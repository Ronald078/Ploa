'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createNextAppStatic({ PUBLIC_ROOT, applySecurityHeaders }) {
  const root = path.join(PUBLIC_ROOT, 'app-next');
  const pages = new Set(['/', '/index.html', '/app-next', '/app-next/', '/app-next/dashboard', '/app-next/dashboard/', '/app-next/funnel', '/app-next/funnel/', '/app-next/leads', '/app-next/leads/']);
  for (const name of ['copies','messages','search','ai']) { pages.add('/app-next/' + name); pages.add('/app-next/' + name + '/'); }
  return async function serveNextApp(response, pathname) {
    const page = pages.has(pathname);
    // Only the dedicated entry and hashed JS/CSS bundles can be served. No
    // directory traversal, source maps, source files or general SPA fallback.
    if (!page && !/^\/app-next\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(pathname)) return false;
    const file = page ? path.join(root, 'index.html') : path.join(root, 'assets', path.basename(pathname));
    let content;
    try { content = await fs.promises.readFile(file); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    applySecurityHeaders(response);
    response.writeHead(200, { 'Content-Type': page ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' });
    response.end(content);
    return true;
  };
}
module.exports = { createNextAppStatic };
