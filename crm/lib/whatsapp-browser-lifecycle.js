'use strict';

// Puppeteer can lose its transport while the browser still owns the profile.
// Only the child handle returned by this browser may be terminated here.
function protectBrowserLifecycle(client, { closeTimeoutMs = 10000, exitTimeoutMs = 5000 } = {}) {
  const originalDestroy = client.destroy.bind(client);
  const closing = new WeakMap();
  const within = (promise, ms) => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    Promise.resolve(promise).then(() => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(false); });
  });
  function waitForExit(child) {
    let listener;
    const promise = new Promise(resolve => {
      listener = () => resolve();
      child.once('exit', listener);
      if (child.exitCode !== null || child.signalCode != null) resolve();
    });
    return { promise, clear: () => child.removeListener('exit', listener) };
  }

  client.destroy = function destroy() {
    const browser = client.pupBrowser;
    if (!browser) return originalDestroy();
    if (closing.has(browser)) return closing.get(browser);
    const promise = (async () => {
      const child = browser.process?.();
      const owned = child && Number.isInteger(child.pid) && child.pid > 0 && child.pid !== process.pid;
      const exited = owned ? waitForExit(child) : null;
      try {
        // Also ask a disconnected Puppeteer browser to close its child. The
        // SDK skips this call when isConnected() is false.
        const closed = await within(Promise.resolve().then(() => browser.close()), closeTimeoutMs);
        if (owned && !await within(exited.promise, exitTimeoutMs)) {
          child.kill('SIGKILL');
          if (!await within(exited.promise, exitTimeoutMs)) {
            throw new Error('O navegador da sessão não encerrou; a sessão foi preservada e não será aberta em duplicidade.');
          }
        } else if (!owned && !closed) {
          throw new Error('Não foi possível confirmar o encerramento do navegador da sessão.');
        }
        // Preserve the authentication strategy cleanup after the browser exit.
        await client.authStrategy.destroy();
      } finally {
        exited?.clear();
      }
    })();
    closing.set(browser, promise);
    // A failed close may be retried, but never concurrently for one browser.
    promise.catch(() => { closing.delete(browser); });
    return promise;
  };
}

module.exports = { protectBrowserLifecycle };
