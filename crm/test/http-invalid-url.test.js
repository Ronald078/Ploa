'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequestHandler } = require('../lib/http-routes');
const { createHttpTools } = require('../lib/http-tools');
const { createCloudHandler } = require('../cloud/http');

const HOST = '127.0.0.1', PORT = 4310, origin = `http://${HOST}:${PORT}`;
const invalidTargets = ['http://[', '//[', 'http://localhost:99999/'];
function response() {
  return { headers: {}, status: null, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; },
  };
}
const request = (url, host = `${HOST}:${PORT}`) => ({ url, method: 'GET', headers: { host } });

test('HTTP local rejeita URLs malformadas sem rejeição da promessa e continua respondendo', async () => {
  const handler = createRequestHandler({ HOST, PORT, ...createHttpTools({ HOST, PORT, PUBLIC_ROOT: '' }) });
  for (const target of invalidTargets) {
    const result = response();
    await handler(request(target), result);
    assert.equal(result.status, 400, target);
    assert.equal(JSON.parse(result.body).erro, 'Endereço de solicitação inválido.');
    assert.ok(!result.body.includes(target));
    const health = response(); await handler(request('/healthz?check=1'), health);
    assert.equal(health.status, 200);
  }
  const denied = response(); await handler(request('http://[', 'outside.invalid'), denied);
  assert.equal(denied.status, 403);
});

test('HTTP local mantém a autorização do painel para endereços válidos', async () => {
  const handler = createRequestHandler({ HOST, PORT, bridgeToken: 'a'.repeat(64), ...createHttpTools({ HOST, PORT, PUBLIC_ROOT: '' }) });
  const result = response(); await handler(request('/api/processes'), result);
  assert.equal(result.status, 403);
  const health = response(); await handler(request('/healthz'), health); assert.equal(health.status, 200);
});

test('HTTP de contas trata URL inválida e host negado sem repetir o parser no catch', async t => {
  const handler = createCloudHandler({ origin, gateway: {} });
  t.after(() => handler.dispose());
  for (const target of invalidTargets) {
    const result = response(); await handler(request(target), result);
    assert.equal(result.status, 400, target);
    assert.equal(JSON.parse(result.body).code, 'url');
    assert.ok(!result.body.includes(target));
    const health = response(); await handler(request('/healthz?check=1'), health); assert.equal(health.status, 200);
  }
  const denied = response(); await handler(request('http://[', 'outside.invalid'), denied);
  assert.equal(denied.status, 403); assert.equal(JSON.parse(denied.body).code, 'host');
});

test('HTTP de contas preserva sessão obrigatória e erro normal de rota', async t => {
  const handler = createCloudHandler({ origin, gateway: {} });
  t.after(() => handler.dispose());
  const protectedResult = response(); await handler(request('/api/cloud/workspaces'), protectedResult);
  assert.equal(protectedResult.status, 401);
  const missing = response(); await handler(request('/missing'), missing); assert.equal(missing.status, 404);
});

for (const kind of ['local', 'contas']) test(`HTTP ${kind}: transporte real responde 400 e mantém health e autorização`, async t => {
  let handler;
  const rejected = [];
  const server = http.createServer((req, res) => {
    void handler(req, res).catch(error => { rejected.push(error.code); res.writeHead(500); res.end(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, HOST, resolve); });
  const port = server.address().port;
  handler = kind === 'local'
    ? createRequestHandler({ HOST, PORT: port, bridgeToken: 'a'.repeat(64), ...createHttpTools({ HOST, PORT: port, PUBLIC_ROOT: '' }) })
    : createCloudHandler({ origin: `http://${HOST}:${port}`, gateway: {} });
  t.after(async () => { handler.dispose?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const call = target => new Promise((resolve, reject) => {
    http.get({ hostname: HOST, port, path: target }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  for (const target of invalidTargets) {
    assert.equal((await call(target)).status, 400, target);
    assert.equal((await call('/healthz')).status, 200);
  }
  assert.equal((await call(kind === 'local' ? '/api/processes' : '/api/cloud/workspaces')).status, kind === 'local' ? 403 : 401);
  assert.deepEqual(rejected, []);
});
