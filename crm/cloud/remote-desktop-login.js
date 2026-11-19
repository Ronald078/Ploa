'use strict';
const {randomBytes,randomUUID}=require('node:crypto');
const {CloudError}=require('./errors');
const CLIENT_HEADER='x-ploa-device-client',BROWSER='ploa_desktop_browser';
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const expired=()=>new CloudError(410,'desktop_expired','A entrada no aplicativo expirou. Recomece pelo Ploa.');

// Uses existing encrypted flow storage with purpose-bound keys. No new schema,
// bearer provider tokens in responses, or machine-wide administrative credential.
function createRemoteDesktopLogin({state,accounts,cookie,setCookie,readBody,checkLoginRate,now=Date.now}){
 const key=(type,value)=>state.hash('desktop:'+type+':'+value);
 const read=async(type,value)=>valid(value)?state.get('flow',key(type,value)):null;
 async function browser(req){const ref=await read('browser',cookie(req,BROWSER));if(!ref)return null;const row=await state.get('flow',ref.value.clientKey);return row?.value.purpose==='desktop-device'&&row.value.until>now()?{key:ref.value.clientKey,...row.value}:null;}
 const remaining=item=>Math.max(1,item.until-now());
 const sessionReq=id=>({headers:{cookie:'__Host-ploa_session='+id}});
 return{
  async pending(req){const item=await browser(req);return Boolean(item&&!item.completed);},
  clear(){},
  async handle(req,res,url,json){
   if(req.method==='GET'&&url.pathname==='/device-login'){
    const ticket=url.searchParams.get('ticket');
    const ref=valid(ticket)?await state.take('flow',key('ticket',ticket)):null;
    if(!ref)throw expired();const row=await state.get('flow',ref.value.clientKey),item=row?.value;
    if(item?.purpose!=='desktop-device'||item.until<=now()||item.completed)throw expired();
    const secret=randomBytes(32).toString('base64url');
    if(!await state.put('flow',key('browser',secret),{clientKey:ref.value.clientKey},remaining(item)))throw expired();
    if(item.intent==='login')await accounts.restoreVerification(res,item.verification);
    setCookie(res,secret,Math.ceil(remaining(item)/1000),BROWSER,'Lax');
    res.writeHead(303,{Location:'/?desktop_remember='+(item.remember?'1':'0')+(item.intent==='recovery'?'&desktop_recover=1':'')});res.end();return true;
   }
   if(!['/api/cloud/device/start','/api/cloud/device/status','/api/cloud/device/cancel','/api/cloud/desktop/complete'].includes(url.pathname))return false;
   if(req.method!=='POST')throw new CloudError(405,'method','Método não permitido.');
   const body=await readBody(req);
   if(url.pathname==='/api/cloud/device/start'){
    await checkLoginRate(req);
    if(body.purpose!==undefined&&!['login','recovery'].includes(body.purpose))throw new CloudError(400,'desktop_purpose','Tipo de entrada inválido.');
    const client=randomBytes(32).toString('base64url'),ticket=randomBytes(32).toString('base64url'),clientKey=key('client',client);
    const intent=body.purpose||'login',ttl=intent==='recovery'?900000:300000;
    const verification=intent==='login'&&body.remember===true?await accounts.verificationFor(req):null;
    const value={purpose:'desktop-device',intent,remember:body.remember===true,until:now()+ttl,verification,completed:false};
    if(!await state.put('flow',clientKey,value,ttl)||!await state.put('flow',key('ticket',ticket),{clientKey},ttl))throw expired();
    json(res,200,{client,url:'/device-login?ticket='+ticket,expiresIn:ttl/1000});return true;
   }
   if(url.pathname==='/api/cloud/desktop/complete'){
    const item=await browser(req);if(!item||item.completed)throw expired();
    const session=await accounts.normalSession(req);
    const lease=randomUUID(),taken=await state.lease('flow',item.key,lease);if(!taken)throw expired();
    try{
     if(taken.value.completed||taken.value.until<=now())throw expired();
     const value={...taken.value,completed:true,identity:session.identity.id,session:cookie(req,'__Host-ploa_session'),verification:session.remember?await accounts.verificationFor(req,session.identity):null};
     if(!await state.write('flow',item.key,lease,taken.version,value))throw expired();
    }finally{await state.release('flow',item.key,lease);}
    setCookie(res,'',0,BROWSER);json(res,200,{completed:true});return true;
   }
   const secret=req.headers[CLIENT_HEADER];if(!valid(secret))throw expired();
   const clientKey=key('client',secret);
   if(url.pathname==='/api/cloud/device/cancel'){await state.take('flow',clientKey);json(res,200,{cancelled:true});return true;}
   const row=await state.get('flow',clientKey);if(row?.value.purpose!=='desktop-device'||row.value.until<=now())throw expired();
   if(!row.value.completed){json(res,200,{completed:false});return true;}
   const taken=await state.take('flow',clientKey);if(!taken)throw expired();
   const item=taken.value,session=await accounts.normalSession(sessionReq(item.session));
   if(session.identity.id!==item.identity)throw new CloudError(401,'session','Entre novamente para confirmar sua conta.');
   if(session.remember)await accounts.restoreVerification(res,item.verification,session.identity);
   setCookie(res,item.session,session.remember?Math.max(1,Math.min(2592000,Math.floor(((session.deadline||now()+2592000000)-now())/1000))):undefined);
   json(res,200,{completed:true});return true;
  },
 };
}
module.exports={createRemoteDesktopLogin,CLIENT_HEADER};
