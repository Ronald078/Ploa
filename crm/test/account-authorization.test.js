'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAccountAuthorization,protectAccountSends}=require('../lib/account-authorization');
test('conta bloqueada ou sessão vencida impede chamada de envio',async()=>{
 let calls=0;const client={async sendMessage(){calls++;return'id';}};
 const authorize=createAccountAuthorization({env:{PLOA_ACCOUNT_WORKER:'1',PLOA_ACCOUNT_AUTH_URL:'http://127.0.0.1:4313/api/cloud/panel/agent-authorize',PLOA_ACCOUNT_AUTH_TOKEN:'a'.repeat(64)},fetch:async()=>({ok:false})});
 protectAccountSends(client,authorize);await assert.rejects(client.sendMessage('contato fictício','teste'),{code:'PLOA_ACCOUNT_ACCESS'});assert.equal(calls,0);
});
test('falha de autorização não libera operação nem envia segredo para outro host',async()=>{
 let calls=0;const authorize=createAccountAuthorization({env:{PLOA_ACCOUNT_WORKER:'1',PLOA_ACCOUNT_AUTH_URL:'https://outro.invalid/api/cloud/panel/agent-authorize',PLOA_ACCOUNT_AUTH_TOKEN:'a'.repeat(64)},fetch:async()=>{calls++;}});
 await assert.rejects(authorize(['ai']),{code:'PLOA_ACCOUNT_ACCESS'});assert.equal(calls,0);
});
test('fluxo local anterior fica preservado e conta autorizada envia uma única vez',async()=>{
 let calls=0;const client={async sendMessage(){calls++;return'ok';}};protectAccountSends(client,createAccountAuthorization({env:{}}));assert.equal(await client.sendMessage(),'ok');
 const auth=createAccountAuthorization({env:{PLOA_ACCOUNT_WORKER:'1',PLOA_ACCOUNT_AUTH_URL:'http://127.0.0.1:4313/api/cloud/panel/agent-authorize',PLOA_ACCOUNT_AUTH_TOKEN:'b'.repeat(64)},fetch:async()=>({ok:true,json:async()=>({authorized:true})})});
 protectAccountSends(client,auth);assert.equal(await client.sendMessage(),'ok');assert.equal(calls,2);
});
