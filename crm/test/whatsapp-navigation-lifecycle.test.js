'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { createRequire } = require('node:module');
const { protectNavigationLifecycle } = require('../lib/whatsapp-navigation-lifecycle');
const { protectBrowserLifecycle } = require('../lib/whatsapp-browser-lifecycle');
const { preservingLocalAuth } = require('../lib/whatsapp-session-auth');
const { createConnectionDiagnostics } = require('../lib/whatsapp-connection-diagnostics');
const { temporaryRoot } = require('./fixture-helpers');
const fs = require('node:fs');
const sdkRequire = process.env.PLOA_TEST_SDK ? createRequire(path.resolve(process.env.PLOA_TEST_SDK, 'package.json')) : require;
const { Client } = sdkRequire(process.env.PLOA_TEST_SDK ? './index.js' : 'whatsapp-web.js');
const puppeteer = sdkRequire('puppeteer');
const frame = (url = 'https://web.whatsapp.com/', child = false) => ({ url: () => url, parentFrame: () => child ? {} : null });
async function fixture(t) {
  const counts = { before: 0, after: 0, injected: 0, logouts: 0 }, reports = [], handlers = new WeakMap(), pages = [];
  const client = new Client({ userAgent: false, webVersionCache: { type: 'none' }, puppeteer: { browserWSEndpoint: 'ws://offline-fixture.invalid' } });
  client.authStrategy.beforeBrowserInitialized = async () => { counts.before++; };
  client.authStrategy.afterBrowserInitialized = async () => { counts.after++; };
  const originalAfter = client.authStrategy.afterBrowserInitialized;
  client.authStrategy.destroy = async () => {};
  client.authStrategy.logout = async () => { counts.logouts++; };
  client.initWebVersionCache = async () => {};
  client.inject = async () => { counts.injected++; };
  protectBrowserLifecycle(client);
  protectNavigationLifecycle(client, { report: item => reports.push(item) });
  async function initialize({ failGoto = false } = {}) {
    // Real installed Puppeteer emitter: Page exposes off(), not removeListener().
    const page = Object.assign(new puppeteer.EventEmitter(), { goto: async () => { if (failGoto) throw Error('fixture navigation failure'); }, evaluate: async () => true }); let connected = true;
    const on = page.on.bind(page);
    page.on = (event, listener) => { if (event === 'framenavigated') handlers.set(page, listener); return on(event, listener); };
    page.originalOn = page.on; pages.push(page);
    const browser = { newPage: async () => page, isConnected: () => connected, close: async () => { connected = false; }, process: () => null };
    const old = puppeteer.connect; puppeteer.connect = async () => browser;
    try { await client.initialize(); } finally { puppeteer.connect = old; }
    return page;
  }
  const page = await initialize(); t.after(() => client.destroy());
  return { client, counts, reports, page, pages, originalAfter, initialize, handler: page => handlers.get(page) };
}

test('SDK anterior restaura hooks e mantém eventos da página após inicializar', async t => {
  const f = await fixture(t);
  assert.equal(f.page.on, f.page.originalOn);
  assert.equal(f.client.authStrategy.afterBrowserInitialized, f.originalAfter);
  assert.equal(f.page.listenerCount('framenavigated'), 1);
  let calls = 0; f.page.on('fixture-event', () => calls++); f.page.emit('fixture-event');
  assert.equal(calls, 1);
});

test('falha de navegação restaura hooks e remove listener da inicialização incompleta', async t => {
  const f = await fixture(t); await f.client.destroy();
  await assert.rejects(f.initialize({ failGoto: true }), /fixture navigation failure/);
  const failedPage = f.pages.at(-1);
  assert.equal(failedPage.on, failedPage.originalOn);
  assert.equal(f.client.authStrategy.afterBrowserInitialized, f.originalAfter);
  assert.equal(failedPage.listenerCount('framenavigated'), 0);
  const recovered = await f.initialize();
  assert.equal(recovered.listenerCount('framenavigated'), 1);
});
test('reconexão protegida registra um handler novo e remove o antigo', async t => {
  const f = await fixture(t);
  assert.equal(typeof f.page.removeListener, 'undefined'); assert.equal(typeof f.page.off, 'function');
  await f.client.destroy();
  assert.equal(f.page.listenerCount('framenavigated'), 0);
  const next = await f.initialize(); assert.equal(next.listenerCount('framenavigated'), 1);
});
test('logout suspenso da página antiga não executa hooks nem injeta na nova', async t => {
  const f = await fixture(t), handler = f.handler(f.page); let release, entered;
  const begun = new Promise(resolve => { entered = resolve; });
  f.client.authStrategy.logout = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = handler(frame('https://web.whatsapp.com/?post_logout=1'));
  await begun; await f.client.destroy(); await f.initialize();
  const before = { ...f.counts }; f.client.lastLoggedOut = true;
  release(); await pending;
  assert.deepEqual(f.counts, before); assert.equal(f.client.lastLoggedOut, true);
});
test('perda de contexto não rejeita o listener nem encerra o processo', async t => {
  const f = await fixture(t); f.page.evaluate = async () => { throw Error('Execution context was destroyed'); };
  await f.handler(f.page)(frame());
  assert.deepEqual(f.reports, ['navigation_interrupted']);
});
test('subframe e página preparada não reinjetam; logout concorrente é emitido uma vez', async t => {
  const f = await fixture(t), handler = f.handler(f.page);
  await handler(frame()); await handler(frame('https://offline.invalid/', true));
  assert.equal(f.counts.injected, 1);
  let disconnected = 0; f.client.on('disconnected', () => { disconnected++; });
  await Promise.all([handler(frame('https://web.whatsapp.com/?post_logout=1')), handler(frame('https://web.whatsapp.com/?post_logout=1'))]);
  assert.equal(disconnected, 1); assert.equal(f.counts.logouts, 1);
});
test('logout automático preserva arquivos e diagnóstico nunca guarda conteúdo arbitrário', async t => {
  const root = temporaryRoot(t), target = path.join(root, 'profile-fixture'); fs.writeFileSync(target, 'fixture');
  class FakeAuth { async logout() { fs.unlinkSync(target); } }
  await new (preservingLocalAuth(FakeAuth))().logout(); assert.equal(fs.readFileSync(target, 'utf8'), 'fixture');
  const record = createConnectionDiagnostics(root, { maxBytes: 2048 });
  record('disconnected', 'https://example.invalid/?token=SECRET-FAKE');
  record('disconnected', 'LOGOUT');
  for (let i = 0; i < 40; i++) record('ready');
  const file = path.join(root, 'diagnostico_conexao_whatsapp.jsonl'), contents = fs.readFileSync(file, 'utf8');
  assert.ok(!contents.includes('SECRET')); assert.ok(!contents.includes('https://'));
  assert.ok(fs.statSync(file).size <= 2048);
});
