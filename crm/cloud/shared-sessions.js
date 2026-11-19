'use strict';
const { randomBytes, randomUUID } = require('node:crypto');
const { CloudError } = require('./errors');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const missing = () => new CloudError(401,'session','Entre para acessar sua conta.');

function createSharedSessions({ state, gateway, now=Date.now, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)) }) {
  async function refresh(id) {
    const lease=randomUUID();
    for(let i=0;i<20;i++) {
      const row=await state.lease('session',id,lease);
      if(row) {
        try {
          if(row.value.expiresAt>now()+30000) return row.value;
          const credentials=await gateway.refresh(row.value.refreshToken), value={...row.value,...credentials};
          if(!await state.write('session',id,lease,row.version,value)) throw missing();
          return value;
        } finally { await state.release('session',id,lease); }
      }
      const current=await state.get('session',id);
      if(!current) throw missing();
      if(current.value.expiresAt>now()+30000) return current.value;
      await pause(100);
    }
    throw new CloudError(503,'session_busy','Seu acesso está sendo atualizado. Tente novamente.');
  }
  return {
    available:true,
    async create(credentials,{remember=false,kind='normal'}={}) {
      const identity=await gateway.user(credentials.accessToken),id=randomBytes(32).toString('base64url');
      const duration=kind==='recovery'?900000:remember?2592000000:28800000;
      const value={...credentials,identity,kind,remember:remember===true&&kind==='normal',deadline:now()+duration};
      if(!await state.put('session',state.hash(id),value,duration,identity.id)) throw new CloudError(503,'session_create','Tente entrar novamente.');
      return {id,identity,kind,maxAge:remember?duration/1000:undefined};
    },
    async resolve(raw) {
      if(!validId(raw)) throw missing();
      const id=state.hash(raw),row=await state.get('session',id);
      if(!row||row.value.deadline<=now()) throw missing();
      try {
        const value=row.value.expiresAt<=now()+30000?await refresh(id):row.value;
        const identity=await gateway.user(value.accessToken);
        if(identity.id!==value.identity.id||!await state.get('session',id)) throw missing();
        return {...value,identity};
      } catch(error) {
        if(error.status===401) await state.take('session',id);
        throw error;
      }
    },
    async remove(raw,{revoke=true}={}) {
      if(!validId(raw)) return;
      const row=await state.take('session',state.hash(raw));
      if(row&&revoke) { try{await gateway.signOut(row.value.accessToken);}catch{/* Shared access has already been revoked. */} }
    },
    async removeUser(id){await state.removeUser('session',id);},
    clear(){/* Stopping one instance must not erase shared sessions. */},
  };
}
module.exports={createSharedSessions};
