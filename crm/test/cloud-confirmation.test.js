'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSupabaseGateway } = require('../cloud/supabase');
const { createCloudHandler } = require('../cloud/http');
const { createHash } = require('node:crypto');

test('resend supplies a new PKCE challenge and preserves the callback redirect', async () => {
  const calls = [], gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'public-fake', fetch: async (url, options) => {
    calls.push({ url, options }); return new Response('{}');
  } });
  await gateway.resendConfirmation(' demo@example.invalid ', { redirect: 'http://127.0.0.1:4311/auth/callback?flow=fixture', challenge: 'challenge' });
  const call = calls[0];
  assert.equal(new URL(call.url).pathname, '/auth/v1/resend');
  assert.equal(new URL(call.url).searchParams.get('redirect_to'), 'http://127.0.0.1:4311/auth/callback?flow=fixture');
  assert.deepEqual(JSON.parse(call.options.body), { type: 'signup', email: 'demo@example.invalid', code_challenge: 'challenge', code_challenge_method: 's256' });
  await assert.rejects(gateway.resendConfirmation('invalid', {}), { status: 400 });
  assert.equal(calls.length, 1);
});

test('unconfirmed email, quota and weak-password errors are actionable without raw provider data', async () => {
  for (const [status, code, expected] of [[400, 'email_not_confirmed', 'email_not_confirmed'], [429, 'over_email_send_rate_limit', 'provider_limit'], [422, 'weak_password', 'password']]) {
    const gateway = createSupabaseGateway({ url: 'https://fake.invalid', key: 'fake', fetch: async () => new Response(JSON.stringify({ code, msg: 'private-upstream-detail' }), { status }) });
    await assert.rejects(gateway.signIn('demo@example.invalid', 'fixture'), error => {
      assert.equal(error.code, expected); assert.equal(error.message.includes('private-upstream-detail'), false);
      assert.equal(error.message.includes('12 caracteres'), false); return true;
    });
  }
});

async function fixture(t, { fail = false, required = false } = {}) {
  let clock = 0, count = 0, sent, verifier, revoked = 0, codes = 0;
  const identity = { id: '11111111-1111-4111-8111-111111111111', email: 'demo@example.invalid' };
  const gateway = {
    async resendConfirmation(email, flow) { count++; sent = { email, flow }; if (fail) throw new Error('private upstream detail'); },
    async exchangeCode(code, value) { assert.equal(code, 'fixture-code'); verifier = value; return { accessToken: 'fake', refreshToken: 'fake', expiresAt: Date.now() + 3600000 }; },
    async user() { return identity; }, async security() { return { email2fa: required }; },
    async signOut() { revoked++; },
    async signIn() { return { accessToken: 'fake', refreshToken: 'fake', expiresAt: Date.now() + 3600000 }; },
  };
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  handler = createCloudHandler({ origin, gateway, now: () => clock, mailer: { ready: true, async sendCode() { codes++; } }, emailSecurity: { ready: true } });
  t.after(() => { handler.dispose(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const post = (email = identity.email, extra = {}) => fetch(origin + '/api/cloud/resend', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, ...extra }) });
  return { origin, post, get count() { return count; }, get sent() { return sent; }, get verifier() { return verifier; }, get revoked() { return revoked; }, get codes() { return codes; }, advance() { clock += 61000; }, expire() { clock += 1800001; } };
}

test('signup confirmation works in another browser without creating an app session or allowing replay', async t => {
  const f = await fixture(t), response = await f.post();
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.retryAfter, 60); assert.equal(body.message.includes('Se o cadastro'), true);
  const url = f.sent.flow.redirect + '&code=fixture-code';
  const result = await fetch(url, { redirect: 'manual' });
  assert.equal(result.headers.get('location'), '/?notice=signup_confirmed');
  assert.equal(result.headers.getSetCookie().some(value => value.startsWith('ploa_preview_session=')), false);
  assert.equal(f.revoked, 1); assert.equal(f.codes, 0);
  const cookie = result.headers.getSetCookie().find(value => value.startsWith('ploa_signup_result=')).split(';')[0];
  const status = await fetch(f.origin + '/api/cloud/session', { headers: { Cookie: cookie } });
  assert.deepEqual(await status.json(), { signupConfirmed: true });
  assert.equal((await fetch(f.origin + '/api/cloud/workspaces', { headers: { Cookie: cookie } })).status, 401);
  assert.equal(createHash('sha256').update(f.verifier).digest('base64url'), f.sent.flow.challenge);
  const replay = await fetch(url, { headers: { Cookie: cookie }, redirect: 'manual' }); assert.equal(replay.headers.get('location'), '/?notice=callback_failed');
});

test('the original browser also receives confirmation only and a transient display receipt', async t => {
  const f = await fixture(t), response = await f.post();
  const original = response.headers.getSetCookie().find(value => value.startsWith('ploa_auth_flow=')).split(';')[0];
  const result = await fetch(f.sent.flow.redirect + '&code=fixture-code', { headers: { Cookie: original }, redirect: 'manual' });
  assert.equal(result.headers.get('location'), '/?notice=signup_confirmed');
  const receipt = result.headers.getSetCookie().find(value => value.startsWith('ploa_signup_result=')).split(';')[0];
  f.expire();
  assert.equal((await fetch(f.origin + '/api/cloud/session', { headers: { Cookie: receipt } })).status, 401);
});

test('unknown/restarted flows and invalid code cannot assert successful confirmation', async t => {
  const f = await fixture(t);
  const response = await fetch(f.origin + '/auth/callback?flow=' + 'a'.repeat(43) + '&code=fixture-code', { redirect: 'manual' });
  assert.equal(response.headers.get('location'), '/?notice=callback_failed');
  assert.equal(response.headers.getSetCookie().some(value => value.startsWith('ploa_signup_result=')), false);
  assert.equal((await fetch(f.origin + '/api/cloud/session?notice=signup_confirmed', { headers: { Cookie: 'ploa_signup_result=' + 'a'.repeat(43) } })).status, 401);
  await f.post();
  const invalid = await fetch(f.sent.flow.redirect + '&code=invalid', { redirect: 'manual' });
  assert.equal(invalid.headers.get('location'), '/?notice=callback_failed');
  assert.equal(invalid.headers.getSetCookie().some(value => value.startsWith('ploa_signup_result=')), false);
});

test('confirmation never bypasses password login and the enabled email second factor', async t => {
  const f = await fixture(t, { required: true }); await f.post();
  const confirmed = await fetch(f.sent.flow.redirect + '&code=fixture-code', { redirect: 'manual' });
  const cookie = confirmed.headers.getSetCookie().find(value => value.startsWith('ploa_signup_result=')).split(';')[0];
  assert.equal(f.codes, 0);
  const login = await fetch(f.origin + '/api/cloud/login', { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ email: 'demo@example.invalid', password: 'fixture-only' }) });
  assert.equal(login.status, 200); assert.ok((await login.json()).challenge); assert.equal(f.codes, 1);
  assert.equal(login.headers.getSetCookie().some(value => /^ploa_preview_session=[^;]/.test(value)), false);
  assert.equal((await fetch(f.origin + '/api/cloud/workspaces', { headers: { Cookie: cookie } })).status, 401);
});

test('concurrent and case-varied requests cannot resend within the one-minute window', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.post(), f.post('DEMO@example.invalid')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]); assert.equal(f.count, 1);
  f.advance(); assert.equal((await f.post()).status, 200); assert.equal(f.count, 2);
});

test('an old or unknown link does not erase the browser cookie of a newer flow', async t => {
  const f = await fixture(t), response = await f.post();
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('ploa_auth_flow=')).split(';')[0];
  const failed = await fetch(f.origin + '/auth/callback?flow=' + 'x'.repeat(43) + '&code=old', { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(failed.headers.getSetCookie().some(value => value.startsWith('ploa_auth_flow=')), false);
  assert.equal(failed.headers.get('location'), '/?notice=callback_failed');
});

test('uncertain provider errors keep cooldown and expose no raw errors or new cookie', async t => {
  const f = await fixture(t, { fail: true }), response = await f.post();
  assert.equal(response.status, 500); assert.equal(response.headers.has('set-cookie'), false);
  assert.equal((await response.text()).includes('private upstream'), false);
  assert.equal((await f.post()).status, 429); assert.equal(f.count, 1);
});

test('resend rejects foreign origins and invalid email before calling the provider', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('invalid')).status, 400);
  const rejected = await fetch(f.origin + '/api/cloud/resend', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@example.invalid' }) });
  assert.equal(rejected.status, 403); assert.equal(f.count, 0);
});
