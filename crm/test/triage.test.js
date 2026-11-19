'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {localTriage,contextualTriage,queueFor}=require('../lib/triage');
const {createTriageService}=require('../lib/triage-service');
const {workspaceFixture}=require('./fixture-helpers');
const lead=text=>({id:'5511999999999',numero:'5511999999999',status:'respondeu',ultima_mensagem:text,ultima_resposta:'2026-10-23T12:00:00.000Z',respostas:[{texto:text,data:'2026-10-23T12:00:00.000Z'}]});
test('saudação, permissão e site existente não viram compra nem recusa',()=>{
  assert.equal(localTriage(lead('Olá, tudo bem?')).category,'greeting');assert.equal(localTriage(lead('Pode explicar.')).category,'permission');
  assert.equal(localTriage(lead('Já temos um site.')).category,'has_site');assert.equal(localTriage(lead('Sim.')).needsReview,true);
  assert.equal(localTriage(lead('Não tenho interesse.')).category,'refusal');
});
test('interpretação da IA exige evidência literal e mantém aceite para conferência',()=>{
  assert.equal(contextualTriage(lead('Já tenho um site'),{intent:'interested',needsReview:false,evidence:'quero contratar',reason:'inventada'}).needsReview,true);
  const accepted=contextualTriage(lead('Aceito a proposta'),{intent:'acceptance',needsReview:false,evidence:'Aceito a proposta'});assert.equal(accepted.needsReview,true);assert.notEqual(accepted.suggestedStatus,'ganho');
});
test('histórico a organizar fica separado de exceções e retornos atuais',()=>{
  const item={...lead('Oi'),classificacao_revisao:true,historico_completo:[{direction:'in'}]};
  assert.equal(queueFor(item,{}).history,true);assert.equal(queueFor(item,{attention:{reason:'Falta preço'}}).actionNow,true);
});
test('prévia e aplicação por regras não criam mensagens; desfazer recupera a situação anterior',async t=>{
  const f=workspaceFixture(t),service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());
  const preview=await service.start({contacts:[f.contact]});assert.equal(preview.safe,1);assert.equal(f.workspace.read().jobs.length,0);
  assert.equal((await f.store.getDashboard()).leads[0].classificacao_revisao,true);
  const applied=await service.apply();assert.equal(applied.applied,1);assert.equal((await f.store.getDashboard()).leads[0].classificacao_revisao,false);assert.equal(f.workspace.read().jobs.length,0);
  assert.equal((await service.undo()).restored,1);assert.equal((await f.store.getDashboard()).leads[0].classificacao_revisao,true);
});
test('nova resposta após a prévia impede aplicação de uma categoria antiga',async t=>{
  const f=workspaceFixture(t),service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());
  await service.start({contacts:[f.contact]});await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Mensagem nova diferente.',messageId:'new-in',at:'2026-10-24T12:00:00Z',eligible:false});
  assert.equal((await service.apply()).applied,0);assert.equal(f.workspace.read().jobs.length,0);
});
test('etapa manual não entra em aplicação em lote',async t=>{
  const f=workspaceFixture(t,{manual:true}),service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());
  await assert.rejects(service.start({contacts:[f.contact]}),/Nenhum contato elegível/);assert.equal((await f.store.getDashboard()).leads[0].status,'proposta');
});
test('uma nova prévia preserva a opção de desfazer a aplicação anterior',async t=>{
  const f=workspaceFixture(t),service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());
  await service.start({contacts:[f.contact]});await service.apply();await service.start({contacts:[f.contact]});assert.equal(service.snapshot().canUndo,true);
  assert.equal((await service.undo()).restored,1);
});
test('interpretação em lote usa método de classificação e não a fila de envio',async t=>{
  const f=workspaceFixture(t,{text:'Explica um pouco melhor esta ideia para mim.'});
  let calls=0;f.workspace.classifyHistory=async()=>{calls++;return{intent:'question',needsReview:false,evidence:'Explica um pouco melhor',reason:'Pedido de explicação.',nextStep:'Entender a necessidade.'};};
  const service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());await service.start({contacts:[f.contact],useAi:true,aiLimit:1});await service.tick();await service.tick();
  assert.equal(calls,1);assert.equal(service.snapshot().status,'completed');assert.equal(f.workspace.read().jobs.length,0);
});
test('caso já interpretado pela IA não consome outra consulta sem mudança de contexto',async t=>{
  const f=workspaceFixture(t,{text:'Talvez, vou pensar nesta possibilidade.'});let calls=0;
  f.workspace.classifyHistory=async()=>{calls++;return{intent:'ambiguous',needsReview:true,evidence:'vou pensar',reason:'Contexto incompleto.'};};
  const service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());
  await service.start({contacts:[f.contact],useAi:true,aiLimit:1});await service.tick();await service.tick();
  await service.start({contacts:[f.contact],useAi:true,aiLimit:1});await service.tick();assert.equal(calls,1);assert.equal(service.snapshot().status,'completed');
});
test('histórico sem texto recebe apenas identificação factual e não consome IA',async t=>{
  const f=workspaceFixture(t,{text:''});let calls=0;f.workspace.classifyHistory=async()=>{calls++;throw new Error('Não deve consultar a IA.');};
  const item=(await f.store.getDashboard()).leads[0],analysis=localTriage(item);
  assert.equal(analysis.category,'missing_history');assert.equal(analysis.suggestedStatus,'respondeu');assert.equal(analysis.canUseAi,false);assert.equal(queueFor(item).withoutText,true);assert.equal(queueFor(item).history,false);
  const service=createTriageService(f.root,f.store,f.workspace);t.after(()=>service.close());
  const preview=await service.start({contacts:[f.contact],useAi:true});await service.tick();assert.equal(preview.withoutText,1);assert.equal(calls,0);
  await service.apply();const after=(await f.store.getDashboard()).leads[0];assert.equal(after.status,'respondeu');assert.equal(after.triagem.category,'missing_history');assert.equal(f.workspace.read().jobs.length,0);
});
test('um bot antigo não transforma a resposta humana atual em atendimento automático',()=>{
  const result=localTriage({...lead('Olá, tudo bem?'),atendimento_automatico:true});assert.equal(result.category,'greeting');assert.equal(result.suggestedStatus,'respondeu');
});
