'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {workerSecrets}=require('../tools/worker-secrets');
test('publicação usa chave própria persistente e recebe valores privados sem arquivos ou argumentos',()=>{
 let saved={},writes=0;const store={load:()=>structuredClone(saved),save:value=>{saved=structuredClone(value);writes++;}};
 const input={origin:'https://accounts.example.invalid',config:{url:'https://fixture.supabase.co',key:'fixture-public',serverKey:'fixture-server'},gmail:{user:'fixture@gmail.com',appPassword:'fixture-password'},store};
 const first=workerSecrets(input),second=workerSecrets(input);assert.equal(first.PLOA_SERVER_STATE_KEY,second.PLOA_SERVER_STATE_KEY);assert.equal(writes,1);assert.equal(Object.keys(first).length,8);assert.equal(first.PLOA_SUPABASE_SERVER_KEY,'fixture-server');
 assert.throws(()=>workerSecrets({...input,origin:'http://accounts.example.invalid'}));assert.throws(()=>workerSecrets({...input,gmail:null}));
});
