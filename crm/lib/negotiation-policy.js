'use strict';

function normalizeNegotiationPolicy(raw){
  if(raw===undefined||raw===null)return null;
  const names=['initialMaxPercent','automaticMaxPercent','humanMinPercent','humanMaxPercent'];
  if(typeof raw!=='object'||Array.isArray(raw)||names.some(key=>!Number.isFinite(Number(raw[key]))))throw Object.assign(new Error('Política de negociação inválida.'),{statusCode:400});
  const policy=Object.fromEntries(names.map(key=>[key,Number(raw[key])]));
  if(policy.initialMaxPercent<0||policy.initialMaxPercent>policy.automaticMaxPercent||policy.automaticMaxPercent>50||policy.humanMinPercent<=policy.automaticMaxPercent||policy.humanMaxPercent<policy.humanMinPercent||policy.humanMaxPercent>50)throw Object.assign(new Error('Confira os limites de desconto automático e de negociação humana.'),{statusCode:400});
  return policy;
}

function discountStageIssue(discount,offer,business,record){
  const policy=business.negotiationPolicy;
  if(!policy||discount<=0)return '';
  if(discount>policy.automaticMaxPercent)return 'O pedido ultrapassa o limite automático. Ronald precisa assumir a negociação; a IA não pode oferecer nem prometer o desconto reservado a ele.';
  const quote=record.lastQuotedOffer;
  const sameBasis=item=>!offer.pricingBasisHash||item.pricingBasisHash===offer.pricingBasisHash;
  const quotedBase=quote?.id===offer.id&&quote.status==='quoted'&&Number.isFinite(quote.amount)&&sameBasis(quote);
  const sentProposals=(record.proposals||[]).filter(proposal=>proposal.catalogOfferId===offer.id&&proposal.status==='sent'&&sameBasis(proposal));
  if(!quotedBase&&!sentProposals.length)return 'Apresente primeiro o preço original, com envio confirmado, antes de negociar desconto.';
  const previousSent=quote?.id===offer.id&&quote.status==='quoted'&&Number(quote.discountPercent)>0&&sameBasis(quote)
    ||sentProposals.some(proposal=>Number(proposal.discountPercent)>0);
  if(discount>policy.initialMaxPercent&&!previousSent)return 'Comece dentro do limite inicial. O teto seguinte exige uma negociação anterior com desconto efetivamente enviado; rascunho não conta como envio.';
  return '';
}

module.exports={normalizeNegotiationPolicy,discountStageIssue};
