'use strict';
// Private Tailscale Serve gateway. The existing CRM remains loopback-only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'acesso-celular.json';
function validateConfig(value) {
  if (value?.enabled !== true) return null;
  const hostname = String(value.hostname || '').toLowerCase();
  const login = String(value.login || '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/.test(hostname)) return null;
  if (!login || login.length > 254 || /[\s\x00-\x1f\x7f]/.test(login)) return null;
  return { enabled: true, hostname, login };
}
function readConfig(root) {
  try { return validateConfig(JSON.parse(fs.readFileSync(path.join(root, 'crm', CONFIG_FILE), 'utf8').replace(/^\uFEFF/, ''))); }
  catch { return null; }
}
function loopback(address) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }
function authorized(request, config) {
  if (!config || !loopback(request.socket?.remoteAddress)) return false;
  const host = String(request.headers.host || '').toLowerCase();
  if (![config.hostname, config.hostname + ':443'].includes(host)) return false;
  // Serve strips client-supplied identity headers. Funnel has no user identity.
  if (request.headers['tailscale-user-login'] !== config.login) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  const origin = request.headers.origin;
  // Um clique do proprietário em outro aplicativo pode ser cross-site. Só
  // permite a navegação principal com gesto do usuário, nunca fetch, iframe ou API.
  let entry = false;
  try { entry = ['/', '/index.html', '/acesso-celular', '/operacao', '/app-next/dashboard', '/app-next/funnel', '/app-next/leads','/app-next/copies','/app-next/messages','/app-next/search','/app-next/ai'].includes(new URL(request.url, 'http://localhost').pathname.replace(/\/$/,'')||'/'); } catch {}
  const entryNavigation = request.method === 'GET' && entry && origin === undefined
    && ['cross-site','same-site'].includes(fetchSite)
    && request.headers['sec-fetch-mode'] === 'navigate'
    && request.headers['sec-fetch-dest'] === 'document'
    && request.headers['sec-fetch-user'] === '?1';
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite) && !entryNavigation) return false;
  if (origin !== undefined && origin !== 'https://' + config.hostname) return false;
  if (!['GET', 'HEAD'].includes(request.method) && !origin) return false;
  return true;
}
function problem(response, code, text) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  response.end(JSON.stringify({ erro: text }));
}
function createRemoteHandler({ root, targetPort = 4310, loadConfig = () => readConfig(root), transport = http.request }) {
  return (request, response) => {
    const config = validateConfig(loadConfig());
    if (!authorized(request, config)) return problem(response, 403, 'Acesso privado não autorizado. Conecte o Tailscale com a conta do proprietário.');
    if (!request.url?.startsWith('/') || request.url.startsWith('//') || /[\x00-\x20]/.test(request.url)) return problem(response, 400, 'Endereço inválido.');
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { return problem(response, 400, 'Endereço inválido.'); }
    if (pathname.startsWith('/api/internal') || pathname.includes('\\')) return problem(response, 403, 'Esta operação é exclusiva do agente local.');
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return problem(response, 405, 'Método não permitido.');
    // This asset is served here too, so an already-running desktop need not restart.
    if (pathname === '/styles/mobile-access.css' && ['GET', 'HEAD'].includes(request.method)) {
      try {
        const css = fs.readFileSync(path.join(root, 'crm/public/styles/mobile-access.css'));
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return response.end(request.method === 'HEAD' ? undefined : css);
      } catch { return problem(response, 503, 'Não foi possível carregar o layout para celular.'); }
    }
    const headers = { ...request.headers, host: '127.0.0.1:' + targetPort };
    // Authenticate and check the external origin BEFORE normalizing the local request.
    for (const key of Object.keys(headers)) {
      if (/^(tailscale-|x-forwarded-|forwarded$|proxy-|connection$|upgrade$|authorization$|x-ploa-)/i.test(key)) delete headers[key];
    }
    if (headers.origin) headers.origin = 'http://127.0.0.1:' + targetPort;
    if (headers.referer) headers.referer = 'http://127.0.0.1:' + targetPort + '/';
    const upstream = transport({ host: '127.0.0.1', port: targetPort, path: request.url, method: request.method, headers }, incoming => {
      const resultHeaders = { ...incoming.headers };
      delete resultHeaders.connection;
      // Site previews may be embedded only by this private origin, not by other sites.
      if (resultHeaders['content-security-policy']) resultHeaders['content-security-policy'] = resultHeaders['content-security-policy'].replace('http://127.0.0.1:' + targetPort, 'https://' + config.hostname);
      response.writeHead(incoming.statusCode, resultHeaders);
      incoming.on('error', () => response.destroy());
      incoming.pipe(response);
    });
    upstream.setTimeout(120000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!response.headersSent) problem(response, 503, 'O Ploa está fechado ou iniciando no notebook. Abra-o e tente novamente.');
      else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
    request.pipe(upstream);
  };
}
function startRemoteAccess({ root, targetPort = 4310, port = 4311, logger = console } = {}) {
  const gateway = http.createServer(createRemoteHandler({ root, targetPort }));
  gateway.headersTimeout = 15000;
  gateway.requestTimeout = 120000;
  gateway.on('error', error => {
    // A one-time setup helper may already provide the same gateway.
    if (error.code !== 'EADDRINUSE') logger.error('Acesso pelo celular indisponível:', error.code || 'falha local');
  });
  gateway.listen(port, '127.0.0.1');
  return { close: () => new Promise(resolve => {
    if (!gateway.listening) return resolve();
    gateway.closeAllConnections?.(); gateway.close(resolve);
  }), server: gateway };
}
module.exports = { CONFIG_FILE, validateConfig, readConfig, authorized, createRemoteHandler, startRemoteAccess };
