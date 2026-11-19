'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {passwordProblem,PASSWORD_PATTERN}=require('../lib/password-policy.mjs');
const {validPassword}=require('../cloud/account-provider');
const {createSupabaseGateway}=require('../cloud/supabase');

test('senha nova precisa de oito caracteres, maiúscula, número e símbolo; não exige minúscula',()=>{
 for(const password of ['Abcdef1!','ABCDEFG1!','AAaa123!!','Árvore1€','Varios123!!MAIS']){
  assert.equal(passwordProblem(password),'');assert.equal(validPassword(password),password);
  assert.equal(new RegExp('^(?:'+PASSWORD_PATTERN+')$','u').test(password),true);
 }
 for(const password of ['abcdefgh1!','ABCDEFGH!','Abcdefgh1','Abcd1!','Senha12 ',null,'A1!'.repeat(400)])assert.throws(()=>validPassword(password),error=>error.status===400&&error.code==='password');
});

test('cadastro rejeita senha fraca antes de fazer pedido ao provedor',async()=>{
 let requests=0;const gateway=createSupabaseGateway({url:'https://fake.invalid',key:'fake',fetch:async()=>{requests++;return new Response('{}');}});
 await assert.rejects(gateway.signUp('fixture@example.invalid','12345678',{}),{code:'password'});assert.equal(requests,0);
});

test('reutilização e fraqueza recebem mensagens distintas sem expor o erro bruto do provedor',async()=>{
 for(const [code,expected,message]of [['same_password','same_password',/diferente da senha atual/],['weak_password','password',/maiúscula.*número.*especial/]]){
  let requests=0;const gateway=createSupabaseGateway({url:'https://fake.invalid',key:'fake',fetch:async()=>{requests++;return new Response(JSON.stringify({code,msg:'private-provider-detail'}),{status:422});}});
  await assert.rejects(gateway.changePassword('fixture-token','Abcdef1!'),error=>error.status===400&&error.code===expected&&message.test(error.message)&&!error.message.includes('private-provider-detail'));assert.equal(requests,1);
 }
});
