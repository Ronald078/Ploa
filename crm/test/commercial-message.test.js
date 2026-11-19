'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBusiness,decideAutonomous}=require('../lib/commercial-policy');
const {negotiationResult}=require('../lib/commercial-transition');
const {buildContext}=require('../lib/conversation-context');
const {workspaceFixture}=require('./fixture-helpers');
const {quoteBasis}=require('../lib/negotiation-budget');
const offer={id:'project-br',title:'Site + sistema',market:'Brasil',currency:'BRL',amount:750,scope:'Catálogo e organização dos pedidos.\n• Produtos\n• Pedidos',terms:'Pagamento integral antes do início ou entrada de 50% e restante na entrega.',deadline:'7 a 20 dias úteis após o pagamento inicial.',maintenance:'Mensalidade de R$50, sem desconto.',autoPresent:true,maxDiscountPercent:15};
const settings={responseMode:'autonomous',business:normalizeBusiness({offers:[offer],allowAutoProposals:true,negotiationPolicy:{initialMaxPercent:10,automaticMaxPercent:15,humanMinPercent:25,humanMaxPercent:30}})};
const lead={id:'5511999999999',numero:'5511999999999',pais:'Brasil',moeda:'BRL',status:'qualificado'};
const record=(discount=0)=>({proposals:[],lastQuotedOffer:{...settings.business.offers[0],amount:750*(1-discount/100),discountPercent:discount,status:'quoted'}});
const context=text=>({latestMessage:text,language:'pt-BR',automation:{manualRequest:false}});
const withBudget=(r,amount)=>({...r,negotiationBudget:{basis:quoteBasis(r.lastQuotedOffer),amount,currency:r.lastQuotedOffer.currency,evidence:'Orçamento informado pelo cliente.'}});

test('depois de conhecer orçamento anuncia a concessão antes do valor sem repetir o escopo',()=>{
  const r=withBudget(record(),675),ctx=context('Teria desconto?'),result=negotiationResult(settings,lead,r,ctx);
  assert.ok(result);assert.equal(result.usage.output,0);
  const action=decideAutonomous(result,settings,lead,r,ctx);
  assert.equal(action.status,'ready');assert.equal(action.amount,675);assert.equal(action.discountPercent,10);
  assert.match(action.text,/^Ok! Posso aplicar 10% de desconto/);assert.match(action.text,/675/);
  assert.ok(action.text.indexOf('desconto')<action.text.indexOf('675'));assert.ok(!action.text.includes('•'));
  assert.ok(action.text.length<450);assert.equal(action.offer.maintenance,offer.maintenance);
});
test('nova objeção usa 15% sobre 750 em vez de parar em 10% ou acumular percentuais',()=>{
  const r=withBudget(record(10),637.5),ctx=context('Achei um pouco salgado o valor');
  const result=negotiationResult(settings,lead,r,ctx);assert.equal(result.decision.discountPercent,15);
  const action=decideAutonomous(result,settings,lead,r,ctx);assert.equal(action.amount,637.5);
  assert.match(action.text,/^Posso melhorar o desconto para 15%/);assert.match(action.text,/637,50/);
});
test('não negocia recusa, condição, orçamento específico, desconto de mensalidade nem escopo novo',()=>{
  for(const text of ['Não achei caro','Não quero mais contato','Quero 30% de desconto','Teria desconto na mensalidade?','Teria desconto se eu pagar depois?','Quero incluir pagamento online','Achei caro, meu limite é 400','Tem desconto? Quero também controlar estoque'])assert.equal(negotiationResult(settings,lead,record(),context(text)),null,text);
  assert.equal(negotiationResult(settings,lead,record(15),context('Teria desconto?')),null);
  assert.equal(negotiationResult({...settings,responseMode:'review'},lead,record(),context('Teria desconto?')),null);
  assert.equal(negotiationResult(settings,lead,{...record(),projectDraft:{status:'pending'}},context('Teria desconto?')),null);
  assert.equal(negotiationResult(settings,lead,{...record(),lastQuotedOffer:{...record().lastQuotedOffer,status:'draft'}},context('Teria desconto?')),null);
});
test('proposta formal mantém condições completas e não usa o resumo de negociação',()=>{
  const ctx=context('Pode formalizar a proposta'),r=record(10);
  const result={reply:'',intent:'proposal_request',evidence:ctx.latestMessage,needsReview:false,decision:{action:'proposal',offerId:offer.id,discountPercent:10}};
  const action=decideAutonomous(result,settings,lead,r,ctx);
  assert.equal(action.status,'ready');for(const field of ['scope','terms','deadline','maintenance'])assert.ok(action.text.includes(offer[field]),field);
});
test('não afirma que as condições permaneceram iguais se elas foram alteradas',()=>{
  const r=withBudget(record(),675);r.lastQuotedOffer.terms='Outra condição anterior.';
  const ctx=context('Teria desconto?'),result=negotiationResult(settings,lead,r,ctx),action=decideAutonomous(result,settings,lead,r,ctx);
  assert.ok(!action.text.includes('continuam os mesmos'));assert.ok(action.text.includes(offer.terms));
});
test('idiomas preservam o novo valor e a mensalidade sem introdução em português',()=>{
  for(const [language,market,currency,message,start] of [['pt-PT','Portugal','EUR','Teria desconto?',/^Posso aplicar-lhe/],['en-US','Estados Unidos','USD','Can you offer a discount?',/^I can offer/],['es-ES','Espanha','EUR','Hay algun descuento?',/^Puedo aplicarte/]]){
    const s=structuredClone(settings),l={...lead,pais:market,moeda:currency};s.business.offers[0].market=market;s.business.offers[0].currency=currency;s.business.offers[0].maintenance=language==='en-US'?'Monthly fee: $50.':'50 €/mes.';
    const r=withBudget({proposals:[],lastQuotedOffer:{...s.business.offers[0],status:'quoted',discountPercent:0}},675),ctx={...context(message),language};
    const result=negotiationResult(s,l,r,ctx),action=decideAutonomous(result,s,l,r,ctx);
    assert.equal(action.amount,675);assert.match(action.text,start);assert.equal(action.offer.maintenance,s.business.offers[0].maintenance);
  }
});
test('contexto distingue desconto enviado de teto automático e mantém o valor já oferecido',()=>{
  const ctx=buildContext(lead,record(10),[{direction:'in',text:'Achei caro'}],settings);
  assert.equal(ctx.confirmedOffer.discountPercent,10);assert.equal(ctx.confirmedOffer.amount,675);assert.equal(ctx.automation.negotiationPolicy.automaticMaxPercent,15);
});
test('desconto enviado depois de uma proposta antiga prevalece no contexto do modelo',()=>{
  const r=record(10);r.lastQuotedOffer.quotedAt='2026-10-25T20:00:00Z';
  r.proposals=[{id:'old-proposal',catalogOfferId:offer.id,title:'Proposta anterior',amount:750,currency:'BRL',status:'sent',discountPercent:0,sentAt:'2026-10-25T19:00:00Z'}];
  const ctx=buildContext(lead,r,[{direction:'in',text:'Achei caro'}],settings);
  assert.equal(ctx.confirmedOffer.discountPercent,10);assert.equal(ctx.confirmedOffer.amount,675);
});
test('negociação simples responde com cota esgotada sem consultar a Groq',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:Date.now()});
  const f=workspaceFixture(t),day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  await f.workspace.saveSettings({...settings,provider:'groq',apiKey:'fixture-not-a-real-api-key',enabled:true,dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:1});
  let calls=0;f.workspace.setProvider({hasKey:()=>true,close(){},generate:async()=>{calls++;throw Error('Não deve chamar o provedor.');}});
  await f.workspace.mutate(data=>{data.records[f.contact]=withBudget(record(10),637.5);data.usage[day]={requests:1,input:0,output:0};});
  await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Achei um pouco salgado o valor',messageId:'second-discount',at:new Date().toISOString(),eligible:true});
  t.mock.timers.tick(16000);
  let job;for(let n=0;n<80;n++){await new Promise(setImmediate);job=f.workspace.read().jobs.at(-1);if(['ready','held'].includes(job.status))break;}
  assert.equal(job.status,'ready',job.reason);assert.equal(job.offerAmount,637.5);assert.equal(calls,0);assert.equal(f.workspace.publicSnapshot().usage.requests,1);
});
