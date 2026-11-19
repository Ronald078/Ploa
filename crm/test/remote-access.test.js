'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { authorized, validateConfig, createRemoteHandler } = require('../lib/remote-access');
const config = { enabled: true, hostname: 'ploa.tail-example.ts.net', login: 'owner@example.com' };
const req = (headers = {}, method = 'GET', remoteAddress = '127.0.0.1') => ({ url:'/', method, socket: { remoteAddress }, headers: { host: config.hostname, 'tailscale-user-login': config.login, ...headers } });
test('disabled, malformed host and unbound owner fail closed', () => {
  assert.equal(validateConfig({ ...config, enabled: false }), null);
  assert.equal(validateConfig({ ...config, hostname: 'evil.test' }), null);
  assert.equal(validateConfig({ ...config, login: '' }), null);
  assert.equal(authorized(req(), null), false);
});
test('only exact owner identity from a loopback proxy is accepted', () => {
  assert.ok(authorized(req(), config));
  assert.equal(authorized(req({ 'tailscale-user-login': 'other@example.com' }), config), false);
  assert.equal(authorized(req({ 'tailscale-user-login': undefined }), config), false);
  assert.equal(authorized(req({}, 'GET', '192.168.0.2'), config), false);
  assert.equal(authorized(req({ host: 'localhost:4311' }), config), false);
});
test('cross-origin requests and writes without an exact HTTPS origin are rejected', () => {
  assert.equal(authorized(req({ origin: 'https://evil.test' }, 'POST'), config), false);
  assert.equal(authorized(req({}, 'POST'), config), false);
  assert.equal(authorized(req({ origin: 'http://' + config.hostname }, 'POST'), config), false);
  assert.equal(authorized(req({ 'sec-fetch-site': 'cross-site' }), config), false);
  assert.ok(authorized(req({ origin: 'https://' + config.hostname, 'sec-fetch-site': 'same-origin' }, 'PUT'), config));
});

test('clique externo só libera a entrada autenticada, nunca APIs, iframe, fetch ou escrita',()=>{
 const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
 for(const url of ['/','/index.html','/acesso-celular?origem=chat'])assert.ok(authorized({...req(headers),url},config));
 for(const url of ['/api/mobile-access','/api/workspace','/api/internal/events','/creative-render.js'])assert.equal(authorized({...req(headers),url},config),false);
 for(const extra of [{'sec-fetch-user':undefined},{'sec-fetch-mode':'cors'},{'sec-fetch-dest':'iframe'},{'tailscale-user-login':'other@example.com'},{origin:'https://evil.test'}])assert.equal(authorized(req({...headers,...extra}),config),false);
 assert.equal(authorized(req(headers,'POST'),config),false);assert.equal(authorized(req(headers,'GET','192.168.1.2'),config),false);
});
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function stop(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function call(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host: config.hostname, 'tailscale-user-login': config.login, ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    }); request.on('error', reject); request.end(body);
  });
}
test('authenticated proxy preserves body and normalizes origin only after validation', async t => {
  let seen = null;
  const upstream = http.createServer(async (request, response) => { let body = ''; for await (const chunk of request) body += chunk; seen = { headers: request.headers, body }; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"saved":true}'); });
  const targetPort = await listen(upstream); t.after(() => stop(upstream));
  const gateway = http.createServer(createRemoteHandler({ root: '.', targetPort, loadConfig: () => config }));
  const port = await listen(gateway); t.after(() => stop(gateway));
  const result = await call(port, '/api/settings', { method: 'PUT', headers: { origin: 'https://' + config.hostname, 'content-type': 'application/json', 'x-forwarded-host': 'evil.test', 'x-ploa-internal-token': 'secret' }, body: '{"delay":20}' });
  assert.equal(result.status, 200); assert.equal(seen.body, '{"delay":20}');
  assert.equal(seen.headers.host, '127.0.0.1:' + targetPort); assert.equal(seen.headers.origin, 'http://127.0.0.1:' + targetPort);
  assert.equal(seen.headers['tailscale-user-login'], undefined); assert.equal(seen.headers['x-forwarded-host'], undefined); assert.equal(seen.headers['x-ploa-internal-token'], undefined);
  seen = null;
  assert.equal((await call(port, '/api/settings', { method: 'PUT', headers: { origin: 'https://evil.test' } })).status, 403); assert.equal(seen, null);
  for (const pathname of ['/api/internal/events', '/api/%69nternal/next', '/api/internal/ack']) assert.equal((await call(port, pathname)).status, 403);
});
test('revocation takes effect immediately and missing backend returns a useful error', async t => {
  let current = config;
  const unused = http.createServer(); const targetPort = await listen(unused); await stop(unused);
  const gateway = http.createServer(createRemoteHandler({ root: '.', targetPort, loadConfig: () => current }));
  const port = await listen(gateway); t.after(() => stop(gateway));
  const result = await call(port, '/'); assert.equal(result.status, 503); assert.match(result.body, /fechado ou iniciando/);
  current = null; assert.equal((await call(port, '/')).status, 403);
});

test('navegação vinda de outro aplicativo alcança a página, mas não abre APIs por esse caminho',async t=>{
 let hits=0;const upstream=http.createServer((request,response)=>{hits++;response.end('Ploa');});const targetPort=await listen(upstream);t.after(()=>stop(upstream));
 const gateway=http.createServer(createRemoteHandler({root:'.',targetPort,loadConfig:()=>config}));const port=await listen(gateway);t.after(()=>stop(gateway));
 const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
 assert.equal((await call(port,'/acesso-celular',{headers})).status,200);assert.equal(hits,1);
 for(const route of ['/operacao?view=ai',...['dashboard','funnel','leads','copies','messages','search','ai'].flatMap(name=>['/app-next/'+name,'/app-next/'+name+'/'])])assert.equal((await call(port,route,{headers})).status,200);
 const navigationHits=hits;
 assert.equal((await call(port,'/api/mobile-access',{headers})).status,403);assert.equal(hits,navigationHits);
});
