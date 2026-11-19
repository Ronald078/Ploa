'use strict';
const path=require('node:path'),{spawn}=require('node:child_process');
const {prepareWorkerAssets}=require('./prepare-worker-assets');
async function run(mode,args=[]){
 if(!['check','deploy','dev','login','whoami','secret'].includes(mode))throw Error('Comando da Cloudflare inválido.');
 const root=path.resolve(__dirname,'../..');
 if(['check','deploy','dev'].includes(mode))await prepareWorkerAssets(root);
 const command=mode==='check'?['deploy','--dry-run','--outdir',path.join(root,'output/cloud-worker-build')]:[mode];
 const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...command,...(!['login','whoami'].includes(mode)?['--config',path.join(root,'crm/cloud/wrangler.jsonc')]:[]),...args],{
  cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true',CLOUDFLARE_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'},
 });
 child.once('error',()=>{console.error('Não foi possível executar a ferramenta da Cloudflare.');process.exitCode=1;});
 child.once('exit',code=>{process.exitCode=code??1;});return child;
}
if(require.main===module)run(process.argv[2],process.argv.slice(3)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run};
