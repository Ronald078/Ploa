'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHttpTools } = require('../lib/http-tools');
const { createRequestHandler } = require('../lib/http-routes');
const { createAdsCatalog } = require('../lib/ads-catalog');
const { createOperationsSnapshot } = require('../lib/operations-snapshot');
const { localDateKey } = require('../lib/store');
const { temporaryRoot } = require('./fixture-helpers');

function response() {
  return { headers: {}, status: null, body: '',
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; },
  };
}

test('extração HTTP preserva origem local, limite de corpo e proteção dos arquivos', async () => {
  const tools = createHttpTools({ HOST: '127.0.0.1', PORT: 4310, PUBLIC_ROOT: path.join(__dirname, '../public') });
  assert.equal(tools.requestIsLocalAndSameOrigin({ headers: { origin: 'http://127.0.0.1:4310' } }), true);
  assert.equal(tools.requestIsLocalAndSameOrigin({ headers: { origin: 'https://outro.local' } }), false);
  await assert.rejects(tools.readJsonBody(Readable.from([Buffer.from('123456')]), 4), { statusCode: 413 });
  const result = response();
  assert.equal(await tools.serveStatic(result, '/modules/leads.js'), true);
  assert.equal(result.status, 200);
  assert.match(result.headers['Content-Security-Policy'], /script-src 'self'/);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  for(const match of css.matchAll(/@import url\("([^"?]+)/g)){
    const style=response();assert.equal(await tools.serveStatic(style,match[1]),true,match[1]);assert.equal(style.status,200,match[1]);
  }
  for (const match of html.matchAll(/<script src="([^"?]+)/g)) {
    const asset = response();
    assert.equal(await tools.serveStatic(asset, match[1]), true, match[1]);
    assert.equal(asset.status, 200, match[1]);
  }
  assert.equal(await tools.serveStatic(response(), '/../ploa_workspace.json'), false);
});

test('rotas de conexão consultam o gerente e cancelam reconexão sem estado global oculto', async () => {
  let cancelled = 0, stopped = 0;
  const worker = { id: 'whatsapp', status: 'idle' };
  const tools = createHttpTools({ HOST: '127.0.0.1', PORT: 4310, PUBLIC_ROOT: '' });
  const handler = createRequestHandler({ HOST: '127.0.0.1', PORT: 4310, ...tools,
    workspace: { mutate: async fn => fn({ settings: {} }) },
    scriptProcesses: new Map([['whatsapp', worker]]), activeProcessStatuses: new Set(['running']),
    publicProcessState: value => ({ id: value.id, status: value.status }),
    cancelAttendanceRetry: () => { cancelled++; },
    stopManagedScript: () => { stopped++; return {}; },
  });
  const request = (url, method = 'GET', headers = {}) => ({ url, method, headers: { host: '127.0.0.1:4310', ...headers } });
  const status = response(); await handler(request('/api/whatsapp'), status);
  assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).status, 'idle');
  const stop = response(); await handler(request('/api/whatsapp/stop', 'POST'), stop);
  assert.equal(stop.status, 202); assert.equal(cancelled, 1); assert.equal(stopped, 0);
  const favicon = response(); await handler(request('/favicon.ico'), favicon); assert.equal(favicon.status, 204);
  const denied = response(); await handler(request('/api/whatsapp', 'GET', { host: 'fora.local' }), denied); assert.equal(denied.status, 403);
});

test('leitura extraída preserva progresso, contador diário e catálogo local existente', async t => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, 'progresso_envios.json'), JSON.stringify({ indice: 5, totalContatos: 20 }));
  fs.writeFileSync(path.join(root, 'contador_diario.json'), JSON.stringify({ data: localDateKey(), enviados: 3 }));
  const snapshot = await createOperationsSnapshot({ PROJECT_ROOT: root, sheetMetrics: async () => ({ value: 30 }) })();
  assert.equal(snapshot.messages.processed, 5); assert.equal(snapshot.messages.total, 20);
  assert.equal(snapshot.messages.sentToday, 3); assert.equal(snapshot.search.totalLeads, null);
  const file = path.join(root, 'catalogo.json');
  fs.writeFileSync(file, JSON.stringify({ ads: [{ id: 'local', status: 'Ativo', title: 'Registro fictício' }] }));
  const catalog = await createAdsCatalog({ file })();
  assert.equal(catalog.summary.total, 1); assert.equal(catalog.summary.active, 1);
});
