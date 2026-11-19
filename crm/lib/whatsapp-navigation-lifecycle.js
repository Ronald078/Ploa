'use strict';

// Adapter for SDK 1.34.7 (inline registration) and 1.34.8 (registration hook).
// A page owns its navigation work, including
// continuations suspended in auth hooks. Old tasks must never touch a new page.
function protectNavigationLifecycle(client, { report = () => {} } = {}) {
  const legacyRegistration = typeof client._registerFramenavigatedHandler !== 'function';
  if (legacyRegistration && !client.initialize.toString().includes("this.pupPage.on('framenavigated'")) {
    throw Error('SDK de WhatsApp incompatível com a proteção de navegação.');
  }
  let generation = 0, ownedPage, ownedListener, disposed = false, injectionQueue = Promise.resolve();
  const initialize = client.initialize.bind(client), destroy = client.destroy.bind(client), inject = client.inject.bind(client);
  function invalidate() {
    generation++; disposed = true;
    if (ownedPage && ownedListener) ownedPage.off('framenavigated', ownedListener);
    ownedPage = ownedListener = undefined;
    client._injectAbort?.abort();
    client._framenavigatedRegistered = false;
    client.lastLoggedOut = false;
    injectionQueue = Promise.resolve();
  }
  client.initialize = async function () {
    invalidate(); disposed = false;
    if (!legacyRegistration) return initialize();
    // 1.34.7 registers an unguarded inline listener only after inject(). Install
    // our owner-scoped listener before goto(), then suppress that one SDK
    // registration during initialize. Never patch Puppeteer globally.
    const auth = client.authStrategy, after = auth.afterBrowserInitialized;
    let restorePage, patchedPage;
    auth.afterBrowserInitialized = async function (...args) {
      await after.apply(this, args);
      const page = client.pupPage;
      if (!page || disposed) return;
      client._registerFramenavigatedHandler();
      if (page === patchedPage) return;
      restorePage?.();
      patchedPage = page;
      const on = page.on;
      const temporaryOn = function (event, ...rest) {
        if (event === 'framenavigated') return this;
        return on.call(this, event, ...rest);
      };
      page.on = temporaryOn;
      restorePage = () => { if (page.on === temporaryOn) page.on = on; };
    };
    try { return await initialize(); }
    catch (error) { invalidate(); throw error; }
    finally {
      auth.afterBrowserInitialized = after;
      restorePage?.();
    }
  };
  client.destroy = function () { invalidate(); return destroy(); };
  client.inject = function () {
    const page = client.pupPage, epoch = generation;
    const task = injectionQueue.catch(() => {}).then(() => {
      if (disposed || generation !== epoch || client.pupPage !== page) return;
      return inject();
    });
    injectionQueue = task;
    return task;
  };
  client._registerFramenavigatedHandler = function () {
    if (client._framenavigatedRegistered) return;
    const page = client.pupPage, epoch = generation;
    let logoutHandled = false;
    const valid = () => !disposed && generation === epoch && client.pupPage === page;
    const handle = async frame => {
      if (!valid() || frame.parentFrame() !== null) return;
      const logout = frame.url().includes('post_logout=1') || client.lastLoggedOut;
      if (logout) {
        if (logoutHandled) return;
        logoutHandled = true;
        client.lastLoggedOut = false;
        client.emit('disconnected', 'LOGOUT');
        if (!valid()) return;
        await client.authStrategy.logout();
        if (!valid()) return;
        await client.authStrategy.beforeBrowserInitialized();
        if (!valid()) return;
        await client.authStrategy.afterBrowserInitialized();
        if (!valid()) return;
      }
      let available;
      try { available = await page.evaluate(() => typeof window.WWebJS !== 'undefined'); }
      catch (error) { if (!valid()) return; throw error; }
      if (!valid() || !logout && available) return;
      await client.inject();
    };
    // EventEmitter does not await listeners. Always handle their rejection.
    const listener = frame => handle(frame).catch(error => {
      if (!valid()) return;
      const transient = /Execution context was destroyed|Cannot find context|detached|Target closed|Session closed/i.test(String(error?.message || error));
      report(transient ? 'navigation_interrupted' : 'navigation_error');
    });
    ownedPage = page; ownedListener = listener;
    client._framenavigatedRegistered = true;
    page.on('framenavigated', listener);
  };
  return { invalidate };
}
module.exports = { protectNavigationLifecycle };
