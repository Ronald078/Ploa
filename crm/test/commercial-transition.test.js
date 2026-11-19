'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {confirmedScopeResult}=require('../lib/commercial-transition');
const {scopeAction}=require('../lib/project-pricing');
const {normalizeBusiness,decideAutonomous}=require('../lib/commercial-policy');
const {workspaceFixture}=require('./fixture-helpers');
const request='Quero um site para apresentar os produtos e receber pedidos pelo WhatsApp.';
const business=normalizeBusiness({allowAutoProposals:true,allowAutoAcceptance:true,projectPricing:{enabled:true,method:'qualitative_factors_v1'},offers:[{id:'site-br',serviceType:'site',title:'Site',market:'Brasil',currency:'BRL',amount:150,amountMax:250,pricingMode:'range',scope:'Apresentar produtos',terms:'Condições aprovadas',autoPresent:true}]});
const settings={responseMode:'autonomous',business};
const lead={pais:'Brasil',moeda:'BRL',status:'respondeu'};
const scope=()=>scopeAction({serviceType:'site',work:'new',summary:'Site para apresentar produtos e receber pedidos pelo WhatsApp',requirements:[{text:'Apresentação dos produtos e recebimento de pedidos',evidence:request}],drivers:[{dimension:'presentation',level:'basic',evidence:request}],technicalReview:false},{language:'pt-BR',history:[{role:'contato',text:request}]}).scopeDraft;
const record=()=>({mode:'automatic',lastInbound:'confirm',proposals:[],projectDraft:{...scope(),status:'pending',sentAt:new Date().toISOString(),inbound:'request'}});
const context=text=>({language:'pt-BR',latestMessage:text,automation:{manualRequest:false}});
test('confirmação do resumo avança para valor e não repete scope ou confirma contrato',()=>{
  const r=record(),ctx=context('Sim exatamente disso'),result=confirmedScopeResult(settings,lead,r,ctx);
  assert.equal(result.decision.action,'quote');assert.equal(result.intent,'interested');assert.equal(result.usage.input,0);
  const action=decideAutonomous(result,settings,lead,r,ctx);assert.equal(action.status,'ready');assert.equal(action.action,'quote');assert.equal(action.amount,150);
});
test('pedido explícito de proposta após o resumo utiliza os mesmos cálculos e condições',()=>{
  const r=record(),ctx=context('Sim, pode enviar a proposta.'),result=confirmedScopeResult(settings,lead,r,ctx);
  assert.equal(result.decision.action,'proposal');assert.equal(decideAutonomous(result,settings,lead,r,ctx).status,'ready');
});
test('condições, novos requisitos, modo manual e resumo não enviado não avançam automaticamente',()=>{
  for(const text of ['Sim, mas quero outra coisa','Sim, se tiver desconto','Sim, também quero pagamento online'])assert.equal(confirmedScopeResult(settings,lead,record(),context(text)),null);
  const r=record();r.projectDraft.sentAt=null;assert.equal(confirmedScopeResult(settings,lead,r,context('Sim')),null);
  assert.equal(confirmedScopeResult({...settings,responseMode:'review'},lead,record(),context('Sim')),null);
  assert.equal(confirmedScopeResult(settings,lead,record(),{...context('Sim'),automation:{manualRequest:true}}),null);
});
test('resumo confirmado consegue apresentar valor com cota de IA esgotada sem consultar o provedor',async t=>{
  const f=workspaceFixture(t,{text:request});
  await f.workspace.saveSettings({provider:'groq',apiKey:'fixture-not-a-real-api-key',enabled:true,dataConsent:true,freeAccountConfirmed:true,responseMode:'autonomous',business,maxDailyRequests:1});
  let calls=0;f.workspace.setProvider({hasKey:()=>true,generate:async()=>{calls++;throw Error('Não consultar o modelo.');},close(){}});
  const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  await f.workspace.mutate(data=>{data.records[f.contact]=record();data.usage[day]={requests:1,input:0,output:0};});
  await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Sim exatamente disso',messageId:'confirm-real',eligible:true});
  await f.workspace.mutate(data=>{data.jobs.at(-1).dueAt=0;});
  const end=Date.now()+5000;let job;
  while(Date.now()<end){job=await f.workspace.nextDelivery();if(job)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(job);assert.equal(calls,0);assert.equal(f.workspace.publicSnapshot().usage.requests,1);assert.match(job.text,/150/);
});
