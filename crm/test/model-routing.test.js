'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createAiProvider}=require('../lib/ai-provider');
const {createModelRouter,routingStore,retryDelay,GROQ_MODELS}=require('../lib/model-routing');
const {createTokenRecorder,readTokenUsage}=require('../lib/ai-token-usage');
const {generateWithReview}=require('../lib/ai-result-review');
const {temporaryRoot,workspaceFixture}=require('./fixture-helpers');
const settings={provider:'groq',dataConsent:true,freeAccountConfirmed:true,modelFallback:true};
const credentials={available:true,load:()=>({groq:'fictional-api-key-for-test-only'}),save(){}};
const context={latestMessage:'Como funciona?',history:[{role:'contato',text:'Como funciona?'}],language:'pt-BR'};
const reply={intent:'question',reply:'Qual serviço você quer apresentar?',needsReview:false,reason:'Pergunta sobre o serviço.',evidence:'Como funciona?',nextStep:'Entender a necessidade.',decision:{action:'reply'},memory:[],assessment:null};
const success=()=>({ok:true,headers:new Headers(),json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}],usage:{prompt_tokens:10,completion_tokens:5}})});
const failure=(status=429,code='rate_limit_exceeded',retry='60')=>({ok:false,status,headers:new Headers(retry?{'retry-after':retry}:{}),json:async()=>({error:{code,message:'Rate limit reached.'}})});
function providerFor(fetchImpl,options={}){return createAiProvider({credentialStore:credentials,fetchImpl,...options});}

test('troca após 429 mantendo contexto, esquema e credencial; retorna uma única resposta',async()=>{
 const requests=[],provider=providerFor(async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return requests.length===1?failure():success();});
 let permits=0;try{
  const result=await provider.generate(settings,context,{beforeFallback:async()=>{permits++;return true;}});
  assert.equal(result.model,GROQ_MODELS[1].id);assert.equal(permits,1);assert.equal(requests.length,2);
  assert.deepEqual(requests[0].body.messages,requests[1].body.messages);assert.deepEqual(requests[0].body.response_format,requests[1].body.response_format);
  assert.equal(requests[0].headers.Authorization,requests[1].headers.Authorization);assert.equal(requests[1].body.reasoning_effort,'low');assert.equal(requests[1].body.include_reasoning,false);
  assert.equal(result.reply,reply.reply);assert.equal(provider.routingStatus(settings).models[0].status,'paused');
 }finally{provider.close();}
});
test('modelos esgotados entram em pausa; novas consultas não repetem chamadas até liberar',async()=>{
 let clock=100000,calls=0;const provider=providerFor(async()=>{calls++;return failure();},{now:()=>clock});
 try{await assert.rejects(provider.generate(settings,context),e=>e.routingUnavailable&&e.retryAfterMs===60000);assert.equal(calls,3);
  await assert.rejects(provider.generate(settings,context),e=>e.routingUnavailable&&e.noRequest);assert.equal(calls,3);
  clock+=61000;await assert.rejects(provider.generate(settings,context),e=>e.routingUnavailable);assert.equal(calls,6);
 }finally{provider.close();}
});
test('espera de cota longa usa a reserva antes de dormir ou gastar outra consulta no principal',async()=>{
 const models=[];const provider=providerFor(async(url,options)=>{models.push(JSON.parse(options.body).model);const response=success();if(models.length===1)response.headers=new Headers({'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'1h'});return response;},{waitImpl:async()=>{throw Error('Não deveria esperar.');}});
 try{await provider.generate(settings,context);const next=await provider.generate(settings,context);assert.equal(next.model,GROQ_MODELS[1].id);assert.deepEqual(models,[GROQ_MODELS[0].id,GROQ_MODELS[1].id]);}finally{provider.close();}
});
test('pausa permanece ao reabrir e só grava metadados dos modelos',t=>{
 const root=temporaryRoot(t),store=routingStore(root),now=100000,router=createModelRouter({now:()=>now,store});
 router.pause(GROQ_MODELS[0].id,60000,'quota');router.success(GROQ_MODELS[1].id);
 const next=createModelRouter({now:()=>now,store}).snapshot(settings);assert.equal(next.models[0].status,'paused');assert.equal(next.activeModel,GROQ_MODELS[1].id);
 const saved=fs.readFileSync(path.join(root,'ploa_rotacao_ia.json'),'utf8');assert.ok(!saved.includes('fictional-api-key'));assert.ok(!saved.includes(context.latestMessage));
});
test('chave inválida, bloqueio de conta e JSON inválido não disparam troca indiscriminada',async()=>{
 for(const [status,code] of [[401,'invalid_api_key'],[403,'forbidden'],[429,'insufficient_quota'],[400,'json_validate_failed']]){
  let calls=0;const provider=providerFor(async()=>{calls++;return failure(status,code);});
  try{await assert.rejects(provider.generate(settings,context));assert.equal(calls,1);}finally{provider.close();}
 }
});
test('troca desativada respeita a configuração sem acessar reservas',async()=>{
 let calls=0;const provider=providerFor(async()=>{calls++;return failure();});try{
  await assert.rejects(provider.generate({...settings,modelFallback:false},context));assert.equal(calls,1);assert.equal(provider.routingStatus({...settings,modelFallback:false}).models.length,1);
 }finally{provider.close();}
});
test('limite local bloqueia chamada adicional mesmo quando há modelos disponíveis',async()=>{
 let calls=0;const provider=providerFor(async()=>{calls++;return failure();});try{
  await assert.rejects(generateWithReview(provider,settings,context,{beforeRetry:async()=>false}),e=>e.localLimit);assert.equal(calls,1);
 }finally{provider.close();}
});
test('falha de servidor e retirada de modelo usam a reserva; parâmetros arbitrários não são aceitos',async()=>{
 for(const response of [failure(503),failure(400,'model_decommissioned')]){
  const models=[],provider=providerFor(async(url,options)=>{models.push(JSON.parse(options.body).model);return models.length===1?response:success();});
  try{const result=await provider.generate({...settings,model:'untrusted-model'},context);assert.equal(result.model,GROQ_MODELS[1].id);assert.equal(models[0],GROQ_MODELS[0].id);}finally{provider.close();}
 }
});
test('429 na classificação também preserva a estrutura e a reserva do limite',async()=>{
 let calls=0,permits=0;const provider=providerFor(async()=>{if(++calls===1)return failure();return{ok:true,headers:new Headers(),json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...reply,intent:'question'})}}]})};});
 try{const result=await provider.classify(settings,context,{beforeFallback:async()=>{permits++;return true;}});assert.equal(calls,2);assert.equal(permits,1);assert.equal(result.reply,undefined);}finally{provider.close();}
});
test('encerramento cancela a chamada sem enviar contexto a outra IA',async()=>{
 let entered,calls=0;const started=new Promise(resolve=>{entered=resolve;});
 const provider=providerFor(async(url,{signal})=>{calls++;entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Cancelled'),{name:'AbortError'})),{once:true}));});
 const work=provider.generate(settings,context);await started;provider.close();await assert.rejects(work,e=>e.cancelled);assert.equal(calls,1);
});
test('retry-after em segundos/data é respeitado, sem confundir TPM com TPD',()=>{
 assert.equal(retryDelay(new Headers({'retry-after':'3600'})),3600000);
 assert.equal(retryDelay(new Headers({'retry-after':new Date(120000).toUTCString()}),{},60000),60000);
 assert.equal(retryDelay(new Headers(),{error:{message:'Tokens per day (TPD) reached.'}}),3600000);
});
test('tokens de cada modelo ficam separados e zeram no dia correto ao usar cache',t=>{
 const root=temporaryRoot(t),recorder=createTokenRecorder(root);
 recorder.record({at:'2026-10-27T12:00:00Z',provider:'groq',model:GROQ_MODELS[0].id,input:100,output:20});
 recorder.record({at:'2026-10-27T12:00:00Z',provider:'groq',model:GROQ_MODELS[1].id,input:50,output:10});
 const report=readTokenUsage(root,{},Date.parse('2026-10-27T13:00:00Z'));assert.equal(report.today.total,180);assert.equal(report.byModel[0].today.total,120);assert.equal(report.byModel[1].today.total,60);
 const next=readTokenUsage(root,{},Date.parse('2026-10-28T13:00:00Z'));assert.equal(next.today.total,0);assert.equal(next.byModel[0].today.total,0);
});
test('painel salva a preferência sem alterar condições comerciais nem consentimento',async t=>{
 const f=workspaceFixture(t);await f.workspace.saveSettings({...settings,enabled:false,maxDailyRequests:2});
 const before=f.workspace.publicSnapshot();assert.equal(before.modelRouting.models.length,3);assert.equal(before.tokenUsage.quota.models.length,3);
 await f.workspace.saveSettings({modelFallback:false});const after=f.workspace.publicSnapshot();assert.equal(after.modelRouting.models.length,1);assert.deepEqual(after.settings.business,before.settings.business);assert.equal(after.settings.dataConsent,before.settings.dataConsent);
});
test('fila aguarda liberação dos modelos sem entrar em envio nem gastar consultas sem requisição',async t=>{
 const f=workspaceFixture(t,{text:'Como funciona?'});await f.workspace.saveSettings({...settings,apiKey:'fictional-api-key-for-test-only',enabled:true,maxDailyRequests:10});
 let calls=0;f.workspace.setProvider(providerFor(async()=>{calls++;return failure();}));
 await f.workspace.ingest({contact:f.contact,direction:'in',text:'Como funciona?',messageId:'routing-in',eligible:true});
 await f.workspace.mutate(data=>{data.jobs.at(-1).dueAt=0;});
 const end=Date.now()+5000;while(Date.now()<end&&calls<3)await new Promise(resolve=>setTimeout(resolve,30));await new Promise(resolve=>setTimeout(resolve,30));
 const snapshot=f.workspace.publicSnapshot(),job=snapshot.jobs.at(-1);assert.equal(calls,3);assert.equal(job.status,'queued');assert.equal(job.attempts,0);assert.equal(snapshot.usage.requests,3);assert.equal(snapshot.runtime.code,'models_paused');assert.equal(await f.workspace.nextDelivery(),null);
});
