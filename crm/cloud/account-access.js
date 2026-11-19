'use strict';
const {CloudError}=require('./errors');
const {normalizeServerKey,requirePloaProject}=require('./server-key-settings');
const MODULES=Object.freeze([
 {key:'dashboard',label:'Dashboard'},{key:'funnel',label:'Funil'},{key:'leads',label:'Leads'},
 {key:'search',label:'Buscar leads'},{key:'messages',label:'Mensagens'},{key:'ai',label:'IA'},
 {key:'copies',label:'Copys'},{key:'ads',label:'Anúncios'},
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validModule=key=>MODULES.some(item=>item.key===key);
function normalizeModules(value){
 if(!value||MODULES.some(({key})=>typeof value[key]!=='boolean'))throw new CloudError(503,'access_unavailable','Não foi possível conferir as permissões da conta.');
 return Object.fromEntries(MODULES.map(({key})=>[key,value[key]]));
}
function createAccountAccess({url,serverKey,fetch:fetcher=fetch}){
 requirePloaProject(url);const key=normalizeServerKey(serverKey);
 async function rpc(name,body){
  let response;
  try{response=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
   headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});}
  catch{throw new CloudError(503,'access_unavailable','Não foi possível conferir as permissões da conta.');}
  if(response.status===401||response.status===403)throw new CloudError(403,'administrator','Este controle é exclusivo da administração do Ploa.');
  if(!response.ok)throw new CloudError(503,'access_unavailable','Não foi possível atualizar as permissões. Confira o estado antes de repetir.');
  try{return await response.json();}catch{throw new CloudError(503,'access_unavailable','Não foi possível confirmar as permissões.');}
 }
 async function access(identity){
  if(!UUID.test(identity?.id||''))throw new CloudError(401,'session','Entre para acessar sua conta.');
  const value=await rpc('ploa_account_access',{p_user:identity.id});
  if(typeof value?.administrator!=='boolean')throw new CloudError(503,'access_unavailable','Não foi possível conferir a administração.');
  return{administrator:value.administrator,modules:normalizeModules(value.modules),catalog:MODULES};
 }
 async function requireAdmin(identity){const value=await access(identity);if(!value.administrator)throw new CloudError(403,'administrator','Este controle é exclusivo da administração do Ploa.');}
 return{
  access,
  async requireModule(identity,module){
   if(!validModule(module))throw new CloudError(404,'module','Função não encontrada.');
   const value=await access(identity);
   if(!value.modules[module])throw new CloudError(403,'module_blocked','Esta função está bloqueada para sua conta. Entre em contato com a administração do Ploa.');
   return value;
  },
  async accounts(identity,{search='',page=0}={}){
   await requireAdmin(identity);
   if(typeof search!=='string'||search.length>150||!Number.isInteger(page)||page<0||page>100000)throw new CloudError(400,'validation','Confira o filtro e a página.');
   const data=await rpc('ploa_admin_accounts',{p_actor:identity.id,p_search:search.trim(),p_page:page});
   if(!Array.isArray(data?.accounts))throw new CloudError(503,'access_unavailable','Não foi possível consultar as contas.');
   return{accounts:data.accounts.slice(0,50).map(account=>({id:account.id,email:account.email,confirmed:account.confirmed===true,administrator:account.administrator===true,
    modules:Object.fromEntries(MODULES.map(({key})=>[key,account.modules?.[key]!==false]))})),hasMore:data.accounts.length>50,page};
  },
  async setFeature(identity,body){
   await requireAdmin(identity);
   if(!body||Object.keys(body).some(k=>!['accountId','module','enabled'].includes(k))||!UUID.test(body.accountId||'')||!validModule(body.module)||typeof body.enabled!=='boolean')throw new CloudError(400,'validation','Confira a conta, a função e a liberação.');
   const result=await rpc('ploa_admin_set_feature',{p_actor:identity.id,p_user:body.accountId,p_module:body.module,p_enabled:body.enabled});
   return{changed:result?.changed===true};
  },
 };
}
module.exports={MODULES,createAccountAccess,validModule};
