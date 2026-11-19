'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildContext}=require('../lib/conversation-context');
const {responseFormat}=require('../lib/ai-response-schema');
const {issueFor}=require('../lib/ai-result-review');
const {generateWithReview}=require('../lib/ai-result-review');
const {examples}=require('../lib/conversation-funnel');
const lead={id:'5511999999999',numero:'5511999999999',nome:'Empresa fictícia',pais:'Brasil',moeda:'BRL',status:'respondeu',classificacao_idioma:'pt-BR'};
const events=(...turns)=>turns.map(([direction,text],i)=>({direction,text,actor:direction==='out'?'script':'contact',at:new Date(1792970000000+i*1000).toISOString()}));
const context=(text,extra={},record={})=>buildContext({...lead,...extra},record,events(['in',text]),{});
const result=(ctx,action='reply',reply='Claro! Que tipo de negócio você tem?')=>({reply,decision:{action},evidence:ctx.latestMessage,needsReview:false});

test('pedido genérico inicia diagnóstico e bloqueia escopo e proposta de um projeto antigo',()=>{
  const old={projectDraft:{status:'pending',serviceType:'site_system',summary:'Loja antiga',requirements:[{text:'Estoque'}]},projectAssessment:{requirements:[],summary:'Loja antiga'}};
  const ctx=context('Olá, boa tarde. Gostaria de fazer um projeto para meu negócio.',{},old),actions=responseFormat(ctx).json_schema.schema.properties.decision.properties.action.enum;
  assert.equal(ctx.funnel.phase,'opening');assert.equal(ctx.funnel.isReopening,true);assert.ok(!actions.includes('scope'));assert.ok(!actions.includes('proposal'));assert.ok(!actions.includes('quote'));
  assert.equal(ctx.project.pending,null);assert.equal(ctx.project.confirmed,null);assert.equal(ctx.confirmedOffer,null);assert.deepEqual(ctx.memory,{});
  assert.match(issueFor(result(ctx,'scope'),ctx),/abertura/);
});
test('as oito categorias nos quatro idiomas têm referência de continuidade sem preço ou promessa',()=>{
  for(const category of Object.keys(examples))for(const language of ['pt-BR','pt-PT','en-US','es-ES']){
    const ctx=buildContext({...lead,categoria:category,classificacao_idioma:language},{},events(['out','Como apresentam o negócio aos novos clientes?'],['in','Instagram / WhatsApp']),{});
    assert.equal(ctx.funnel.phase,'discovery');assert.equal(ctx.funnel.allowScope,false);assert.equal(ctx.funnel.categoryKnown,true);
    assert.ok(ctx.funnel.examples.length>=1);assert.deepEqual(ctx.funnel.knownChannels,['instagram','whatsapp']);
    assert.ok(ctx.funnel.examples.every(item=>!/(?:R\$|€|\d+%|garantid|guaranteed)/.test(item.reply)));
  }
});
test('tipo do negócio já informado muda a pergunta para o objetivo',()=>{
  const ctx=context('Tenho uma loja e gostaria de fazer um site.');assert.equal(ctx.funnel.categoryKnown,true);assert.match(ctx.funnel.nextStep,/o que a pessoa quer/);
  const known=context('Gostaria de fazer um projeto para o meu negócio.',{categoria:'barbearia'});assert.equal(known.funnel.categoryKnown,true);
  const described=buildContext(lead,{},events(['in','Gostaria de fazer um projeto.'],['out','Claro! Que tipo de negócio você tem?'],['in','Tenho uma barbearia.']),{});
  assert.equal(described.funnel.category,'barbearia');assert.equal(described.funnel.phase,'opening');assert.match(described.funnel.nextStep,/o que a pessoa quer/);
});
test('loja online já é objetivo: falta esclarecer a compra e não perguntar de novo o objetivo',()=>{
  const ctx=context('Tenho uma loja de roupas e quero fazer uma loja online.',{categoria:'loja de roupa'});
  assert.equal(ctx.funnel.phase,'requirements');assert.equal(ctx.funnel.allowScope,false);assert.match(ctx.funnel.nextStep,/compra no site|pedido pelo WhatsApp/);
});
test('pedido funcional claro permite resumir sem exigir todas as perguntas do diagnóstico',()=>{
  const ctx=context('Quero um site para apresentar os serviços e receber pedidos pelo WhatsApp.');
  assert.equal(ctx.funnel.allowScope,true);assert.ok(responseFormat(ctx).json_schema.schema.properties.decision.properties.action.enum.includes('scope'));
});

test('objetivo descrito como resultado visível não reinicia o diagnóstico',()=>{
  for(const [language,text]of [
    ['pt-BR','Tenho uma loja de roupas e queria que os clientes vissem as peças disponíveis sem eu precisar conferir tudo pelo WhatsApp. Você consegue me ajudar?'],
    ['pt-PT','Tenho uma loja de roupa e gostava que os clientes vissem as peças disponíveis.'],
    ['en-US',"I have a clothing store and I'd like customers to see the available items."],
    ['es-ES','Tengo una tienda de ropa y me gustaría que los clientes vieran las prendas disponibles.']]){
    const ctx=context(text,{classificacao_idioma:language});
    assert.equal(ctx.funnel.phase,'requirements',text);
    assert.equal(ctx.funnel.allowScope,false,text);
    assert.equal(ctx.funnel.needsFunctionalChoice,true,text);
    assert.equal(ctx.funnel.allowQuote,false,text);
    assert.equal(ctx.funnel.solutionDue,true,text);
    assert.match(ctx.funnel.nextStep,/possibilidade concreta/);
  }
});

test('escolha futura libera resumo; informar o WhatsApp atual não escolhe a solução',()=>{
  const goal='Tenho uma loja de roupas e queria que os clientes vissem as peças disponíveis.';
  const ask='Posso montar um catálogo com as peças. Você prefere receber os pedidos pelo WhatsApp ou concluir a compra no site?';
  for(const proposal of [ask,'Dá para montar um catálogo para o cliente conhecer as opções. A ideia é manter os pedidos por WhatsApp ou comprar no site?']){
    const future=buildContext(lead,{},events(['in',goal],['out',proposal],['in','Pelo WhatsApp']),{});
    assert.equal(future.funnel.needsFunctionalChoice,false);assert.equal(future.funnel.allowScope,true);
  }
  const here=buildContext(lead,{},events(['in',goal],['out','Dá para organizar isso num catálogo. A ideia é manter os pedidos por aqui ou comprar no site?'],['in','Por aqui mesmo']),{});
  assert.equal(here.funnel.allowScope,true);
  const current=buildContext(lead,{},events(['in',goal],['out','Como vocês recebem pedidos hoje?'],['in','Pelo WhatsApp']),{});
  assert.equal(current.funnel.needsFunctionalChoice,true);assert.equal(current.funnel.allowScope,false);
});

test('reprodução da conversa real rejeita mais uma pergunta de rotina',()=>{
  const history=events(
    ['in','Tenho uma loja de roupas e queria que os clientes vissem as peças disponíveis sem eu precisar conferir tudo pelo WhatsApp. Você consegue me ajudar?'],
    ['out','Hoje, quando uma peça entra ou sai do estoque, como você faz para deixar isso visível?'],
    ['in','Não tenho essa forma de deixar visível'],
    ['out','Quando alguém pede uma peça, como vocês fecham o pedido hoje?'],
    ['in','Confirmo se tem a peça desejada, informo, eles realizam o pagamento e coloco para envio'],
    ['out','O que mais trava você: confirmar a peça ou organizar o envio?'],
    ['in','Um pouco dos dois']);
  const ctx=buildContext(lead,{},history,{});
  assert.equal(ctx.funnel.phase,'requirements');
  assert.equal(ctx.funnel.solutionDue,true);
  for(const text of ['Entendi. Quando o cliente paga, como você organiza o envio hoje?','O que mais toma seu tempo: montar o pedido ou acompanhar o recebimento?']){
    assert.match(issueFor(result(ctx,'reply',text),ctx),/possibilidade concreta/);
  }
  assert.equal(issueFor(result(ctx,'reply','Posso montar um catálogo para o cliente escolher as peças e preparar o pedido. Você prefere receber esse pedido pelo WhatsApp?'),ctx),null);
  assert.match(issueFor(result(ctx,'reply','Posso criar uma integração com Instagram para atualizar a disponibilidade automaticamente.'),ctx),/Não foi solicitada/);
});

test('duas perguntas sem intenção de projeto pedem uma sugestão, sem liberar escopo ou preço',()=>{
  const ctx=buildContext({...lead,categoria:'barbearia'},{},events(
    ['out','Como apresentam os serviços?'],['in','Instagram'],
    ['out','Como recebem os pedidos de horário?'],['in','Pelo WhatsApp']),{});
  assert.equal(ctx.funnel.solutionDue,true);
  assert.equal(ctx.funnel.allowScope,false);
  assert.equal(ctx.funnel.allowQuote,false);
  assert.equal(issueFor(result(ctx,'reply','Uma possibilidade é um site com seus serviços e um botão para pedir horário pelo WhatsApp. Isso ajudaria?'),ctx),null);
});

test('clínica genérica também recebe orientação sem exigir uma subcategoria cadastrada',()=>{
  const ctx=context('Tenho uma clínica e queria que os pacientes vissem os serviços antes de entrar em contato.');
  assert.equal(ctx.funnel.category,'clinica');
  assert.equal(ctx.funnel.solutionDue,true);
});

test('modelo que repete diagnóstico ou inventa recusa é recuperado sem nova consulta',async()=>{
  const history=events(['in','Tenho uma loja de roupas e queria que os clientes vissem as peças disponíveis.'],
    ['out','Como recebem pedidos hoje?'],['in','Pelo WhatsApp'],['out','O que mais toma tempo?'],['in','Um pouco dos dois']);
  const settings={responseMode:'autonomous'};
  const ctx=buildContext(lead,{},history,settings);
  for(const patch of [
    {reply:'Entendi. Como você organiza o envio hoje?',intent:'question',decision:{action:'reply'}},
    {reply:'',intent:'refusal',decision:{action:'close'}}]){
    let calls=0;const provider={generate:async()=>{calls++;return{...result(ctx),...patch,usage:{input:100,output:20},reason:'Modelo simulado',nextStep:'Continuar',memory:[]};}};
    const output=await generateWithReview(provider,settings,ctx);
    assert.equal(calls,1);assert.equal(output.decision.action,'reply');assert.equal(output.needsReview,false);
    assert.match(output.reply,/catálogo/);assert.match(output.reply,/WhatsApp|por aqui/);assert.match(output.reply,/site/);assert.equal((output.reply.match(/\?/g)||[]).length,1);
    assert.ok(output.reply.split(/\s+/).length<=40);assert.equal(output.assessment,undefined);
    assert.equal(issueFor(output,ctx),null);
  }
});

test('preços dos produtos e serviços do cliente não são pedido de orçamento do projeto',()=>{
 for(const [language,text]of [['en-US','I want people to see our services and prices before contacting us.'],['es-ES','Quiero mostrar los tratamientos y el precio de cada uno.'],['pt-PT','Gostava de mostrar a ementa e os preços dos pratos.']]){
  const ctx=context(text,{classificacao_idioma:language});assert.equal(ctx.funnel.allowQuote,false,text);
 }
 for(const text of ['Quanto custa esse site?','What is your price?','How much would this website cost?','¿Cuál es el precio?','¿Precio?'])assert.equal(context(text).funnel.allowQuote,true,text);
});
test('aceitar ideia futura permite avançar, confirmar processo atual não confirma um projeto',()=>{
  const make=text=>buildContext({...lead,categoria:'loja de roupa'},{},events(['out',text],['in','Quero sim']),{});
  const idea=make('Uma possibilidade é um catálogo para escolher peças e montar o pedido. Isso ajudaria no atendimento?');
  assert.equal(idea.funnel.affirmedIdea,true);assert.equal(idea.funnel.allowScope,true);
  const process=make('O cliente encontra as peças no Instagram e pede pelo WhatsApp?');assert.equal(process.funnel.affirmedIdea,false);assert.equal(process.funnel.allowScope,false);
});
test('a primeira copy permanece identificada mesmo após sair da janela dos últimos turnos',()=>{
  const history=events(['out','Primeira copy para Empresa fictícia, 5511999999999 e https://example.com'],...Array.from({length:14},(_,i)=>[i%2?'out':'in','Turno '+i]));
  const ctx=buildContext(lead,{},history,{});assert.equal(ctx.history.length,12);assert.match(ctx.funnel.openingMessage,/Primeira copy/);
  assert.ok(!ctx.funnel.openingMessage.includes('5511999999999'));assert.ok(!ctx.funnel.openingMessage.includes('https://'));
});
test('resposta longa, múltiplas perguntas e encaminhamento desnecessário são rejeitados antes do envio',()=>{
  const ctx=context('Gostaria de fazer um projeto para meu negócio.');
  assert.match(issueFor(result(ctx,'reply','Uma longa apresentação do serviço. '.repeat(15)),ctx),/longa/);
  assert.match(issueFor(result(ctx,'reply','Qual o negócio? O que precisa?'),ctx),/uma pergunta/);
  assert.match(issueFor(result(ctx,'handoff'),ctx),/informação comum/);
  assert.equal(issueFor(result(ctx),ctx),null);
});
