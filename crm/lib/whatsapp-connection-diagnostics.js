'use strict';
const fs = require('node:fs'), path = require('node:path');
const STATES = new Set(['starting','ready','qr','authenticating','reconnecting','auth_failure','disconnected','stopped']);
const REASONS = new Set(['LOGOUT','CONFLICT','UNPAIRED','UNPAIRED_IDLE','TIMEOUT','DISCONNECTED','NAVIGATION_INTERRUPTED','NAVIGATION_ERROR']);
function createConnectionDiagnostics(root, { maxBytes = 65536 } = {}) {
  const file = path.join(root, 'diagnostico_conexao_whatsapp.jsonl');
  return (state, reason = '') => {
    if (!STATES.has(state)) return;
    // No arbitrary error strings, URLs, IDs, codes, session data or conversations.
    const safeReason = REASONS.has(String(reason).toUpperCase()) ? String(reason).toUpperCase() : reason ? 'OTHER' : '';
    const line = JSON.stringify({ version: 1, at: new Date().toISOString(), state, reason: safeReason }) + '\n';
    try {
      let size = 0; try { size = fs.statSync(file).size; } catch {}
      if (size + Buffer.byteLength(line) > maxBytes) {
        // Bound disk and memory; never read a pre-existing oversized file.
        let tail = size <= maxBytes ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-100).join('\n') + '\n' : '';
        while (Buffer.byteLength(tail + line) > maxBytes && tail) tail = tail.slice(tail.indexOf('\n') + 1);
        fs.writeFileSync(file, tail + line, { mode: 0o600 });
      } else fs.appendFileSync(file, line, { mode: 0o600 });
    } catch { /* Diagnostic failure never clears a session or restarts a send. */ }
  };
}
module.exports = { createConnectionDiagnostics };
