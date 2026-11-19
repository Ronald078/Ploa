'use strict';
function createAccountAuthorization({env=process.env,fetch:fetcher=fetch}={}){
 const active=env.PLOA_ACCOUNT_WORKER==='1';
 const denied=()=>Object.assign(new Error('O acesso desta conta foi encerrado, bloqueado ou não pôde ser confirmado. Entre novamente antes de continuar.'),{code:'PLOA_ACCOUNT_ACCESS',statusCode:403});
 const authorize=async modules=>{
  if(!active)return true;
  let url;try{url=new URL(env.PLOA_ACCOUNT_AUTH_URL);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/api/cloud/panel/agent-authorize'||url.username||url.password||url.hash||url.search)throw Error();}catch{throw denied();}
  if(!/^[a-f0-9]{64}$/.test(env.PLOA_ACCOUNT_AUTH_TOKEN||''))throw denied();
  try{
   const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Origin:url.origin,'Content-Type':'application/json','x-ploa-agent-lease':env.PLOA_ACCOUNT_AUTH_TOKEN},body:JSON.stringify({modules})});
   if(!response.ok||(await response.json()).authorized!==true)throw denied();return true;
  }catch{throw denied();}
 };
 authorize.active=active;
 return authorize;
}
function protectAccountSends(client,authorize){
 if(!authorize.active)return;
 const send=client.sendMessage.bind(client);
 client.sendMessage=async(...args)=>{await authorize(['messages']);return send(...args);};
}
module.exports={createAccountAuthorization,protectAccountSends};
