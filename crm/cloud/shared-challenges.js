'use strict';
const {randomBytes,randomInt,randomUUID,timingSafeEqual}=require('node:crypto');
const {CloudError}=require('./errors');
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id);
const mask=email=>email.replace(/^(.{1,2})[^@]*(@.*)$/,'$1***$2');
const expired=()=>new CloudError(400,'email_expired','O código expirou. Inicie o acesso novamente.');
function createSharedChallenges({state,mailer,now=Date.now}){
  return {
    async issue(identity,credentials,{remember=false,action='login'}={}){
      if(!await state.hit('email-code',identity.id,1,60000))throw new CloudError(429,'email_cooldown','Aguarde um minuto antes de solicitar outro código.');
      const id=randomBytes(32).toString('base64url'),code=String(randomInt(100000,1000000));
      await state.removeUser('challenge',identity.id);
      const value={identity,credentials,remember,action,digest:state.hash(id+':'+code),attempts:0,until:now()+300000};
      if(!await state.put('challenge',state.hash(id),value,300000,identity.id))throw expired();
      try{await mailer.sendCode(identity.email,code,id);}catch(error){await state.take('challenge',state.hash(id));throw error;}
      return{id,email:mask(identity.email),expiresIn:300};
    },
    async status(id){
      if(!valid(id))return null;const row=await state.get('challenge',state.hash(id));
      return row?{email:mask(row.value.identity.email),expiresIn:Math.max(0,Math.floor((row.value.until-now())/1000))}:null;
    },
    async consume(raw,code){
      if(!valid(raw))throw expired();
      const id=state.hash(raw),lease=randomUUID(),row=await state.lease('challenge',id,lease);
      if(!row){if(!await state.get('challenge',id))throw expired();throw new CloudError(409,'email_busy','O código está sendo verificado. Aguarde e tente novamente.');}
      try{
        const item=row.value;item.attempts++;
        const matches=typeof code==='string'&&/^\d{6}$/.test(code)&&timingSafeEqual(Buffer.from(item.digest,'hex'),Buffer.from(state.hash(raw+':'+code),'hex'));
        if(matches){if(!await state.take('challenge',id,lease))throw expired();return item;}
        if(item.attempts>=5)await state.take('challenge',id,lease);
        else if(!await state.write('challenge',id,lease,row.version,item))throw expired();
        throw new CloudError(400,item.attempts>=5?'email_attempts':'email_code',item.attempts>=5?'Limite de tentativas atingido. Inicie o acesso novamente.':'Código incorreto. Confira o e-mail e tente novamente.');
      }finally{await state.release('challenge',id,lease);}
    },
    async cancel(id){if(valid(id))await state.take('challenge',state.hash(id));},
    clear(){},
  };
}
module.exports={createSharedChallenges};
