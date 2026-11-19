'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path');
const { createSendConfirmation, pendingReservations } = require('../lib/whatsapp-send-confirmation');
const { createDailySendLedger } = require('../lib/daily-send-ledger');
const { temporaryRoot } = require('./fixture-helpers');
const { summarizeOutreachResults } = require('../lib/outreach-results');
const tick = () => new Promise(resolve => setImmediate(resolve));
const message = (ack = 0) => ({ id: { _serialized: 'true_fixture@c.us_message' }, ack });
function fixture(t, timeoutMs = 100) {
  const client = new EventEmitter(), gate = createSendConfirmation(client, { timeoutMs });
  t.after(() => gate.close()); return { client, gate };
}
test('retorno do SDK e ACK pendente não contam como confirmação do servidor', async t => {
  const { client, gate } = fixture(t), m = message(), updates = []; let settled = false, calls = 0;
  const sending = gate.send(async () => { calls++; return m; }, { onReceipt: item => updates.push(item) });
  sending.then(() => { settled = true; });
  await tick(); assert.equal(settled, false); assert.equal(updates[0].stage, 'pending');
  client.emit('message_ack', message(), 1);
  assert.equal(await sending, m); assert.equal(calls, 1);
  assert.equal(gate.receipt(m).stage, 'server');
});
test('ACK que chega antes do retorno do SDK e recibo entregue são reconhecidos', async t => {
  const { client, gate } = fixture(t), m = message();
  await gate.send(async () => { client.emit('message_ack', m, 2); return m; });
  assert.equal(gate.receipt(m).stage, 'delivered');
});
test('retorno com ACK mais avançado prevalece sobre evento pendente anterior', async t => {
  const { client, gate } = fixture(t), m = message(2);
  await gate.send(async () => { client.emit('message_ack', m, 0); return m; });
  assert.equal(gate.receipt(m).ack, 2);
});
test('timeout não repete e ACK tardio pode ser persistido sem resolver sucesso antigo', async t => {
  const { client, gate } = fixture(t, 15), m = message(), updates = []; let calls = 0;
  await assert.rejects(gate.send(async () => { calls++; return m; }, { onReceipt: item => updates.push(item) }), { code: 'PLOA_SEND_UNCONFIRMED' });
  assert.equal(calls, 1); assert.equal(updates.at(-1).ack, 0);
  client.emit('message_ack', m, 1);
  assert.equal(updates.at(-1).ack, 1); assert.equal(calls, 1);
});
test('queda durante envio interrompe a espera e não fabrica confirmação', async t => {
  const { client, gate } = fixture(t), m = message(), updates = [];
  const sending = gate.send(async () => m, { onReceipt: item => updates.push(item) });
  const rejected = assert.rejects(sending, { code: 'PLOA_SEND_UNCONFIRMED' });
  await tick(); client.emit('disconnected', 'LOGOUT'); await rejected;
  assert.equal(updates.at(-1).ack, 0);
});
test('SDK sem ID e ACK negativo nunca resultam em sucesso; erro anterior ao envio é preservado', async t => {
  const { client, gate } = fixture(t);
  await assert.rejects(gate.send(async () => ({})), { code: 'PLOA_SEND_UNCONFIRMED' });
  const noLid = Error('No LID for user');
  await assert.rejects(gate.send(async () => { throw noLid; }), error => error === noLid);
  const sending = gate.send(async () => message());
  const rejected = assert.rejects(sending, { code: 'PLOA_SEND_UNCONFIRMED' });
  await tick(); client.emit('message_ack', message(), -1); await rejected;
});
test('falha ao persistir ID/ACK impede sucesso e contador sem apagar pendência', async t => {
  const { gate } = fixture(t), failure = Object.assign(Error('fake disk lock'), { code: 'PERSISTENCIA_JSON_GRAVACAO' });
  await assert.rejects(gate.send(async () => message(1), { onReceipt: () => { throw failure; } }), error => error === failure);
});
test('registro diário recebe ID/ACK do servidor uma vez; rejeita ACK pendente', async t => {
  const root = temporaryRoot(t), { client, gate } = fixture(t);
  let counter = { data: '2026-11-18', enviados: 0 };
  const ledger = createDailySendLedger({ root, day: () => counter.data, readCounter: () => counter, saveCounter: value => { counter = value; } });
  assert.throws(() => ledger.confirm('5511999999999', counter, { receipt: { messageId: 'fixture', ack: 0 } }), /não confirmou/);
  const sending = gate.send(async () => message());
  await tick(); assert.equal(ledger.recover().enviados, 0);
  client.emit('message_ack', message(), 1);
  const sent = await sending, receipt = gate.receipt(sent);
  ledger.confirm('5511999999999', counter, { runId: 'fixture', receipt }); ledger.apply(counter);
  ledger.confirm('5511999999999', counter, { runId: 'fixture', receipt });
  assert.equal(counter.enviados, 1);
  const persisted = JSON.parse(fs.readFileSync(path.join(root, ledger.file), 'utf8'));
  assert.equal(persisted.confirmation.messageId, receipt.messageId); assert.equal(persisted.confirmation.ack, 1);
});
test('pendentes incertos aparecem para conferir e reservam a cota sem contar como enviados', () => {
  assert.deepEqual(summarizeOutreachResults([{ numero: '1', status: 'envio pendente de confirmação (não reenviado automaticamente)' }]), { sent: 0, skipped: 0, failed: 0, uncertain: 1 });
  const items = { '1': { confirmationTracked: true, attemptDay: '2026-11-18' }, '2': { confirmationTracked: true, attemptDay: '2026-11-18' }, '3': { confirmationTracked: true, attemptDay: '2026-11-17' }, '4': {} };
  assert.equal(pendingReservations(items, '2026-11-18', id => id === '2'), 1);
});
