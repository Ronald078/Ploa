'use strict';
const idOf = message => typeof message?.id === 'string' ? message.id : message?.id?._serialized || message?.id?.$1 || '';
const validAck = value => Number.isInteger(value) && value >= -1 && value <= 4;
const stageOf = ack => ack >= 3 ? 'read' : ack >= 2 ? 'delivered' : ack >= 1 ? 'server' : ack === -1 ? 'failed' : 'pending';
function pendingReservations(records, day, confirmed = () => false) {
  return Object.entries(records || {}).filter(([number, item]) => item?.confirmationTracked === true &&
    item.attemptDay === day && !confirmed(number)).length;
}

// A resolved sendMessage() is not a server receipt. Never retry an ambiguous send.
function createSendConfirmation(client, { timeoutMs = 60000, now = Date.now } = {}) {
  const early = new Map(), tracked = new Map(), receipts = new WeakMap(), waiting = new Set();
  const uncertain = cause => Object.assign(new Error('Envio sem confirmação do servidor do WhatsApp. Não será repetido automaticamente.'),
    { code: 'PLOA_SEND_UNCONFIRMED', cause });
  function trim() {
    for (const [id, item] of tracked) if (item.done && now() - item.at > 600000) tracked.delete(id);
    while (early.size > 1000) early.delete(early.keys().next().value);
    for (const [id, item] of tracked) { if (tracked.size <= 512) break; if (item.done) tracked.delete(id); }
  }
  function onAck(message, ack) {
    const id = idOf(message);
    if (!id || !validAck(ack)) return;
    const previous = early.get(id);
    if (previous === undefined || ack > previous || ack === -1 && previous === 0) early.set(id, ack);
    tracked.get(id)?.update(ack);
    trim();
  }
  function disconnected() { for (const item of [...waiting]) item.fail(uncertain('connection_lost')); }
  client.on('message_ack', onAck);
  client.on('disconnected', disconnected);
  client.on('auth_failure', disconnected);
  async function send(operation, { onReceipt = () => {} } = {}) {
    trim();
    return new Promise((resolve, reject) => {
      let message, timer;
      const item = { done: false, at: now(), ack: undefined,
        fail(error) { if (item.done) return; item.done = true; clearTimeout(timer); waiting.delete(item); reject(error); },
        update(ack) {
          if (!message || !validAck(ack)) return;
          if (item.ack !== undefined && ack <= item.ack && !(ack === -1 && item.ack === 0)) return;
          item.ack = ack;
          const receipt = { messageId: idOf(message), ack, stage: stageOf(ack), at: new Date(now()).toISOString() };
          receipts.set(message, receipt);
          try { onReceipt(receipt); } catch (error) { item.fail(error); return; }
          if (ack < 1) { if (ack === -1) item.fail(uncertain('negative_ack')); return; }
          if (!item.done) { item.done = true; clearTimeout(timer); waiting.delete(item); resolve(message); }
        } };
      waiting.add(item);
      timer = setTimeout(() => item.fail(uncertain('timeout')), timeoutMs);
      Promise.resolve().then(operation).then(value => {
        message = value;
        const id = idOf(message);
        if (!id || !message || typeof message !== 'object') { item.fail(uncertain('missing_message_id')); return; }
        tracked.set(id, item);
        const observed = validAck(message.ack) ? message.ack : 0, cached = early.get(id) ?? 0;
        const ack = observed > 0 || cached > 0 ? Math.max(observed, cached) : observed === -1 || cached === -1 ? -1 : 0;
        item.update(ack);
      }, error => item.fail(error)).catch(error => item.fail(error));
    });
  }
  return { send, receipt: message => receipts.get(message),
    close() { disconnected(); client.removeListener('message_ack', onAck); client.removeListener('disconnected', disconnected);
      client.removeListener('auth_failure', disconnected); early.clear(); tracked.clear(); } };
}
module.exports = { createSendConfirmation, idOf, stageOf, pendingReservations };
