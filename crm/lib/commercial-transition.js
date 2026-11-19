'use strict';
const {confirmsScope}=require('./project-pricing');
const {eligibleOffers,decideAutonomous}=require('./commercial-policy');
const {budgetFor,discountForBudget,quoteBasis}=require('./negotiation-budget');
function confirmedScopeResult(settings,lead,record,context){
  const draft=record.projectDraft;
  if(settings.responseMode!=='autonomous'||context.automation?.manualRequest||!settings.business?.allowAutoProposals||!settings.business?.projectPricing?.enabled)return null;
  if(!draft||draft.status!=='pending'||!draft.sentAt||record.lastInbound===draft.inbound||!confirmsScope(context.latestMessage))return null;
  const message=String(context.latestMessage||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(?:tambem|also|ademas|acrescent\w*|adicion\w*|mud\w*|alter\w*|incluir|inclua|outra?\s+coisa|another|change)\b/.test(message))return null;
  const offer=eligibleOffers(settings.business,lead).find(item=>item.serviceType===draft.serviceType);
  if(!offer)return null;
  const formal=/\b(?:proposta|proposal|presupuesto)\b/.test(message);
  return{reply:'',intent:'interested',reason:'O cliente confirmou o resumo enviado. Avanço comercial validado pelo servidor, sem repetir a confirmação.',
    evidence:context.latestMessage.slice(0,600),nextStep:formal?'Apresentar proposta calculada.':'Apresentar valor e condições do projeto confirmado.',needsReview:false,
    decision:{action:formal?'proposal':'quote',offerId:offer.id,proposalId:'',discountPercent:0,confirmScope:true,reason:'Confirmação do escopo, não aceite de contrato.'},memory:[],
    model:'server-commercial-policy',usage:{input:0,output:0},timing:{quotaWaitMs:0,providerMs:0,attempts:0}};
}
function negotiationResult(settings,lead,record,context){
  const business=settings.business,policy=business?.negotiationPolicy,quote=record.lastQuotedOffer;
  if(settings.responseMode!=='autonomous'||context.automation?.manualRequest||!business?.allowAutoProposals||!policy
    ||quote?.status!=='quoted'||!Number.isFinite(quote.amount)||record.projectDraft?.status==='pending'
    ||(record.proposals||[]).some(p=>p.status==='accepted'))return null;
  // Apenas pedidos curtos e inequívocos. Condições, números ou mudança de escopo vão ao modelo.
  const message=String(context.latestMessage||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[?!.,]+/g,' ').replace(/\s+/g,' ').trim();
  const simple=[
    /^(?:(?:ok|mas|ainda) )?(?:teria|tem|ha) (?:algum |mais |um )?desconto(?: pra mim| para mim)?$/,
    /^(?:(?:voce|vc) )?(?:pode|consegue|conseguiria|poderia) (?:dar|fazer|aplicar|oferecer) (?:um |mais |algum )?desconto(?: pra mim| para mim)?$/,
    /^(?:achei|ficou|esta|ta) (?:um pouco |muito |bem |meio )?(?:caro|salgado)(?: o (?:valor|preco))?$/,
    /^(?:o (?:valor|preco) )?(?:ainda )?(?:ficou|esta|ta) (?:um pouco |muito |bem |meio )?(?:alto|caro|salgado)$/,
    /^(?:(?:ainda )?(?:achei|ficou|esta|ta|continua) (?:um pouco |muito |bem |meio )?(?:alto|caro|salgado) )?(?:(?:voce|vc) )?(?:pode|consegue|conseguiria|poderia) (?:melhorar|aumentar) (?:mais )?(?:o |esse |este )?desconto(?: pra mim| para mim)?$/,
    /^(?:is there|do you have|can you offer|could you offer) (?:a |any |another )?discount$/,
    /^(?:it s|it is|that s|that is|still) (?:a bit |too |very )?(?:expensive|pricey)$/,
    /^(?:(?:it s|it is|that s|that is) (?:still )?(?:a bit |too |very )?(?:expensive|pricey) )?(?:can|could) you (?:improve|increase) (?:the |this )?discount$/,
    /^(?:hay|tienes|tendrias) (?:algun |un |mas )?descuento$/,
    /^(?:puedes|podrias) (?:hacer|aplicar|ofrecer) (?:un |algun |mas )?descuento$/,
    /^(?:me parece|esta|sigue siendo) (?:un poco |muy |demasiado )?caro$/,
    /^(?:(?:me parece|esta|sigue siendo) (?:un poco |muy |demasiado )?caro )?(?:puedes|podrias) (?:mejorar|aumentar) (?:el |este )?descuento$/
  ];
  const budget=budgetFor(record,context.latestMessage);
  if(!budget&&record.negotiationQuestion?.basis===quoteBasis(quote)&&record.negotiationQuestion?.askedAt)return null;
  const freshBudget=budget?.evidence===String(context.latestMessage).slice(0,600);
  if(!simple.some(pattern=>pattern.test(message))&&!freshBudget)return null;
  const offer=eligibleOffers(business,lead).find(item=>item.id===quote.id);
  if(!offer)return null;
  const previous=Number(quote.discountPercent)||0;
  if(budget&&budget.amount>=quote.amount)return null;
  const base=quote.amount/(1-previous/100);
  const next=Math.min(offer.maxDiscountPercent,previous>0?policy.automaticMaxPercent:policy.initialMaxPercent,
    budget?discountForBudget(base,budget.amount):policy.initialMaxPercent);
  if(next<=previous)return null;
  const result={reply:'',intent:'objection',reason:budget?'Orçamento informado pelo cliente, dentro dos limites de negociação.':'Conhecer o orçamento antes de oferecer desconto.',
    evidence:context.latestMessage,nextStep:budget?'Avaliar uma condição a partir do orçamento informado.':'Perguntar o valor que o cliente tinha em mente.',needsReview:false,
    decision:{action:'quote',offerId:offer.id,proposalId:'',discountPercent:next,confirmScope:false,reason:'Percentual total sobre o preço original.'},memory:[],
    model:'server-commercial-policy',usage:{input:0,output:0},timing:{quotaWaitMs:0,providerMs:0,attempts:0}};
  // Reutiliza validações de catálogo, preço, escopo e envio. Não contorna as travas comerciais.
  return decideAutonomous(result,settings,lead,record,context).status==='ready'?result:null;
}
module.exports={confirmedScopeResult,negotiationResult};
