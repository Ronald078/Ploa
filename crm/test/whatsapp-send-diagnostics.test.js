'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { temporaryRoot } = require('./fixture-helpers');
const { installInPage, CODES, FIELDS, safeRecord, createSendDiagnostics, attachSendDiagnostics } = require('../lib/whatsapp-send-diagnostics');
const { createSendConfirmation } = require('../lib/whatsapp-send-confirmation');
const tick = () => new Promise(resolve => setImmediate(resolve));
function pageFixture(original, callback = () => {}) {
  const action = { addAndSendMsgToChat: original }, context = vm.createContext({ window: { require: () => action, fixtureDiagnostic: callback } });
  const install = () => vm.runInContext('(' + installInPage.toString() + ')', context)('fixtureDiagnostic', CODES, FIELDS);
  return { action, context, install };
}
test('observa resultado descartado pelo SDK preservando tupla, argumentos, this e promessas', async () => {
  const reports = [], msg = { ack: -1 }, sendResult = { messageSendResult: 'ERROR_UNKNOWN', body: 'PRIVATE-FIXTURE', phone: '5511999999999' };
  const pair = [Promise.resolve(msg), Promise.resolve(sendResult)];
  let calls = 0, received;
  const f = pageFixture(function (...args) { calls++; received = { self: this, args }; return pair; }, item => reports.push(item));
  assert.equal(f.install(), true); const wrapped = f.action.addAndSendMsgToChat;
  f.install(); assert.equal(f.action.addAndSendMsgToChat, wrapped);
  const chat = {}, payload = {};
  assert.equal(wrapped.call(f.action, chat, payload), pair);
  assert.equal(received.self, f.action); assert.deepEqual(received.args, [chat, payload]);
  assert.equal(await pair[0], msg); assert.equal(await pair[1], sendResult);
  await tick(); assert.equal(calls, 1); assert.equal(reports[0].phase, 'resolved');
  assert.equal(reports[0].fields[0].code, 'ERROR_UNKNOWN');
  assert.ok(!JSON.stringify(reports).includes('PRIVATE')); assert.ok(!JSON.stringify(reports).includes('5511999999999'));
});
test('rejeição e exceção síncrona originais são preservadas, sem retry ou rejeição não tratada', async () => {
  const reports = [], failure = Object.assign(Error('SECRET-FAILURE'), { code: 'ERROR_TIMEOUT' });
  const pair = [Promise.resolve({}), Promise.reject(failure)];
  const f = pageFixture(() => pair, data => reports.push(data)); f.install();
  assert.equal(f.action.addAndSendMsgToChat(), pair);
  await assert.rejects(pair[1], error => error === failure); await tick();
  assert.equal(reports[0].phase, 'rejected'); assert.ok(!JSON.stringify(reports).includes('SECRET'));
  const g = pageFixture(() => { throw failure; }, data => reports.push(data)); g.install();
  assert.throws(() => g.action.addAndSendMsgToChat(), error => error === failure);
  assert.equal(reports.at(-1).phase, 'sync_error');
});
test('callback defeituoso ou retorno desconhecido não muda a operação original', async () => {
  const pair = [Promise.resolve({}), Promise.resolve('SUCCESS')];
  const f = pageFixture(() => pair, () => Promise.reject(Error('fake diagnostic failure'))); f.install();
  assert.equal(f.action.addAndSendMsgToChat(), pair); await pair[1]; await tick();
  const result = {}; const g = pageFixture(() => result); g.install();
  assert.equal(g.action.addAndSendMsgToChat(), result);
});
test('sanitização nas duas fronteiras ignora texto, IDs, getters, URLs e códigos desconhecidos', async () => {
  const reports = [], value = { status: { code: 429, result: 'SECRET-PAYLOAD' }, code: '5511999999999', name: 'TypeError', body: 'PRIVATE' };
  Object.defineProperty(value, 'errorCode', { get() { throw Error('getter must not run'); } });
  const f = pageFixture(() => [Promise.resolve({}), Promise.resolve(value)], data => reports.push(data)); f.install();
  f.action.addAndSendMsgToChat(); await tick();
  const record = safeRecord({ ...reports[0], phone: 'PRIVATE', text: 'PRIVATE' });
  assert.ok(record.fields.some(item => item.numericCode === 429));
  const serialized = JSON.stringify(record);
  for (const secret of ['SECRET', 'PRIVATE', '5511999999999']) assert.ok(!serialized.includes(secret));
  assert.equal(safeRecord({ phase: 'PRIVATE' }), null);
});
test('diagnóstico em disco é limitado e falha de escrita não propaga erro', t => {
  const root = temporaryRoot(t), record = createSendDiagnostics(root, { maxBytes: 2048 });
  for (let i = 0; i < 80; i++) record({ phase: 'resolved', valueCode: 'ERROR_UNKNOWN', body: 'SECRET' });
  const file = path.join(root, 'diagnostico_envios_whatsapp.jsonl');
  assert.ok(fs.statSync(file).size <= 2048); assert.ok(!fs.readFileSync(file, 'utf8').includes('SECRET'));
  createSendDiagnostics(path.join(root, 'missing', 'folder'))({ phase: 'resolved' });
});
test('instala por página, reinstala após navegação e ignora callback de página antiga', async () => {
  const records = []; let sent = 0, exposed = 0, installed = 0, callback;
  const page = { exposeFunction: async (_, fn) => { exposed++; callback = fn; }, evaluate: async () => { installed++; return true; } };
  const client = { pupPage: page, async sendMessage(...args) { sent++; assert.equal(this, client); return args; } };
  attachSendDiagnostics(client, { record: value => records.push(value) });
  assert.deepEqual(await client.sendMessage('fixture', 'text'), ['fixture', 'text']);
  await client.sendMessage('fixture2'); assert.equal(exposed, 1); assert.equal(installed, 2); assert.equal(sent, 2);
  callback({ phase: 'resolved', valueCode: 'ERROR_UNKNOWN' }); assert.equal(records.length, 1);
  client.pupPage = { ...page }; callback({ phase: 'resolved' }); assert.equal(records.length, 1);
  await client.sendMessage('fixture3'); assert.equal(exposed, 2);
});
test('instalação indisponível/pendurada não trava envio e exceção do SDK é preservada', async () => {
  for (const exposeFunction of [async () => { throw Error('fake binding failure'); }, () => new Promise(() => {})]) {
    const failure = Error('fake SDK failure'); let calls = 0;
    const client = { pupPage: { exposeFunction }, async sendMessage() { calls++; throw failure; } };
    attachSendDiagnostics(client, { installTimeoutMs: 10, record: () => { throw Error('fake diagnostic failure'); } });
    await assert.rejects(client.sendMessage(), error => error === failure); assert.equal(calls, 1);
  }
});
test('resultado técnico SUCCESS não substitui ACK nem conta sucesso diante de ACK -1', async t => {
  const reports = [], message = { id: 'fixture-message', ack: -1 };
  const f = pageFixture(() => [Promise.resolve(message), Promise.resolve('SUCCESS')], data => reports.push(data)); f.install();
  const client = Object.assign(new EventEmitter(), { pupPage: { exposeFunction: async () => {}, evaluate: async () => true },
    async sendMessage() { const pair = f.action.addAndSendMsgToChat(); await pair[1]; return pair[0]; } });
  attachSendDiagnostics(client); const gate = createSendConfirmation(client, { timeoutMs: 100 }); t.after(() => gate.close());
  await assert.rejects(gate.send(() => client.sendMessage()), { code: 'PLOA_SEND_UNCONFIRMED', cause: 'negative_ack' });
  await tick(); assert.equal(reports[0].valueCode, 'SUCCESS');
});
