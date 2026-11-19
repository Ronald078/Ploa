'use strict';
const {randomUUID}=require('node:crypto');
const {normalizeNegotiationPolicy,discountStageIssue}=require('./negotiation-policy');
const {SERVICE_TYPES,normalizeProjectPricing,scopeAction,resolveProjectOffer}=require('./project-pricing');
const {compactQuote}=require('./commercial-message');
const {normalizePaymentDetails,paymentAction}=require('./payment-flow');
const {budgetFor,budgetQuestionAction,discountForBudget,scopeBudgetAction}=require('./negotiation-budget');
const MARKETS={'Brasil':'pt-BR','Portugal':'pt-PT','Estados Unidos':'en-US','Espanha':'es-ES'};
const CURRENCIES=['BRL','EUR','USD'];
const MEMORY_FIELDS=['need','objection','decisionMaker','currentChannel','requirements','agreed','nextStep'];
const text=(value,max=1500)=>String(value??'').trim().slice(0,max);
const normalize=value=>text(value,16000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const fail=message=>Object.assign(new Error(message),{statusCode:400});
const defaults=()=>({offers:[],allowAutoProposals:false,allowAutoAcceptance:false,allowUnlimitedInScopeChanges:false,guidance:'Não inventar condições. Negociar somente dentro dos limites cadastrados. Pedidos especiais precisam de Ronald.'});

function normalizeBusiness(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.offers??[]))throw fail('Base comercial inválida.');
  if((raw.offers||[]).length>30)throw fail('Cadastre até 30 ofertas na base comercial.');
  const ids=new Set();
  const offers=(raw.offers||[]).map(item=>{
    if(!item||typeof item!=='object')throw fail('Oferta inválida.');
    const amount=Number(item.amount),discount=Number(item.maxDiscountPercent||0);
    if(!Number.isFinite(amount)||amount<=0||amount>10000000)throw fail('Informe um preço válido para cada oferta.');
    const pricingMode=item.pricingMode??'fixed';
    if(!['fixed','range'].includes(pricingMode))throw fail('Escolha preço definido ou faixa de preço.');
    const amountMax=pricingMode==='range'?Number(item.amountMax):amount;
    if(!Number.isFinite(amountMax)||amountMax<amount||amountMax>10000000)throw fail('O máximo da faixa deve ser igual ou maior que o mínimo.');
    if(!Number.isFinite(discount)||discount<0||discount>50)throw fail('O desconto autorizado deve ficar entre 0 e 50%.');
    if(!Object.hasOwn(MARKETS,item.market)||!CURRENCIES.includes(item.currency))throw fail('País ou moeda da oferta inválidos.');
    const serviceType=item.serviceType??'';
    if(serviceType&&!SERVICE_TYPES.includes(serviceType))throw fail('Tipo de solução inválido na oferta.');
    if(pricingMode==='range'&&raw.projectPricing?.enabled&&item.autoPresent===true&&!serviceType)throw fail('Selecione Site, Sistema ou Site + sistema na oferta com cálculo automático.');
    const id=text(item.id||randomUUID(),80);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||ids.has(id))throw fail('Identificador de oferta inválido ou repetido.');ids.add(id);
    if(!text(item.title,150)||!text(item.scope,1800)||!text(item.terms,1200))throw fail('Preencha serviço, escopo e condições da oferta.');
    return{id,title:text(item.title,150),market:item.market,currency:item.currency,amount:Math.round(amount*100)/100,
      pricingMode,amountMax:Math.round(amountMax*100)/100,serviceType,
      category:text(item.category,90),scope:text(item.scope,1800),terms:text(item.terms,1200),deadline:text(item.deadline,300),
      maintenance:text(item.maintenance,500),maxDiscountPercent:discount,active:item.active!==false,autoPresent:item.autoPresent===true};
  });
  return{offers,paymentDetails:normalizePaymentDetails(raw.paymentDetails),allowAutoProposals:raw.allowAutoProposals===true,allowAutoAcceptance:raw.allowAutoAcceptance===true,
    negotiationPolicy:normalizeNegotiationPolicy(raw.negotiationPolicy),
    projectPricing:normalizeProjectPricing(raw.projectPricing),
    allowUnlimitedInScopeChanges:raw.allowUnlimitedInScopeChanges===true,guidance:text(raw.guidance,6000)};
}
function eligibleOffers(business,lead){return(business?.offers||[]).filter(offer=>offer.active&&offer.autoPresent&&offer.market===lead.pais&&offer.currency===lead.moeda&&(!offer.category||normalize(offer.category)===normalize(lead.categoria)));}

function unsupportedUnlimitedClaim(reply,business){
  const unlimited=/ilimitad|unlimited|sem (?:limites?|cota)|sin limites?|no (?:change )?(?:limit|quota)|without (?:a )?(?:change )?(?:cap|limit|quota)/;
  const contentOrFix=/conteud|contenid|content|correc|bug|fix/;
  const inScope=/projeto (?:contratado|original|inicial|combinado)|escopo (?:contratado|original|combinado)|ambito (?:contratado|original|acordado)|agreed (?:project|scope)|original project|proyecto (?:contratado|original|acordado)|alcance (?:contratado|original|acordado)/;
  const broadPromise=/(?:unlimited|ilimitad\w*)\s+(?:support|suporte|soporte|hosting|storage|traffic)|(?:suporte|support|soporte|hospedagem|alojamento|hosting|storage|traffic)\s+(?:ilimitad\w*|unlimited|sem limites?|sin limites?)/;
  return normalize(reply).split(/[.!?;\n]+/).some(sentence=>unlimited.test(sentence)
    &&(!business.allowUnlimitedInScopeChanges||!contentOrFix.test(sentence)||!inScope.test(sentence)||broadPromise.test(sentence)));
}

function captureMemory(record,items,history,inbound){
  record.memory ||= {};
  const incoming=history.filter(e=>e.direction==='in'&&e.actor!=='bot'&&e.text);
  for(const item of (items||[]).slice(0,7)){
    if(!MEMORY_FIELDS.includes(item.field)||!text(item.value,1000)||!text(item.evidence,600))continue;
    // Evidência vem do contato, não de uma copy enviada pelo vendedor.
    const source=[...incoming].reverse().find(e=>String(e.text).includes(item.evidence));
    if(!source)continue;
    const previous=record.memory[item.field];
    if(previous?.sourceAt&&Date.parse(previous.sourceAt)>Date.parse(source.at))continue;
    record.memory[item.field]={value:text(item.value,1000),evidence:text(item.evidence,600),sourceAt:source.at||null,
      sourceMessageId:source.messageId||source.id||inbound,updatedAt:new Date().toISOString()};
  }
}

function formatOffer(offer,language,discountPercent=0,formal=false,conversation={}){
  const labels={
    'pt-BR':{quote:'Uma opção compatível é',proposal:'Proposta',scope:'Inclui',price:'Valor',terms:'Condições',deadline:'Prazo',maintenance:'Manutenção',discount:'Desconto autorizado',question:'O que você gostaria de esclarecer sobre essa opção?'},
    'pt-PT':{quote:'Uma opção compatível é',proposal:'Proposta',scope:'Inclui',price:'Valor',terms:'Condições',deadline:'Prazo',maintenance:'Manutenção',discount:'Desconto autorizado',question:'O que gostaria de esclarecer sobre esta opção?'},
    'en-US':{quote:'One suitable option is',proposal:'Proposal',scope:'Includes',price:'Price',terms:'Terms',deadline:'Timeline',maintenance:'Maintenance',discount:'Authorized discount',question:'What would you like to clarify about this option?'},
    'es-ES':{quote:'Una opción compatible es',proposal:'Propuesta',scope:'Incluye',price:'Precio',terms:'Condiciones',deadline:'Plazo',maintenance:'Mantenimiento',discount:'Descuento autorizado',question:'¿Qué te gustaría aclarar sobre esta opción?'},
  };
  const words=labels[language]||labels['pt-BR'];
  if(offer.pricingMode==='range'){
    const ranges={
      'pt-BR':{label:'Faixa estimada',note:'Esta faixa não é uma proposta fechada. O valor final depende do escopo e dos critérios aprovados por Ronald.',monthly:'Mensalidade e custos recorrentes'},
      'pt-PT':{label:'Intervalo estimado',note:'Este intervalo não é uma proposta fechada. O valor final depende do âmbito do projeto e dos critérios aprovados pelo Ronald.',monthly:'Mensalidade e custos recorrentes'},
      'en-US':{label:'Estimated range',note:'This range is not a fixed proposal. The final price depends on the scope and the criteria approved by Ronald.',monthly:'Monthly fee and recurring costs'},
      'es-ES':{label:'Rango estimado',note:'Este rango no es una propuesta cerrada. El precio final depende del alcance y de los criterios aprobados por Ronald.',monthly:'Cuota mensual y costes recurrentes'},
    };
    const range=ranges[language]||ranges['pt-BR'];
    const format=value=>new Intl.NumberFormat(language,{style:'currency',currency:offer.currency}).format(value);
    const lines=[`${words.quote}: ${offer.title}`,`${range.label}: ${format(offer.amount)} – ${format(offer.amountMax)}`];
    if(offer.maintenance)lines.push(`${range.monthly}: ${offer.maintenance}`);
    lines.push(range.note,`${words.scope}: ${offer.scope}`,`${words.terms}: ${offer.terms}`,words.question);
    return{text:lines.join('\n\n'),amount:null};
  }
  const amount=Math.round(offer.amount*(1-discountPercent/100)*100)/100;
  if(!formal||conversation.scopeConfirmed)return{text:compactQuote(offer,language,amount,discountPercent,conversation),amount};
  const value=new Intl.NumberFormat(language,{style:'currency',currency:offer.currency}).format(amount);
  const lines=[`${formal?words.proposal:words.quote}: ${offer.title}`,`${words.scope}: ${offer.scope}`,`${words.price}: ${value}`];
  if(discountPercent)lines.push(`${words.discount}: ${Number.isInteger(discountPercent)?'':'≈ '}${new Intl.NumberFormat(language,{maximumFractionDigits:2}).format(discountPercent)}%`);
  lines.push(`${words.terms}: ${offer.terms}`);
  if(offer.deadline)lines.push(`${words.deadline}: ${offer.deadline}`);
  if(offer.maintenance)lines.push(`${words.maintenance}: ${offer.maintenance}`);
  lines.push(words.question);
  return{text:lines.join('\n\n'),amount};
}

function decideAutonomous(result,settings,lead,record,context){
  const decision=result.decision||{action:'reply'};
  const review=reason=>({status:'held',reason,text:result.reply,action:'handoff'});
  if(result.intent==='opt_out')return{status:'closed',text:'',action:'close',closeStatus:'nao_contatar',reason:'O contato pediu para interromper o atendimento.'};
  if(result.intent==='refusal')return lead.status==='ganho'?review('Cliente com acordo existente: a mensagem exige avaliação antes de alterar o negócio.'):{status:'closed',text:'',action:'close',closeStatus:'perdido',reason:'O contato recusou a oferta. A abordagem foi encerrada.'};
  if(result.intent==='bot')return review('Menu automático: o fluxo próprio de bot continua responsável, evitando resposta duplicada.');
  if(decision.action==='handoff')return review(decision.reason||result.reason||'O pedido precisa de uma condição ainda não autorizada.');
  if(decision.action==='close')return review('Confirme a intenção de encerramento: não há uma recusa explícita na classificação.');
  const business=settings.business||defaults();
  const payment=paymentAction(settings,lead,record,context);
  if(payment)return payment;
  if(decision.action==='scope'){
    if(!business.projectPricing?.enabled)return review('O diagnóstico para cálculo do projeto não está habilitado.');
    return scopeAction(result.assessment,context);
  }
  if(['quote','proposal'].includes(decision.action)){
    let offer=eligibleOffers(business,lead).find(item=>item.id===decision.offerId);
    if(!offer)return review('Não há oferta autorizada para este serviço, país e moeda. Complete a base comercial.');
    if(!business.allowAutoProposals)return review('A apresentação automática de ofertas ainda não foi autorizada na base comercial.');
    const resolved=resolveProjectOffer(offer,record,context,decision,business);
    if(resolved.reason)return review(resolved.reason);
    offer=resolved.offer;
    if(resolved.assessment&&(result.needsReview||!result.evidence||!context.latestMessage.includes(result.evidence)))return review('Confira a dúvida ou a evidência da última mensagem antes de preparar o preço fechado.');
    if(offer.pricingMode==='range'&&decision.action==='proposal')return review('Confirme primeiro o resumo do projeto para calcular o preço fechado. A faixa isolada não é proposta.');
    let discount=Number(decision.discountPercent||0);
    if(!Number.isFinite(discount)||discount<0||discount>offer.maxDiscountPercent)return review('O desconto solicitado ultrapassa o limite autorizado.');
    if(offer.pricingMode==='range'&&discount>0)return review('O teto de desconto está cadastrado, mas só pode ser aplicado depois de definir um preço fechado; não descontar os extremos de uma faixa.');
    const contextualObjection=result.intent==='objection'&&result.evidence&&context.latestMessage.includes(result.evidence)
      &&record.lastQuotedOffer?.id===offer.id&&Number.isFinite(record.lastQuotedOffer.amount);
    const previousQuote=record.lastQuotedOffer;
    const agreedDiscount=discount>0&&previousQuote?.id===offer.id&&previousQuote.status==='quoted'&&Number.isFinite(previousQuote.amount)
      &&Number(previousQuote.discountPercent)===discount&&(!offer.pricingBasisHash||previousQuote.pricingBasisHash===offer.pricingBasisHash);
    if(discount>0&&!contextualObjection&&!agreedDiscount&&!/caro|desconto|negoci|orcamento|expensive|discount|budget|precio|presupuesto|car[oa]/i.test(normalize(context.latestMessage)))return review('Não houve uma negociação de preço explícita que justifique oferecer desconto.');
    if(discount>0&&!agreedDiscount){
      if(previousQuote?.id!==offer.id||previousQuote.status!=='quoted')return review('Apresente o preço original antes de negociar condições.');
      const budget=budgetFor(record,context.latestMessage);
      if(!budget)return budgetQuestionAction(record,context.language);
      const maximum=Math.min(offer.maxDiscountPercent,business.negotiationPolicy?.automaticMaxPercent??offer.maxDiscountPercent);
      if(budget.amount<Math.round(offer.amount*(1-maximum/100)*100)/100)return scopeBudgetAction(context.language);
      // Não conceder uma redução maior do que a necessária para o orçamento informado.
      discount=Math.max(Number(previousQuote.discountPercent)||0,Math.min(discount,discountForBudget(offer.amount,budget.amount)));
    }
    const stageIssue=discountStageIssue(discount,offer,business,record);
    if(stageIssue)return review(stageIssue);
    const formatted=formatOffer(offer,context.language,discount,decision.action==='proposal',{previousQuote,scopeConfirmed:Boolean(resolved.assessment)});
    if(formatted.text.length>5000)return review('A oferta ficou longa demais para envio em uma mensagem. Reduza o escopo descritivo da oferta.');
    return{status:'ready',action:decision.action,text:formatted.text,amount:formatted.amount,discountPercent:discount,offer:structuredClone(offer),projectAssessment:resolved.assessment,
      reason:resolved.assessment?'Preço calculado dentro da faixa a partir do projeto confirmado; condições e descontos vêm da base autorizada.':'Oferta montada a partir do catálogo e dos limites autorizados.'};
  }
  if(decision.action==='accept'){
    const proposal=(record.proposals||[]).find(item=>item.id===decision.proposalId&&item.status==='sent');
    if(!proposal||!business.allowAutoAcceptance)return review('O aceite precisa ser associado a uma proposta apresentada e à autorização configurada.');
    const evidence=result.evidence&&context.latestMessage.includes(result.evidence);
    const acceptanceText=normalize(context.latestMessage);
    if(result.needsReview||result.intent!=='acceptance'||!evidence||/\b(?:nao|not|no|se|if|si|talvez|maybe|quizas|mas|but|pero)\b/.test(acceptanceText)
      ||!/(?:aceito|aceitamos|vamos fechar|pode avancar|podemos avancar|i accept|we accept|acepto|aceptamos)/.test(acceptanceText))return review('A mensagem não confirma claramente o aceite desta proposta. Esclareça antes de registrar.');
    const responses={
      'pt-BR':'Registrei seu aceite da proposta apresentada. Os próximos passos seguem o escopo e as condições combinados; o recebimento de qualquer pagamento será conferido separadamente.',
      'pt-PT':'Registei a sua aceitação da proposta apresentada. Os próximos passos seguem o âmbito e as condições acordados; a receção de qualquer pagamento será verificada separadamente.',
      'en-US':'I’ve recorded your acceptance of the proposal. The next steps follow its agreed scope and terms; receipt of any payment will be verified separately.',
      'es-ES':'He registrado tu aceptación de la propuesta presentada. Los siguientes pasos seguirán el alcance y las condiciones acordados; la recepción de cualquier pago se comprobará por separado.',
    };
    return{status:'ready',action:'accept',proposalId:proposal.id,text:responses[context.language]||responses['pt-BR'],reason:'Aceite explícito de uma proposta apresentada, dentro da autorização configurada.'};
  }
  if(result.intent==='acceptance')return review('O contato sinalizou aceite, mas a proposta e as condições ainda precisam ser identificadas.');
  if(!result.reply)return review('A IA não preparou uma resposta utilizável.');
  // Preços, descontos e prazos concretos são compostos pelo servidor, nunca
  // copiados livremente da saída do modelo.
  const financialText=normalize(result.reply);
  if(/(?:R\$|US\$|[€$£]|USD|EUR|BRL)\s*\d|\d\s*(?:%|BRL|USD|EUR)|\d[\d., ]*\s*(?:reais|euros|dolares|dollars|pounds)|\d+\s*(?:dias?|semanas?|meses|days?|weeks?|months?|business days?)\b/i.test(financialText))return review('A resposta contém condição numérica fora de uma oferta montada pelo catálogo.');
  if(/\b(?:cinquenta|cem|duzentos|trezentos|quinhentos|mil|hundred|thousand|quinientos)\b.*\b(?:reais|euros|dolares|dollars)\b/i.test(financialText))return review('A resposta contém preço por extenso fora do catálogo.');
  if(/pagamento (?:confirmado|recebido)|payment (?:confirmed|received)|pago (?:confirmado|recibido)|(?:recebi|recebemos).*pix|received.*payment|(?:garantia).*ilimitad|resultado garantido|\b(?:guaranteed|garantizado)\b/i.test(financialText))return review('A resposta declara confirmação financeira ou garantia não executada pelo painel.');
  if(unsupportedUnlimitedClaim(result.reply,business))return review('A ausência de limite deve se referir somente às correções e alterações de conteúdo autorizadas dentro do projeto contratado.');
  if(/\[(?:CONTATO|EMAIL|LINK|NUMERO)\]/.test(result.reply))return review('A resposta depende de um dado filtrado; ajuste o contexto antes do envio.');
  if(/^\[(?:midia|imagem|audio|video|anexo)/.test(normalize(context.latestMessage)))return review('A mensagem exige interpretação de um anexo.');
  if(result.needsReview)return review(result.reason||'A IA identificou uma exceção nas condições disponíveis.');
  if(!result.evidence||!context.latestMessage.includes(result.evidence))return review('A análise não apresentou um trecho válido da última mensagem.');
  return{status:'ready',action:'reply',text:result.reply,reason:'Continuação contextual da conversa dentro das regras comerciais.'};
}
module.exports={defaults,normalizeBusiness,eligibleOffers,captureMemory,decideAutonomous,MEMORY_FIELDS,MARKETS};
