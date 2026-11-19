'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createProcessManager } = require('../lib/process-manager');
const http = require('node:http');
const { createRequestHandler } = require('../lib/http-routes');
const { createHttpTools } = require('../lib/http-tools');

function fixture(t) {
  const children = [], timers = [];
  const runtime = Object.assign(new EventEmitter(), { env: {}, execPath: process.execPath, connected: false });
  const data = { settings: { keepConnected: true } };
  const workspace = { read: () => data, mutate: async fn => fn(data),
    control() { throw new Error('Não pode iniciar disparos'); } };
  const manager = createProcessManager({ PROJECT_ROOT: __dirname, PORT: 0, process: runtime,
    workspace,
    getOperationsSnapshot: async () => ({}),
    setTimeout(fn, delay) { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; },
    spawn() {
      const child = Object.assign(new EventEmitter(), { pid: 9000 + children.length, connected: true,
        stdout: new EventEmitter(), stderr: new EventEmitter(), commands: [] });
      child.send = (command, callback) => { child.commands.push(command); callback?.(); };
      children.push(child); return child;
    } });
  t.after(() => manager.cancelAttendanceRetry());
  const start = () => { manager.startManagedScript('whatsapp'); children.at(-1).emit('spawn'); return children.at(-1); };
  const retry = () => timers.filter(timer => !timer.cancelled).at(-1);
  return { manager, workspace, children, timers, start, retry };
}

test('API: encerrar durante a espera cancela a retomada sem exigir processo ativo', async t => {
  const f = fixture(t), child = f.start();
  child.emit('close', 1, null);
  const pending = f.retry();
  assert.equal(pending.delay, 10000);
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, base = 'http://127.0.0.1:' + port;
  handler = createRequestHandler({ HOST: '127.0.0.1', PORT: port, workspace: f.workspace,
    ...f.manager, ...createHttpTools({ HOST: '127.0.0.1', PORT: port, PUBLIC_ROOT: __dirname }) });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(base + '/api/whatsapp/stop', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 202);
  assert.equal(f.workspace.read().settings.keepConnected, false);
  assert.equal(pending.cancelled, true);
  pending.fn(); // Even a callback already queued must respect the stop.
  assert.equal(f.children.length, 1);
});

test('quedas repetidas têm espera crescente limitada e ready restaura a espera inicial', t => {
  const f = fixture(t); let child = f.start();
  for (const delay of [10000, 20000, 40000, 80000, 120000, 120000]) {
    child.emit('close', 1, null);
    const pending = f.retry(); assert.equal(pending.delay, delay);
    pending.fn(); child = f.children.at(-1); child.emit('spawn');
    assert.equal(child.commands.some(command => command.type === 'ploa-campaign-start'), false);
  }
  child.emit('message', { type: 'ploa-whatsapp-state', connection: 'ready' });
  child.emit('close', 1, null);
  assert.equal(f.retry().delay, 10000);
  assert.equal(f.manager.getProcessesSnapshot().messages.running, false);
});

test('eventos da conexão antiga não alteram a instância nova', t => {
  const f = fixture(t), old = f.start();
  old.emit('close', 1, null); f.retry().fn();
  const current = f.children.at(-1); current.emit('spawn');
  current.emit('message', { type: 'ploa-whatsapp-state', connection: 'ready' });
  old.emit('message', { type: 'ploa-whatsapp-state', connection: 'reconnecting' });
  assert.equal(f.manager.getProcessesSnapshot().whatsapp.connection, 'ready');
  assert.equal(f.manager.getProcessesSnapshot().whatsapp.pid, current.pid);
});
