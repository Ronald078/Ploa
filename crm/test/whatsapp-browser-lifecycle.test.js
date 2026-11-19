'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { protectBrowserLifecycle } = require('../lib/whatsapp-browser-lifecycle');

function fixture({ disconnected = false, stuck = false, unkillable = false } = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 987654, exitCode: null, signalCode: null });
  let closes = 0, kills = 0, cleanups = 0;
  const exit = () => { child.exitCode = 0; child.emit('exit', 0); };
  child.kill = () => { kills++; if (!unkillable) exit(); };
  const browser = { isConnected: () => !disconnected, process: () => child,
    close: async () => { closes++; if (!stuck) exit(); } };
  const client = { pupBrowser: browser, authStrategy: { destroy: async () => { cleanups++; } },
    destroy: async () => { throw new Error('Unprotected destroy should not run'); } };
  protectBrowserLifecycle(client, { closeTimeoutMs: 10, exitTimeoutMs: 10 });
  return { client, child, browser, counts: () => ({ closes, kills, cleanups }) };
}

test('transport disconnected still closes the browser owning the session', async () => {
  const f = fixture({ disconnected: true });
  await f.client.destroy();
  assert.deepEqual(f.counts(), { closes: 1, kills: 0, cleanups: 1 });
  assert.equal(f.child.listenerCount('exit'), 0);
});

test('SDK and reconnect share one close; a later browser has its own lifecycle', async () => {
  const f = fixture();
  await Promise.all([f.client.destroy(), f.client.destroy()]);
  await f.client.destroy();
  assert.deepEqual(f.counts(), { closes: 1, kills: 0, cleanups: 1 });
  f.client.pupBrowser = { close: async () => {}, process: () => null };
  await f.client.destroy();
  assert.equal(f.counts().cleanups, 2);
});

test('stuck browser termination uses only its owned child and waits for exit', async () => {
  const f = fixture({ stuck: true });
  await f.client.destroy();
  assert.deepEqual(f.counts(), { closes: 1, kills: 1, cleanups: 1 });
});

test('unconfirmed termination blocks auth cleanup and may be retried', async () => {
  const f = fixture({ stuck: true, unkillable: true });
  await assert.rejects(f.client.destroy(), /não encerrou/);
  assert.equal(f.counts().cleanups, 0);
  assert.equal(f.child.listenerCount('exit'), 0);
  f.child.exitCode = 0;
  await f.client.destroy();
  assert.equal(f.counts().cleanups, 1);
});

test('remote browser without child cannot be confirmed closed after an error', async () => {
  let cleaned = false;
  const client = { pupBrowser: { close: async () => { throw new Error('lost'); } },
    authStrategy: { destroy: async () => { cleaned = true; } }, destroy: async () => {} };
  protectBrowserLifecycle(client);
  await assert.rejects(client.destroy(), /confirmar/);
  assert.equal(cleaned, false);
});
