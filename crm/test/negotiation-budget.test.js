'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBusiness,decideAutonomous}=require('../lib/commercial-policy');
const {negotiationResult}=require('../lib/commercial-transition');
const {quoteBasis,parseBudget,budgetFor,captureBudget}=require('../lib/negotiation-budget');
const {workspaceFixture}=require('./fixture-helpers');
const {negotiationBounds}=require('../lib/negotiation-budget');
const offer={id:'site-br',title:'Projeto aprovado',market:'Brasil',currency:'BRL',amount:750,scope:'Escopo aprovado.',terms:'Integral antes do início ou 50% de entrada e 50% na entrega.',maintenance:'R$50 por mês, sem desconto.',maxDiscountPercent:15,autoPresent:true};
const settings={responseMode:'autonomous',business:normalizeBusiness({offers:[offer],allowAutoProposals:true,negotiationPolicy:{initialMaxPercent:10,automaticMaxPercent:15,humanMinPercent:25,humanMaxPercent:30}})};
const lead={pais:'Brasil',moeda:'BRL',status:'qualificado'};
const record=()=>({proposals:[],lastQuotedOffer:{...settings.business.offers[0],status:'quoted',discountPercent:0}});
const ctx=text=>({language:'pt-BR',latestMessage:text,automation:{manualRequest:false}});
const quotedResult=text=>({reply:'',intent:'objection',evidence:text,needsReview:false,decision:{action:'quote',offerId:offer.id,discountPercent:10}});
function asked(){const r=record();r.negotiationQuestion={basis:quoteBasis(r.lastQuotedOffer),askedAt:new Date().toISOString()};return r;}

test('objeção e pedido simples perguntam orçamento sem conceder desconto',()=>{
  for(const text of ['Achei um pouco caro','Teria desconto?']){
    const r=record(),context=ctx(text),result=negotiationResult(settings,lead,r,context),action=decideAutonomous(result,settings,lead,r,context);
    assert.equal(action.status,'ready');assert.equal(action.action,'reply');assert.ok(action.budgetQuestion);
    assert.match(action.text,/Qual valor você tinha em mente/);assert.ok(!/%|675|desconto/i.test(action.text));assert.equal(action.offer,undefined);
  }
});
test('a validação do servidor impede desconto precoce mesmo se o modelo o solicitar',()=>{
  const action=decideAutonomous(quotedResult('Tem desconto?'),settings,lead,record(),ctx('Tem desconto?'));
  assert.equal(action.amount,undefined);assert.match(action.text,/Qual valor/);
});
test('orçamento claro de 700 recebe apenas a redução necessária, não o desconto máximo',()=>{
  const r=asked(),message='700';captureBudget(r,{text:message,actor:'contact',messageId:'budget-1'});
  const result=negotiationResult(settings,lead,r,ctx(message)),action=decideAutonomous(result,settings,lead,r,ctx(message));
  assert.equal(r.negotiationBudget.amount,700);assert.ok(action.discountPercent>6.66&&action.discountPercent<6.67);assert.equal(action.amount,700);assert.ok(action.amount>675);assert.match(action.text,/ajustar o valor/);
});
test('orçamento abaixo da margem abre discussão de escopo sem prometer valor nem reduzir além do limite',()=>{
  const r=asked(),message='Meu orçamento é 400',result=negotiationResult(settings,lead,r,ctx(message)),action=decideAutonomous(result,settings,lead,r,ctx(message));
  assert.equal(action.action,'reply');assert.equal(action.offer,undefined);assert.match(action.text,/versão mais enxuta/);assert.ok(!/25%|30%|400|675/.test(action.text));
});
test('parser não confunde prazo, entrada, mensalidade, moeda, recusa ou intervalo com orçamento',()=>{
  for(const text of ['50 por mês','50% de entrada','50 de entrada','2 pagamentos','O prazo seria 20?','700 dólares','700 €','Entre 600 e 700','Talvez 700','Não sei','Não consigo pagar 700','-700'])assert.equal(parseBudget(text,'BRL',true),null,text);
  assert.equal(parseBudget('700','BRL'),null);assert.equal(parseBudget('Meu orçamento é R$700','BRL'),700);
  assert.equal(parseBudget('R$1.000,50','BRL',true),1000.5);assert.equal(parseBudget('$1,000.50','USD',true),1000.5);assert.equal(parseBudget('700,50 €','EUR',true),700.5);
});
test('pergunta confirmada e orçamento ficam associados ao mesmo projeto e preço-base',()=>{
  const r=asked();captureBudget(r,{actor:'contact',text:'700',messageId:'client-budget'});
  assert.equal(budgetFor(r).amount,700);r.lastQuotedOffer={...r.lastQuotedOffer,amount:675,discountPercent:10};assert.equal(budgetFor(r).amount,700);
  r.lastQuotedOffer.pricingBasisHash='novo-projeto';assert.equal(budgetFor(r),null);assert.equal(budgetFor(r,'700'),null);
  const bot=asked();captureBudget(bot,{actor:'bot',text:'700'});assert.equal(bot.negotiationBudget,undefined);
});
test('não repete a pergunta de orçamento nem oferece desconto quando o cliente não informa valor',()=>{
  const r=asked(),context=ctx('Teria desconto?');assert.equal(negotiationResult(settings,lead,r,context),null);
  const action=decideAutonomous(quotedResult(context.latestMessage),settings,lead,r,context);
  assert.ok(!action.text.includes('Qual valor você tinha em mente'));assert.match(action.text,/forma de pagamento/);assert.equal(action.amount,undefined);
});
test('os quatro idiomas perguntam orçamento antes do desconto',()=>{
  for(const [language,message,pattern] of [['pt-BR','Teria desconto?',/Qual valor/],['pt-PT','Teria desconto?',/Que valor/],['en-US','Can you offer a discount?',/What budget/],['es-ES','Hay algun descuento?',/presupuesto/]]){
    const r=record(),context={...ctx(message),language},result=negotiationResult(settings,lead,r,context),action=decideAutonomous(result,settings,lead,r,context);
    assert.match(action.text,pattern);assert.equal(action.amount,undefined);
  }
});

test('orçamento igual ao mínimo continua elegível após um desconto enviado',()=>{
 const r=asked();r.lastQuotedOffer={...r.lastQuotedOffer,amount:675,discountPercent:10};
 r.negotiationBudget={basis:quoteBasis(r.lastQuotedOffer),amount:637.5,currency:'BRL',evidence:'Meu orçamento é 637,50'};
 const bounds=negotiationBounds(r,settings.business.offers,settings.business.negotiationPolicy,budgetFor(r));
 assert.equal(bounds.minimumAmount,637.5);assert.equal(bounds.budgetFits,true);
 for(const message of ['Ainda está caro. Consegue melhorar o desconto?','Poderia aumentar esse desconto?','Está caro, pode melhorar o desconto?']){
  const result=negotiationResult(settings,lead,r,ctx(message));assert.ok(result,message);
  const action=decideAutonomous(result,settings,lead,r,ctx(message));assert.equal(action.status,'ready');assert.equal(action.discountPercent,15);assert.equal(action.amount,637.5);
 }
 r.negotiationBudget.amount=637.49;assert.equal(negotiationBounds(r,settings.business.offers,settings.business.negotiationPolicy,budgetFor(r)).budgetFits,false);
});

test('pedido de melhora em inglês e espanhol usa o orçamento já conhecido',()=>{
 for(const [language,message]of [['en-US','It is still expensive. Can you improve the discount?'],['es-ES','Sigue siendo caro. Puedes mejorar el descuento?']]){
  const r=asked();r.lastQuotedOffer={...r.lastQuotedOffer,amount:675,discountPercent:10};r.negotiationBudget={basis:quoteBasis(r.lastQuotedOffer),amount:637.5,currency:'BRL',evidence:'637,50'};
  const context={...ctx(message),language},result=negotiationResult(settings,lead,r,context);assert.ok(result);
  assert.equal(decideAutonomous(result,settings,lead,r,context).amount,637.5);
 }
});

test('condições novas, 25% ou mudança no catálogo não são liberadas pela leitura curta',()=>{
 const r=asked();r.lastQuotedOffer={...r.lastQuotedOffer,amount:675,discountPercent:10};r.negotiationBudget={basis:quoteBasis(r.lastQuotedOffer),amount:637.5,currency:'BRL',evidence:'637,50'};
 for(const message of ['Consegue melhorar o desconto para 25%?','Consegue melhorar o desconto e incluir outra loja?','Se conseguir melhorar o desconto eu pago na entrega'])assert.equal(negotiationResult(settings,lead,r,ctx(message)),null,message);
 assert.equal(negotiationBounds(r,[{...settings.business.offers[0],amount:900}],settings.business.negotiationPolicy,budgetFor(r)),null);
});
test('fluxo integrado só grava pergunta após envio e usa orçamento do contato sem consulta externa',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:Date.now()});
  const f=workspaceFixture(t);await f.workspace.saveSettings({...settings,provider:'groq',apiKey:'fixture-not-a-real-api-key',enabled:true,dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:1});
  let calls=0;f.workspace.setProvider({hasKey:()=>true,close(){},generate:async()=>{calls++;throw Error('Não consultar modelo.');}});
  await f.workspace.mutate(data=>{data.records[f.contact]=record();const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});data.usage[day]={requests:1,input:0,output:0};});
  async function receive(text,messageId){await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text,messageId,at:new Date().toISOString(),eligible:true});t.mock.timers.tick(16000);
    for(let n=0;n<80;n++){await new Promise(setImmediate);const j=f.workspace.read().jobs.at(-1);if(['ready','held'].includes(j.status))return j;}assert.fail('Fila não concluiu.');}
  let job=await receive('Achei um pouco caro','objection');assert.ok(job.budgetQuestion);assert.equal(job.offerAmount,undefined);
  assert.equal(f.workspace.read().records[f.contact].negotiationQuestion,undefined);
  const delivery=await f.workspace.nextDelivery();await f.workspace.ack({id:delivery.id,ok:true,messageId:'asked-sent'});
  assert.ok(f.workspace.read().records[f.contact].negotiationQuestion.askedAt);
  job=await receive('700','budget-answer');assert.equal(job.offerAmount,700);assert.equal(calls,0);
  assert.equal(f.workspace.read().records[f.contact].negotiationBudget.sourceMessageId,'budget-answer');
});
