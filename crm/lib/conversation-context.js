'use strict';
const {createHash}=require('node:crypto');
const {selectGuide,normalize}=require('./sales-playbook');
const {projectContext}=require('./project-pricing');
const {selectVoiceExample}=require('./sales-voice');
const {eligibleOffers,MEMORY_FIELDS}=require('./commercial-policy');
const {budgetFor,quoteBasis,negotiationBounds}=require('./negotiation-budget');
const {funnelContext}=require('./conversation-funnel');
const {pricingGuide}=require('./pricing-calibration');
const defaults=require('./ai-default-guidance.json');
const known=new Set(Object.values(defaults).flat());
const cut=(value,max=16000)=>String(value??'').trim().slice(0,max);

function filterText(value,identities=[]){
  let text=cut(value);
  for(const identity of identities.filter(Boolean).sort((a,b)=>String(b).length-String(a).length)){
    if(String(identity).length<3)continue;
    text=text.replace(new RegExp(String(identity).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'[CONTATO]');
  }
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
    .replace(/(?:https?:\/\/|www\.)\S+/gi,'[LINK]').replace(/\+?\d[\d ().-]{6,}\d/g,'[NUMERO]');
}
// Apenas parágrafos padrão idênticos são substituídos pelas regras compactas e catálogo.
// Qualquer instrução criada ou alterada pelo usuário permanece inteira.
function customGuidance(text){
  return String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!known.has(createHash('sha256').update(line).digest('hex'))).join('\n');
}
function buildContext(lead,record,events,settings){
  const safe=text=>filterText(text,[lead.id,lead.numero,lead.nome,settings.business?.paymentDetails?.pixKey,settings.business?.paymentDetails?.pixRecipient]);
  const turns=events.filter(e=>['in','out'].includes(e.direction)&&e.text)
    .slice().sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)).slice(-12);
  const history=turns.map(e=>({role:e.direction==='in'?'contato':'Ronald',text:safe(e.text).slice(0,1200)}));
  const last=history.filter(e=>e.role==='contato').at(-1)?.text||safe(lead.ultima_mensagem);
  const language=lead.classificacao_idioma||(/^351/.test(lead.numero)?'pt-PT':/^34/.test(lead.numero)?'es-ES':/^1/.test(lead.numero)?'en-US':'pt-BR');
  const words=new Set(normalize(last).match(/[a-z]{4,}/g)||[]);
  const examples=(settings.examples||[]).filter(e=>!e.language||e.language===language)
    .map(e=>({e,score:(normalize(e.question).match(/[a-z]{4,}/g)||[]).filter(w=>words.has(w)).length}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,2)
    .map(({e})=>({situation:safe(e.question).slice(0,300),answer:safe(e.answer).slice(0,650)}));
  const catalog=eligibleOffers(settings.business,lead).slice(0,3);
  const common={};
  for(const key of ['scope','terms','deadline','maintenance'])if(catalog.length&&catalog.every(o=>o[key]===catalog[0][key]))common[key]=safe(catalog[0][key]);
  const offers=catalog.map(item=>{
    const value={id:item.id,serviceType:item.serviceType,title:safe(item.title),currency:item.currency,amount:item.amount,amountMax:item.amountMax,pricingMode:item.pricingMode,maxDiscountPercent:item.maxDiscountPercent};
    for(const key of ['scope','terms','deadline','maintenance'])if(!Object.hasOwn(common,key))value[key]=safe(item[key]);
    return value;
  });
  const remembered=Object.fromEntries(Object.entries(record.memory||{}).filter(([key])=>MEMORY_FIELDS.includes(key))
    .map(([key,item])=>[key,{value:safe(item.value),evidence:safe(item.evidence),sourceAt:item.sourceAt}]));
  const sentAt=item=>Date.parse(item.quotedAt||item.acceptedAt||item.sentAt||item.updatedAt||item.createdAt||'')||0;
  const offer=[record.lastQuotedOffer,...(record.proposals||[]).filter(p=>['sent','accepted'].includes(p.status))]
    .filter(Boolean).sort((a,b)=>sentAt(a)-sentAt(b)).at(-1);
  const policy=settings.business?.negotiationPolicy;
  const negotiationBudget=budgetFor(record,last);
  const authorizedBudget=negotiationBounds(record,catalog,policy,negotiationBudget);
  const context={
    language,country:lead.pais,category:lead.categoria,stage:lead.status,
    history,latestMessage:last,
    // Mantém a pergunta anterior explicitamente, inclusive para confirmações curtas.
    lastAssistantMessage:[...history].reverse().find(e=>e.role==='Ronald')?.text||'',
    responseGuide:selectGuide(last,language),voiceExample:selectVoiceExample(last,language),
    project:projectContext(record,safe),
    confirmedFacts:Object.fromEntries(['need','objection','agreed','nextStep'].map(k=>[k,safe(record.facts?.[k])])),
    confirmedOffer:offer?{id:offer.id,catalogOfferId:offer.catalogOfferId||offer.id,title:safe(offer.title),scope:safe(offer.scope),terms:safe(offer.terms),amount:offer.amount,discountPercent:Number(offer.discountPercent)||0,pricingMode:offer.pricingMode||'fixed',amountMin:offer.amountMin,amountMax:offer.amountMax,currency:offer.currency,status:offer.status}:null,
    memory:remembered,
    negotiation:{budgetAsked:record.negotiationQuestion?.basis===quoteBasis(record.lastQuotedOffer)&&Boolean(record.negotiationQuestion?.askedAt),
      budget:negotiationBudget?{amount:negotiationBudget.amount,currency:negotiationBudget.currency,evidence:safe(negotiationBudget.evidence)}:null,
      ...(authorizedBudget?{authorized:authorizedBudget}:{})},
    automation:{mode:settings.responseMode,allowAutoProposals:settings.business?.allowAutoProposals===true,allowAutoAcceptance:settings.business?.allowAutoAcceptance===true,
      allowUnlimitedInScopeChanges:settings.business?.allowUnlimitedInScopeChanges===true,
      negotiationPolicy:policy?{initialMaxPercent:policy.initialMaxPercent,automaticMaxPercent:policy.automaticMaxPercent}:null,
      projectPricing:settings.business?.projectPricing||null,pixAvailable:lead.pais==='Brasil'&&lead.moeda==='BRL'&&Boolean(settings.business?.paymentDetails?.pixKey),rules:safe(customGuidance(settings.business?.guidance)),offers,commercialTerms:common},
    instructions:safe(customGuidance(settings.guidance)),confirmedServices:safe(customGuidance(settings.services)),approvedExamples:examples
  };
  if(/^(?:isso|isto|sim|exatamente|certo|yes|right|exactly|si|sí|correcto)(?:\b|[,.!])/i.test(last.trim())&&last.length<100&&context.lastAssistantMessage){
    context.responseGuide={id:'contextual_confirmation',requiresReview:false,
      strategy:context.project.pending?'Confira qual resumo foi confirmado e avance conforme o pedido; não peça para confirmar de novo.':'A pessoa respondeu à última pergunta do atendimento. Confirmar o processo atual não contrata uma solução. Apresente uma possibilidade prática, sem integrações ou estoque automático presumidos, e esclareça apenas a escolha funcional que falta. Não repita o fluxo nem apresente um menu de site/sistema.'};
  }
  const opening=events.filter(e=>e.direction==='out'&&e.text).find(e=>e.actor==='script')||events.find(e=>e.direction==='out'&&e.text);
  context.funnel=funnelContext({category:lead.categoria,language,history,record,openingMessage:safe(opening?.text).slice(0,700)});
  if(context.automation.projectPricing?.enabled&&(context.funnel.allowScope||context.funnel.allowQuote)){
    context.automation.projectPricing={...context.automation.projectPricing,guide:pricingGuide(context)};
  }
  if(context.funnel.isReopening){
    // Uma abertura genérica não confirma o projeto antigo. Ele segue salvo no CRM,
    // mas não é apresentado ao modelo como o pedido atual ainda não explicado.
    context.project={pending:null,confirmed:null};context.confirmedOffer=null;context.memory={};context.confirmedFacts={};
    context.negotiation={budgetAsked:false,budget:null};context.history=history.slice(history.map(e=>e.role).lastIndexOf('contato'));
    context.lastAssistantMessage='';context.funnel.openingMessage='';
  }
  if(['opening','discovery'].includes(context.funnel.phase)){
    context.voiceExample=null;
    if(['unclear','instagram','send_information','need_confirmed'].includes(context.responseGuide.id))context.responseGuide={id:'conversation_intake',requiresReview:false,strategy:context.funnel.nextStep};
  }
  if(settings.accountIdentity){
    context.accountIdentity={name:safe(settings.accountIdentity.name),businessName:safe(settings.accountIdentity.businessName)};
    // Owner-derived examples are never a shared training set for another account.
    context.voiceExample=null;context.funnel.examples=[];
    const guide=context.responseGuide;
    context.responseGuide={id:guide.id,strategy:String(guide.strategy||'').replace(/\bRonald\b/g,'a pessoa responsável'),requiresReview:guide.requiresReview,...(guide.stopIntent?{stopIntent:guide.stopIntent}:{})};
    context.history=context.history.map(turn=>({...turn,role:turn.role==='contato'?'contato':'atendimento'}));
  }
  Object.defineProperty(context,'evidenceSources',{enumerable:false,value:[...context.history.filter(e=>e.role==='contato').map(e=>e.text),...Object.values(context.memory).map(e=>e.evidence).filter(Boolean)]});
  // Reduza referências opcionais antes de qualquer fato ou turno da conversa.
  if(JSON.stringify(context).length>12000){context.approvedExamples=[];context.voiceExample=null;}
  return context;
}
module.exports={buildContext,filterText,customGuidance};
