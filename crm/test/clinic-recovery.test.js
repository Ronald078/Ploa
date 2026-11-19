'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildContext}=require('../lib/conversation-context');
const {generateWithReview,issueFor}=require('../lib/ai-result-review');
const {responseFormat,evidenceBindings,decodeEvidence}=require('../lib/ai-response-schema');
const {isGreeting}=require('../lib/conversation-funnel');
const {normalizeBusiness,decideAutonomous}=require('../lib/commercial-policy');
const {recoverConversation}=require('../lib/conversation-recovery');
const {workspaceFixture}=require('./fixture-helpers');
const lead={id:'5511999999999',numero:'5511999999999',pais:'Brasil',moeda:'BRL',status:'respondeu',classificacao_idioma:'pt-BR'};
const settings={responseMode:'autonomous',business:normalizeBusiness({allowAutoProposals:true,projectPricing:{enabled:true,method:'qualitative_factors_v1'},offers:[]})};
const request='Gostaria q o cliente escolhesse e fizesse sozinho e dps eu pudesse ter algo para administrar esses agendamentos';
const turns=[['in','Oii boa noite'],['in','Olá?'],['in','Gostaria de saber mais sobre os serviços'],['out','Qual é o seu negócio?'],['in','Tenho uma clínica e uso o Instagram para conseguir clientes e os levo para o WhatsApp.'],['out','O que gostaria de facilitar?'],['in','Não sei, oq vc sugere?'],['out','Muitas clínicas usam uma página simples para apresentar os serviços e facilitar o agendamento. Faz sentido para você?'],['in','Sim'],['out','O cliente escolhe o horário e confirma sozinho ou envia o pedido pelo WhatsApp?'],['in',request]];
const events=rows=>rows.map(([direction,text],i)=>({direction,text,actor:direction==='in'?'contact':'ai',at:new Date(Date.now()-60000+i*1000).toISOString()}));
const ctx=(rows,extra={})=>buildContext({...lead,...extra},{},events(rows),settings);
const result=(context,patch={})=>({reply:'',intent:'interested',evidence:context.latestMessage,reason:'Requisitos do cliente',nextStep:'Continuar',needsReview:false,decision:{action:'reply'},memory:[],usage:{input:20,output:5},model:'fixture',...patch});
const assessment=evidence=>({serviceType:'site_system',work:'new',summary:'Agendamento em que o cliente escolhe o horário e um painel para administrar a agenda.',requirements:[{text:'Agendamento pelo próprio cliente',evidence},{text:'Painel para administrar os agendamentos',evidence:request}],drivers:[{dimension:'businessRules',level:'moderate',evidence:request}],technicalReview:false});

test('saudações do cenário são reconhecidas sem transformar outros pedidos em saudação',()=>{
 for(const text of ['Oii boa noite','Olá?','Oi!','Hello?','Hola.','Boa noite!'])assert.equal(isGreeting(text),true,text);
 for(const text of ['Não quero contato','Quero pagar','Oi, quero um sistema','???'])assert.equal(isGreeting(text),false,text);
});
test('clínica declarada pelo cliente prevalece sobre categoria antiga e recebe ideia concreta',()=>{
 const context=ctx(turns.slice(0,7),{categoria:'Restaurante'});
 assert.equal(context.funnel.category,'clinica');assert.equal(context.funnel.ideaRequested,true);
 assert.match(context.funnel.ideaReply,/Posso criar um site/);assert.match(context.funnel.nextStep,/solução|construir/);
 assert.match(issueFor(result(context,{reply:turns[7][1]}),context),/solução/);
 assert.equal(issueFor(result(context,{reply:context.funnel.ideaReply}),context),null);
});
test('resposta rejeitada a saudação se recupera sem outra consulta ou abandono do contato',async()=>{
 for(const text of ['Oii boa noite','Olá?']){
  const context=ctx([['in',text]]);let calls=0;
  const output=await generateWithReview({generate:async()=>{calls++;return result(context,{intent:'refusal',decision:{action:'close'},reply:''});}},settings,context);
  assert.equal(calls,1);assert.equal(output.decision.action,'reply');assert.equal(output.needsReview,false);assert.equal(output.reply.match(/\?/g).length,1);
  assert.equal(decideAutonomous(output,settings,lead,{proposals:[]},context).status,'ready');
 }
});
test('pedido de ideia tem solução e escolha útil nos quatro idiomas, sem prova inventada',async()=>{
 for(const [language,business,question] of [['pt-BR','Tenho uma clínica e atendo pelo WhatsApp.','Não sei, oq vc sugere?'],['pt-PT','Tenho uma clínica.','O que sugere?'],['en-US','I run a clinic.','What do you suggest?'],['es-ES','Tengo una clínica.','¿Qué sugieres?']]){
  const context=ctx([['in',business],['out','Como quer melhorar?'],['in',question]],{classificacao_idioma:language});let calls=0;
  const output=await generateWithReview({generate:async()=>{calls++;return result(context,{reply:'Muitas clínicas usam uma página simples. Faz sentido para você?'});}},settings,context);
  assert.equal(calls,1);assert.ok(output.reply);assert.ok(!/muitas clinicas/i.test(output.reply));assert.equal(output.decision.action,'reply');assert.equal(output.needsReview,false);
  assert.equal((output.reply.match(/\?/g)||[]).length,1);assert.ok(output.reply.trim().split(/\s+/).length<=55);
 }
});
test('evidências de escopo excluem saudação e Sim, mantendo os requisitos reais e a memória',()=>{
 const context=ctx(turns),schema=responseFormat(context).json_schema.schema.properties;
 const bindings=evidenceBindings(context),yes=bindings.find(e=>e.text==='Sim').id,last=bindings.find(e=>e.text===request).id;
 const refs=schema.assessment.properties.requirements.items.properties.evidence.enum;
 assert.ok(!refs.includes(yes));assert.ok(refs.includes(last));assert.ok(schema.memory.items.properties.evidence.enum.includes(yes));
 const decoded=decodeEvidence({assessment:assessment(last),memory:[]},context);
 assert.equal(decoded.assessment.requirements[0].evidence,request);
 assert.equal(issueFor(result(context,{decision:{action:'scope'},assessment:decoded.assessment}),context),null);
});
test('confirmação de uma solução é distinta de Sim a uma escolha entre duas opções',()=>{
 const accepted=ctx([['in','Tenho uma clínica.'],['out','Posso criar uma página para apresentar os serviços e organizar os agendamentos. Isso ajudaria no atendimento?'],['in','Sim']]);
 assert.equal(accepted.funnel.affirmedIdea,true);
 const ambiguous=ctx([['in','Tenho uma clínica.'],['out','Posso criar um site com os serviços. Prefere que o paciente marque sozinho ou envie um pedido pelo WhatsApp?'],['in','Sim']]);
 assert.equal(ambiguous.funnel.affirmedIdea,false);assert.equal(ambiguous.funnel.allowScope,false);
});
test('correção de evidência válida registra scope e preserva o consumo das duas tentativas',async()=>{
 const context=ctx(turns);let calls=0;
 const output=await generateWithReview({generate:async()=>result(context,{decision:{action:'scope'},assessment:assessment(++calls===1?'Sim':request)})},settings,context);
 assert.equal(calls,2);assert.equal(output.decision.action,'scope');assert.equal(output.needsReview,false);assert.deepEqual(output.usage,{input:40,output:10});
 assert.equal(decideAutonomous(output,settings,lead,{proposals:[]},context).status,'ready');
});
test('evidência inválida repetida dá continuidade com uma clarificação, sem inventar escopo ou preço',async()=>{
 const context=ctx(turns);let calls=0;
 const output=await generateWithReview({generate:async()=>{calls++;return result(context,{decision:{action:'scope'},assessment:assessment('Sim')});}},settings,context);
 assert.equal(calls,2);assert.equal(output.decision.action,'reply');assert.match(output.reply,/painel.*administrar a agenda/);assert.match(output.reply,/algum sistema/);
 assert.equal(output.needsReview,false);assert.equal(output.timing.recovered,true);assert.equal(output.reply.match(/\?/g).length,1);assert.ok(!/R\$|€|\d+/.test(output.reply));
});
test('recuperação não contorna pedido humano, recusa, pagamento ou revisão de integração',()=>{
 for(const guide of ['human_request','payment','attachment','virtual_assistant'])assert.equal(recoverConversation({...ctx([['in','Olá?']]),responseGuide:{id:guide}},'erro'),null);
 assert.equal(recoverConversation(ctx([['in','Não quero mais contato']]),'erro',{scope:true}),null);
 const context=ctx([...turns.slice(0,-1),['in','Quero integrar os agendamentos ao Google Calendar.']]);
 assert.equal(recoverConversation(context,'Um requisito não tem evidência válida.',{scope:true}),null);
});
test('fila do cenário consegue produzir uma resposta útil após falha de escopo, sem envio real',async t=>{
 const f=workspaceFixture(t,{text:request});await f.workspace.saveSettings({...settings,provider:'groq',enabled:true,dataConsent:true,freeAccountConfirmed:true,apiKey:'fixture-not-a-real-api-key'});
 let calls=0;f.workspace.setProvider({hasKey:()=>true,close(){},generate:async(s,context)=>{calls++;return result(context,{decision:{action:'scope'},assessment:assessment('Sim')});}});
 await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:request,messageId:'clinic-function',eligible:true});await f.workspace.mutate(data=>{data.jobs.at(-1).dueAt=0;});
 const end=Date.now()+5000;let delivery;while(Date.now()<end){delivery=await f.workspace.nextDelivery();if(delivery)break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(delivery);assert.match(delivery.text,/administrar a agenda/);assert.equal(calls,2);assert.equal(f.workspace.read().records[f.contact].projectDraft,undefined);
});
