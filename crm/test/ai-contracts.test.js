'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAiProvider}=require('../lib/ai-provider');
const {normalizeBusiness,eligibleOffers,decideAutonomous}=require('../lib/commercial-policy');
const {uniqueConversationEvents}=require('../lib/conversation-events');
const {workspaceFixture}=require('./fixture-helpers');
const {quoteBasis}=require('../lib/negotiation-budget');
const business=()=>normalizeBusiness({allowAutoProposals:true,allowAutoAcceptance:true,offers:[{id:'site-br',title:'Site de exemplo',market:'Brasil',currency:'BRL',amount:500,maxDiscountPercent:10,category:'restaurante',scope:'Escopo fictício.',terms:'Condições fictícias.',active:true,autoPresent:true}]});
const lead={pais:'Brasil',moeda:'BRL',categoria:'restaurante',status:'qualificado'};
const result={intent:'question',reply:'Posso explicar a opção.',reason:'Pergunta.',evidence:'Quero uma proposta',needsReview:false,decision:{action:'proposal',offerId:'site-br',discountPercent:0}};
test('país, moeda e categoria restringem as ofertas elegíveis',()=>{
  assert.equal(eligibleOffers(business(),lead).length,1);for(const variation of [{pais:'Portugal'},{moeda:'USD'},{categoria:'pet shop'}])assert.equal(eligibleOffers(business(),{...lead,...variation}).length,0);
});
test('valor é montado pelo catálogo e desconto precisa respeitar autorização e contexto',()=>{
  const settings={business:business()},context={language:'pt-BR',latestMessage:'Quero uma proposta'};
  const proposal=decideAutonomous({...result,reply:'O valor seria R$ 1.'},settings,lead,{},context);assert.equal(proposal.amount,500);assert.ok(!proposal.text.includes('R$ 1.'));
  assert.equal(decideAutonomous({...result,decision:{...result.decision,discountPercent:20}},settings,lead,{},context).status,'held');
  assert.equal(decideAutonomous({...result,decision:{...result.decision,discountPercent:5}},settings,lead,{},context).status,'held');
  const quoted={lastQuotedOffer:{...settings.business.offers[0],status:'quoted',discountPercent:0}};
  quoted.negotiationBudget={basis:quoteBasis(quoted.lastQuotedOffer),amount:475,currency:'BRL',evidence:'Meu orçamento é 475.'};
  assert.equal(decideAutonomous({...result,decision:{...result.decision,discountPercent:5}},settings,lead,quoted, {...context,latestMessage:'Tem algum desconto?'}).amount,475);
});
test('aceite curto, condicional ou sem proposta apresentada não confirma contrato',()=>{
  const settings={business:business()},record={proposals:[{id:'p1',status:'sent'}]};
  for(const latestMessage of ['Sim','Aceito se tiver desconto','Não aceito a proposta']){
    const action=decideAutonomous({...result,intent:'acceptance',evidence:latestMessage,decision:{action:'accept',proposalId:'p1'}},settings,lead,record,{language:'pt-BR',latestMessage});assert.equal(action.status,'held');
  }
  assert.equal(decideAutonomous({...result,intent:'acceptance',decision:{action:'accept',proposalId:'missing'}},settings,lead,record,{language:'pt-BR',latestMessage:'Aceito a proposta'}).status,'held');
});
test('resposta comum não pode afirmar pagamento recebido',()=>{
  assert.equal(decideAutonomous({...result,reply:'Pagamento confirmado, recebi o Pix.',decision:{action:'reply'}},{business:business()},lead,{}, {latestMessage:'Enviei o comprovante',language:'pt-BR'}).status,'held');
});
test('mesmo envio por dois caminhos vira um registro; IDs diferentes ficam separados',()=>{
  const a={contact:'5511999999999',direction:'out',actor:'script',text:'Mensagem fictícia',at:'2026-10-24T12:00:00.500Z'};
  const b={...a,actor:'human',at:'2026-10-24T12:00:00.000Z'};
  assert.equal(uniqueConversationEvents([a,b]).length,1);assert.equal(uniqueConversationEvents([{...a,messageId:'a'},{...b,messageId:'b'}]).length,2);assert.equal(uniqueConversationEvents([a,{...a}]).length,2);
});
test('provedor tem saída própria de classificação sem texto de resposta',async()=>{
  let request;const provider=createAiProvider({credentialStore:{available:true,load:()=>({groq:'fixture-not-a-real-api-key'}),save(){}},fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({intent:'question',evidence:'Como funciona',reason:'Dúvida.',nextStep:'Explicar.',needsReview:false,reply:'Não deve sair na classificação.'})}}],usage:{prompt_tokens:10,completion_tokens:5}})};}});
  try{const data=await provider.classify({provider:'groq',dataConsent:true,freeAccountConfirmed:true},{latestMessage:'Como funciona?'});assert.equal(data.intent,'question');assert.equal(data.reply,undefined);assert.equal(data.usage.input,10);assert.match(request.messages[0].content,/Não escreva resposta/);}finally{provider.close();}
});
test('triagem da IA compartilha a cota e não coloca nada na fila de envio',async t=>{
  const f=workspaceFixture(t);await f.workspace.saveSettings({provider:'groq',apiKey:'fixture-not-a-real-api-key',enabled:true,dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:20});let calls=0;
  f.workspace.setProvider({hasKey:()=>true,classify:async()=>{calls++;return{intent:'greeting',reason:'Saudação.',evidence:'Olá',needsReview:false,usage:{input:1,output:1}};},close(){}});
  const current=(await f.store.getDashboard()).leads[0];await f.workspace.classifyHistory(current);
  assert.equal(calls,1);assert.equal(f.workspace.publicSnapshot().usage.requests,1);assert.equal(f.workspace.read().jobs.length,0);
  await assert.rejects(f.workspace.classifyHistory(current),error=>error.triageBusy===true);
});
test('novas conversas externas seguem a IA até intervenção explícita pelo painel',async t=>{
  const f=workspaceFixture(t);await f.workspace.saveSettings({provider:'groq',apiKey:'fixture-not-a-real-api-key',enabled:true,dataConsent:true,freeAccountConfirmed:true,autoExternal:true});
  f.workspace.setProvider({hasKey:()=>true,close(){},generate:async()=>{throw new Error('Provedor fictício.');}});
  await f.workspace.ingest({contact:f.contact,origin:'whatsapp_external',direction:'out',actor:'human',text:'Abertura fictícia.',messageId:'external-out'});
  assert.equal(f.workspace.read().records[f.contact].mode,'automatic');
  await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Pode explicar.',messageId:'in-next',eligible:true});assert.ok(f.workspace.read().jobs.some(job=>job.status==='queued'));
  await f.workspace.command(f.contact,{action:'mode',mode:'human'});
  await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Está bem.',messageId:'in-last',eligible:true});assert.equal(f.workspace.read().jobs.some(job=>job.status==='queued'),false);
});
