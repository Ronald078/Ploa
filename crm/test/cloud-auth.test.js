'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuthFlows } = require('../cloud/auth-flows');
const { createEmailChallenges } = require('../cloud/email-challenges');
const { createSessionStore } = require('../cloud/sessions');
const { createSessionPersistence } = require('../cloud/session-persistence');
const { createSupabaseGateway } = require('../cloud/supabase');
const {CloudError}=require('../cloud/errors');
const { createEmailService } = require('../cloud/email-service');
const { createCloudHandler } = require('../cloud/http');
const { createEmailSecurityProvider } = require('../cloud/email-security-provider');
const A = '11111111-1111-4111-8111-111111111111';
const identity = { id: A, email: 'demo@example.invalid' };
const credentials = () => ({ accessToken: 'fake-provider-token', refreshToken: 'fake-refresh', expiresAt: Date.now() + 3600000 });
const memory = () => { let data = {}; return { available: true, load: () => structuredClone(data), save: next => { data = structuredClone(next); } }; };

test('PKCE exige o navegador correto, expira e não aceita replay', () => {
  let now = 100;
  const flows = createAuthFlows({ origin: 'http://127.0.0.1:4311', now: () => now });
  const flow = flows.create('google', true);
  assert.equal(flow.challenge.length, 43);
  assert.throws(() => flows.consume(flow.id, 'x'.repeat(43)), { status: 400 });
  assert.equal(flows.consume(flow.id, flow.id).remember, true);
  assert.throws(() => flows.consume(flow.id, flow.id), { status: 400 });
  const expired = flows.create('recovery'); now += 1800001;
  assert.throws(() => flows.consume(expired.id, expired.id), { status: 400 });
});

test('código de e-mail só pode ser usado uma vez, expira e tem limite de tentativas', async () => {
  let now = 0, sent;
  const challenges = createEmailChallenges({ now: () => now, mailer: { async sendCode(email, code) { sent = { email, code }; } } });
  const item = await challenges.issue(identity, credentials());
  assert.equal(item.email, 'de***@example.invalid');
  assert.equal('code' in item, false);
  assert.equal(challenges.consume(item.id, sent.code).identity.id, A);
  assert.throws(() => challenges.consume(item.id, sent.code));
  await assert.rejects(challenges.issue(identity, credentials()), { status: 429 });
  now += 61000; const limited = await challenges.issue(identity, credentials());
  for (let i = 0; i < 5; i++) assert.throws(() => challenges.consume(limited.id, '000000'), { status: 400 });
  assert.throws(() => challenges.consume(limited.id, sent.code));
  now += 61000; const expired = await challenges.issue(identity, credentials()); now += 300001;
  assert.throws(() => challenges.consume(expired.id, sent.code));
});

test('Lembrar de mim recupera sessão protegida após reiniciar e logout remove o acesso', async () => {
  const persistence = memory(), gateway = { async user() { return identity; }, async signOut() {} };
  const first = createSessionStore({ gateway, persistence });
  const regular = await first.create(credentials()), remembered = await first.create(credentials(), { remember: true });
  assert.equal(regular.maxAge, undefined);
  assert.equal(remembered.maxAge, 30 * 86400);
  first.clear();
  const second = createSessionStore({ gateway, persistence });
  assert.equal((await second.resolve(remembered.id)).identity.id, A);
  await assert.rejects(second.resolve(regular.id), { status: 401 });
  await second.remove(remembered.id);
  const third = createSessionStore({ gateway, persistence });
  await assert.rejects(third.resolve(remembered.id), { status: 401 });
});

test('tokens lembrados são cifrados e arquivo adulterado não é aceito', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ploa-auth-'));
  t.after(() => { const target = fs.realpathSync(directory), root = fs.realpathSync(os.tmpdir()); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test directory'); fs.rmSync(target, { recursive: true, force: true }); });
  const keyStore = { available: true, load: () => ({ sessionEncryptionKey: Buffer.alloc(32, 7).toString('base64') }) };
  const store = createSessionPersistence({ directory, keyStore });
  const data = { sid: { accessToken: 'secret-token-never-plain' } };
  store.save(data); const file = path.join(directory, 'remembered-sessions.enc.json');
  assert.equal(fs.readFileSync(file, 'utf8').includes('secret-token-never-plain'), false);
  assert.deepEqual(store.load(), data);
  const raw = JSON.parse(fs.readFileSync(file)); raw.tag = Buffer.alloc(16).toString('base64');
  fs.writeFileSync(file, JSON.stringify(raw)); assert.throws(() => store.load());
});

test('Windows protege e recupera a chave das sessões com DPAPI em diretório descartável', { skip: process.platform !== 'win32' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ploa-dpapi-'));
  t.after(() => { const target = fs.realpathSync(directory), root = fs.realpathSync(os.tmpdir()); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test directory'); fs.rmSync(target, { recursive: true, force: true }); });
  const first = createSessionPersistence({ directory });
  first.save({ fixture: { accessToken: 'disposable-test-only' } });
  const second = createSessionPersistence({ directory });
  assert.deepEqual(second.load(), { fixture: { accessToken: 'disposable-test-only' } });
  assert.equal(fs.readFileSync(path.join(directory, 'credenciais-ia.dpapi.json'), 'utf8').includes('sessionEncryptionKey'), false);
});

test('falha ao limpar persistência não impede a tentativa de revogar a sessão no provedor', async () => {
  const persistence = memory(); let revoked = 0;
  const store = createSessionStore({ gateway: { async user() { return identity; }, async signOut() { revoked++; } }, persistence });
  const session = await store.create(credentials(), { remember: true });
  persistence.save = () => { throw new Error('disk'); };
  await assert.rejects(store.remove(session.id), { status: 503 });
  assert.equal(revoked, 1); await assert.rejects(store.resolve(session.id), { status: 401 });
});

test('registro da confirmação usa chave administrativa só no servidor e recusa chave pública', async () => {
  let captured;
  const sessionId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const token = 'header.' + Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url') + '.signature';
  const service = createEmailSecurityProvider({ url: 'https://fake.invalid', serverKey: 'sb_secret_test', fetch: async (url, options) => { captured = { url, options }; return new Response('null'); } });
  await service.mark({ accessToken: token }, identity, true);
  assert.equal(captured.url, 'https://fake.invalid/rest/v1/rpc/ploa_mark_email_session');
  assert.equal(captured.options.headers.apikey, 'sb_secret_test');
  assert.equal(JSON.parse(captured.options.body).p_user, A);
  assert.equal(JSON.parse(captured.options.body).p_session, sessionId);
  const unavailable = createEmailSecurityProvider({ url: 'https://fake.invalid', serverKey: 'sb_publishable_fake' });
  assert.equal(unavailable.ready, false);
  await assert.rejects(unavailable.mark({ accessToken: token }, identity, false), { status: 503 });
});

test('mailer usa Resend com idempotência e não retorna chave nem código', async () => {
  let sent;
  const mailer = createEmailService({ key: 're_fake', from: 'access@example.invalid', fetch: async (url, options) => { sent = { url, options }; return new Response('{}'); } });
  await mailer.sendCode('demo@example.invalid', '123456', 'fake-challenge');
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.options.headers['Idempotency-Key'], 'ploa-code/fake-challenge');
  assert.equal(JSON.parse(sent.options.body).to[0], 'demo@example.invalid');
  assert.ok(JSON.parse(sent.options.body).html.includes('123456'));
  assert.ok(JSON.parse(sent.options.body).text.includes('123456'));
  await assert.rejects(createEmailService().sendCode('demo@example.invalid', '123456', 'id'), { status: 503 });
});

test('cadastro e recuperação usam PKCE e senha tem validação independente do navegador', async () => {
  const calls = [], gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'fake', fetch: async (url, options) => { calls.push({ url, options }); return new Response('{}'); } });
  const flow = { redirect: 'http://127.0.0.1:4311/auth/callback?flow=fake', challenge: 'challenge' };
  await assert.rejects(gateway.signUp('demo@example.invalid', '1234567', flow), { status: 400 });
  assert.equal(await gateway.signUp('demo@example.invalid', 'Abcdef1!', flow), null);
  await gateway.recover('demo@example.invalid', flow);
  assert.equal(JSON.parse(calls[0].options.body).code_challenge_method, 's256');
  assert.ok(calls[1].url.startsWith('https://fake.invalid/auth/v1/recover?redirect_to='));
  const google = new URL(gateway.googleUrl(flow));
  assert.equal(google.searchParams.get('provider'), 'google');
  assert.equal(google.searchParams.get('scopes'), 'openid email profile');
});

async function fixture(t, { required = false } = {}) {
  let clock=Date.now();
  const state = { required, verified: false, sent: null, signupFlow: null, recoverFlow: null, updates: 0,marks:0,mails:0,identity };
  const gateway = {
    async user() { return state.identity; }, async signIn() { if(state.denyLogin)throw new CloudError(401,'authentication','Credenciais inválidas.');return credentials(); }, async signOut() {},
    async security() { return { email2fa: state.required }; }, async emailAccess() { return !state.required || state.verified; },
    async capabilities() { return { google: true, signup: true }; },
    async signUp(email, password, flow) { state.signupFlow = flow; return null; },
    async recover(email, flow) { state.recoverFlow = flow; },
    googleUrl(flow) { state.googleFlow = flow; return 'https://fake.invalid/authorize'; },
    async exchangeCode(code) { assert.equal(code, 'valid-code'); return credentials(); },
    async changePassword() { if(state.samePassword)throw new CloudError(400,'same_password','A nova senha deve ser diferente da senha atual.');state.updates++; }, async revokeAll() {},
    async workspaces() { return [{ id: A, name: 'Fictícia', role: 'owner' }]; },
  };
  const mailer = { ready: true, async sendCode(email, code) { state.mails++;state.sent = { email, code }; } };
  const emailSecurity = { ready: true, async mark() { state.marks++;state.verified = true; }, async set(_c, _u, _r, enabled) { state.required = enabled; state.verified = enabled; } };
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  handler = createCloudHandler({ origin, gateway, persistence: memory(), mailer, emailSecurity,now:()=>clock });
  t.after(() => { handler.dispose(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const jar = new Map();
  async function call(route, body, { useCookie = true, follow = true } = {}) {
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', redirect: follow ? 'follow' : 'manual',
      headers: { ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(useCookie ? { Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'), separator = pair.indexOf('='), key = pair.slice(0, separator), value = pair.slice(separator + 1);
      if (!value) jar.delete(key); else jar.set(key, value);
    }
    return response;
  }
  return { origin, state, call, jar,advance:ms=>{clock+=ms;} };
}

async function rememberedLogin(f){
 const result=await f.call('/api/cloud/login',{email:identity.email,password:'fixture',remember:true});assert.equal(result.status,200);
 return f.call('/api/cloud/verify-email',{code:f.state.sent.code});
}

test('HTTP: lembrar dispensa novo código por dez minutos sem renovar o prazo nem manter sessão após logout',async t=>{
 const f=await fixture(t,{required:true}),verified=await rememberedLogin(f);
 assert.equal(verified.status,200);
 assert.ok(verified.headers.getSetCookie().some(value=>/ploa_verified_device=.*HttpOnly; SameSite=Lax; Path=\/; Max-Age=600$/.test(value)));
 assert.ok(verified.headers.getSetCookie().some(value=>value.startsWith('ploa_preview_session=')&&value.includes('Max-Age=2592000')));
 f.advance(610000);
 const logout=await f.call('/api/cloud/logout',{});assert.equal((await f.call('/api/cloud/session')).status,401);
 assert.ok(logout.headers.getSetCookie().some(value=>value.startsWith('ploa_verified_device=')&&value.includes('Max-Age=600')),'prazo começa ao sair, mesmo depois de expirar a confirmação original');
 assert.ok(f.jar.has('ploa_verified_device'));
 f.advance(300000);f.state.verified=false;
 const again=await f.call('/api/cloud/login',{email:identity.email,password:'fixture',remember:true});
 assert.ok((await again.json()).user);assert.equal(f.state.mails,1);assert.equal(f.state.marks,2,'confirma a nova sessão no servidor');
 assert.ok(!again.headers.getSetCookie().some(value=>value.startsWith('ploa_verified_device=')),'reentrada não renova confiança');
 f.jar.delete('ploa_preview_session');f.advance(300001);
 assert.ok((await (await f.call('/api/cloud/login',{email:identity.email,password:'fixture',remember:true})).json()).challenge);
 assert.equal(f.state.mails,2);
});

test('HTTP: confiança não substitui senha, não vale em outro navegador nem em outra conta',async t=>{
 const f=await fixture(t,{required:true});await rememberedLogin(f);await f.call('/api/cloud/logout',{});
 f.state.denyLogin=true;assert.equal((await f.call('/api/cloud/login',{email:identity.email,password:'errada',remember:true})).status,401);
 f.state.denyLogin=false;f.advance(61000);
 const otherBrowser=await f.call('/api/cloud/login',{email:identity.email,password:'fixture',remember:true},{useCookie:false});assert.ok((await otherBrowser.json()).challenge);
 f.state.identity={id:'22222222-2222-4222-8222-222222222222',email:'other@example.invalid'};
 const other=await f.call('/api/cloud/login',{email:f.state.identity.email,password:'fixture',remember:true});assert.ok((await other.json()).challenge);
});

test('HTTP: sem lembrar não emite prova e desmarcar elimina confirmação anterior',async t=>{
 const f=await fixture(t,{required:true});
 await f.call('/api/cloud/login',{email:identity.email,password:'fixture'});
 await f.call('/api/cloud/verify-email',{code:f.state.sent.code});assert.equal(f.jar.has('ploa_verified_device'),false);
 await f.call('/api/cloud/logout',{});f.advance(61000);await rememberedLogin(f);
 await f.call('/api/cloud/logout',{});f.advance(61000);
 const login=await f.call('/api/cloud/login',{email:identity.email,password:'fixture',remember:false});assert.ok((await login.json()).challenge);
 await f.call('/api/cloud/verify-email',{code:f.state.sent.code});assert.equal(f.jar.has('ploa_verified_device'),false);
});

test('HTTP: troca de senha revoga prova mesmo se o navegador reapresentar o cookie antigo',async t=>{
 const f=await fixture(t,{required:true});await rememberedLogin(f);const proof=f.jar.get('ploa_verified_device');
 assert.equal((await f.call('/api/cloud/password',{currentPassword:'fixture',password:'NovaSenha42!',confirmPassword:'NovaSenha42!'})).status,200);
 f.jar.set('ploa_verified_device',proof);f.advance(61000);
 assert.ok((await (await f.call('/api/cloud/login',{email:identity.email,password:'NovaSenha42!',remember:true})).json()).challenge);
});

test('HTTP: desativar e reativar 2FA invalida a prova anterior',async t=>{
 const f=await fixture(t,{required:true});await rememberedLogin(f);const proof=f.jar.get('ploa_verified_device');f.advance(61000);
 await f.call('/api/cloud/email-security',{enabled:false});await f.call('/api/cloud/verify-email',{code:f.state.sent.code});f.advance(61000);
 await f.call('/api/cloud/email-security',{enabled:true});await f.call('/api/cloud/verify-email',{code:f.state.sent.code});
 await f.call('/api/cloud/logout',{});f.jar.set('ploa_verified_device',proof);f.advance(61000);
 assert.ok((await (await f.call('/api/cloud/login',{email:identity.email,password:'fixture',remember:true})).json()).challenge);
});

test('HTTP: Google reutiliza somente prova já confirmada e preserva PKCE',async t=>{
 const f=await fixture(t,{required:true});await rememberedLogin(f);await f.call('/api/cloud/logout',{});
 await f.call('/api/cloud/google',{remember:true});const target=new URL(f.state.googleFlow.redirect);target.searchParams.set('code','valid-code');
 const callback=await f.call(target.pathname+target.search,null,{follow:false});assert.match(callback.headers.get('location'),/notice=welcome/);
 assert.equal(f.state.mails,1);assert.equal(f.state.marks,2);
});

test('HTTP: prova não libera recuperação e a redefinição exige novo código na próxima entrada',async t=>{
 const f=await fixture(t,{required:true});await rememberedLogin(f);const proof=f.jar.get('ploa_verified_device');
 assert.equal((await (await f.call('/api/cloud/session')).json()).remember,true);
 await f.call('/api/cloud/recover',{email:identity.email});const target=new URL(f.state.recoverFlow.redirect);target.searchParams.set('code','valid-code');
 await f.call(target.pathname+target.search,null,{follow:false});
 assert.equal((await (await f.call('/api/cloud/session')).json()).mode,'recovery');
 assert.equal((await f.call('/api/cloud/workspaces')).status,403);
 assert.equal((await f.call('/api/cloud/password',{password:'NovaSenha42!',confirmPassword:'NovaSenha42!'})).status,200);
 f.jar.set('ploa_verified_device',proof);f.advance(61000);
 assert.ok((await (await f.call('/api/cloud/login',{email:identity.email,password:'NovaSenha42!',remember:true})).json()).challenge);
});

test('HTTP: exige código antes de emitir sessão e não aceita repetição', async t => {
  const f = await fixture(t, { required: true });
  const login = await f.call('/api/cloud/login', { email: identity.email, password: 'fake' });
  const result = await login.json(); assert.equal(result.challenge.email, 'de***@example.invalid');
  assert.equal(result.user, undefined); assert.equal(f.jar.has('ploa_preview_session'), false);
  assert.equal((await f.call('/api/cloud/workspaces')).status, 401);
  assert.equal((await f.call('/api/cloud/verify-email', { code: f.state.sent.code })).status, 200);
  assert.equal((await f.call('/api/cloud/workspaces')).status, 200);
  assert.equal((await f.call('/api/cloud/verify-email', { code: f.state.sent.code })).status, 400);
});

test('HTTP: callback exige o cookie original e recuperação não libera os dados da empresa', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/cloud/recover', { email: identity.email })).status, 200);
  const callback = new URL(f.state.recoverFlow.redirect); callback.searchParams.set('code', 'valid-code');
  const route = callback.pathname + callback.search;
  const wrong = await f.call(route, null, { useCookie: false, follow: false }); assert.match(wrong.headers.get('location'), /recovery_failed/);
  // A failed foreign-browser callback must not consume the valid server flow.
  const correct = callback;
  const res = await f.call(correct.pathname + correct.search, null, { follow: false }); assert.match(res.headers.get('location'), /notice=recovery/);
  assert.equal((await f.call('/api/cloud/session')).status, 200);
  assert.equal((await f.call('/api/cloud/workspaces')).status, 403);
  const reset = await f.call('/api/cloud/password', { password: 'NovaSenha42!', confirmPassword: 'NovaSenha42!' });
  assert.equal(reset.status, 200); assert.equal(f.state.updates, 1);
  assert.equal((await f.call('/api/cloud/session')).status, 401);
});

test('HTTP: senha nova fraca ou igual à atual não altera nem desconecta a conta',async t=>{
 const f=await fixture(t);await f.call('/api/cloud/login',{email:identity.email,password:'fixture'});
 const weak=await f.call('/api/cloud/password',{currentPassword:'fixture',password:'Abcdefgh',confirmPassword:'Abcdefgh'});assert.equal(weak.status,400);assert.equal((await weak.json()).code,'password');
 const same=await f.call('/api/cloud/password',{currentPassword:'Abcdef1!',password:'Abcdef1!',confirmPassword:'Abcdef1!'});assert.equal(same.status,400);assert.equal((await same.json()).code,'same_password');
 assert.equal(f.state.updates,0);assert.equal((await f.call('/api/cloud/session')).status,200);
});

test('HTTP: senha repetida na recuperação preserva o link/sessão para escolher outra',async t=>{
 const f=await fixture(t);await f.call('/api/cloud/recover',{email:identity.email});
 const callback=new URL(f.state.recoverFlow.redirect);callback.searchParams.set('code','valid-code');await f.call(callback.pathname+callback.search,null,{follow:false});
 f.state.samePassword=true;
 const result=await f.call('/api/cloud/password',{password:'Abcdef1!',confirmPassword:'Abcdef1!'});assert.equal(result.status,400);assert.equal((await result.json()).code,'same_password');
 assert.equal(f.state.updates,0);assert.equal((await (await f.call('/api/cloud/session')).json()).mode,'recovery');
});

test('HTTP: ativação e desativação por e-mail exigem código', async t => {
  const f = await fixture(t);
  await f.call('/api/cloud/login', { email: identity.email, password: 'fake', remember: true });
  const response = await f.call('/api/cloud/email-security', { enabled: true });
  assert.equal(response.status, 200); assert.equal(f.state.required, false);
  await f.call('/api/cloud/verify-email', { code: f.state.sent.code });
  assert.equal(f.state.required, true); assert.equal(f.state.verified, true);
  const session = await (await f.call('/api/cloud/session')).json(); assert.equal(session.security.email2fa, true);
});
