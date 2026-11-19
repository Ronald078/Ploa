'use strict';
const { randomBytes, randomInt, createHmac, timingSafeEqual } = require('node:crypto');
const { CloudError } = require('./errors');

function createEmailChallenges({ mailer, now = Date.now, capacity = 1000 }) {
  const pending = new Map(), lastSent = new Map(), secret = randomBytes(32);
  const digest = value => createHmac('sha256', secret).update(value).digest();
  function prune() {
    for (const [key, item] of pending) if (item.until <= now()) pending.delete(key);
    for (const [key, time] of lastSent) if (time + 60000 <= now()) lastSent.delete(key);
  }
  return {
    async issue(identity, credentials, { remember = false, action = 'login' } = {}) {
      prune();
      if (lastSent.has(identity.id)) throw new CloudError(429, 'email_cooldown', 'Aguarde um minuto antes de solicitar outro código.');
      if (pending.size >= capacity) throw new CloudError(429, 'email_limit', 'Tente novamente em alguns instantes.');
      const id = randomBytes(32).toString('base64url'), code = String(randomInt(100000, 1000000));
      lastSent.set(identity.id, now());
      try { await mailer.sendCode(identity.email, code, id); } catch (error) { lastSent.delete(identity.id); throw error; }
      for (const [key, item] of pending) if (item.identity.id === identity.id) pending.delete(key);
      pending.set(digest(id).toString('hex'), { identity, credentials, remember, action, digest: digest(id + ':' + code), attempts: 0, until: now() + 5 * 60 * 1000 });
      return { id, email: identity.email.replace(/^(.{1,2})[^@]*(@.*)$/, '$1***$2'), expiresIn: 300 };
    },
    status(id) {
      prune(); if (typeof id !== 'string') return null;
      const item = pending.get(digest(id).toString('hex'));
      return item ? { email: item.identity.email.replace(/^(.{1,2})[^@]*(@.*)$/, '$1***$2'), expiresIn: Math.max(0, Math.floor((item.until - now()) / 1000)) } : null;
    },
    consume(id, code) {
      prune();
      const key = typeof id === 'string' ? digest(id).toString('hex') : '', item = pending.get(key);
      if (!item) throw new CloudError(400, 'email_expired', 'O código expirou. Inicie o acesso novamente para receber outro.');
      item.attempts++;
      if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !timingSafeEqual(item.digest, digest(id + ':' + code))) {
        if (item.attempts >= 5) pending.delete(key);
        throw new CloudError(400, item.attempts >= 5 ? 'email_attempts' : 'email_code', item.attempts >= 5 ? 'Limite de tentativas atingido. Inicie o acesso novamente.' : 'Código incorreto. Confira o e-mail e tente novamente.');
      }
      pending.delete(key);
      return item;
    },
    cancel(id) { if (typeof id === 'string') pending.delete(digest(id).toString('hex')); },
    clear() { pending.clear(); lastSent.clear(); },
  };
}
module.exports = { createEmailChallenges };
