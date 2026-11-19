'use strict';

function reachedDailyLimit(limit, sent) {
  return Number.isFinite(Number(limit)) && Number(limit) > 0 && Number(sent) >= Number(limit);
}

// O andamento visual não substitui os registros protegidos de enviados e contador.
function createProgressWriter({ save, warn = () => {}, now = Date.now,
  wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
  let retryAt = 0, lastWarning = -Infinity;
  return data => {
    const terminal = ['limite_diario', 'concluida', 'interrompida', 'erro'].includes(data.status);
    if (!terminal && now() < retryAt) return false;
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { save(data); retryAt = 0; return true; }
      catch (value) { error = value; if (attempt < 2) wait(40 * (attempt + 1)); }
    }
    retryAt = now() + 1000;
    if (terminal || now() - lastWarning >= 30000) { warn(error); lastWarning = now(); }
    return false;
  };
}

module.exports = { reachedDailyLimit, createProgressWriter };
