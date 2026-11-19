'use strict';
const { loadConfig } = require('./config');
const { CloudError } = require('./errors');
const { normalizeServerKey, requirePloaProject, createServerKeySettings } = require('./server-key-settings');

async function configureServerKey({ input, config, store = createServerKeySettings(), fetch: fetcher = fetch }) {
  requirePloaProject(config.url);
  const serverKey = normalizeServerKey(input?.serverKey);
  if (config.serverKey && config.serverKey !== serverKey) throw new CloudError(409, 'server_environment', 'Ja existe uma chave definida no ambiente do servidor. Confira essa configuracao antes de substitui-la.');
  const legacy = !serverKey.startsWith('sb_secret_');
  let response;
  try {
    // Authentication/read-only permission check. limit=0 does not return account rows.
    response = await fetcher(config.url + '/rest/v1/ploa_account_security?select=email_2fa_enabled&limit=0', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { apikey: serverKey, ...(legacy ? { Authorization: `Bearer ${serverKey}` } : {}) },
    });
    await response.body?.cancel();
  } catch { throw new CloudError(503, 'server_connection', 'Nao foi possivel verificar o projeto Ploa. Confira a internet e tente novamente.'); }
  if (!response.ok) throw new CloudError(503, 'server_verification', 'A chave nao foi aceita pelo projeto Ploa ou a base de acesso esta indisponivel. Confira se copiou a chave secret do projeto correto.');
  store.save(config.url, serverKey);
  return { saved: true, verified: true, message: 'Chave verificada e salva com a protecao do Windows. Reabra somente a previa de acesso para carregar a configuracao.' };
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 8192) process.exit(1); });
  process.stdin.on('end', async () => {
    try { process.stdout.write(JSON.stringify(await configureServerKey({ input: JSON.parse(raw), config: loadConfig() }))); }
    catch (error) {
      process.stdout.write(JSON.stringify({ saved: false, message: error instanceof CloudError ? error.message : 'Nao foi possivel salvar a chave protegida. A configuracao anterior foi mantida.' }));
      process.exitCode = 1;
    }
  });
}
module.exports = { configureServerKey };
