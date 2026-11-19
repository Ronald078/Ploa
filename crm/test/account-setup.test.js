'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {temporaryRoot}=require('./fixture-helpers');
const {createAccountData}=require('../lib/account-data');
const {snapshot,saveIdentity,markConfigured,requireSetup}=require('../lib/account-setup');
const {readCopySettings,writeCopySettings}=require('../lib/copy-settings');
test('conta nova não libera disparo com valores de fábrica; identidade/copys/limites são próprios',async t=>{
 const directory=temporaryRoot(t),code=path.join(directory,'code');fs.mkdirSync(code);
 const {root}=createAccountData({directory,codeRoot:code}).resolve({id:'11111111-1111-4111-8111-111111111111'},{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'owner',name:'Empresa nova'});
 assert.throws(()=>requireSetup(root,'messages'),/Conclua/);
 saveIdentity(root,{name:'Responsável',businessName:'Empresa'});markConfigured(root,'messages');
 assert.throws(()=>requireSetup(root,'messages'),/Copys/);
 const copies=await readCopySettings(root);copies.firstContact.Brasil.genericas=['Copy própria'];
 for(const kind of ['agradecimento','bot-atendimento'])copies.automaticReplies.categorias[kind].porIdioma['pt-BR']=['Resposta própria'];
 await writeCopySettings(root,copies);assert.doesNotThrow(()=>requireSetup(root,'messages'));
 assert.throws(()=>requireSetup(root,'search'),/busca/);markConfigured(root,'search');assert.doesNotThrow(()=>requireSetup(root,'search'));
 assert.equal(snapshot(root).required,false);assert.throws(()=>requireSetup(root,'ai'),/IA/);
 assert.throws(()=>saveIdentity(root,{name:'',businessName:'Empresa'}),/Informe/);
});
