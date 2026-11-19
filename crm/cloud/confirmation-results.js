'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { CloudError } = require('./errors');
const digest = value => createHash('sha256').update(value).digest('hex');

// A short-lived display receipt, never a credential or authorization proof.
function createConfirmationResults({ now = Date.now, capacity = 1000 } = {}) {
  const results = new Map();
  const key = id => typeof id === 'string' && /^[A-Za-z0-9_-]{43}$/.test(id) ? digest(id) : '';
  function prune() { for (const [id, until] of results) if (until <= now()) results.delete(id); }
  return {
    issue() {
      prune();
      if (results.size >= capacity) throw new CloudError(429, 'confirmation_limit', 'Tente entrar com seu e-mail e senha.');
      const id = randomBytes(32).toString('base64url');
      results.set(digest(id), now() + 600000); return id;
    },
    has(id) { prune(); return results.has(key(id)); },
    remove(id) { results.delete(key(id)); },
    clear() { results.clear(); },
  };
}
module.exports = { createConfirmationResults };
