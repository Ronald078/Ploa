'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createNoRedirectFetch}=require('../cloud/no-redirect-fetch');
test('Workers rejeita redirects sem encaminhar credenciais a outro destino',async()=>{
 for(const status of [301,302,303,307,308]){
  let calls=0;
  const request=createNoRedirectFetch(async(url,options)=>{calls++;assert.equal(url,'https://provider.example.invalid');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'fixture-private');return new Response(null,{status,headers:{Location:'https://outside.invalid'}});});
  await assert.rejects(request('https://provider.example.invalid',{redirect:'error',headers:{Authorization:'fixture-private'}}),e=>e instanceof TypeError&&!e.message.includes('fixture-private'));
  assert.equal(calls,1);
 }
 const request=createNoRedirectFetch(async()=>new Response('{"ok":true}'));assert.deepEqual(await(await request('https://provider.example.invalid')).json(),{ok:true});
});
