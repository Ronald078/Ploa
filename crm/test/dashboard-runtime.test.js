'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestHandler } = require('../lib/http-routes');
const { createHttpTools } = require('../lib/http-tools');

function data(messages = {}) {
  return { dashboard: { resumo: {}, leads: [] }, operations: { search: {}, messages: {
    executionStatus: 'reconectando', executionSent: 2, executionTarget: 5, ...messages,
  } } };
}

test('Dashboard não anuncia execução ao vivo com telemetria antiga ou processo parado', async () => {
  const { attentionNews } = await import('../app-next/src/model.js');
  for (const messages of [{}, { executionActive: false, connectionStatus: 'reconnecting' },
    { executionActive: false, connectionStatus: 'ready' }, { executionActive: true, connectionStatus: 'qr' }]) {
    assert.equal(attentionNews(data(messages)).some(item => item.tone === 'live'), false);
  }
});

test('Dashboard usa a conexão atual para distinguir envio ativo de reconexão', async () => {
  const { attentionNews } = await import('../app-next/src/model.js');
  const active = attentionNews(data({ executionActive: true, connectionStatus: 'ready' }));
  assert.equal(active[0].title, 'Envio de mensagens em andamento');
  assert.match(active[0].detail, /2 de 5/);
  const reconnecting = attentionNews(data({ executionActive: true, connectionStatus: 'reconnecting', executionStatus: 'em_execucao' }));
  assert.equal(reconnecting[0].title, 'Envios estão reconectando');
  const historical = attentionNews(data({ executionActive: false, sentToday: 3 }));
  assert.ok(historical.some(item => item.title.includes('3 contatos novos abordados hoje')));
});

test('API de operações acrescenta estado atual sem alterar o histórico nem buscar novos dados', async () => {
  const messages = { status: 'stopped' }, whatsapp = { status: 'stopped', connection: 'reconnecting' };
  const scriptProcesses = new Map([['messages', messages], ['whatsapp', whatsapp]]);
  const original = data().operations;
  let calls = 0;
  const handler = createRequestHandler({ HOST: '127.0.0.1', PORT: 4310, scriptProcesses,
    ...createHttpTools({ HOST: '127.0.0.1', PORT: 4310, PUBLIC_ROOT: '' }),
    getOperationsSnapshot: async () => { calls++; return original; },
  });
  async function snapshot() {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await handler({ method: 'GET', url: '/api/operations', headers: { host: '127.0.0.1:4310' } }, response);
    assert.equal(response.status, 200); return JSON.parse(response.body);
  }
  assert.equal((await snapshot()).messages.executionActive, false);
  messages.status = 'running'; whatsapp.status = 'running'; whatsapp.connection = 'ready';
  const active = await snapshot(); assert.equal(active.messages.executionActive, true);
  assert.equal(active.messages.connectionStatus, 'ready'); assert.equal(calls, 2);
  assert.equal(active.messages.executionStatus, 'reconectando');
  assert.equal(Object.hasOwn(original.messages, 'executionActive'), false);
  for (const status of ['idle', 'paused', 'stopping', 'stopped', 'completed', 'error']) {
    messages.status = status; assert.equal((await snapshot()).messages.executionActive, false, status);
  }
  messages.status = 'running'; whatsapp.status = 'error';
  assert.equal((await snapshot()).messages.executionActive, false);
});
