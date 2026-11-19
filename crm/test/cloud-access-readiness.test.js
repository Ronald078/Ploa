'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createCloudHandler } = require('../cloud/http');
const { CloudError } = require('../cloud/errors');
const identity = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.invalid' };

async function setup(t, { required = true } = {}) {
  const state = { now: Date.now(), code: '', required, verified: false, available: true, emails: 0 };
  const credentials = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: state.now + 3600000 };
  const gateway = {
    async signIn(_email, password) { if (password === 'wrong') throw new CloudError(401, 'authentication', 'Confira seu acesso.'); return credentials; },
    async user() { return identity; }, async signOut() {},
    async security() { return { email2fa: state.required }; },
    async emailAccess() { return !state.required || state.verified; },
    async capabilities() { return { google: false, signup: false }; },
    async changePassword() { state.changed = true; },
    async workspaces() { if (!state.available) throw new CloudError(503, 'provider_unavailable', 'Tente novamente.'); return []; },
  };
  let data = {};
  const persistence = { available: true, load: () => data, save: value => { data = value; } };
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  handler = createCloudHandler({ origin, gateway, persistence, now: () => state.now,
    mailer: { ready: true, async sendCode(_email, code) { state.code = code; state.emails++; } },
    emailSecurity: { ready: true, async mark() { state.verified = true; } },
  });
  t.after(() => { handler.dispose(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const jar = new Map();
  async function call(route, body, savedCookie) {
    const response = await fetch(origin + '/api/cloud/' + route, { method: body ? 'POST' : 'GET',
      headers: { Cookie: savedCookie || [...jar].map(([k, v]) => k + '=' + v).join('; '), ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';'), split = pair.indexOf('=');
      if (pair.slice(split + 1)) jar.set(pair.slice(0, split), pair.slice(split + 1)); else jar.delete(pair.slice(0, split));
    }
    return { status: response.status, body: await response.json() };
  }
  return { call, state, jar };
}

test('código incorreto permite corrigir; código vencido pede reinício e não cria sessão', async t => {
  const f = await setup(t);
  await f.call('login', { email: identity.email, password: 'fixture' });
  assert.equal((await f.call('verify-email', { code: '000000' })).body.code, 'email_code');
  assert.ok((await f.call('session')).body.challenge);
  f.state.now += 300001;
  assert.equal((await f.call('verify-email', { code: f.state.code })).body.code, 'email_expired');
  assert.equal((await f.call('workspaces')).status, 401);
  assert.equal(f.state.emails, 1);
});

test('cinco erros encerram o desafio; voltar cancela o código também no servidor', async t => {
  const f = await setup(t);
  await f.call('login', { email: identity.email, password: 'fixture' });
  for (let index = 0; index < 5; index++) {
    const result = await f.call('verify-email', { code: '000000' });
    assert.equal(result.body.code, index === 4 ? 'email_attempts' : 'email_code');
  }
  f.state.now += 61000;
  await f.call('login', { email: identity.email, password: 'fixture' });
  const savedCookie = 'ploa_email_challenge=' + f.jar.get('ploa_email_challenge');
  assert.equal((await f.call('logout', {})).status, 200);
  assert.equal((await f.call('verify-email', { code: f.state.code }, savedCookie)).body.code, 'email_expired');
});

test('limite de tentativas não impede sair ou cancelar o acesso', async t => {
  const f = await setup(t, { required: false });
  assert.equal((await f.call('login', { email: identity.email, password: 'fixture' })).status, 200);
  for (let index = 0; index < 9; index++) await f.call('login', { email: identity.email, password: 'wrong' });
  assert.equal((await f.call('login', { email: identity.email, password: 'wrong' })).status, 429);
  assert.equal((await f.call('logout', {})).status, 200);
  assert.equal((await f.call('session')).status, 401);
});

test('indisponibilidade nas empresas preserva a sessão para nova consulta', async t => {
  const f = await setup(t, { required: false });
  await f.call('login', { email: identity.email, password: 'fixture' });
  f.state.available = false;
  assert.equal((await f.call('workspaces')).status, 503);
  assert.equal((await f.call('session')).body.user.email, identity.email);
  f.state.available = true;
  assert.deepEqual((await f.call('workspaces')).body.workspaces, []);
});

test('senha atual incorreta não desconecta a conta nem altera a senha', async t => {
  const f = await setup(t, { required: false });
  await f.call('login', { email: identity.email, password: 'fixture' });
  const result = await f.call('password', { currentPassword: 'wrong', password: 'NovaSenha42!', confirmPassword: 'NovaSenha42!' });
  assert.equal(result.status, 400); assert.equal(result.body.code, 'current_password');
  assert.equal(f.state.changed, undefined);
  assert.equal((await f.call('session')).body.user.email, identity.email);
});

const apiModule = () => import(pathToFileURL(path.resolve(__dirname, '../app-next/src/cloud/account-api.js')).href);
test('cliente encerra espera e nunca repete POST automaticamente', async () => {
  const { createAccountApi } = await apiModule();
  let calls = 0;
  const api = createAccountApi({ timeout: 15, fetcher: (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => { const timer = setTimeout(() => {}, 1000); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
  } });
  await assert.rejects(api('signup', { email: identity.email }), /conferir o resultado antes de repetir/);
  assert.equal(calls, 1);
});

test('cliente distingue cancelamento, falha de rede, retorno inválido e sessão vencida', async () => {
  const { createAccountApi } = await apiModule();
  await assert.rejects(createAccountApi({ fetcher: async () => { throw new TypeError('offline'); } })('session'), /Confira sua internet/);
  await assert.rejects(createAccountApi({ fetcher: async () => new Response('not-json') })('session'), /Atualize a página/);
  await assert.rejects(createAccountApi({ fetcher: async () => new Response('null') })('session'), /dados recebidos/);
  await assert.rejects(createAccountApi({ fetcher: async () => new Response(JSON.stringify({ code: 'session', error: 'Entre novamente.' }), { status: 401 }) })('session'), { status: 401, code: 'session' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createAccountApi({ fetcher: async (_url, { signal }) => { throw signal.reason; } })('session', null, controller.signal), { name: 'AbortError' });
});
