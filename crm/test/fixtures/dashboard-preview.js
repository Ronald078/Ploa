'use strict';
// Standalone visual fixture: no account provider, user data or automation agent.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHttpTools } = require('../../lib/http-tools');
const { createRequestHandler } = require('../../lib/http-routes');
async function startPreview(buildRoot) {
  const root = path.resolve(buildRoot);
  await fs.access(path.join(root, 'index.html'));
  const campaign = { status: 'stopped' }, attendance = { status: 'stopped', connection: 'reconnecting' };
  const operations = { search: {}, messages: { executionStatus: 'reconectando', executionSent: 2, executionTarget: 5 }, bases: {} };
  const dashboard = { resumo: { total: 5, taxa_resposta: 0, retornos_pendentes: 0, acao_ronald: 0, propostas_abertas: 0, oportunidades: 0, enviados_hoje: 0, respostas_automaticas: 0, sem_resposta: 0 }, leads: [], funnel_steps: [] };
  let handler, tools;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://fixture');
      if (url.pathname.startsWith('/app-next/')) {
        if (url.searchParams.has('fixture')) {
          const state = url.searchParams.get('fixture');
          campaign.status = state === 'stopped' ? 'stopped' : 'running'; attendance.status = campaign.status;
          attendance.connection = state === 'ready' ? 'ready' : 'reconnecting';
        }
        const relative = url.pathname.startsWith('/app-next/assets/') ? url.pathname.slice('/app-next/'.length) : 'index.html';
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
        const bytes = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': (file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html') + '; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(bytes); return;
      }
      if (url.pathname === '/api/dashboard') { tools.sendJson(res, 200, dashboard); return; }
      if (url.pathname === '/api/reports') { tools.sendJson(res, 200, {}); return; }
      if (url.pathname === '/api/account-context') { tools.sendJson(res, 404, {}); return; }
      if (!['/api/operations', '/healthz'].includes(url.pathname) && !/^\/(?:styles(?:\/|\.css$)|assets\/|ploa-[a-z-]+\.css$)/.test(url.pathname)) { res.writeHead(404); res.end(); return; }
      await handler(req, res);
    } catch { if (!res.headersSent) res.writeHead(500); res.end('Preview unavailable'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  tools = createHttpTools({ HOST: '127.0.0.1', PORT: port, PUBLIC_ROOT: path.resolve(__dirname, '../../public') });
  handler = createRequestHandler({ HOST: '127.0.0.1', PORT: port, ...tools, getOperationsSnapshot: async () => operations, scriptProcesses: new Map([['messages', campaign], ['whatsapp', attendance]]) });
  return server;
}
if (require.main === module) startPreview(process.argv[2]).then(server => {
  console.log(`PREVIEW_URL=http://127.0.0.1:${server.address().port}/app-next/dashboard?fixture=stopped`);
  const close = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { startPreview };
