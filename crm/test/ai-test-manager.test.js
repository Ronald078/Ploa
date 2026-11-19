'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {temporaryRoot}=require('./fixture-helpers');
const {createAiTestManager}=require('../lib/ai-test-manager');
const {createRequestHandler}=require('../lib/http-routes');
const contact='5511999999999';
function fixture(t){
  const root=temporaryRoot(t);fs.mkdirSync(path.join(root,'crm'));fs.writeFileSync(path.join(root,'crm','ai-test-contact.json'),JSON.stringify({contact,name:'Contato de teste'}));
  fs.writeFileSync(path.join(root,'crm','ai-contact-test.js'),'// executor fictício');
  fs.writeFileSync(path.join(root,'ploa_conversas.jsonl'),[JSON.stringify({id:'one',contact,direction:'in',text:'Mensagem do teste',at:new Date().toISOString()}),JSON.stringify({id:'two',contact:'5521999999999',direction:'in',text:'Outro contato',at:new Date().toISOString()})].join('\n')+'\n');
  const state={settings:{enabled:false,provider:'groq',dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:200},hasKey:true};let calls=0,options;
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.connected=true;child.pid=55;
  const sent=[];child.send=(value,done)=>{sent.push(value);done?.();};child.kill=()=>{child.exitCode=0;child.emit('exit',0);};
  const manager=createAiTestManager({root,port:4310,workspace:{publicSnapshot:()=>state},store:{getDashboard:async()=>({leads:[{id:contact,nome:'Contato de teste',status:'respondeu'}]})},getWhatsapp:()=>({connection:'ready'}),alive:pid=>pid===99,
    spawn:(...args)=>{calls++;options=args;return child;}});
  t.after(()=>child.kill());return{root,state,child,manager,sent,calls:()=>calls,options:()=>options};
}
test('iniciar duas vezes compartilha um único executor oculto e restrito ao contato salvo',async t=>{
  const f=fixture(t);await Promise.all([f.manager.start(),f.manager.start()]);assert.equal(f.calls(),1);
  const options=f.options()[2];assert.equal(options.windowsHide,true);assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(options.env.PLOA_PANEL_PORT,'4310');
  assert.equal(f.manager.snapshot().running,true);assert.equal(f.state.settings.enabled,false);
  f.manager.stop();assert.equal(fs.existsSync(path.join(f.root,'teste_ia_local','parar.flag')),true);assert.deepEqual(f.sent,[{type:'ploa-test-stop'}]);
});
test('um teste aberto pelo iniciador externo aparece e pode ser encerrado pelo painel',async t=>{
  const f=fixture(t),folder=path.join(f.root,'teste_ia_local');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'execucao.lock.json'),JSON.stringify({pid:99}));
  fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify({status:'waiting_for_contact',startedAt:new Date().toISOString(),deliveries:2}));
  assert.equal(f.manager.snapshot().running,true);await f.manager.start();assert.equal(f.calls(),0);f.manager.stop();assert.equal(f.manager.snapshot().status,'stopping');
});
test('IA geral ligada bloqueia teste sem trocar a configuração nem iniciar o executor',async t=>{
  const f=fixture(t);f.state.settings.enabled=true;await assert.rejects(f.manager.start(),error=>error.statusCode===409);assert.equal(f.calls(),0);assert.equal(f.state.settings.enabled,true);
});
test('a consulta do laboratório retorna só as mensagens do contato de teste e não altera o histórico',t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.root,'ploa_conversas.jsonl'),'utf8'),data=f.manager.snapshot();
  assert.equal(data.messages.length,1);assert.equal(data.messages[0].text,'Mensagem do teste');assert.equal(data.contact.ending,'9999');assert.equal(data.contact.id,undefined);
  assert.equal(fs.readFileSync(path.join(f.root,'ploa_conversas.jsonl'),'utf8'),before);
});
test('encerrar o painel solicita parada e aguarda o próprio filho sair',async t=>{
  const f=fixture(t);await f.manager.start();const closing=f.manager.close();f.child.kill();await closing;assert.equal(f.manager.snapshot().running,false);
});
test('novo cenário preserva cota e histórico original, arquiva o ensaio e não importa conversa antiga',t=>{
  const f=fixture(t),folder=path.join(f.root,'teste_ia_local'),dataDir=path.join(folder,contact);fs.mkdirSync(dataDir,{recursive:true});
  const old={version:1,settings:{maxDailyRequests:200},records:{[contact]:{projectAssessment:{summary:'Projeto antigo'}}},jobs:[{status:'sent'}],usage:{today:{requests:4}}};
  fs.writeFileSync(path.join(dataDir,'ploa_workspace.json'),JSON.stringify(old));fs.writeFileSync(path.join(dataDir,'ploa_conversas.jsonl'),'Histórico privado antigo');
  const original=fs.readFileSync(path.join(f.root,'ploa_conversas.jsonl'),'utf8');
  let snapshot=f.manager.reset();assert.equal(snapshot.messages.length,0);assert.equal(snapshot.metrics.lastResponseMs,null);
  const fresh=JSON.parse(fs.readFileSync(path.join(dataDir,'ploa_workspace.json'),'utf8'));assert.deepEqual(fresh.records,{});assert.deepEqual(fresh.jobs,[]);assert.deepEqual(fresh.usage,old.usage);
  assert.equal(fs.readFileSync(path.join(f.root,'ploa_conversas.jsonl'),'utf8'),original);assert.equal(fs.readdirSync(path.join(folder,'cenarios')).length,1);
  snapshot=f.manager.reset();assert.equal(snapshot.messages.length,0);
  fs.appendFileSync(path.join(f.root,'ploa_conversas.jsonl'),'\n'+JSON.stringify({id:'fresh',contact,direction:'in',text:'Outro projeto',at:new Date().toISOString()})+'\n');
  assert.deepEqual(f.manager.snapshot().messages.map(e=>e.text),['Outro projeto']);
});
test('não permite trocar o cenário com o atendimento de teste em execução',async t=>{
  const f=fixture(t);await f.manager.start();assert.throws(()=>f.manager.reset(),error=>error.statusCode===409);
});
test('API do laboratório restringe origem, tamanho e ações permitidas',async()=>{
  let starts=0,result,limit;
  const handler=createRequestHandler({HOST:'127.0.0.1',PORT:4310,aiTests:{snapshot:()=>({running:false}),start:async()=>{starts++;return{running:true};},stop:()=>({running:false})},
    requestIsLocalAndSameOrigin:r=>r.headers.origin==='http://127.0.0.1:4310',readJsonBody:async(r,max)=>{limit=max;return{};},sendJson:(r,status,body)=>{result={status,body};}});
  const request=(method,url,origin='http://127.0.0.1:4310')=>({method,url,headers:{host:'127.0.0.1:4310',origin,'content-type':'application/json'}});
  await handler(request('POST','/api/ai-tests/start','https://externo.example'),{});assert.equal(result.status,403);assert.equal(starts,0);
  await handler(request('POST','/api/ai-tests/start'),{});assert.equal(result.status,202);assert.equal(limit,4096);assert.equal(starts,1);
  await handler(request('POST','/api/ai-tests/remove'),{});assert.equal(result.status,404);
});
