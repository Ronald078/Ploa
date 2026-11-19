'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SCENARIOS,pricingGuide,calibrateAssessment}=require('../lib/pricing-calibration');
const {scopeAction,resolveProjectOffer}=require('../lib/project-pricing');
const {buildContext}=require('../lib/conversation-context');
const {generateWithReview}=require('../lib/ai-result-review');
const raw=(requirements,type='site_system',dimension='contentManagement',level='moderate')=>({serviceType:type,work:'new',summary:requirements.join('; '),
  requirements:requirements.map(text=>({text,evidence:text})),drivers:[{dimension,level,evidence:requirements[0]}],technicalReview:false});
const ctx=assessment=>({language:'pt-BR',latestMessage:'Sim, é isso mesmo',history:assessment.requirements.map(r=>({role:'contato',text:r.text}))});
function priced(assessment,market='Brasil',currency='BRL',min=150,max=250){
  const response=scopeAction(assessment,ctx(assessment));assert.equal(response.status,'ready',response.reason);
  const offer={id:'fixture-site',serviceType:response.scopeDraft.serviceType,market,currency,amount:min,amountMax:max,pricingMode:'range',terms:'Condição de teste',deadline:'Prazo cadastrado',maintenance:'Mensalidade cadastrada'};
  const record={lastInbound:'confirmation',projectDraft:{...response.scopeDraft,status:'pending',sentAt:new Date().toISOString(),inbound:'request'}};
  return resolveProjectOffer(offer,record,ctx(assessment),{confirmScope:true},{projectPricing:{enabled:true}});
}

test('serviços públicos simples nos nichos não viram sistema por incluir edição de conteúdo',()=>{
  const examples=[
    ['Catálogo online de roupas','Painel para cadastrar peças e atualizar disponibilidade','Pedidos pelo WhatsApp'],
    ['Cardápio digital para restaurante','Editar fotos e preços dos pratos','Pedidos pelo WhatsApp'],
    ['Site para apresentar os serviços da barbearia','Atualizar fotos dos cortes','Pedidos de horário pelo WhatsApp'],
    ['Página para apresentar os serviços do salão','Cadastrar serviços e preços'],
    ['Site para mostrar os produtos do pet shop','Atualizar os produtos e a disponibilidade'],
    ['Site para apresentar modalidades da academia','Atualizar textos e preços dos planos'],
    ['Página para apresentar os tratamentos da clínica','Formulário de contato'],
    ['Portfolio com apresentação dos serviços','Localização e contato']
  ];
  for(const requirements of examples){
    const input=raw(requirements),before=JSON.stringify(input),result=scopeAction(input,ctx(input));
    assert.equal(result.status,'ready',result.reason);assert.equal(result.scopeDraft.serviceType,'site',requirements.join('|'));
    assert.ok(result.scopeDraft.drivers.every(d=>d.level==='basic'));assert.equal(JSON.stringify(input),before);
    assert.equal(priced(input).assessment.amount,150);
  }
});

test('caso aprovado do catálogo usa a oferta site nos quatro países, sem misturar moedas',()=>{
  const input=raw(['Catálogo público para consultar as peças disponíveis','Cadastrar produtos e atualizar disponibilidade no painel','Pedidos pelo WhatsApp']);
  for(const [market,currency,min,max]of [['Brasil','BRL',150,250],['Portugal','EUR',80,150],['Estados Unidos','USD',80,120],['Espanha','EUR',80,150]]){
    const result=priced(input,market,currency,min,max);
    assert.equal(result.assessment.serviceType,'site');assert.equal(result.assessment.amount,min);assert.equal(result.offer.currency,currency);
  }
});

test('cadastro apenas interno é sistema simples, não site nem pacote combinado',()=>{
  const input=raw(['Cadastro de contatos apenas interno, sem site','Consultar contatos e registrar observações']);
  const result=scopeAction(input,ctx(input));assert.equal(result.status,'ready');assert.equal(result.scopeDraft.serviceType,'system');
  assert.equal(result.scopeDraft.drivers[0].level,'basic');assert.equal(result.scopeDraft.calibration.rule,'private_records_system');
});

test('regras de agenda, estoque, checkout e permissões não recebem o preço de um catálogo manual',()=>{
  const examples=[
    ['Catálogo público','Checkout com carrinho e pagamento online'],
    ['Site público com agendamento','Cliente escolhe horário e painel valida conflitos de agenda'],
    ['Controle interno de estoque com cálculo automático de entradas e saídas'],
    ['Site com área do cliente e histórico de pedidos'],
    ['Site com permissões de acesso de usuários'],
    ['Site com gestão de conteúdo e aprovação editorial por versões']
  ];
  for(const requirements of examples){
    const input=raw(requirements,'site','businessRules');const result=calibrateAssessment(input,ctx(input));
    assert.equal(result.drivers[0].level,'moderate',requirements.join('|'));
    assert.notEqual(result.calibration?.rule,'public_content_site');
  }
  assert.equal(calibrateAssessment(raw(examples[0],'site'),ctx(raw(examples[0],'site'))).serviceType,'site_system');
});

test('dependência externa não confirmada impede preço fechado, sem inventar taxa ou valor',()=>{
  const input=raw(['Site com catálogo','Integração de pedidos com ERP via API'],'site_system','externalConnections');
  const scope=scopeAction(input,ctx(input));assert.equal(scope.status,'ready');assert.equal(scope.scopeDraft.technicalReview,true);
  const offer={id:'fixture',serviceType:'site_system',pricingMode:'range',amount:400,amountMax:800};
  const record={lastInbound:'confirm',projectDraft:{...scope.scopeDraft,inbound:'request',sentAt:new Date().toISOString(),status:'pending'}};
  assert.match(resolveProjectOffer(offer,record,ctx(input),{confirmScope:true},{projectPricing:{enabled:true}}).reason,/avaliação técnica/);
});

test('operação acrescentada sem prova vira esclarecimento, sem escopo ou preço',async()=>{
  const text='Quero um catálogo com painel para atualizar os produtos e a disponibilidade.';
  const assessment=raw(['Controle de estoque com cálculo automático de saldo'],'site_system','businessRules');
  assessment.requirements[0].evidence=text;assessment.drivers[0].evidence=text;
  const context={language:'pt-BR',latestMessage:text,history:[{role:'contato',text}],automation:{mode:'autonomous'},project:{},
    responseGuide:{id:'conversation_intake'},funnel:{phase:'requirements',allowScope:true,allowQuote:false}};
  const action=scopeAction(assessment,context);
  assert.equal(action.status,'ready');assert.equal(action.action,'reply');assert.equal(action.scopeDraft,undefined);
  let calls=0;const output=await generateWithReview({generate:async()=>{calls++;return{intent:'interested',evidence:text,reply:'',reason:'Fixture',nextStep:'Continuar',needsReview:false,
    decision:{action:'scope'},assessment,memory:[],usage:{input:10,output:10}};}},{},context);
  assert.equal(calls,1);assert.equal(output.decision.action,'reply');assert.equal(output.assessment,undefined);
  assert.match(output.reply,/apenas editar/);assert.equal((output.reply.match(/\?/g)||[]).length,1);
});

test('atualização e orçamento já confirmado não são recalculados como se fossem escopo novo',()=>{
  const input={...raw(['Catálogo online','Atualizar produtos no painel']),work:'update'};
  assert.deepEqual(calibrateAssessment(input,ctx(input)),input);
  const confirmed=priced(raw(['Catálogo online','Cadastrar produtos no painel']));
  const saved={...confirmed.assessment,amount:225},record={projectAssessment:saved};
  const catalog={...confirmed.offer,pricingMode:'range',amount:150,amountMax:250};
  const same=resolveProjectOffer(catalog,record,ctx(input),{}, {projectPricing:{enabled:true}});
  assert.ok(same.assessment,same.reason);
  assert.equal(same.assessment.amount,225);assert.equal(same.offer.amount,225);
});

test('o contexto recebe só as referências pertinentes e preserva as faixas comerciais',()=>{
  assert.equal(SCENARIOS.length,13);
  const guide=pricingGuide({history:[{role:'contato',text:'Quero um catálogo com painel para cadastrar produtos e pedir pelo WhatsApp.'}]});
  assert.ok(guide.examples.some(item=>item.id==='manual_catalog'));assert.ok(guide.examples.length<=3);
  assert.match(guide.principles,/não por palavras/);
  const lead={id:'5511000000000',numero:'5511000000000',pais:'Brasil',moeda:'BRL',categoria:'loja de roupa'};
  const context=buildContext(lead,{},[{direction:'in',text:'Quero um catálogo para mostrar as peças disponíveis e receber pedidos pelo WhatsApp.'}],{business:{projectPricing:{enabled:true},offers:[]}});
  assert.ok(context.automation.projectPricing.guide.examples.some(item=>item.id==='manual_catalog'));
});
