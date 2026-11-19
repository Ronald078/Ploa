'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configureServerKey } = require('../cloud/configure-server-key');
const { PROJECT_URL, normalizeServerKey, createServerKeySettings, withProtectedServerKey } = require('../cloud/server-key-settings');
const key = 'sb_secret_' + 'synthetic_only_'.repeat(3);
const jwt = role => ['header', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'signature'].join('.');
const config = { url: PROJECT_URL, serverKey: '' };

test('accepts server keys and rejects public keys and unrelated secrets', () => {
  assert.equal(normalizeServerKey(' ' + key + '\n'), key);
  assert.equal(normalizeServerKey(jwt('service_role')), jwt('service_role'));
  for (const value of ['', null, 'sb_publishable_abc', 'gsk_synthetic', jwt('anon'), 'sb_secret_short', key + '\nextra']) {
    assert.throws(() => normalizeServerKey(value), { code: 'server_key' });
  }
});

test('verification only reads the configured project without returning account rows', async () => {
  let saved = null, canceled = false;
  const result = await configureServerKey({ input: { serverKey: key }, config,
    fetch: async (url, options) => {
      assert.equal(url, PROJECT_URL + '/rest/v1/ploa_account_security?select=email_2fa_enabled&limit=0');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { apikey: key });
      assert.equal(options.body, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, body: { cancel: async () => { canceled = true; } } };
    }, store: { save: (...args) => { assert.equal(canceled, true); saved = args; } } });
  assert.deepEqual(saved, [PROJECT_URL, key]);
  assert.equal(result.verified, true);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('legacy service key supplies the legacy bearer header', async () => {
  const legacy = jwt('service_role');
  await configureServerKey({ input: { serverKey: legacy }, config, store: { save() {} }, fetch: async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + legacy);
    return { ok: true };
  } });
});

test('foreign project and conflicting environment cannot fetch or overwrite credentials', async () => {
  const fail = () => assert.fail('Unexpected credential operation');
  for (const candidate of [{ ...config, url: 'https://another.supabase.co' }, { ...config, serverKey: key + 'other' }]) {
    await assert.rejects(configureServerKey({ input: { serverKey: key }, config: candidate, fetch: fail, store: { save: fail } }));
  }
});

test('failed authentication and network errors preserve the previous secret without exposing provider errors', async () => {
  for (const fetcher of [async () => ({ ok: false }), async () => { throw new Error('Sensitive: ' + key); }]) {
    await assert.rejects(configureServerKey({ input: { serverKey: key }, config, fetch: fetcher,
      store: { save: () => assert.fail('Must not save') } }), error => {
      assert.equal(error.message.includes(key), false);
      return error.status === 503;
    });
  }
});

test('protected settings bind the credential to the separate Ploa project', () => {
  let data = {};
  const settings = createServerKeySettings({ store: { load: () => data, save: value => { data = value; } } });
  assert.equal(settings.load(PROJECT_URL), '');
  settings.save(PROJECT_URL, key);
  assert.deepEqual(data, { supabaseServer: { projectUrl: PROJECT_URL, serverKey: key } });
  assert.equal(settings.load(PROJECT_URL), key);
  assert.throws(() => settings.load('https://another.supabase.co'));
  data.supabaseServer.projectUrl = 'https://another.supabase.co';
  assert.throws(() => settings.load(PROJECT_URL));
});

test('hosting environment takes precedence and does not load Windows secrets', () => {
  const original = { ...config, serverKey: key };
  assert.equal(withProtectedServerKey(original, { settings: { load: () => assert.fail('Must not read Windows key') } }).serverKey, key);
  assert.equal(original.serverKey, key);
});

test('local preview composes a protected key without mutating public config', () => {
  const result = withProtectedServerKey(config, { settings: { load: url => { assert.equal(url, PROJECT_URL); return key; } } });
  assert.equal(result.serverKey, key);
  assert.equal(config.serverKey, '');
});
