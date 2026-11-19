'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildContext}=require('../lib/conversation-context');
const {systemFor}=require('../lib/ai-prompt-profile');
const lead={id:'5511999999999',nome:'Contato fictício',pais:'Brasil',categoria:'loja',status:'respondeu'};
test('empresa nova usa identidade própria sem exemplos da conversa privada do dono',()=>{
 const context=buildContext(lead,{},[{direction:'out',text:'Qual projeto você tem em mente?',at:'2026-11-01T12:00:00Z'},{direction:'in',text:'Quero um catálogo.',at:'2026-11-01T12:01:00Z'}],{accountIdentity:{name:'Pessoa B',businessName:'Empresa B'},business:{offers:[]},examples:[],guidance:'Somente condições próprias.'});
 assert.deepEqual(context.accountIdentity,{name:'Pessoa B',businessName:'Empresa B'});
 assert.equal(context.voiceExample,null);assert.deepEqual(context.funnel.examples,[]);
 assert.doesNotMatch(JSON.stringify(context),/Ronald/);assert.doesNotMatch(systemFor(context),/Ronald/);
 assert.match(systemFor(context),/accountIdentity/);
 assert.match(systemFor({}),/Ronald/,'a operação antiga mantém seu perfil');
});
