'use strict';
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { CloudError } = require('./errors');
const digest = value => createHash('sha256').update(value).digest('base64url');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function createAuthFlows({ origin, now = Date.now, capacity = 1000 }) {
  const flows = new Map();
  function prune() { for (const [key, flow] of flows) if (flow.until <= now()) flows.delete(key); }
  return {
    kind(id) { prune(); return validId(id) ? flows.get(digest(id))?.kind : undefined; },
    consumeConfirmation(id) {
      prune();
      const key = validId(id) ? digest(id) : '', flow = flows.get(key);
      if (!flow || flow.kind !== 'signup') throw new CloudError(400, 'flow', 'Não foi possível concluir a confirmação. Tente entrar com sua senha.');
      // Confirmation alone never grants an app session. Recovery/OAuth still require the original browser.
      flows.delete(key); return flow;
    },
    create(kind, remember = false) {
      prune();
      if (flows.size >= capacity) throw new CloudError(429, 'flow_limit', 'Aguarde um pouco e tente novamente.');
      const id = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
      flows.set(digest(id), { kind, remember: remember === true, verifier, until: now() + 30 * 60 * 1000 });
      return { id, challenge: digest(verifier), redirect: origin + '/auth/callback?flow=' + encodeURIComponent(id) };
    },
    consume(id, cookieId) {
      prune();
      if (!validId(id) || !validId(cookieId) || !timingSafeEqual(Buffer.from(id), Buffer.from(cookieId))) {
        throw new CloudError(400, 'flow', 'Abra o link no navegador em que iniciou o acesso, ou solicite um novo.');
      }
      const key = digest(id), flow = flows.get(key);
      if (!flow) throw new CloudError(400, 'flow', 'O link expirou ou já foi utilizado. Solicite um novo.');
      flows.delete(key);
      return flow;
    },
    clear() { flows.clear(); },
  };
}
module.exports = { createAuthFlows };
