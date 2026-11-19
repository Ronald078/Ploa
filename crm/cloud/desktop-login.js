'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {CloudError}=require('./errors');
const digest=value=>createHash('sha256').update(value).digest('hex');
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const CLIENT='ploa_desktop_client',BROWSER='ploa_desktop_browser';

// OAuth, PKCE and e-mail verification stay in the existing browser login flow.
function createDesktopLogin({cookie,setCookie,normalSession,verificationFor=async()=>null,restoreVerification=async()=>{},readBody,now=Date.now,ttl=300000,capacity=32}){
 const flows=new Map();
 function prune(){for(const [id,item]of flows)if(item.deadline<=now())flows.delete(id);}
 function client(req){prune();const secret=cookie(req,CLIENT),item=valid(secret)?flows.get(digest(secret)):null;if(!item)throw new CloudError(410,'desktop_expired','A entrada no aplicativo expirou. Tente novamente pelo Ploa.');return item;}
 function browser(req){prune();const secret=cookie(req,BROWSER);return valid(secret)?[...flows.values()].find(item=>item.browser===digest(secret)):null;}
 function pending(req){return Boolean(browser(req));}
 async function handle(req,res,url,json){
  if(url.pathname==='/desktop-login'&&req.method==='GET'){
   prune();const ticket=url.searchParams.get('ticket');
   const item=valid(ticket)?[...flows.values()].find(entry=>entry.ticket===digest(ticket)):null;
   if(!item)throw new CloudError(410,'desktop_expired','Abra a entrada novamente pelo aplicativo Ploa.');
   delete item.ticket;const secret=randomBytes(32).toString('hex');item.browser=digest(secret);
   if(item.purpose==='login')await restoreVerification(res,item.carriedVerification);
   setCookie(res,secret,Math.ceil((item.deadline-now())/1000),BROWSER,'Lax');
   res.writeHead(303,{Location:'/?desktop_remember='+(item.remember?'1':'0')+(item.purpose==='recovery'?'&desktop_recover=1':'')});res.end();return true;
  }
  if(!url.pathname.startsWith('/api/cloud/desktop/'))return false;
  if(req.method!=='POST')throw new CloudError(405,'method','Método não permitido.');
  const body=await readBody(req);
  const action=url.pathname.slice('/api/cloud/desktop/'.length);
  if(action==='start'){
   if(body.purpose!==undefined&&!['login','recovery'].includes(body.purpose))throw new CloudError(400,'desktop_purpose','Tipo de entrada inválido.');
   prune();const previous=cookie(req,CLIENT);if(valid(previous))flows.delete(digest(previous));
   if(flows.size>=capacity)throw new CloudError(429,'desktop_capacity','Há entradas em andamento. Aguarde alguns minutos.');
   const secret=randomBytes(32).toString('hex'),ticket=randomBytes(32).toString('hex');
   const purpose=body.purpose||'login',duration=purpose==='recovery'?900000:ttl;
   const carriedVerification=purpose==='login'&&body.remember===true?await verificationFor(req):null;
   flows.set(digest(secret),{ticket:digest(ticket),deadline:now()+duration,remember:body.remember===true,purpose,carriedVerification});setCookie(res,secret,Math.ceil(duration/1000),CLIENT);
   json(res,200,{url:'/desktop-login?ticket='+ticket,expiresIn:Math.ceil(duration/1000)});return true;
  }
  if(action==='complete'){
   const item=browser(req);if(!item)throw new CloudError(410,'desktop_expired','Essa entrada no aplicativo expirou. Recomece pelo Ploa.');
   const session=await normalSession(req);
   item.verification=session.remember?await verificationFor(req,session.identity):null;
   item.sessionCookie=cookie(req);item.identity=session.identity.id;delete item.browser;
   setCookie(res,'',0,BROWSER);json(res,200,{completed:true});return true;
  }
  if(action==='status'){
   const item=client(req);
   if(!item.sessionCookie){json(res,200,{completed:false});return true;}
   const sessionName=url.protocol==='https:'?'__Host-ploa_session':'ploa_preview_session';
   // Recheck session revocation and e-mail verification at consumption time.
   const session=await normalSession({headers:{cookie:sessionName+'='+item.sessionCookie}});
   if(session.identity.id!==item.identity)throw new CloudError(401,'session','Entre novamente para confirmar sua conta.');
   if(session.remember)await restoreVerification(res,item.verification,session.identity);
   const duration=session.remember?Math.max(1,Math.min(2592000,Math.floor(((session.deadline||now()+2592000000)-now())/1000))):undefined;
   setCookie(res,item.sessionCookie,duration);setCookie(res,'',0,CLIENT);flows.delete(digest(cookie(req,CLIENT)));
   json(res,200,{completed:true});return true;
  }
  if(action==='cancel'){
   const secret=cookie(req,CLIENT);if(valid(secret))flows.delete(digest(secret));setCookie(res,'',0,CLIENT);json(res,200,{cancelled:true});return true;
  }
  throw new CloudError(404,'route','Página não encontrada.');
 }
 return{handle,pending,clear:()=>flows.clear()};
}
module.exports={createDesktopLogin};
