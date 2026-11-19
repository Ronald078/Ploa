'use strict';
// Offline comparison: real SDK lifecycle, synthetic page/auth/transport only.
// Never initialize the sender, open a browser, read an account or send messages.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { protectBrowserLifecycle } = require('../lib/whatsapp-browser-lifecycle');
const ROOT = path.resolve(__dirname, '../..');

async function comparePackage(folder, { protectedLifecycle = false } = {}) {
  const localRequire = createRequire(path.join(folder, 'package.json'));
  const { Client } = localRequire('./index.js');
  const manifest = localRequire('./package.json');
  const puppeteer = localRequire('puppeteer');
  async function fixture() {
    const counts = { before: 0, after: 0, injected: 0, logout: 0 };
    const client = new Client({ userAgent: false, webVersionCache: { type: 'none' },
      puppeteer: { browserWSEndpoint: 'ws://offline-fixture.invalid' } });
    client.authStrategy.beforeBrowserInitialized = async () => { counts.before++; };
    client.authStrategy.afterBrowserInitialized = async () => { counts.after++; };
    client.authStrategy.destroy = async () => {};
    client.authStrategy.logout = async () => { counts.logout++; };
    client.initWebVersionCache = async () => {};
    client.inject = async () => { counts.injected++; };
    if (protectedLifecycle) {
      protectBrowserLifecycle(client);
      require('../lib/whatsapp-navigation-lifecycle').protectNavigationLifecycle(client);
    }
    let current;
    async function initialize() {
      const page = Object.assign(new EventEmitter(), { goto: async () => {}, evaluate: async () => true });
      let connected = true;
      const browser = { newPage: async () => page, isConnected: () => connected,
        close: async () => { connected = false; }, process: () => null };
      const original = puppeteer.connect;
      puppeteer.connect = async () => browser;
      try { await client.initialize(); } finally { puppeteer.connect = original; }
      current = { page, browser };
      return current;
    }
    await initialize();
    return { client, counts, initialize, current: () => current };
  }
  const frame = (url = 'https://web.whatsapp.com/', child = false) => ({ url: () => url, parentFrame: () => child ? {} : null });
  const result = { version: manifest.version,
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'src/Client.js'))).digest('hex'),
    browserOpened: false, accountUsed: false, messagesSent: 0,
    sharedDependencies: 'Existing dependency versions; candidate package uses the same dependency declarations.' };
  {
    const f = await fixture(), handler = f.current().page.listeners('framenavigated')[0];
    const before = f.counts.injected;
    await handler(frame());
    result.reinjectsAlreadyWiredPage = f.counts.injected > before;
    const after = f.counts.injected;
    await handler(frame('https://offline-fixture.invalid/frame', true));
    result.reinjectsChildFrame = f.counts.injected > after;
    await f.client.destroy();
  }
  {
    const f = await fixture(), oldHandler = f.current().page.listeners('framenavigated')[0];
    let release, entered;
    const begun = new Promise(resolve => { entered = resolve; });
    f.client.lastLoggedOut = true;
    f.client.authStrategy.logout = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const pending = oldHandler(frame());
    await begun;
    await f.client.destroy();
    await f.initialize();
    const before = { ...f.counts };
    release();
    await pending;
    result.staleLogoutRunsAuthHooksAfterReinitialize = f.counts.before > before.before || f.counts.after > before.after;
    result.staleLogoutInjectsReplacementPage = f.counts.injected > before.injected;
    await f.client.destroy();
  }
  {
    const f = await fixture(), handler = f.current().page.listeners('framenavigated')[0];
    f.current().page.evaluate = async () => { throw Error('Execution context was destroyed'); };
    f.client.inject = async () => { throw Error('Execution context was destroyed'); };
    try { await handler(frame()); result.navigationRaceRejectsListener = false; }
    catch { result.navigationRaceRejectsListener = true; }
    await f.client.destroy();
  }
  {
    const f = await fixture();
    if (!protectedLifecycle) protectBrowserLifecycle(f.client);
    await f.client.destroy();
    const replacement = await f.initialize();
    result.ploaReinitializeRegistersNavigationHandler = replacement.page.listenerCount('framenavigated') === 1;
    await f.client.destroy();
  }
  result.protectedLifecycle = protectedLifecycle;
  result.passesRecoveryProbes = !result.staleLogoutRunsAuthHooksAfterReinitialize &&
    !result.staleLogoutInjectsReplacementPage && !result.navigationRaceRejectsListener &&
    result.ploaReinitializeRegistersNavigationHandler;
  return result;
}

async function main() {
  const candidate = path.resolve(process.argv[2] || '');
  if (!candidate.startsWith(path.join(ROOT, 'output') + path.sep) ||
      JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'))).version !== '1.34.8') {
    throw Error('Expected the isolated official 1.34.8 package under output.');
  }
  const baselineFolder = path.join(ROOT, 'node_modules/whatsapp-web.js');
  const baselineManifest = JSON.parse(fs.readFileSync(path.join(baselineFolder, 'package.json')));
  const candidateManifest = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json')));
  for (const field of ['dependencies', 'optionalDependencies']) {
    if (JSON.stringify(baselineManifest[field]) !== JSON.stringify(candidateManifest[field])) {
      throw Error('Dependency declarations differ; prepare separate dependencies before comparing.');
    }
  }
  const results = [];
  const protectedLifecycle = process.argv[3] === '--protected';
  for (const folder of protectedLifecycle ? [candidate] : [baselineFolder, candidate]) results.push(await comparePackage(folder, { protectedLifecycle }));
  if (require.cache[path.join(ROOT, 'enviar_mensagens_whatsapp.js')]) throw Error('Sender unexpectedly loaded.');
  const output = { mode: 'offline-synthetic-browser-auth-transport', realSessionsRead: false,
    senderLoaded: false, productionChanged: false, results };
  fs.writeFileSync(path.join(path.dirname(candidate), protectedLifecycle ? 'comparison-protected.json' : 'comparison.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { comparePackage };
