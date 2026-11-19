'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createProcessManager } = require('../lib/process-manager');
const { createWorkspaceService } = require('../lib/workspace-service');
const { createCrmStore } = require('../lib/store');
const { temporaryRoot } = require('./fixture-helpers');

test('uma sessão atende disparos e atendimento; fim, pausa e reinício não repetem campanha', async t => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, 'leads.json'), '{}');
  const workspace = createWorkspaceService(root, createCrmStore(root), {
    credentialStore: { available: true, load: () => ({}), save() {} },
  });
  const children = [], timers = [], fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, { env: {}, execPath: process.execPath, connected: false });
  const manager = createProcessManager({
    workspace, PROJECT_ROOT: root, PORT: 14339, process: fakeProcess,
    getOperationsSnapshot: async () => ({ messages: {} }),
    setTimeout(fn, delay) {
      const timer = { fn, delay, unref() {} }; timers.push(timer); return timer;
    },
    clearTimeout(timer) { if (timer) timer.cancelled = true; },
    spawn() {
      const child = new EventEmitter();
      Object.assign(child, {
        pid: 8000 + children.length, connected: true, killed: false, commands: [],
        stdout: new EventEmitter(), stderr: new EventEmitter(),
      });
      child.send = (command, callback) => { child.commands.push(command); callback?.(); };
      child.kill = () => { child.killed = true; };
      children.push(child); return child;
    },
  });
  t.after(() => { manager.cancelAttendanceRetry(); workspace.close(); });
  const state = id => manager.getProcessesSnapshot()[id];
  assert.equal(children.length, 0);
  manager.startManagedScript('messages');
  assert.equal(children.length, 1);
  const worker = children[0];
  worker.emit('spawn');
  worker.emit('message', { type: 'ploa-whatsapp-state', connection: 'authenticating' });
  assert.equal(state('whatsapp').connection,'authenticating');
  worker.emit('message', { type: 'ploa-whatsapp-state', connection: 'ready' });
  worker.emit('message', { type: 'ploa-whatsapp-state', connection: 'authenticating' });
  assert.equal(state('whatsapp').connection,'ready','progresso tardio não desfaz a conexão pronta');
  const first = worker.commands.find(command => command.type === 'ploa-campaign-start');
  worker.emit('message', { type: 'ploa-campaign-finished', runId: first.runId, status: 'completed' });
  assert.equal(state('messages').running, false);
  assert.equal(state('whatsapp').running, true);
  manager.startManagedScript('messages');
  manager.pauseManagedScript('messages', 'pause');
  manager.stopManagedScript('messages');
  assert.equal(worker.killed, false);
  const second = worker.commands.filter(command => command.type === 'ploa-campaign-start').at(-1);
  worker.emit('message', { type: 'ploa-campaign-finished', runId: second.runId, status: 'stopped' });
  await workspace.mutate(data => { data.settings.keepConnected = true; });
  manager.startManagedScript('messages');
  worker.emit('close', 1, null);
  assert.equal(state('messages').status, 'error');
  const retry = timers.find(timer => timer.delay >= 10000 && !timer.cancelled);
  assert.ok(retry);
  retry.fn();
  assert.equal(children.length, 2);
  assert.equal(children[1].commands.some(command => command.type === 'ploa-campaign-start'), false);
});
