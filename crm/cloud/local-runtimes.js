'use strict';
const path=require('node:path'),net=require('node:net'),http=require('node:http');
const {spawn:spawnProcess}=require('node:child_process');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {CloudError}=require('./errors');
function unusedPort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});}
function health(port){return new Promise(resolve=>{const req=http.get('http://127.0.0.1:'+port+'/healthz',res=>{res.resume();resolve(res.statusCode===200);});req.setTimeout(1000,()=>req.destroy());req.once('error',()=>resolve(false));});}
function createLocalRuntimes({codeRoot,origin,spawn=spawnProcess,getPort=unusedPort,probe=health,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const items=new Map(),pending=new Map();let closing=false;
 async function check(data){
  if(closing)throw new CloudError(503,'panel_stopping','O Ploa está encerrando.');
  if(data.legacy&&await probe(4310))throw new CloudError(409,'legacy_running','A operação atual ainda está aberta. Finalize os disparos e feche a janela antiga antes de abrir a operação vinculada à conta.');
 }
 async function launch(data,context){
  await check(data);
  const port=await getPort(),token=randomBytes(32).toString('hex'),lease=randomBytes(32).toString('hex');
  // Do not pass Supabase/server/SMTP secrets to a commercial worker.
  const env={...process.env};for(const key of Object.keys(env))if(/^PLOA_(?:SUPABASE|SERVER_STATE|GMAIL|RESEND|EMAIL_FROM|STATE_MODE)/.test(key))delete env[key];
  Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',CRM_PORT:String(port),PLOA_ACCOUNT_WORKER:'1',PLOA_DATA_ROOT:data.root,PLOA_LOCAL_BRIDGE_TOKEN:token,PLOA_ACCOUNT_AUTH_URL:origin+'/api/cloud/panel/agent-authorize',PLOA_ACCOUNT_AUTH_TOKEN:lease});
  const child=spawn(process.execPath,[path.join(codeRoot,'crm/server.js')],{cwd:codeRoot,windowsHide:true,shell:false,env,stdio:['ignore','pipe','pipe','ipc']});
  const item={...data,port,token,lease,child,context,ready:false,error:false};items.set(data.workspaceId,item);
  // Drain output without persisting conversations or provider errors in login logs.
  child.stdout?.on('data',()=>{});child.stderr?.on('data',()=>{});
  child.once('error',()=>{item.error=true;});
  child.once('exit',()=>{if(items.get(data.workspaceId)===item)items.delete(data.workspaceId);});
  child.on('message',message=>{if(message?.type==='ploa-attendance'&&process.connected)process.send?.(message,()=>{});});
  for(let attempt=0;attempt<80;attempt++){
   if(closing||item.error||child.exitCode!=null)break;
   if(await probe(port)){item.ready=true;return item;}
   await wait(150);
  }
  child.kill();items.delete(data.workspaceId);throw new CloudError(503,'panel_startup','Não foi possível iniciar o painel desta empresa. Os arquivos foram preservados.');
 }
 return{
  check,
  async get(data,context){
   const existing=items.get(data.workspaceId);
   if(existing?.ready){if(existing.accountId!==data.accountId)throw new CloudError(403,'workspace','Esta instalação pertence a outra conta.');existing.context=context;return existing;}
   if(!pending.has(data.workspaceId))pending.set(data.workspaceId,launch(data,context).finally(()=>pending.delete(data.workspaceId)));
   const item=await pending.get(data.workspaceId);
   // Ownership can change while a worker is starting. A shared startup promise
   // must never hand a different account the first account's worker or lease.
   if(item.accountId!==data.accountId)throw new CloudError(403,'workspace','Esta instalação pertence a outra conta.');
   item.context=context;
   return item;
  },
  findLease(value){
   if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return null;
   return [...items.values()].find(item=>timingSafeEqual(Buffer.from(item.lease),Buffer.from(value)))||null;
  },
  async close(){closing=true;await Promise.allSettled([...pending.values()]);await Promise.all([...items.values()].map(item=>new Promise(resolve=>{if(item.child.exitCode!=null){resolve();return;}let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};const timer=setTimeout(()=>{item.child.kill();finish();},20000);item.child.once('exit',finish);if(item.child.connected)item.child.send({type:'ploa-shutdown'},()=>{});else item.child.kill();})));items.clear();},
 };
}
module.exports={createLocalRuntimes,unusedPort,health};
