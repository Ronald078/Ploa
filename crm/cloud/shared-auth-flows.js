'use strict';
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {CloudError}=require('./errors');
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id);
const digest=id=>createHash('sha256').update(id).digest('base64url');
const invalid=()=>new CloudError(400,'flow','O retorno não está disponível. Tente entrar com sua senha ou solicite outro link.');
function createSharedAuthFlows({state,origin}) {
  async function take(id,expectedKind) {
    if(!valid(id)) throw invalid();
    if(expectedKind&&(await state.get('flow',state.hash(id)))?.value.kind!==expectedKind)throw invalid();
    const row=await state.take('flow',state.hash(id));if(!row)throw invalid();return row.value;
  }
  return {
    async create(kind,remember=false){
      const id=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
      if(!await state.put('flow',state.hash(id),{kind,remember:remember===true,verifier},1800000))throw invalid();
      return{id,challenge:digest(verifier),redirect:origin+'/auth/callback?flow='+encodeURIComponent(id)};
    },
    async kind(id){return valid(id)?(await state.get('flow',state.hash(id)))?.value.kind:undefined;},
    async consumeConfirmation(id){return take(id,'signup');},
    async consume(id,cookie){if(!valid(id)||!valid(cookie)||!timingSafeEqual(Buffer.from(id),Buffer.from(cookie)))throw invalid();return take(id);},
    clear(){},
  };
}
module.exports={createSharedAuthFlows};
