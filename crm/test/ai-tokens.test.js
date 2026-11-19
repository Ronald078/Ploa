'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {temporaryRoot}=require('./fixture-helpers');
const {createTokenRecorder,readTokenUsage,tokenDashboard,dayKey}=require('../lib/ai-token-usage');
const {buildContext}=require('../lib/conversation-context');
const {systemFor,requestContext}=require('../lib/ai-prompt-profile');
const {SYSTEM}=require('../lib/ai-instructions');
const {createAiProvider}=require('../lib/ai-provider');
const {issueFor,generateWithReview}=require('../lib/ai-result-review');
const lead={id:'5511999999999',numero:'5511999999999',nome:'Pessoa fictícia',categoria:'loja de roupa',pais:'Brasil',moeda:'BRL',classificacao_idioma:'pt-BR'};
const history=[{direction:'out',actor:'script',text:'Como apresenta as peças aos clientes?',at:'2026-10-26T12:00:00Z'},{direction:'in',text:'Mostramos no Instagram e atendemos pelo WhatsApp.',at:'2026-10-26T12:01:00Z'}];
const settings={guidance:'REGRA PERSONALIZADA INTEGRAL',services:'SERVIÇO PERSONALIZADO INTEGRAL',business:{offers:[{id:'fictional',title:'Projeto',serviceType:'site',market:'Brasil',currency:'BRL',active:true,autoPresent:true,amount:1000,amountMax:2000,pricingMode:'range',terms:'CONDIÇÃO IMPORTANTE',scope:'ESCOPO APROVADO',maintenance:'MENSALIDADE APROVADA'}],guidance:'REGRA COMERCIAL PERSONALIZADA'}};

test('perfil de descoberta reduz repetições preservando copy, turnos, fatos e instruções personalizadas',()=>{
  const ctx=buildContext(lead,{facts:{need:'Necessidade confirmada'},memory:{requirements:{value:'Catálogo',evidence:'Quero um catálogo'}}},history,settings),before=JSON.stringify(ctx),compact=requestContext(ctx),prompt=systemFor(ctx);
  assert.ok(prompt.length<SYSTEM.length*.5);assert.match(prompt,/manualRequest/);assert.match(prompt,/opt_out/);assert.match(prompt,/integração|integracao/);
  assert.equal(JSON.stringify(ctx),before);assert.deepEqual(compact.history,ctx.history);assert.equal(compact.funnel.openingMessage,history[0].text);assert.equal(compact.latestMessage,history[1].text);
  assert.equal(compact.instructions,settings.guidance);assert.equal(compact.confirmedServices,settings.services);assert.equal(compact.automation.rules,settings.business.guidance);assert.equal(compact.confirmedFacts.need,'Necessidade confirmada');assert.deepEqual(compact.memory,ctx.memory);
  assert.equal(compact.automation.offers[0].id,'fictional');assert.equal(compact.automation.offers[0].amount,undefined);assert.equal(ctx.automation.offers[0].amount,1000);
});
test('pedido de preço e escopo carregam as instruções e condições da etapa correspondente',()=>{
  const pricing=buildContext(lead,{},[{direction:'in',text:'Quanto custa um site?'}],settings),scope=buildContext(lead,{},[{direction:'in',text:'Quero um site para apresentar os produtos e receber pedidos pelo WhatsApp.'}],settings);
  assert.equal(systemFor(pricing),SYSTEM);assert.equal(requestContext(pricing).automation.offers[0].amount,1000);assert.ok(JSON.stringify(requestContext(pricing)).includes('CONDIÇÃO IMPORTANTE'));
  assert.equal(systemFor(scope),SYSTEM);assert.equal(requestContext(scope).automation.offers[0].amount,1000);assert.equal(systemFor({}),SYSTEM);
});

test('escolha funcional ainda pendente usa contexto curto sem liberar condições comerciais',()=>{
  const ctx=buildContext(lead,{},[{direction:'in',text:'Tenho uma loja e queria que os clientes vissem as peças disponíveis.'}],settings);
  assert.equal(ctx.funnel.phase,'requirements');assert.equal(ctx.funnel.allowScope,false);assert.equal(ctx.funnel.allowQuote,false);
  assert.ok(systemFor(ctx).length<SYSTEM.length*.5);assert.match(systemFor(ctx),/solutionDue/);
  assert.equal(requestContext(ctx).automation.offers[0].amount,undefined);
});
test('histórico anterior é importado uma vez sem duplicar consumo após gravação de novo uso',t=>{
  const root=temporaryRoot(t),day='2026-10-26',legacy={[day]:{requests:2,input:100,output:20}},recorder=createTokenRecorder(root,()=>legacy);
  assert.equal(readTokenUsage(root,legacy,Date.parse(day+'T12:00:00Z')).today.total,120);
  recorder.record({at:day+'T12:00:00Z',provider:'groq',model:'fictional',input:50,output:5,apiKey:'never-record-me',text:'private-message'});
  legacy[day].input+=50;legacy[day].output+=5;
  let usage=readTokenUsage(root,legacy,Date.parse(day+'T12:00:00Z'));assert.equal(usage.today.total,175);
  const reopened=createTokenRecorder(root,()=>legacy);reopened.record({at:day+'T12:01:00Z',provider:'groq',model:'fictional',input:10,output:2});
  usage=readTokenUsage(root,legacy,Date.parse(day+'T12:01:00Z'));assert.equal(usage.today.total,187);
  const text=fs.readFileSync(path.join(root,'ploa_tokens.jsonl'),'utf8');assert.equal(text.match(/"baseline"/g).length,1);assert.ok(!text.includes('never-record-me'));assert.ok(!text.includes('private-message'));
});
test('virada do dia usa Brasília e mantém o consumo histórico',t=>{
  const root=temporaryRoot(t),recorder=createTokenRecorder(root);recorder.record({at:'2026-10-26T02:59:59Z',input:100,output:10});recorder.record({at:'2026-10-26T03:00:00Z',input:200,output:20});
  assert.equal(dayKey('2026-10-26T02:59:59Z'),'2026-10-25');const usage=readTokenUsage(root,{},Date.parse('2026-10-26T12:00:00Z'));assert.equal(usage.today.total,220);assert.equal(usage.daily.length,2);
});
test('resposta rejeitada por limite de geração já registra tokens informados pelo provedor',async t=>{
  const root=temporaryRoot(t),recorder=createTokenRecorder(root);let calls=0;
  const provider=createAiProvider({credentialStore:{available:true,load:()=>({groq:'fixture-not-a-real-api-key'}),save(){}},onUsage:recorder.record,fetchImpl:async()=>({ok:true,json:async()=>({usage:{prompt_tokens:300,completion_tokens:20},choices:[{finish_reason:++calls===1?'length':'stop',message:{content:JSON.stringify({reply:'Claro! O que você precisa?',intent:'question',reason:'Dúvida',evidence:'Olá',nextStep:'Entender',needsReview:false})}}]})})});
  try{const s={provider:'groq',dataConsent:true,freeAccountConfirmed:true};await assert.rejects(provider.generate(s,{latestMessage:'Olá'}),/não concluiu/);assert.equal(readTokenUsage(root).today.total,320);await provider.generate(s,{latestMessage:'Olá'});assert.equal(readTokenUsage(root).today.total,640);}finally{provider.close();}
});
test('painel separa atendimento e teste sem depender da sessão ou expor dados de contatos',t=>{
  const root=temporaryRoot(t),contact='5511999999999',day=dayKey(Date.now());fs.mkdirSync(path.join(root,'crm'));fs.writeFileSync(path.join(root,'crm','ai-test-contact.json'),JSON.stringify({contact,name:'Nome privado'}));
  const testRoot=path.join(root,'teste_ia_local',contact);fs.mkdirSync(testRoot,{recursive:true});fs.writeFileSync(path.join(testRoot,'ploa_workspace.json'),JSON.stringify({usage:{[day]:{input:30,output:4}}}));
  const report=tokenDashboard(root,{[day]:{input:100,output:10}});assert.equal(report.sources.attendance.today.total,110);assert.equal(report.sources.tests.today.total,34);assert.ok(!JSON.stringify(report).includes(contact));assert.ok(!JSON.stringify(report).includes('Nome privado'));
});
test('preservar WhatsApp não é recusa; falha de validação não pode encerrar o lead',async()=>{
  const text='Quero um site para mostrar os cortes e os preços, com um botão para marcar pelo WhatsApp. Vou continuar agendando pelo WhatsApp.';
  const ctx=buildContext(lead,{},[{direction:'in',text}],{}),wrong={reply:'',intent:'refusal',reason:'Mantém WhatsApp',evidence:text,nextStep:'Encerrar',needsReview:false,decision:{action:'close'},usage:{input:1,output:1}};
  assert.match(issueFor(wrong,ctx),/Não há recusa/);const corrected=await generateWithReview({generate:async()=>wrong},{},ctx,{beforeRetry:async()=>false});
  assert.equal(corrected.intent,'unknown');assert.equal(corrected.decision.action,'handoff');
  assert.equal(issueFor({...wrong,evidence:'Não quero o site'}, {...ctx,latestMessage:'Não quero o site'}),null);
});
test('resumo de pedido definido precisa registrar scope para poder avançar após a confirmação',()=>{
  const text='Quero um site para mostrar os serviços e receber pedidos pelo WhatsApp.',ctx=buildContext(lead,{},[{direction:'in',text}],{responseMode:'autonomous',business:{projectPricing:{enabled:true},offers:[]}});
  const value={reply:'O site vai mostrar os serviços e receber os pedidos pelo WhatsApp. É isso mesmo?',intent:'interested',evidence:text,decision:{action:'reply'}};
  assert.match(issueFor(value,ctx),/registrar o resumo/);
});
test('sem cota para corrigir formato mantém revisão e estrutura de consumo válida',async()=>{
  const result=await generateWithReview({generate:async()=>{throw Object.assign(new Error('Formato incompleto'),{repairableFormat:true});}},{},{latestMessage:'Olá'},{beforeRetry:async()=>false});
  assert.equal(result.decision.action,'handoff');assert.equal(result.intent,'unknown');assert.deepEqual(result.usage,{input:0,output:0});
});
