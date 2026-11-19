'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBusiness,decideAutonomous}=require('../lib/commercial-policy');
const {scopeAction,resolveProjectOffer}=require('../lib/project-pricing');
const {buildContext,createAiProvider,validateResult}=require('../lib/ai-provider');
const {publicPlaybook}=require('../lib/sales-playbook');
const {publicVoice,selectVoiceExample,VOICE_RULES}=require('../lib/sales-voice');
const {workspaceFixture}=require('./fixture-helpers');
const {quoteBasis}=require('../lib/negotiation-budget');
const request='Quero apresentar meus serviços em um site e alterar o conteúdo com versões e aprovação editorial.';
const assessment=()=>({serviceType:'site',work:'new',summary:'A ideia é apresentar os serviços e administrar o conteúdo com versões e aprovação editorial.',technicalReview:false,
  requirements:[{text:'Apresentação dos serviços.',evidence:'apresentar meus serviços'},{text:'Gestão de conteúdo com versões e aprovação editorial.',evidence:'versões e aprovação editorial'}],
  drivers:[{dimension:'presentation',level:'basic',evidence:'apresentar meus serviços'},{dimension:'contentManagement',level:'moderate',evidence:'versões e aprovação editorial'}]});
const offer=(id='site-br',market='Brasil',currency='BRL',serviceType='site')=>({id,title:'Projeto fictício',market,currency,serviceType,pricingMode:'range',amount:100,amountMax:200,
  scope:'Escopo a confirmar.',terms:'Integral ou 50% de entrada e 50% na entrega.',maintenance:'50 por mês. Mensalidade sem desconto.',deadline:'7 a 15 dias úteis a partir do pagamento inicial.',maxDiscountPercent:15,autoPresent:true,active:true});
const business=()=>normalizeBusiness({offers:[offer()],projectPricing:{enabled:true,method:'qualitative_factors_v1'},allowAutoProposals:true,allowAutoAcceptance:true,
  negotiationPolicy:{initialMaxPercent:10,automaticMaxPercent:15,humanMinPercent:25,humanMaxPercent:30},allowUnlimitedInScopeChanges:true});
const lead={pais:'Brasil',moeda:'BRL',categoria:'serviços',status:'qualificado'};
const context=(latestMessage=request)=>({language:'pt-BR',latestMessage,history:[{role:'contato',text:request}]});
const result=(action='quote',text='Sim, é isso mesmo.')=>({reply:'Posso explicar.',intent:'question',reason:'Conversa fictícia.',evidence:text,nextStep:'Explicar a condição aprovada.',needsReview:false,decision:{action,offerId:'site-br',discountPercent:0,confirmScope:true}});
function pending(raw=assessment()){
  const response=scopeAction(raw,context());assert.equal(response.status,'ready',response.reason);
  return{lastInbound:'in-confirm',proposals:[],projectDraft:{...response.scopeDraft,status:'pending',inbound:'in-request',sentAt:new Date().toISOString()}};
}
function priced(raw=assessment()){
  const record=pending(raw),b=business();
  const response=resolveProjectOffer(b.offers[0],record,context('Sim, é isso mesmo.'),{confirmScope:true},b);
  assert.ok(response.assessment,response.reason);record.projectAssessment=response.assessment;record.projectDraft.status='confirmed';
  record.negotiationBudget={basis:quoteBasis({...response.offer,status:'quoted',discountPercent:0}),amount:response.assessment.amount*.85,currency:'BRL',evidence:'Orçamento indicado pelo cliente.'};
  return{record,b,response};
}

test('guia tem contexto, ramificações e quatro idiomas sem dados do cliente de referência',()=>{
  const playbook=publicPlaybook();assert.equal(playbook.scenarios.length,39);
  for(const item of playbook.scenarios){assert.ok(item.objective&&item.branches.length&&item.avoid&&item.checkpoint,item.id);for(const lang of ['pt-BR','pt-PT','en-US','es-ES']){assert.equal(typeof item.examples[lang],'string');assert.ok(item.incoming[lang],item.id);}}
  assert.match(publicVoice().principles.join(' '),/ortografia/);assert.match(VOICE_RULES,/Tratamento formal só/);
  assert.ok(!/350|ConectaLook|Tequero|Eduardo/i.test(JSON.stringify(publicVoice())));
});
test('voz segue o idioma e não transforma um sistema existente em site',()=>{
  for(const language of ['pt-BR','pt-PT','en-US','es-ES']){const sample=selectVoiceExample('Já tenho um sistema',language);assert.ok(sample.reply);assert.ok(!/site|website|web/i.test(sample.reply));}
  assert.equal(selectVoiceExample('Uma mensagem nova sem padrão reconhecido'),null);
});
test('provedor recebe voz, diagnóstico e requisição manual sem usar chave real',async()=>{
  let payload;const provider=createAiProvider({credentialStore:{available:true,load:()=>({groq:'fixture-not-a-real-api-key'}),save(){}},fetchImpl:async(url,options)=>{
    payload=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result('reply','Estou perdido'))}}],usage:{prompt_tokens:1,completion_tokens:1}})};
  }});
  try{const ctx=buildContext({id:'5511999999999',numero:'5511999999999',nome:'Pessoa fictícia',pais:'Brasil',categoria:'serviços'}, {},[{direction:'in',text:'Estou perdido',at:new Date().toISOString()}],{business:business()});
    ctx.automation.manualRequest=true;await provider.generate({provider:'groq',dataConsent:true,freeAccountConfirmed:true},ctx);
    assert.match(payload.messages[0].content,/VOZ DO ATENDIMENTO/);assert.match(payload.messages[0].content,/manualRequest/);
    const sent=JSON.parse(payload.messages[1].content);assert.equal(sent.automation.manualRequest,true);assert.ok(sent.funnel.examples[0].reply);assert.ok(!Object.hasOwn(sent,'evidenceSources'));
  }finally{provider.close();}
});
test('saída estruturada admite resumo mas não inventa ação',()=>{
  assert.equal(validateResult({...result('scope'),assessment:assessment()}).assessment.serviceType,'site');
  assert.throws(()=>validateResult({...result(),decision:{action:'charge-card'}}));
});
test('requisito sem evidência, fator repetido e condição comercial não viram escopo',()=>{
  const absent=assessment();absent.requirements[0].evidence='função nunca solicitada';assert.equal(scopeAction(absent,context()).status,'held');
  const duplicate=assessment();duplicate.drivers.push(duplicate.drivers[0]);assert.equal(scopeAction(duplicate,context()).status,'held');
  const money=assessment();money.summary='O projeto terá preço de R$ 1 e entrega em 2 dias.';assert.equal(scopeAction(money,context()).status,'held');
});
test('sem confirmação, faixa é estimativa e não permite proposta ou desconto',()=>{
  const b=business(),ctx=context('Quanto custa?'),quote=decideAutonomous(result('quote','Quanto custa?'),{business:b},lead,{},ctx);
  assert.equal(quote.amount,null);assert.match(quote.text,/Faixa estimada/);
  assert.equal(decideAutonomous(result('proposal','Quanto custa?'),{business:b},lead,{},ctx).status,'held');
  assert.equal(decideAutonomous({...result('quote','Quanto custa?'),decision:{...result().decision,discountPercent:10}},{business:b},lead,{},ctx).status,'held');
});
test('confirmação curta do resumo é separada de aceite comercial e depende do envio',()=>{
  const b=business();for(const message of ['Sim, mas quero outra função','Não é isso','Talvez','Sim se incluir mais coisas'])assert.ok(resolveProjectOffer(b.offers[0],pending(),context(message),{confirmScope:true},b).reason,message);
  const notSent=pending();delete notSent.projectDraft.sentAt;assert.ok(resolveProjectOffer(b.offers[0],notSent,context('Sim'),{confirmScope:true},b).reason);
  const same=pending();same.lastInbound=same.projectDraft.inbound;assert.ok(resolveProjectOffer(b.offers[0],same,context('Sim'),{confirmScope:true},b).reason);
  const done=priced();assert.equal(done.response.assessment.amount,150);assert.equal(done.record.proposals.length,0);
});
test('mínimo, máximo e fatores adicionais mantêm preço na faixa e sem baratear',()=>{
  const basic=assessment();basic.drivers=basic.drivers.map(item=>({...item,level:'basic'}));assert.equal(priced(basic).response.assessment.amount,100);
  const advanced=assessment();advanced.drivers[0].level='advanced';assert.equal(priced(advanced).response.assessment.amount,200);
  const one=assessment();one.drivers=[one.drivers[1]];const added=assessment();assert.equal(priced(one).response.assessment.amount,priced(added).response.assessment.amount);
  const two=assessment();two.drivers[0].level='moderate';assert.equal(priced(two).response.assessment.amount,175);
});
test('doze combinações respeitam país, moeda e tipo de solução',()=>{
  for(const [market,currency,language,yes] of [['Brasil','BRL','pt-BR','Sim'],['Portugal','EUR','pt-PT','Sim'],['Estados Unidos','USD','en-US','Yes'],['Espanha','EUR','es-ES','Sí']])for(const type of ['site','system','site_system']){
    const b=business();b.offers[0]={...offer('site-br',market,currency,type)};const a=assessment();a.serviceType=type;const record=pending(a);
    const action=decideAutonomous(result('proposal',yes),{business:b},{...lead,pais:market,moeda:currency},record,{...context(yes),language});
    assert.equal(action.status,'ready',action.reason);assert.equal(action.amount,150);assert.equal(action.offer.currency,currency);
    assert.match(action.text,/50/);assert.ok(!action.text.includes('R$ 1.'));
  }
});
test('nova moeda, oferta diferente, mudança no catálogo e viabilidade incerta exigem revisão',()=>{
  const {record,b}=priced();const different={...b.offers[0],id:'outra'};assert.ok(resolveProjectOffer(different,record,context('Quero uma proposta'),{},b).reason);
  const changed={...b.offers[0],amountMax:300};assert.ok(resolveProjectOffer(changed,record,context('Quero uma proposta'),{},b).reason);
  const technical=assessment();technical.technicalReview=true;assert.ok(resolveProjectOffer(b.offers[0],pending(technical),context('Sim'),{confirmScope:true},b).reason);
  assert.equal(decideAutonomous(result(),{business:b},{...lead,moeda:'USD'},record,context('Sim, é isso mesmo.')).status,'held');
});
test('10% e depois 15% usam preço original e preservam mensalidade; acima disso é humano',()=>{
  const {record,b,response}=priced();const ctx=context('Ainda está caro. Tem desconto?');
  const make=discountPercent=>({...result('quote',ctx.latestMessage),intent:'objection',decision:{...result().decision,discountPercent}});
  assert.equal(decideAutonomous(make(10),{business:b},lead,record,ctx).status,'held');
  record.lastQuotedOffer={...response.offer,status:'quoted',discountPercent:0};
  assert.equal(decideAutonomous(make(15),{business:b},lead,record,ctx).status,'held');
  const first=decideAutonomous(make(10),{business:b},lead,record,ctx);assert.equal(first.amount,135);
  record.lastQuotedOffer={...first.offer,amount:first.amount,status:'quoted',discountPercent:10};
  const second=decideAutonomous(make(15),{business:b},lead,record,ctx);assert.equal(second.amount,127.5);assert.equal(second.offer.maintenance,b.offers[0].maintenance);
  for(const discount of [16,25,30])assert.equal(decideAutonomous(make(discount),{business:b},lead,record,ctx).status,'held');
});
test('ausência de cota é permitida só em conteúdo e correções do projeto contratado',()=>{
  const b=business(),run=reply=>decideAutonomous({...result('reply','Tem limite?'),reply},{business:b},lead,{},context('Tem limite?'));
  assert.equal(run('Content changes within the agreed project have no change quota.').status,'ready');
  assert.equal(run('Unlimited hosting and unlimited support.').status,'held');
  assert.equal(run('Content changes have no limit.').status,'held');
});

test('formalizar desconto já enviado não exige pedir desconto de novo nem permite novo abatimento',()=>{
  const {record,b,response}=priced();const text='Pode formalizar a proposta.';
  record.lastQuotedOffer={...response.offer,amount:127.5,status:'quoted',discountPercent:15};
  const requestDiscount=discountPercent=>({...result('proposal',text),intent:'proposal_request',decision:{...result('proposal').decision,discountPercent}});
  assert.equal(decideAutonomous(requestDiscount(15),{business:b},lead,record,context(text)).status,'ready');
  record.lastQuotedOffer.discountPercent=10;assert.equal(decideAutonomous(requestDiscount(15),{business:b},lead,record,context(text)).status,'held');
  record.lastQuotedOffer.discountPercent=15;record.lastQuotedOffer.pricingBasisHash='outro-escopo';assert.equal(decideAutonomous(requestDiscount(15),{business:b},lead,record,context(text)).status,'held');
});

test('fluxo integrado: resumo, confirmação, descontos, proposta, aceite e intervenção manual',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:Date.now()});
  const f=workspaceFixture(t);await f.workspace.saveSettings({provider:'groq',apiKey:'fixture-not-a-real-api-key',enabled:true,dataConsent:true,freeAccountConfirmed:true,business:business()});
  let respond,requests=0;
  f.workspace.setProvider({hasKey:()=>true,keyStatus:()=>({saved:false}),close(){},generate:async(settings,ctx)=>{requests++;return{...respond(ctx),model:'mock',usage:{input:1,output:1}};}});
  let id=0;
  const receive=async(text,fn)=>{id++;const messageId='integration-'+id;respond=fn;await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text,messageId,at:new Date().toISOString(),eligible:true});t.mock.timers.tick(16000);
    const deadline=performance.now()+4000;
    while(performance.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,5));
      const job=f.workspace.read().jobs.find(item=>item.inbound===messageId);
      if(job&&['ready','held'].includes(job.status))return job;
      // O relógio simulado precisa continuar acionando o trabalhador periódico
      // enquanto as leituras reais de arquivo da etapa anterior são concluídas.
      t.mock.timers.tick(2000);
    }
    assert.fail('A fila não concluiu o recebimento '+id+': '+JSON.stringify(f.workspace.read().jobs.find(item=>item.inbound===messageId)));
  };
  const send=async()=>{const job=await f.workspace.nextDelivery();assert.ok(job);await f.workspace.ack({id:job.id,ok:true,messageId:'sent-'+id});};
  let job=await receive(request,()=>({...result('scope',request),assessment:assessment()}));assert.equal(job.status,'ready');await send();
  assert.equal(f.workspace.read().records[f.contact].projectDraft.status,'pending');
  job=await receive('Sim, é isso mesmo.',()=>result());assert.equal(job.offerAmount,150);await send();
  job=await receive('Tem algum desconto?',ctx=>({...result('quote',ctx.latestMessage),intent:'objection',decision:{...result().decision,discountPercent:10}}));assert.ok(job.budgetQuestion);assert.equal(job.offerAmount,undefined);await send();
  job=await receive('Meu orçamento é 127,50',ctx=>({...result('quote',ctx.latestMessage),intent:'objection',decision:{...result().decision,discountPercent:10}}));assert.equal(job.offerAmount,135);await send();
  job=await receive('Ainda está caro, pode melhorar?',ctx=>({...result('quote',ctx.latestMessage),intent:'objection',decision:{...result().decision,discountPercent:15}}));assert.equal(job.offerAmount,127.5);await send();
  job=await receive('Quero 25% de desconto.',ctx=>({...result('quote',ctx.latestMessage),intent:'objection',decision:{...result().decision,discountPercent:25}}));assert.equal(job.status,'held');assert.equal(await f.workspace.nextDelivery(),null);
  job=await receive('Pode enviar a proposta com o ajuste de 15%.',ctx=>({...result('proposal',ctx.latestMessage),intent:'proposal_request',decision:{...result('proposal').decision,discountPercent:15}}));assert.equal(job.status,'ready',job.reason);await send();
  const proposal=f.workspace.read().records[f.contact].proposals.at(-1);assert.equal(proposal.status,'sent');assert.equal(proposal.amount,127.5);
  job=await receive('Eu aceito a proposta.',ctx=>({...result('accept',ctx.latestMessage),intent:'acceptance',decision:{action:'accept',proposalId:ctx.confirmedOffer.id}}));assert.equal(job.status,'ready');await send();
  assert.equal(f.workspace.read().records[f.contact].proposals.at(-1).status,'accepted');assert.equal(f.workspace.read().records[f.contact].payments.length,0);
  const old=requests;await f.workspace.command(f.contact,{action:'mode',mode:'human'});await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Uma pergunta.',messageId:'manual-only',eligible:true});t.mock.timers.tick(16000);await new Promise(setImmediate);assert.equal(requests,old);
  await f.workspace.command(f.contact,{action:'facts',need:'Necessidade corrigida por Ronald.'});assert.equal(f.workspace.read().records[f.contact].projectAssessment,null);assert.equal(f.workspace.read().records[f.contact].projectDraft,null);
});
