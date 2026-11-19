'use strict';
const { CloudError } = require('./errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createEmailSecurityProvider({ url, serverKey = '', fetch: fetcher = fetch }) {
  let legacyService = false;
  try { legacyService = JSON.parse(Buffer.from(serverKey.split('.')[1], 'base64url')).role === 'service_role'; } catch { /* Modern secret is opaque. */ }
  const ready = serverKey.startsWith('sb_secret_') || legacyService;
  async function call(name, token, identity, remember, enabled) {
    if (!ready) throw new CloudError(503, 'security_configuration', 'A verificação por e-mail ainda precisa ser configurada pelo responsável do Ploa.');
    // The same token must first be verified through Auth /user by the caller.
    let sessionId;
    try { sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).session_id; } catch { /* Reject malformed provider responses. */ }
    if (!UUID.test(sessionId || '') || !UUID.test(identity?.id || '')) throw new CloudError(401, 'session', 'Entre novamente para confirmar seu acesso.');
    const body = { p_user: identity.id, p_session: sessionId, p_until: new Date(Date.now() + (remember ? 30 * 24 : 8) * 3600000).toISOString(),
      ...(typeof enabled === 'boolean' ? { p_enabled: enabled } : {}) };
    let response;
    try {
      response = await fetcher(url + '/rest/v1/rpc/' + name, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { apikey: serverKey, ...(legacyService ? { Authorization: `Bearer ${serverKey}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new CloudError(503, 'security_unavailable', 'Não foi possível confirmar a verificação. Inicie o acesso novamente.'); }
    await response.body?.cancel();
    if (!response.ok) throw new CloudError(503, 'security_unavailable', 'Não foi possível confirmar a verificação. Confira a configuração ou tente novamente.');
  }
  return {
    ready,
    async mark(credentials, identity, remember) { await call('ploa_mark_email_session', credentials.accessToken, identity, remember); },
    async set(credentials, identity, remember, enabled) { await call('ploa_set_email_security', credentials.accessToken, identity, remember, enabled); },
  };
}
module.exports = { createEmailSecurityProvider };
