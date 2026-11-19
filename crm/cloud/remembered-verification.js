'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {CloudError}=require('./errors');
const COOKIE='ploa_verified_device',KIND='verification',TTL=600000;
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id);

// This proof never authenticates a user: password/OAuth must already be verified.
// Store no provider credentials, and never extend its deadline when reused.
function createRememberedVerification({state,now=Date.now,capacity=1000}={}){
 const records=new Map(),hash=id=>state?state.hash(id):createHash('sha256').update(id).digest('hex');
 function prune(){for(const[id,value]of records)if(value.until<=now())records.delete(id);}
 async function lookup(id){if(!valid(id))return null;prune();const value=state?(await state.get(KIND,hash(id)))?.value:records.get(hash(id));return value?.until>now()?value:null;}
 return{
  async issue(identity){
   prune();if(!state&&records.size>=capacity)throw new CloudError(503,'verification_capacity','Tente entrar novamente em alguns instantes.');
   const id=randomBytes(32).toString('base64url'),value={userId:identity.id,email:identity.email,until:now()+TTL};
   if(state){if(!await state.put(KIND,hash(id),value,TTL,identity.id))throw new CloudError(503,'verification_store','Não foi possível lembrar a confirmação.');}
   else records.set(hash(id),value);
   return{id,until:value.until};
  },
  async check(id,identity){
   const value=await lookup(id);
   return value&&value.userId===identity.id&&value.email===identity.email?{id,until:value.until}:null;
  },
  async inspect(id){const value=await lookup(id);return value?{id,until:value.until}:null;},
  async remove(id){if(valid(id)){if(state)await state.take(KIND,hash(id));else records.delete(hash(id));}},
  async removeUser(userId){if(state)await state.removeUser(KIND,userId);else for(const[id,value]of records)if(value.userId===userId)records.delete(id);},
  clear(){records.clear();},
 };
}
module.exports={createRememberedVerification,VERIFICATION_COOKIE:COOKIE,VERIFICATION_TTL:TTL};
