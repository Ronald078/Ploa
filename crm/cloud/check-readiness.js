'use strict';
const { loadConfig } = require('./config');
const { withProtectedServerKey } = require('./server-key-settings');
const { createCodeMailer } = require('./code-mailer');
const { createStateCrypto } = require('./state-crypto');

const requiredFunctions = [
  'state_read', 'state_put', 'state_take', 'state_lease', 'state_write',
  'state_release', 'state_remove_user', 'limit_hit', 'state_cleanup',
  'account_access', 'admin_accounts', 'admin_set_feature',
].map(name => '/rpc/ploa_' + name);

async function checkReadiness({ config, mailerReady, fetch: fetcher = fetch }) {
  async function read(path, headers = {}) {
    try {
      const response = await fetcher(config.url + path, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12000), headers,
      });
      return response.ok ? { ok: true, data: await response.json() } : { ok: false, status: response.status };
    } catch { return { ok: false }; }
  }
  const auth = await read('/auth/v1/settings', { apikey: config.key });
  let schema = { ok: false };
  if (config.serverKey) schema = await read('/rest/v1/', {
    apikey: config.serverKey, Accept: 'application/openapi+json',
    ...(!config.serverKey.startsWith('sb_secret_') ? { Authorization: `Bearer ${config.serverKey}` } : {}),
  });
  const missingFunctions = requiredFunctions.filter(name => !schema.data?.paths?.[name]);
  let stateKeyReady = false;
  try { createStateCrypto(config.stateKey); stateKeyReady = true; } catch { /* Read-only: never generate a key here. */ }
  const result = {
    mode: config.production ? 'production' : 'preview',
    authenticationReachable: auth.ok,
    googleConfigured: auth.ok && auth.data.external?.google === true,
    signupAvailable: auth.ok && auth.data.disable_signup !== true && auth.data.external?.email !== false,
    mailConfigured: mailerReady === true,
    sharedDatabase: { verified: schema.ok, requiredFunctions: requiredFunctions.length, missingFunctions: schema.ok ? missingFunctions : [] },
    stateKeyInEnvironment: stateKeyReady,
    httpsOriginConfigured: config.production === true && config.origin.startsWith('https:'),
    deliveryAndLoginValidation: 'requires-owner-validation',
    publicationReady: false,
  };
  // This diagnostic cannot attest to personal login, delivery or the host/proxy validation.
  result.infrastructureReady = config.production === true && config.stateMode === 'shared' && auth.ok && schema.ok &&
    missingFunctions.length === 0 && stateKeyReady && mailerReady === true && result.httpsOriginConfigured;
  return result;
}

if (require.main === module) {
  (async () => {
    const config = withProtectedServerKey(loadConfig());
    const mailer = createCodeMailer(config);
    try {
      const result = await checkReadiness({ config, mailerReady: mailer.ready });
      console.log(JSON.stringify(result, null, 2));
      if (process.argv.includes('--strict') && !result.infrastructureReady) process.exitCode = 2;
    } finally { mailer.close?.(); }
  })().catch(() => { console.error('Não foi possível conferir a configuração privada do servidor.'); process.exitCode = 1; });
}
module.exports = { checkReadiness };
