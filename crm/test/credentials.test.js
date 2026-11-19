'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAiProvider}=require('../lib/ai-provider');
test('reabrir recupera a chave salva; fechar não apaga; remover exclui a persistência',()=>{
  let saved={};const store={available:true,load:()=>({...saved}),save:value=>{saved={...value};}};
  let provider=createAiProvider({credentialStore:store});provider.setKey({provider:'groq',apiKey:'fixture-not-a-real-api-key'});assert.equal(provider.keyStatus('groq').saved,true);provider.close();
  provider=createAiProvider({credentialStore:store});assert.equal(provider.hasKey('groq'),true);provider.setKey({provider:'groq',clearKey:true});assert.deepEqual(saved,{});provider.close();
});
test('falha de gravação preserva a chave anterior; falha de recuperação não expõe o segredo',()=>{
  const provider=createAiProvider({credentialStore:{available:true,load:()=>({groq:'fixture-not-a-real-api-key'}),save:()=>{throw new Error('Fixture: gravação indisponível.');}}});
  assert.throws(()=>provider.setKey({provider:'groq',clearKey:true}));assert.equal(provider.hasKey('groq'),true);assert.equal(JSON.stringify(provider.keyStatus('groq')).includes('fixture-not-a-real-api-key'),false);provider.close();
  const broken=createAiProvider({credentialStore:{available:true,load:()=>{throw new Error('Fixture: dado inválido.');},save(){}}});assert.equal(broken.hasKey('groq'),false);assert.ok(broken.keyStatus('groq').error);broken.close();
});
