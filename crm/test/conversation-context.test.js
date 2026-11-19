'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildContext,createAiProvider}=require('../lib/ai-provider');
const {createRatePacer,durationMs}=require('../lib/provider-pacing');
const {customGuidance:custom}=require('../lib/conversation-context');
const {issueFor,generateWithReview}=require('../lib/ai-result-review');
const {responseFormat,evidenceBindings,decodeEvidence}=require('../lib/ai-response-schema');
const lead={id:'5511999999999',numero:'5511999999999',nome:'Pessoa Exemplo',pais:'Brasil',moeda:'BRL',classificacao_idioma:'pt-BR',status:'respondeu'};
const turns=[
  ['in','Quero uma loja online.'],['out','Como recebe pedidos hoje?'],['in','Pelo WhatsApp, eu confiro a peça.'],
  ['out','Uma loja pode mostrar as peças e organizar o pedido.'],['in','Quero algo mais automático.'],
  ['out','O cliente encontra pelo Instagram e fecha pelo WhatsApp?'],['in','Isso exatamente assim']
].map(([direction,text],i)=>({direction,text,at:new Date(1000000+i*1000).toISOString()}));
const offer=(id,serviceType)=>({id,serviceType,market:'Brasil',currency:'BRL',active:true,autoPresent:true,title:serviceType,scope:'Escopo confirmado',terms:'Integral ou 50% de entrada e 50% na entrega',deadline:'Prazo confirmado',maintenance:'Mensalidade confirmada',amount:150,amountMax:250,pricingMode:'range'});

test('duas perguntas de diagnóstico viram uma pergunta válida sem segunda consulta',async()=>{
 for(const [language,reply]of [['pt-BR','Vocês já têm um site? Quem atualiza os produtos?'],['pt-PT','Já têm um sítio para consultar a ementa? Quem a atualiza?'],['en-US','Do you already have a website? Who updates it?'],['es-ES','¿Ya tenéis una web? ¿Quién la actualiza?']]){
  const text='Gostava de organizar a informação dos serviços.',context={language,latestMessage:text,history:[],automation:{mode:'autonomous'},funnel:{phase:'discovery',allowScope:false,allowQuote:false},project:{},responseGuide:{id:'conversation_intake',requiresReview:false}};
  let calls=0;const provider={generate:async()=>{calls++;return{reply,intent:'question',evidence:text,reason:'Esclarecer a presença atual.',nextStep:'Entender o que já existe.',needsReview:false,decision:{action:'reply'},usage:{input:10,output:10}};}};
  const result=await generateWithReview(provider,{},context);assert.equal(calls,1);assert.equal((result.reply.match(/\?/g)||[]).length,1);assert.equal(result.needsReview,false);assert.equal(issueFor(result,context),null);
 }
});
test('mantém pergunta anterior e confirmação mesmo com instruções extensas',()=>{
  const settings={guidance:'INSTRUÇÃO PERSONALIZADA '.repeat(700),services:'SERVIÇO '.repeat(600),business:{guidance:'REGRA '.repeat(600),offers:[offer('a','site'),offer('b','system'),offer('c','site_system')]}};
  const ctx=buildContext(lead,{},turns,settings);
  assert.equal(ctx.history.length,turns.length);assert.equal(ctx.lastAssistantMessage,turns.at(-2).text);
  assert.equal(ctx.history.at(-1).text,'Isso exatamente assim');
  assert.match(ctx.instructions,/INSTRUÇÃO PERSONALIZADA/);assert.equal(ctx.automation.offers.length,3);
  assert.equal(ctx.automation.commercialTerms.terms,'Integral ou 50% de entrada e 50% na entrega');
});
test('compactação não altera eventos e mantém evidências locais fora do JSON externo',()=>{
  const original=JSON.stringify(turns),ctx=buildContext(lead,{memory:{need:{value:'Loja online',evidence:'Quero uma loja online.'}}},turns,{});
  assert.equal(JSON.stringify(turns),original);assert.ok(ctx.evidenceSources.includes('Quero uma loja online.'));
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(ctx)),'evidenceSources'),false);
  assert.equal(custom('Uma condição nova definida pelo usuário.'),'Uma condição nova definida pelo usuário.');
});
test('condições comuns são enviadas uma vez e valores dos três serviços são preservados',()=>{
  const offers=[offer('a','site'),{...offer('b','system'),amount:350},{...offer('c','site_system'),amount:400}];
  const ctx=buildContext(lead,{},turns,{business:{offers}});
  assert.deepEqual(ctx.automation.offers.map(o=>o.amount),[150,350,400]);
  assert.equal(JSON.stringify(ctx).split('Integral ou 50%').length-1,1);
});
test('continua filtrando os identificadores em histórico, exemplos e regras personalizadas',()=>{
  const text='Pessoa Exemplo em teste@example.com ou https://example.com e 5511999999999';
  const ctx=buildContext(lead,{},[{direction:'in',text}],{guidance:text});
  for(const value of [ctx.instructions,ctx.latestMessage]){
    assert.ok(!value.includes('Pessoa Exemplo'));assert.ok(!value.includes('teste@example.com'));assert.ok(!value.includes('5511999999999'));assert.ok(!value.includes('https://'));
  }
});
test('espera só o déficit de tokens, não a recomposição integral da cota',()=>{
  let now=0;const p=createRatePacer(()=>now);
  p.observe(new Headers({'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'1000','x-ratelimit-reset-tokens':'52.5s'}));
  assert.equal(p.waitMs(3000),15250);now=16000;assert.equal(p.waitMs(3000),0);
  assert.equal(durationMs('1m26.4s'),86400);
});
test('respeita Retry-After e não considera cota restante como cota esgotada',()=>{
  let now=0;const p=createRatePacer(()=>now);
  p.observe(new Headers({'x-ratelimit-limit-requests':'1000','x-ratelimit-remaining-requests':'996','x-ratelimit-reset-requests':'5m45.6s'}));
  assert.equal(p.waitMs(3000),0);assert.equal(p.retryAfter(new Headers({'retry-after':'2'}),3000),2000);
  assert.equal(p.waitMs(3000),2250);now=2300;assert.equal(p.waitMs(3000),0);
});
test('considera a cota de saída sem esperar o minuto inteiro',()=>{
  let now=0;const p=createRatePacer(()=>now,{outputTokensPerMinute:1000});p.consumeOutput(800);
  assert.equal(p.waitMs(100,400),12250);now=13000;assert.equal(p.waitMs(100,400),0);
});
const answer=reply=>({reply,intent:'question',evidence:'Isso exatamente assim',reason:'Continuidade',nextStep:'Avançar',needsReview:false,decision:{action:'reply'},memory:[],usage:{input:100,output:20}});
test('distingue pedido preparado no WhatsApp de promessa de integração ou estoque automático',()=>{
  const ctx=buildContext(lead,{},turns,{});
  assert.equal(issueFor(answer('O cliente escolhe as peças e envia o pedido pronto para o WhatsApp.'),ctx),null);
  assert.match(issueFor(answer('Integração com Instagram e WhatsApp para automatizar a disponibilidade.'),ctx),/Não foi solicitada/);
});
test('corrige uma tentativa inválida sem repetir o diagnóstico nem ignorar a cota',async()=>{
  const ctx=buildContext(lead,{},turns,{});let calls=0,retries=0;
  const provider={generate:async(settings,context)=>{calls++;if(calls===1)return answer('Integração com Instagram para automatizar a disponibilidade.');assert.match(context.repairInstructions,/Não foi solicitada/);return answer('Uma possibilidade é organizar as peças e receber o pedido preenchido no WhatsApp.');}};
  const result=await generateWithReview(provider,{},ctx,{beforeRetry:async()=>{retries++;return true;}});
  assert.equal(calls,2);assert.equal(retries,1);assert.equal(result.needsReview,false);assert.equal(result.usage.input,200);
  calls=0;await generateWithReview(provider,{},ctx,{beforeRetry:async()=>false});assert.equal(calls,1);
});
test('serializa cliente e atendimento em seus papéis corretos e exige evidência da mensagem atual',async()=>{
  let payload;const provider=createAiProvider({credentialStore:{available:true,load:()=>({groq:'fixture-not-a-real-api-key'}),save(){}},fetchImpl:async(url,options)=>{
    payload=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer('Uma possibilidade é organizar os pedidos.'))}}],usage:{prompt_tokens:1,completion_tokens:1}})};
  }});
  try{await provider.generate({provider:'groq',dataConsent:true,freeAccountConfirmed:true},buildContext(lead,{},turns,{}));
    assert.equal(payload.messages.at(-1).role,'user');assert.match(payload.messages.at(-1).content,/^\[c\d+\] Isso exatamente assim$/);assert.equal(payload.messages.at(-2).role,'assistant');
    assert.equal(JSON.parse(payload.messages[1].content).history,undefined);
    assert.deepEqual(payload.response_format.json_schema.schema.properties.evidence.enum,['Isso exatamente assim']);
  }finally{provider.close();}
});
test('referências de evidência apontam apenas para falas do contato e não autorizam resumir o fluxo como projeto',()=>{
  const ctx=buildContext(lead,{},turns,{}),refs=evidenceBindings(ctx);
  assert.equal(refs.some(e=>e.text===turns.at(-2).text),false);
  const value=decodeEvidence({memory:[{field:'need',value:'Loja',evidence:refs[0].id}]},ctx);
  assert.equal(value.memory[0].evidence,'Quero uma loja online.');
  const schema=responseFormat(ctx).json_schema.schema;
  assert.equal(schema.properties.decision.properties.action.enum.includes('scope'),false);
  assert.equal(schema.properties.assessment.type,'null');
  const functional=buildContext(lead,{},[{direction:'in',text:'Quero um site para apresentar os serviços e receber pedidos pelo WhatsApp.'}],{});
  assert.deepEqual(responseFormat(functional).json_schema.schema.properties.assessment.properties.requirements.items.properties.evidence.enum,evidenceBindings(functional).map(e=>e.id));
});
test('sem reservas, provedor mede espera e consulta sem consumir o tempo de rede na espera da cota',async()=>{
  let now=0,calls=0;const waits=[];
  const provider=createAiProvider({now:()=>now,waitImpl:async ms=>{waits.push(ms);now+=ms;},credentialStore:{available:true,load:()=>({groq:'fixture-not-a-real-api-key'}),save(){}},fetchImpl:async()=>{
    calls++;now+=200;return {ok:true,headers:new Headers({'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'60s'}),json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Uma opção pode facilitar os pedidos.',intent:'question',reason:'Continuidade',evidence:'Quero uma loja online.',nextStep:'Apresentar possibilidade',needsReview:false})}}],usage:{prompt_tokens:2000,completion_tokens:200}})};
  }});
  try{
    const settings={provider:'groq',dataConsent:true,freeAccountConfirmed:true,modelFallback:false},ctx=buildContext(lead,{},turns,{});
    await provider.generate(settings,ctx);const next=await provider.generate(settings,ctx);
    assert.equal(calls,2);assert.equal(waits.length,1);assert.ok(waits[0]<30000);assert.ok(next.timing.quotaWaitMs>0);assert.equal(next.timing.providerMs,200);
  }finally{provider.close();}
});
