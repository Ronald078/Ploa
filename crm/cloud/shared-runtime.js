'use strict';
const {randomBytes}=require('node:crypto');
const {CloudError}=require('./errors');
const {createSharedState}=require('./shared-state');
const {createSharedSessions}=require('./shared-sessions');
const {createSharedAuthFlows}=require('./shared-auth-flows');
const {createSharedChallenges}=require('./shared-challenges');
const {createRememberedVerification}=require('./remembered-verification');
function createSharedRuntime({config,gateway,mailer,state=createSharedState(config),now=Date.now,clientAddress=req=>req.socket.remoteAddress}){
  async function hit(scope,value,limit,window,code,message){if(!await state.hit(scope,value,limit,window))throw new CloudError(429,code,message);}
  const confirmations={
    async issue(){const id=randomBytes(32).toString('base64url');if(!await state.put('confirmation',state.hash(id),{confirmed:true},600000))throw new CloudError(503,'confirmation_unavailable','Tente entrar com sua senha.');return id;},
    async has(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id)&&(await state.get('confirmation',state.hash(id)))?.value.confirmed===true;},
    async remove(id){if(typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id))await state.take('confirmation',state.hash(id));},clear(){},
  };
  return{
    desktopState:state,
    sessions:createSharedSessions({state,gateway,now}),
    verifications:createRememberedVerification({state,now}),
    flows:createSharedAuthFlows({state,origin:config.origin}),
    challenges:createSharedChallenges({state,mailer,now}),confirmations,
    checkLoginRate:req=>hit('auth-attempts',clientAddress(req),10,600000,'login_limit','Aguarde alguns minutos antes de tentar entrar novamente.'),
    reserveResend:email=>hit('resend',email.trim().toLowerCase(),1,60000,'resend_wait','Aguarde pelo menos um minuto antes de solicitar outro link.'),
    cleanup:()=>state.cleanup(),
  };
}
module.exports={createSharedRuntime};
