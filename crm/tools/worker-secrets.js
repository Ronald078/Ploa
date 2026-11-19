'use strict';
const path=require('node:path'),os=require('node:os'),{randomBytes}=require('node:crypto'),{spawn}=require('node:child_process');
const {loadConfig}=require('../cloud/config');
const {withProtectedServerKey}=require('../cloud/server-key-settings');
const {createGmailSettings}=require('../cloud/gmail-settings');
const {createCredentialStore}=require('../lib/credential-store');
const {accountOrigin}=require('../cloud/remote-account-client');
function workerSecrets({origin,config,gmail,store}){
 const publicOrigin=accountOrigin(origin);
 if(!config.serverKey||!gmail?.user||!gmail?.appPassword)throw Error('A conexão privada de Supabase e Gmail precisa estar configurada.');
 const saved=store.load();if(!saved.stateKey){saved.stateKey=randomBytes(32).toString('base64');store.save(saved);}
 if(Buffer.from(saved.stateKey,'base64').length!==32)throw Error('Chave do estado hospedado inválida.');
 return{PLOA_PUBLIC_ORIGIN:publicOrigin,PLOA_SUPABASE_URL:config.url,PLOA_SUPABASE_PUBLISHABLE_KEY:config.key,PLOA_SUPABASE_SERVER_KEY:config.serverKey,
  PLOA_SERVER_STATE_KEY:saved.stateKey,PLOA_EMAIL_PROVIDER:'gmail',PLOA_GMAIL_USER:gmail.user,PLOA_GMAIL_APP_PASSWORD:gmail.appPassword};
}
async function uploadWorkerSecrets(origin){
 const root=path.resolve(__dirname,'../..');process.loadEnvFile(path.join(root,'crm/cloud/.env'));
 const payload=workerSecrets({origin,config:withProtectedServerKey(loadConfig()),gmail:createGmailSettings().load(),
  store:createCredentialStore({directory:path.join(os.homedir(),'AppData/Local/Ploa/Cloud/Workers')})});
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'secret','bulk','--config',path.join(root,'crm/cloud/wrangler.jsonc')],{
   cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true',CLOUDFLARE_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'},
  });
  let output='';child.stdout.on('data',part=>{output=(output+part).slice(-8000);});child.stderr.on('data',()=>{});
  child.once('error',()=>reject(Error('Não foi possível iniciar o vínculo privado do serviço.')));
  child.once('exit',code=>code===0&&/8 secrets|8 secret|success|Success/.test(output)?resolve():reject(Error('Não foi possível confirmar os secrets no host. Confira a conexão e as permissões da Cloudflare.')));
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
 });
 return{configured:true,secretCount:Object.keys(payload).length,origin};
}
if(require.main===module)uploadWorkerSecrets(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={workerSecrets,uploadWorkerSecrets};
