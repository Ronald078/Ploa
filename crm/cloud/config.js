'use strict';
const { CloudError } = require('./errors');

function loadConfig(env = process.env) {
  const url = new URL(env.PLOA_SUPABASE_URL || 'https://unconfigured.invalid');
  const key = env.PLOA_SUPABASE_PUBLISHABLE_KEY || '';
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new CloudError(503, 'configuration', 'Configure o projeto Supabase separado do Ploa.');
  }
  let anon = false;
  try { anon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch { /* Publishable keys are not JWTs. */ }
  if (!key.startsWith('sb_publishable_') && !anon) {
    throw new CloudError(503, 'configuration', 'Use a chave pública do projeto, sem chave administrativa.');
  }
  const mode=env.PLOA_SERVER_MODE||'preview';
  if(!['preview','production'].includes(mode))throw new Error('Modo do servidor inválido.');
  const production=mode==='production';
  const port = Number(env.PLOA_CLOUD_PORT || (production ? env.PORT || 3000 : 4313));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Porta de preparação inválida.');
  if(!production&&[4310,4311].includes(port))throw new Error('As portas 4310 e 4311 pertencem ao painel e ao acesso pelo celular. Use 4313 para a prévia de contas.');
  const mailProvider = env.PLOA_EMAIL_PROVIDER || 'resend';
  if (!['gmail', 'resend'].includes(mailProvider)) throw new Error('Provedor de e-mail inválido.');
  let origin=`http://127.0.0.1:${port}`;
  const stateMode=env.PLOA_STATE_MODE||(production?'shared':'local');
  if(!['local','shared'].includes(stateMode))throw new Error('Modo de estado inválido.');
  if(production){
    let publicUrl;try{publicUrl=new URL(env.PLOA_PUBLIC_ORIGIN);}catch{throw new Error('Configure a origem HTTPS do Ploa.');}
    if(publicUrl.protocol!=='https:'||publicUrl.username||publicUrl.password||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||publicUrl.port||!publicUrl.hostname.includes('.')||publicUrl.hostname.endsWith('.localhost')||publicUrl.hostname==='127.0.0.1')throw new Error('Use uma origem HTTPS pública exata.');
    if(stateMode!=='shared'||!env.PLOA_SUPABASE_SERVER_KEY||!env.PLOA_SERVER_STATE_KEY)throw new Error('O servidor online precisa de estado compartilhado e chaves privadas configuradas.');
    origin=publicUrl.origin;
  }
  return { url: url.origin, key, port, host: production?'0.0.0.0':'127.0.0.1', origin, production,stateMode,stateKey:env.PLOA_SERVER_STATE_KEY||'',
    serverKey: env.PLOA_SUPABASE_SERVER_KEY || '', emailKey: env.PLOA_RESEND_API_KEY || '', emailFrom: env.PLOA_EMAIL_FROM || '',
    mailProvider, gmailUser: env.PLOA_GMAIL_USER || '', gmailPassword: env.PLOA_GMAIL_APP_PASSWORD || '' };
}

module.exports = { loadConfig };
