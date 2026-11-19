'use strict';
const http = require('node:http');
const { loadConfig } = require('./config');
const { createSupabaseGateway } = require('./supabase');
const { createCloudHandler } = require('./http');
const { createSessionPersistence } = require('./session-persistence');
const { createCodeMailer } = require('./code-mailer');
const { createEmailSecurityProvider } = require('./email-security-provider');
const { withProtectedServerKey } = require('./server-key-settings');
const {withStateKey}=require('./state-key-settings');
const {createSharedRuntime}=require('./shared-runtime');
const {createAccountAccess}=require('./account-access');
const fs=require('node:fs'),path=require('node:path');

function startCloudPreview(env = process.env) {
  const config = withStateKey(withProtectedServerKey(loadConfig(env)));
  const mailer = createCodeMailer(config);
  const gateway=createSupabaseGateway(config);
  const runtime=config.stateMode==='shared'?createSharedRuntime({config,gateway,mailer}):undefined;
  let localPanel;
  if(env.PLOA_LOCAL_PANEL==='1'){
    if(config.production)throw new Error('O agente local não deve ser iniciado no servidor público de contas.');
    const CODE_ROOT=path.resolve(__dirname,'../..');
    const {createAccountData}=require('../lib/account-data');
    const {createLocalRuntimes}=require('./local-runtimes');
    const directory=path.join(CODE_ROOT,'.ploa-local');
    const bindingFile=path.join(directory,'owner-binding.json');
    let legacyBinding=null;
    if(fs.existsSync(bindingFile))legacyBinding=JSON.parse(fs.readFileSync(bindingFile,'utf8'));
    else if(fs.existsSync(path.join(CODE_ROOT,'leads.json')))throw new Error('Confira o vínculo da operação existente antes de ativar a integração.');
    localPanel={registry:createAccountData({directory,codeRoot:CODE_ROOT,legacyBinding}),runtimes:createLocalRuntimes({codeRoot:CODE_ROOT,origin:config.origin})};
  }
  const handler = createCloudHandler({ origin: config.origin, gateway, runtime, persistence:runtime?undefined:createSessionPersistence(),
    localPanel,
    accessControl:config.serverKey?createAccountAccess(config):undefined,
    mailer, emailSecurity: createEmailSecurityProvider(config) });
  const server = http.createServer(handler);
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  const cleanup=runtime?setInterval(()=>{runtime.cleanup().catch(()=>{});},300000):null;
  cleanup?.unref();
  server.on('close', () => { if(cleanup)clearInterval(cleanup);handler.dispose(); mailer.close?.();void localPanel?.runtimes.close(); });
  server.on('error', error => console.error(error.code === 'EADDRINUSE' ? 'A porta de preparação já está em uso.' : 'Não foi possível abrir o acesso de preparação.'));
  server.listen(config.port, config.host, () => console.log(`Acesso de preparação do Ploa: ${config.origin}`));
  return server;
}

if (require.main === module) {
  try {
    const server = startCloudPreview();
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeIdleConnections(); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { startCloudPreview };
