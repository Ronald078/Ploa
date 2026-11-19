'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {temporaryRoot}=require('./fixture-helpers');
const {createAccountData}=require('../lib/account-data');
const {CODE_ROOT,dataRoot,credentialDirectory}=require('../lib/runtime-paths');
const {readCopySettings,writeCopySettings}=require('../lib/copy-settings');
const {createWorkspaceService}=require('../lib/workspace-service');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const X='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',Y='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('dados novos não herdam arquivos, chaves, copys ou identidade do dono',async t=>{
 const root=temporaryRoot(t),owner=path.join(root,'program'),directory=path.join(root,'local');fs.mkdirSync(owner);
 fs.writeFileSync(path.join(owner,'leads.json'),JSON.stringify({privado:{nome:'Dado exclusivo'}}));
 const registry=createAccountData({directory,codeRoot:owner,legacyBinding:{userId:A,workspaceId:X}});
 assert.equal(registry.resolve({id:A},{id:X,role:'owner'}).root,fs.realpathSync(owner));
 assert.throws(()=>registry.resolve({id:B},{id:X,role:'owner'}),/exclusivamente/);
 const fresh=registry.resolve({id:B},{id:Y,name:'Empresa nova',role:'owner'});
 assert.notEqual(fresh.root,owner);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fresh.root,'leads.json'))),{});
 const copies=await readCopySettings(fresh.root);assert.equal(copies.firstContact.Brasil.genericas.length,0);assert.equal(copies.automaticReplies.categorias['bot-atendimento'].porIdioma['pt-BR'].length,0);
 const workspace=createWorkspaceService(fresh.root,{getDashboard:async()=>({leads:[]})},{neutralDefaults:true,credentialStore:{available:true,load:()=>({}),save(){}}});t.after(()=>workspace.close());
 assert.equal(workspace.read().settings.enabled,false);assert.equal(workspace.read().settings.keepConnected,false);
 assert.equal(workspace.read().settings.business.offers.length,0);assert.doesNotMatch(JSON.stringify(workspace.read()),/Ronald|Dado exclusivo/);
 assert.equal(workspace.publicSnapshot().playbook.voice,null);assert.deepEqual(workspace.publicSnapshot().playbook.scenarios,[]);
 assert.notEqual(credentialDirectory(fresh.root),credentialDirectory(CODE_ROOT));
 fs.writeFileSync(path.join(fresh.root,'leads.json'),'{"preservado":true}');registry.resolve({id:B},{id:Y,name:'Empresa nova',role:'owner'});
 assert.equal(JSON.parse(fs.readFileSync(path.join(fresh.root,'leads.json'))).preservado,true);
});
test('início vazio permite configurar idiomas gradualmente sem excluir última copy já salva',async t=>{
 const root=temporaryRoot(t),code=path.join(root,'code');fs.mkdirSync(code);
 const data=createAccountData({directory:root,codeRoot:code}).resolve({id:B},{id:Y,name:'Nova',role:'owner'});
 const copies=await readCopySettings(data.root);copies.automaticReplies.categorias['bot-atendimento'].porIdioma['pt-BR']=['Mensagem aprovada de teste'];
 await writeCopySettings(data.root,copies);const saved=await readCopySettings(data.root);
 assert.equal(saved.automaticReplies.categorias['bot-atendimento'].porIdioma['en-US'].length,0);
 saved.automaticReplies.categorias['bot-atendimento'].porIdioma['pt-BR']=[];
 await assert.rejects(writeCopySettings(data.root,saved),/pelo menos uma copy/);
});
test('raiz de dados é explícita e não muda raiz de código',()=>{
 assert.equal(dataRoot({}),CODE_ROOT);assert.throws(()=>dataRoot({PLOA_DATA_ROOT:'relative'}),/inválido/);
 const root=path.resolve('outro-diretorio');assert.equal(dataRoot({PLOA_DATA_ROOT:root}),root);assert.notEqual(root,CODE_ROOT);
});
