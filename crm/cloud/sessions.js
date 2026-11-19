'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { CloudError } = require('./errors');
const hash = id => createHash('sha256').update(id).digest('hex');

function createSessionStore({ gateway, now = Date.now, ttl = 8 * 60 * 60 * 1000, capacity = 1000, persistence }) {
  const sessions = new Map(Object.entries(persistence?.load() || {}).filter(([, value]) => value?.remember === true && value.deadline > now()));
  function persist() {
    persistence?.save(Object.fromEntries([...sessions].filter(([, value]) => value.remember).map(([id, value]) => [id, {
      accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt,
      identity: value.identity, deadline: value.deadline, remember: true, kind: 'normal',
    }])));
  }
  function prune() {
    for (const [id, value] of sessions) if (value.deadline <= now()) sessions.delete(id);
  }
  return {
    async create(credentials, { remember = false, kind = 'normal' } = {}) {
      prune();
      if (sessions.size >= capacity) throw new CloudError(503, 'capacity', 'Tente entrar novamente em alguns instantes.');
      const identity = await gateway.user(credentials.accessToken);
      const id = randomBytes(32).toString('base64url');
      const duration = kind === 'recovery' ? 15 * 60 * 1000 : remember ? 30 * 24 * 60 * 60 * 1000 : ttl;
      if (remember && (!persistence || persistence.available === false)) throw new CloudError(503, 'remember', 'O acesso protegido não está disponível. Entre sem “Lembrar de mim”.');
      sessions.set(hash(id), { ...credentials, identity, deadline: now() + duration, refreshing: null, remember: remember === true && kind === 'normal', kind });
      try { if (remember) persist(); } catch (error) { sessions.delete(hash(id)); throw new CloudError(503, 'remember', error.message); }
      return { id, identity, kind, maxAge: remember ? Math.floor(duration / 1000) : undefined };
    },
    async resolve(id) {
      prune();
      const value = typeof id === 'string' && id.length === 43 ? sessions.get(hash(id)) : null;
      if (!value) throw new CloudError(401, 'session', 'Entre para acessar sua conta.');
      try {
        if (value.expiresAt <= now() + 30000) {
          // Concurrent page requests must share a single refresh-token exchange.
          if (!value.refreshing) value.refreshing = gateway.refresh(value.refreshToken)
            .then(credentials => { Object.assign(value, credentials); if (value.remember) persist(); }).finally(() => { value.refreshing = null; });
          await value.refreshing;
        }
        const identity = await gateway.user(value.accessToken);
        if (identity.id !== value.identity.id) throw new CloudError(401, 'session', 'Entre novamente para confirmar sua conta.');
        return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, identity, kind: value.kind || 'normal', remember: value.remember === true };
      } catch (error) {
        if (error.status === 401) { sessions.delete(hash(id)); if (value.remember) persist(); }
        throw error;
      }
    },
    async remove(id, { revoke = true } = {}) {
      if (typeof id !== 'string') return;
      const value = sessions.get(hash(id));
      sessions.delete(hash(id));
      let saveError;
      try { if (value?.remember) persist(); } catch (error) { saveError = error; }
      if (value) {
        try { if (revoke) await gateway.signOut(value.accessToken); } catch { /* Local access is revoked even during an outage. */ }
      }
      if (saveError) throw new CloudError(503, 'remember', 'O acesso foi encerrado nesta execução, mas não foi possível atualizar o arquivo de acesso lembrado.');
    },
    removeUser(userId) { for (const [id, value] of sessions) if (value.identity.id === userId) sessions.delete(id); persist(); },
    clear() { sessions.clear(); },
  };
}

module.exports = { createSessionStore };
