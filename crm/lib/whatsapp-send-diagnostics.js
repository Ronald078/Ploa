'use strict';
const fs = require('node:fs'), path = require('node:path');

// Fixed vocabulary: never persist arbitrary error text, message IDs or payloads.
const CODES = ['OK', 'SUCCESS', 'SENT', 'ERROR_UNKNOWN', 'ERROR', 'FAILURE', 'FAILED',
  'ERROR_NETWORK', 'ERROR_TIMEOUT', 'ERROR_RATE_LIMIT', 'ERROR_RATE_LIMITED',
  'ERROR_NOT_CONNECTED', 'ERROR_NOT_FOUND', 'ERROR_UNAUTHORIZED', 'ERROR_FORBIDDEN',
  'ERROR_INVALID_JID', 'ERROR_INVALID_RECIPIENT', 'ERROR_NO_SESSION',
  'Error', 'TypeError', 'ReferenceError', 'TimeoutError', 'AbortError'];
const FIELDS = ['status', 'code', 'errorCode', 'messageSendResult', 'result', 'name'];
const TYPES = ['undefined', 'null', 'string', 'number', 'boolean', 'object', 'other'];
const PHASES = ['resolved', 'rejected', 'sync_error', 'installed', 'unavailable'];

function safeRecord(input) {
  if (!input || !PHASES.includes(input.phase)) return null;
  const record = { version: 1, at: new Date().toISOString(), phase: input.phase };
  if (Number.isFinite(input.durationMs)) record.durationMs = Math.max(0, Math.min(86400000, Math.round(input.durationMs)));
  if (TYPES.includes(input.valueType)) record.valueType = input.valueType;
  if (CODES.includes(input.valueCode)) record.valueCode = input.valueCode;
  if (Array.isArray(input.fields)) record.fields = input.fields.slice(0, 18).flatMap(item => {
    if (!item || !FIELDS.includes(item.field) || !TYPES.includes(item.type) || ![0, 1].includes(item.depth)) return [];
    const field = { field: item.field, depth: item.depth, type: item.type };
    if (CODES.includes(item.code)) field.code = item.code;
    // HTTP-like technical codes only; no recipient, timestamps or message IDs.
    if (Number.isInteger(item.numericCode) && item.numericCode >= 0 && item.numericCode <= 599) field.numericCode = item.numericCode;
    return [field];
  });
  return record;
}

function createSendDiagnostics(root, { maxBytes = 65536 } = {}) {
  const file = path.join(root, 'diagnostico_envios_whatsapp.jsonl');
  return input => {
    try {
      const record = safeRecord(input);
      if (!record) return;
      const line = JSON.stringify(record) + '\n';
      let size = 0; try { size = fs.statSync(file).size; } catch {}
      if (size + Buffer.byteLength(line) > maxBytes) {
        let tail = size <= maxBytes ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-100).join('\n') + '\n' : '';
        while (tail && Buffer.byteLength(tail + line) > maxBytes) tail = tail.slice(tail.indexOf('\n') + 1);
        if (Buffer.byteLength(line) <= maxBytes) fs.writeFileSync(file, tail + line, { mode: 0o600 });
      } else fs.appendFileSync(file, line, { mode: 0o600 });
    } catch { /* Diagnostics must not change sending, confirmation or recovery. */ }
  };
}

// Self-contained browser function, also exercised in an isolated VM in tests.
function installInPage(binding, codes, fields) {
  const action = window.require('WAWebSendMsgChatAction');
  const original = action.addAndSendMsgToChat;
  if (typeof original !== 'function') return false;
  if (original.__ploaSendDiagnostics === binding) return true;
  const typeOf = value => value === null ? 'null' : ['undefined', 'string', 'number', 'boolean', 'object'].includes(typeof value) ? typeof value : 'other';
  function collect(value) {
    const result = { valueType: typeOf(value), fields: [] };
    if (codes.includes(value)) result.valueCode = value;
    function visit(object, depth) {
      if (!object || typeof object !== 'object') return;
      for (const field of fields) {
        // Avoid invoking arbitrary getters on result/error objects.
        const descriptor = Object.getOwnPropertyDescriptor(object, field);
        if (!descriptor || !('value' in descriptor)) continue;
        const v = descriptor.value, item = { field, depth, type: typeOf(v) };
        if (codes.includes(v)) item.code = v;
        if (Number.isInteger(v) && v >= 0 && v <= 599) item.numericCode = v;
        result.fields.push(item);
        if (!depth) visit(v, 1);
      }
    }
    visit(value, 0);
    return result;
  }
  function report(phase, value, started) {
    try {
      const callback = window[binding];
      if (typeof callback !== 'function') return;
      const data = { phase, durationMs: Date.now() - started, ...collect(value) };
      Promise.resolve(callback(data)).catch(() => {});
    } catch { /* No raw result or error crosses the browser boundary. */ }
  }
  function observed(...args) {
    const started = Date.now();
    let pair;
    try { pair = original.apply(this, args); }
    catch (error) { report('sync_error', error, started); throw error; }
    try {
      if (Array.isArray(pair) && pair.length > 1) {
        // Observe a separate branch. Return the exact tuple and promises to SDK.
        Promise.resolve(pair[1]).then(value => report('resolved', value, started),
          error => report('rejected', error, started)).catch(() => {});
      }
    } catch { /* Original return is preserved even if instrumentation fails. */ }
    return pair;
  }
  Object.defineProperty(observed, '__ploaSendDiagnostics', { value: binding });
  action.addAndSendMsgToChat = observed;
  return true;
}

function attachSendDiagnostics(client, { record = () => {}, installTimeoutMs = 1000 } = {}) {
  const original = client.sendMessage, bindings = new WeakMap();
  const binding = '__ploaSendResultDiagnostic';
  const report = data => { try { record(safeRecord(data)); } catch {} };
  async function install(page) {
    let exposed = bindings.get(page);
    if (!exposed) {
      exposed = page.exposeFunction(binding, data => {
        // Ignore callbacks from replaced/closed pages.
        if (client.pupPage === page) report(data);
      });
      bindings.set(page, exposed);
      exposed.catch(() => { if (bindings.get(page) === exposed) bindings.delete(page); });
    }
    await exposed;
    if (client.pupPage !== page) return;
    if (!await page.evaluate(installInPage, binding, CODES, FIELDS)) throw Error('Diagnostic unavailable');
  }
  client.sendMessage = async function (...args) {
    const page = client.pupPage;
    let timer;
    try {
      if (!page) throw Error('Page unavailable');
      await Promise.race([install(page), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Diagnostic timeout')), installTimeoutMs);
      })]);
    } catch { report({ phase: 'unavailable' }); }
    finally { clearTimeout(timer); }
    return original.apply(this, args);
  };
  return { install: async () => { try { await install(client.pupPage); return true; } catch { report({ phase: 'unavailable' }); return false; } } };
}
module.exports = { attachSendDiagnostics, createSendDiagnostics, safeRecord, installInPage, CODES, FIELDS };
