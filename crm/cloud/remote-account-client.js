'use strict';
const {randomBytes}=require('node:crypto');
const {CloudError}=require('./errors');
const {UUID}=require('../lib/account-data');
const COOKIES={'__Host-ploa_session':'ploa_remote_session',ploa_auth_flow:'ploa_remote_flow',ploa_email_challenge:'ploa_remote_challenge',ploa_signup_result:'ploa_remote_signup',ploa_verified_device:'ploa_remote_verified'};
const CLIENT='ploa_remote_client';
const MODULES=['dashboard','funnel','leads','search','messages','ai','copies','ads'];
function accountOrigin(value){
 let url;try{url=new URL(value);}catch{throw Error('Configure o endereço HTTPS do serviço de contas do Ploa.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||/^(?:\d+\.){3}\d+$/.test(url.hostname)||url.hostname.endsWith('.localhost'))throw Error('Use somente a origem HTTPS pública do serviço de contas.');
 return url.origin;
}
function cookie(req,name){return(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);}
function remoteCookies(req){return Object.entries(COOKIES).flatMap(([remote,local])=>{const value=cookie(req,local);return value&&!/[\r\n]/.test(value)?[remote+'='+value]:[];}).join('; ');}
function receiveCookies(response,res){
 const values=res.getHeader('Set-Cookie')||[];
 for(const line of response.headers.getSetCookie()){
  const parts=line.split(';'),at=parts[0].indexOf('='),name=parts[0].slice(0,at),local=COOKIES[name];if(!local)continue;
  const attributes=parts.slice(1).map(v=>v.trim()).filter(v=>/^(?:Max-Age=\d+|Expires=|SameSite=(?:Strict|Lax|None)$)/i.test(v));
  values.push(local+'='+parts[0].slice(at+1)+'; Path=/; HttpOnly; '+attributes.join('; '));
 }
 if(values.length)res.setHeader('Set-Cookie',values);
}
function createRemoteAccountClient({remoteOrigin,fetch:fetcher=fetch,readBody,now=Date.now}){
 const origin=accountOrigin(remoteOrigin),clients=new Map();
 const failure=()=>new CloudError(503,'accounts_unavailable','Não foi possível acessar o serviço de contas. Sua sessão e seus dados foram preservados. Tente novamente.');
 function clientCookie(res,value,maxAge){const previous=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...previous,CLIENT+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge]);}
 function prune(){for(const[id,value]of clients)if(value.until<=now())clients.delete(id);}
 async function request(req,route,body,headers={}){
  try{return await fetcher(origin+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:origin,...(remoteCookies(req)?{Cookie:remoteCookies(req)}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw failure();}
 }
 async function data(response){let value;try{value=await response.json();}catch{throw failure();}if(!response.ok)throw new CloudError(response.status,value.code||'accounts',value.error||'Não foi possível confirmar seu acesso.');return value;}
 async function device(req,res,url,json){
  if(url.pathname==='/desktop-login'&&req.method==='GET'){
   prune();const ticket=url.searchParams.get('ticket'),item=/^[a-f0-9]{64}$/.test(ticket||'')?[...clients.values()].find(item=>item.ticket===ticket):null;
   if(!item)throw new CloudError(410,'desktop_expired','Abra a entrada novamente pelo Ploa.');
   delete item.ticket;res.writeHead(303,{Location:origin+item.url});res.end();return true;
  }
  if(!url.pathname.startsWith('/api/cloud/desktop/'))return false;
  // Workspace authorization belongs to the public server, not the local ticket flow.
  if(url.pathname==='/api/cloud/desktop/workspace')return false;
  if(req.method!=='POST')throw new CloudError(405,'method','Método não permitido.');
  const body=await readBody(req),action=url.pathname.split('/').pop();prune();
  if(action==='start'){
   if(clients.size>=32)throw new CloudError(429,'desktop_capacity','Aguarde as entradas em andamento terminarem.');
   const response=await request(req,'/api/cloud/device/start',body),result=await data(response);
   if(!/^[A-Za-z0-9_-]{43}$/.test(result.client||'')||!/^\/device-login\?ticket=[A-Za-z0-9_-]{43}$/.test(result.url||'')||!Number.isFinite(result.expiresIn)||result.expiresIn<=0||result.expiresIn>900)throw failure();
   const id=randomBytes(32).toString('base64url'),ticket=randomBytes(32).toString('hex');
   clients.set(id,{secret:result.client,url:result.url,ticket,until:now()+result.expiresIn*1000});clientCookie(res,id,result.expiresIn);
   json(res,200,{url:'/desktop-login?ticket='+ticket,expiresIn:result.expiresIn});return true;
  }
  const id=cookie(req,CLIENT),item=clients.get(id);if(!item)throw new CloudError(410,'desktop_expired','A entrada no aplicativo expirou. Recomece pelo Ploa.');
  if(!['status','cancel'].includes(action))throw new CloudError(404,'route','Página não encontrada.');
  const response=await request(req,'/api/cloud/device/'+action,{}, {'x-ploa-device-client':item.secret});
  if(response.status===410){clients.delete(id);clientCookie(res,'',0);}
  const result=await data(response);receiveCookies(response,res);
  if(result.completed||action==='cancel'){clients.delete(id);clientCookie(res,'',0);}
  json(res,200,result);return true;
 }
 const accounts=async(req,res,url,json)=>{
  if(await device(req,res,url,json))return true;
  if(!url.pathname.startsWith('/api/cloud/')||url.pathname.startsWith('/api/cloud/panel/'))return false;
  if(!['GET','POST'].includes(req.method))throw new CloudError(405,'method','Método não permitido.');
  // Remote /device/* secrets must never be returned to the renderer.
  if(url.pathname.startsWith('/api/cloud/device/'))throw new CloudError(403,'device','Use a entrada do aplicativo.');
  const body=req.method==='POST'?await readBody(req):undefined,response=await request(req,url.pathname+url.search,body);
  receiveCookies(response,res);const result=await data(response);
  if(url.pathname==='/api/cloud/capabilities')Object.assign(result,{localPanel:true,desktopLogin:true,desktopPending:false});
  json(res,response.status,result);return true;
 };
 accounts.normalSession=async req=>{const result=await data(await request(req,'/api/cloud/session'));if(!result.user||result.mode!=='normal')throw new CloudError(401,'session','Entre para acessar sua conta.');return{identity:result.user,kind:'normal',remember:result.remember===true};};
 accounts.dispose=()=>clients.clear();
 async function resolveScope(req,workspaceId){
  if(!UUID.test(workspaceId||''))throw new CloudError(409,'workspace_selection','Escolha sua empresa para abrir o painel.');
  const result=await data(await request(req,'/api/cloud/desktop/workspace',{workspaceId}));
  if(result.workspace?.id!==workspaceId||result.workspace.role!=='owner'||result.session?.kind!=='normal'||!UUID.test(result.session?.identity?.id||'')||MODULES.some(key=>typeof result.access?.modules?.[key]!=='boolean'))throw failure();
  return result;
 }
 return{accounts,resolveScope};
}
module.exports={createRemoteAccountClient,accountOrigin,remoteCookies,receiveCookies};
