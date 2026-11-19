'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadConfig } = require('../cloud/config');
const { createSupabaseGateway } = require('../cloud/supabase');
const { createSessionStore } = require('../cloud/sessions');
const { createCloudHandler } = require('../cloud/http');
const { CloudError } = require('../cloud/errors');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const WA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', WB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = id => ({ id, email: id === A ? 'a@example.invalid' : 'b@example.invalid' });
const credentials = id => ({ accessToken: 'access-' + id, refreshToken: 'refresh-' + id, expiresAt: Date.now() + 3600000 });
const response = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('configuração rejeita chave administrativa, destino estranho e porta inválida', () => {
  const env = { PLOA_SUPABASE_URL: 'https://ploa-example.supabase.co', PLOA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake' };
  assert.equal(loadConfig(env).host, '127.0.0.1');
  assert.equal(loadConfig(env).port, 4313);
  for(const port of ['4310','4311'])assert.throws(()=>loadConfig({...env,PLOA_CLOUD_PORT:port}));
  for (const value of ['sb_secret_fake', 'invalid', 'ey.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x']) {
    assert.throws(() => loadConfig({ ...env, PLOA_SUPABASE_PUBLISHABLE_KEY: value }));
  }
  for (const value of ['http://ploa-example.supabase.co', 'https://evil.invalid', 'https://ploa-example.supabase.co/other']) {
    assert.throws(() => loadConfig({ ...env, PLOA_SUPABASE_URL: value }));
  }
  assert.throws(() => loadConfig({ ...env, PLOA_CLOUD_PORT: '0' }));
});

test('gateway confirma a identidade no Auth e não usa metadados para permissões', async () => {
  const calls = [];
  const gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'public-fake', fetch: async (url, options) => {
    calls.push({ url, options });
    return response({ ...user(A), user_metadata: { role: 'owner', workspace_id: WB } });
  } });
  assert.deepEqual(await gateway.user('token-a'), user(A));
  assert.equal(calls[0].url, 'https://fake.invalid/auth/v1/user');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-a');
  assert.equal(calls[0].options.redirect, 'error');
});

test('gateway descarta conta anônima e não expõe erros brutos do provedor', async () => {
  const gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'public-fake', fetch: async () => response({ ...user(A), is_anonymous: true }) });
  await assert.rejects(gateway.user('token'), { status: 401 });
  for (const status of [401, 429, 500]) {
    const broken = createSupabaseGateway({ url: 'https://fake.invalid', key: 'public-fake', fetch: async () => response({ secret: 'never-serialize' }, status) });
    await assert.rejects(broken.user('token'), failure => !failure.message.includes('never-serialize') && failure.status === (status === 500 ? 503 : status));
  }
});

test('gateway trata falha de rede e resposta não JSON como indisponibilidade', async () => {
  for (const fetcher of [async () => { throw new Error('sensitive'); }, async () => new Response('<html>gateway</html>')]) {
    const gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'fake', fetch: fetcher });
    await assert.rejects(gateway.user('token'), failure => failure.status === 503 && !failure.message.includes('sensitive'));
  }
});

test('gateway isola membros e dono sem aceitar empresa fornecida por metadados', async () => {
  const gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'fake', fetch: async url => {
    return response(url.includes('ploa_workspace_members') ? [] : [
      { id: WA, name: 'Empresa A', owner_id: A }, { id: WB, name: 'Empresa B', owner_id: B },
    ]);
  } });
  assert.deepEqual(await gateway.workspaces('a', user(A)), [{ id: WA, name: 'Empresa A', role: 'owner' }]);
  await assert.rejects(gateway.requireWorkspace('a', user(A), WB), { status: 404 });
  await assert.rejects(gateway.requireWorkspace('a', user(A), 'invalid'), { status: 404 });
});

test('criação usa o usuário verificado e valida o nome antes de gravar', async () => {
  let sent;
  const gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'fake', fetch: async (_url, options) => {
    sent = JSON.parse(options.body); return response([{ id: WA, name: sent.name, owner_id: sent.owner_id }]);
  } });
  assert.deepEqual(await gateway.createWorkspace('a', user(A), ' Empresa A '), { id: WA, name: 'Empresa A', role: 'owner' });
  assert.deepEqual(sent, { name: 'Empresa A', owner_id: A });
  for (const name of ['', '\nEmpresa', 'a'.repeat(81), null]) await assert.rejects(gateway.createWorkspace('a', user(A), name), { status: 400 });
});

function fakeGateway() {
  const gateway = {
    async user(token) { return user(token.includes(B) ? B : A); },
    async signIn(email) { return credentials(email.startsWith('b@') ? B : A); },
    async refresh() { return credentials(A); }, async signOut() {},
    async workspaces(token, identity) { return [{ id: identity.id === A ? WA : WB, name: identity.id === A ? 'Empresa A' : 'Empresa B', role: 'owner' }]; },
    async createWorkspace(token, identity, name) { return { id: WA, name, owner: identity.id }; },
    async requireWorkspace(token, identity, id) {
      const space = (await gateway.workspaces(token, identity)).find(item => item.id === id);
      if (!space) throw new CloudError(404, 'workspace', 'Empresa não encontrada.');
      return space;
    },
  };
  return gateway;
}

test('sessão opaca não entrega tokens e expira mesmo com uso contínuo', async () => {
  let time = Date.now();
  const store = createSessionStore({ gateway: fakeGateway(), now: () => time, ttl: 1000 });
  const session = await store.create(credentials(A));
  assert.equal(session.id.length, 43);
  assert.equal('accessToken' in session, false);
  assert.deepEqual((await store.resolve(session.id)).identity, user(A));
  time += 1001;
  await assert.rejects(store.resolve(session.id), { status: 401 });
});

test('requisições simultâneas trocam o refresh token somente uma vez', async () => {
  const gateway = fakeGateway(); let calls = 0;
  gateway.refresh = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return credentials(A); };
  const store = createSessionStore({ gateway });
  const session = await store.create({ ...credentials(A), expiresAt: 0 });
  await Promise.all([store.resolve(session.id), store.resolve(session.id), store.resolve(session.id)]);
  assert.equal(calls, 1);
});

test('indisponibilidade preserva a sessão; revogação ou mudança de identidade a invalida', async () => {
  const gateway = fakeGateway(), store = createSessionStore({ gateway });
  const session = await store.create(credentials(A));
  gateway.user = async () => { throw new CloudError(503, 'offline', 'offline'); };
  await assert.rejects(store.resolve(session.id), { status: 503 });
  gateway.user = async () => user(A);
  await store.resolve(session.id);
  gateway.user = async () => user(B);
  await assert.rejects(store.resolve(session.id), { status: 401 });
  gateway.user = async () => user(A);
  await assert.rejects(store.resolve(session.id), { status: 401 });
});

test('logout local remove acesso mesmo se o provedor estiver indisponível', async () => {
  const gateway = fakeGateway(), store = createSessionStore({ gateway });
  const session = await store.create(credentials(A));
  gateway.signOut = async () => { throw new Error('offline'); };
  await store.remove(session.id);
  await assert.rejects(store.resolve(session.id), { status: 401 });
});

async function fixture(t) {
  const gateway = fakeGateway(); let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  handler = createCloudHandler({ origin: base, gateway });
  t.after(() => { handler.dispose(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const request = (path, options = {}) => fetch(base + path, options);
  const post = (path, body, cookie) => request(path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const login = async email => {
    const res = await post('/api/cloud/login', { email, password: 'not-a-real-password' });
    assert.equal(res.status, 200);
    return res.headers.getSetCookie().find(value => value.startsWith('ploa_preview_session=')).split(';')[0];
  };
  return { base, gateway, request, post, login };
}

test('HTTP: sessão exige login, devolve somente identidade e usa cookie HttpOnly', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/cloud/session')).status, 401);
  const res = await f.post('/api/cloud/login', { email: 'a@example.invalid', password: 'fake' });
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const result = await res.json();
  assert.deepEqual(result.user, user(A));
  assert.equal(result.mode, 'normal');
  assert.equal(result.message, 'Acesso realizado.');
  assert.equal('accessToken' in result || 'refreshToken' in result, false);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('HTTP: duas contas não acessam empresas uma da outra; rotas do CRM local não existem', async t => {
  const f = await fixture(t), ca = await f.login('a@example.invalid'), cb = await f.login('b@example.invalid');
  for (const [cookie, own, other] of [[ca, WA, WB], [cb, WB, WA]]) {
    const headers = { Cookie: cookie };
    assert.equal((await f.request('/api/cloud/workspaces/' + own, { headers })).status, 200);
    assert.equal((await f.request('/api/cloud/workspaces/' + other, { headers })).status, 404);
    assert.equal((await f.request('/api/workspace', { headers })).status, 404);
  }
});

test('HTTP: dono enviado pelo navegador é ignorado e logout encerra a sessão', async t => {
  const f = await fixture(t), cookie = await f.login('a@example.invalid');
  const created = await f.post('/api/cloud/workspaces', { name: 'Empresa fictícia', owner_id: B }, cookie);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).workspace.owner, A);
  assert.equal((await f.post('/api/cloud/logout', {}, cookie)).status, 200);
  assert.equal((await f.request('/api/cloud/session', { headers: { Cookie: cookie } })).status, 401);
});

test('HTTP: nega origem externa, conteúdo inválido e excesso de tentativas de login', async t => {
  const f = await fixture(t);
  const res = await f.request('/api/cloud/login', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  assert.equal((await f.request('/api/cloud/login', { method: 'POST', headers: { Origin: f.base }, body: '{}' })).status, 415);
  for (let i = 0; i < 9; i++) await f.login('a@example.invalid');
  assert.equal((await f.post('/api/cloud/login', { email: 'a@example.invalid', password: 'fake' })).status, 429);
});
