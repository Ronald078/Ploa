'use strict';
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function quoteBasis(quote){
  if(quote?.status!=='quoted'||quote.pricingMode==='range'||!Number.isFinite(quote.amount))return '';
  const base=quote.amount/(1-Number(quote.discountPercent||0)/100);
  return JSON.stringify([quote.id,quote.currency,quote.pricingBasisHash||'',Math.round(base*100)]);
}
function parseBudget(message,currency,asked=false){
  const value=normalize(message);
  if(/%|mensal|por mes|ao mes|per month|monthly|al mes|cuota|parcela|pagamentos|vezes|entrada|deposit|upfront|por semana|per week|prazo|timeline|dias?\b|days?\b|talvez|maybe|quizas|entre\b|between\b|cerca de|mais ou menos|around\b|nao sei|don.t know|no se\b|nao (?:posso|consigo|quero|vou) pagar|(?:can.t|cannot|won.t) pay|no (?:puedo|quiero) pagar/.test(value))return null;
  if(/(?:^|\s)-\s*\d/.test(value))return null;
  const markers=[];
  if(/r\$|\bbrl\b|\breais\b/.test(value))markers.push('BRL');
  if(/us\$|\busd\b|\bdolares\b|\bdollars\b/.test(value))markers.push('USD');
  if(/€|\beur\b|\beuros?\b/.test(value))markers.push('EUR');
  if(markers.some(code=>code!==currency)||/[£¥]/.test(value)||(/\$/.test(value)&&!markers.length&&currency!=='USD'))return null;
  const explicit=/orcamento|presupuesto|budget|(?:posso|consigo|queria|quero|poderia) (?:pagar|investir)|(?:tenho|tinha) (?:em mente|disponivel)|(?:pode|consegue) fazer|(?:can|could|want to) (?:pay|spend)|(?:puedo|podria|quiero) (?:pagar|invertir)/.test(value);
  if(!asked&&!explicit)return null;
  const numbers=value.match(/\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g)||[];
  if(numbers.length!==1)return null;
  const raw=numbers[0],last=Math.max(raw.lastIndexOf(','),raw.lastIndexOf('.'));
  const decimal=last>=0&&raw.length-last-1<=2;
  const amount=Number(decimal?raw.slice(0,last).replace(/[.,]/g,'')+'.'+raw.slice(last+1):raw.replace(/[.,]/g,''));
  return amount>0&&amount<=10000000?Math.round(amount*100)/100:null;
}
function budgetFor(record,message=''){
  const basis=quoteBasis(record.lastQuotedOffer);if(!basis)return null;
  const amount=parseBudget(message,record.lastQuotedOffer.currency,record.negotiationQuestion?.basis===basis);
  if(amount!==null)return{amount,currency:record.lastQuotedOffer.currency,basis,evidence:String(message).slice(0,600)};
  return record.negotiationBudget?.basis===basis?record.negotiationBudget:null;
}
function captureBudget(record,event){
  if(event.actor==='bot')return;
  const found=budgetFor(record,event.text);
  if(found&&found.evidence===String(event.text).slice(0,600))record.negotiationBudget={...found,sourceMessageId:event.messageId||event.at,at:event.at};
}
function negotiationBounds(record,offers,policy,budget){
  const quote=record.lastQuotedOffer,basis=quoteBasis(quote);
  if(!basis||!budget||budget.basis!==basis||!policy)return null;
  const offer=offers.find(item=>item.id===quote.id&&item.currency===quote.currency);
  if(!offer)return null;
  const base=JSON.parse(basis)[3]/100;
  if(offer.pricingMode==='range'?(base<offer.amount||base>offer.amountMax):Math.abs(base-offer.amount)>.02)return null;
  const maximum=Math.min(offer.maxDiscountPercent,policy.automaticMaxPercent);
  if(!Number.isFinite(maximum))return null;
  const minimumCents=Math.round(base*(1-maximum/100)*100);
  return{currency:quote.currency,baseAmount:base,minimumAmount:minimumCents/100,
    budgetFits:Math.round(budget.amount*100)>=minimumCents,maxDiscountPercent:maximum,previousDiscountPercent:Number(quote.discountPercent)||0};
}
function budgetQuestionAction(record,language){
  const questions={
    'pt-BR':'Qual valor você tinha em mente para esse projeto? Podemos ver o que faz sentido para os dois.',
    'pt-PT':'Que valor tinha em mente para este projeto? Podemos ver o que faz sentido para ambos.',
    'en-US':'What budget did you have in mind for this project? We can see what works for both of us.',
    'es-ES':'¿Qué presupuesto tenías en mente para este proyecto? Podemos ver qué encaja para ambos.'
  };
  const alternatives={
    'pt-BR':'Podemos avaliar a forma de pagamento ou uma versão mais enxuta. Qual dessas opções ajudaria mais?',
    'pt-PT':'Podemos avaliar a forma de pagamento ou uma versão mais simples. Qual destas opções ajudaria mais?',
    'en-US':'We can look at payment options or a simpler version. Which would help more?',
    'es-ES':'Podemos valorar la forma de pago o una versión más sencilla. ¿Qué opción te ayudaría más?'
  };
  const alreadyAsked=record.negotiationQuestion?.basis===quoteBasis(record.lastQuotedOffer)&&record.negotiationQuestion?.askedAt;
  return{status:'ready',action:'reply',text:alreadyAsked?(alternatives[language]||alternatives['pt-BR']):(questions[language]||questions['pt-BR']),
    budgetQuestion:{basis:quoteBasis(record.lastQuotedOffer)},reason:'Conhecer o orçamento do cliente antes de propor desconto.'};
}
function discountForBudget(base,amount){return Math.max(0,Math.ceil((1-amount/base)*100000000-0.000001)/1000000);}
function scopeBudgetAction(language){
  const replies={
    'pt-BR':'Podemos avaliar uma versão mais enxuta para tentar chegar a esse valor. O que é indispensável para você nessa primeira versão?',
    'pt-PT':'Podemos avaliar uma versão mais simples para tentar chegar a esse valor. O que é indispensável para si nesta primeira versão?',
    'en-US':'We can look at a simpler version to try to fit that budget. What is essential for you in the first version?',
    'es-ES':'Podemos valorar una versión más sencilla para intentar ajustarnos a ese presupuesto. ¿Qué es imprescindible para ti en esta primera versión?'
  };
  return{status:'ready',action:'reply',text:replies[language]||replies['pt-BR'],reason:'O orçamento está abaixo da margem automática; discutir escopo sem prometer preço nem desconto adicional.'};
}
module.exports={quoteBasis,budgetFor,captureBudget,budgetQuestionAction,discountForBudget,parseBudget,scopeBudgetAction,negotiationBounds};
