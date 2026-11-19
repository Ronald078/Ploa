'use strict';
const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
const phrases={
  'pt-BR':{first:p=>`Ok! Posso aplicar ${p}% de desconto para você.`,better:p=>`Posso melhorar o desconto para ${p}%.`,value:v=>`O projeto fica em ${v}.`,same:'O escopo, o prazo e as condições de pagamento continuam os mesmos.',monthly:v=>`A mensalidade continua em ${v}, sem desconto.`,question:'O que achou dessa proposta?',quote:(title,v)=>`${title}: ${v}.`,project:v=>`Para montar essa estrutura, o investimento fica em ${v}.`,terms:'Você pode pagar tudo antes do início ou dividir em 50% de entrada e 50% na entrega.',maintenance:'Depois da entrega, são R$ 50 por mês para hospedagem, suporte, correções e alterações de conteúdo, sem limite dentro do que combinamos. Uma ampliação grande ou nova estrutura é orçada à parte, antes de começar.',days:(a,b)=>`${a} a ${b} dias úteis após a confirmação do pagamento inicial.`},
  'pt-PT':{first:p=>`Posso aplicar-lhe um desconto de ${p}%.`,better:p=>`Posso melhorar o desconto para ${p}%.`,value:v=>`O projeto fica por ${v}.`,same:'O âmbito, o prazo e as condições de pagamento mantêm-se.',monthly:v=>`A mensalidade mantém-se nos ${v}, sem desconto.`,question:'O que acha desta proposta?',quote:(title,v)=>`${title}: ${v}.`,project:v=>`Para concretizar esta ideia, o investimento fica em ${v}.`,terms:'Pode pagar a totalidade antes do início ou optar por 50% de entrada e 50% na entrega.',maintenance:'Após a entrega, são 50 € por mês para alojamento, apoio, correções e alterações de conteúdo, sem limite dentro do que combinámos. Uma ampliação substancial ou nova estrutura é orçamentada à parte, antes de começar.',days:(a,b)=>`${a} a ${b} dias úteis após a confirmação do pagamento inicial.`},
  'en-US':{first:p=>`I can offer you a ${p}% discount.`,better:p=>`I can increase the discount to ${p}%.`,value:v=>`The project comes to ${v}.`,same:'The scope, timeline and payment terms stay the same.',monthly:v=>`The monthly fee stays at ${v}, with no discount.`,question:'How does that proposal sound to you?',quote:(title,v)=>`${title}: ${v}.`,project:v=>`To build the setup we discussed, the price is ${v}.`,terms:'You can pay in full before we begin, or choose a 50% deposit and 50% on delivery.',maintenance:'After delivery, the monthly fee is US$50 for hosting, support, fixes and content changes, with no limit within the agreed scope. Major additions or a new structure are quoted separately before work begins.',days:(a,b)=>`${a} to ${b} business days after the initial payment is confirmed.`},
  'es-ES':{first:p=>`Puedo aplicarte un ${p}% de descuento.`,better:p=>`Puedo mejorar el descuento hasta el ${p}%.`,value:v=>`El proyecto se queda en ${v}.`,same:'El alcance, el plazo y las condiciones de pago se mantienen.',monthly:v=>`La cuota mensual se mantiene en ${v}, sin descuento.`,question:'¿Qué te parece esta propuesta?',quote:(title,v)=>`${title}: ${v}.`,project:v=>`Para dar forma a esta idea, la inversión es ${v}.`,terms:'Puedes pagar todo antes de empezar u optar por un 50% de entrada y el 50% a la entrega.',maintenance:'Después de la entrega, son 50 € al mes para alojamiento, soporte, correcciones y cambios de contenido, sin límite dentro de lo acordado. Las ampliaciones importantes o estructuras nuevas se presupuestan aparte antes de empezar.',days:(a,b)=>`${a} a ${b} días hábiles desde la confirmación del pago inicial.`}
};
// Só compactamos as condições padrão exatas. Texto personalizado permanece inteiro.
const standardTerms={
  'pt-BR':'O cliente escolhe uma das duas formas:\n1. Pagamento integral na contratação, antes do início do projeto.\n2. 50% de entrada e os 50% restantes na entrega do projeto.\nA mensalidade começa na entrega do projeto.',
  'pt-PT':'O cliente escolhe uma das duas modalidades:\n1. Pagamento integral na contratação, antes do início do projeto.\n2. 50% de entrada e os restantes 50% na entrega do projeto.\nA mensalidade começa na entrega do projeto.',
  'en-US':'The customer chooses one of the two options:\n1. Full payment when commissioning the project, before work begins.\n2. 50% deposit and the remaining 50% on project delivery.\nThe monthly fee starts on project delivery.',
  'es-ES':'El cliente elige una de las dos modalidades:\n1. Pago íntegro al contratar, antes de iniciar el proyecto.\n2. 50% de entrada y el 50% restante a la entrega del proyecto.\nLa cuota mensual empieza a la entrega del proyecto.'
};
const standardMaintenance={
  'pt-BR':'R$50 por mês: hospedagem, suporte, correções de erros e bugs e alterações de conteúdo do projeto contratado, sem cota de alterações. Ampliação substancial ou nova estrutura fora do projeto inicial exige orçamento separado, previamente combinado com Ronald. A mensalidade começa na entrega do projeto. Mensalidade sem desconto.',
  'pt-PT':'50 € por mês: alojamento, apoio, correções de erros e bugs e alterações de conteúdo do projeto contratado, sem limite de alterações. Uma ampliação substancial ou nova estrutura fora do projeto inicial exige um orçamento separado, previamente acordado com o Ronald. A mensalidade começa na entrega do projeto. Mensalidade sem desconto.',
  'en-US':'US$50 per month: hosting, support, error/bug fixes and content changes within the agreed project, with no change quota. Substantial additions or a new structure outside the original project require a separate quote agreed with Ronald in advance. The monthly fee starts on project delivery. The monthly fee is not discounted.',
  'es-ES':'50 € al mes: alojamiento, soporte, correcciones de errores y bugs y cambios de contenido del proyecto contratado, sin límite de cambios. Una ampliación importante o una estructura nueva fuera del proyecto inicial requiere un presupuesto aparte, acordado previamente con Ronald. La cuota mensual empieza a la entrega del proyecto. Cuota mensual sin descuento.'
};
function sameSentOffer(previous,offer){
  return previous?.status==='quoted'&&previous.id===offer.id&&Number.isFinite(previous.amount)
    &&['currency','scope','terms','deadline','maintenance','pricingBasisHash'].every(key=>previous[key]===offer[key])
    &&Math.abs(previous.amount/(1-Number(previous.discountPercent||0)/100)-offer.amount)<0.02;
}
function compactQuote(offer,language,amount,discount,{previousQuote,scopeConfirmed=false}={}){
  const code=Object.hasOwn(phrases,language)?language:'pt-BR',w=phrases[code];
  const format=value=>new Intl.NumberFormat(code,{style:'currency',currency:offer.currency}).format(value);
  const standardMonthly=normalize(offer.maintenance)===normalize(standardMaintenance[code]);
  const adjustments={'pt-BR':'Ok! Consigo ajustar o valor para você.','pt-PT':'Consigo ajustar o valor para si.','en-US':'I can adjust the price for you.','es-ES':'Puedo ajustar el precio para ti.'};
  const introduction=previous=>Number.isInteger(discount)?(previous?w.better(discount):w.first(discount)):adjustments[code];
  if(discount>0&&sameSentOffer(previousQuote,offer)){
    const previous=Number(previousQuote.discountPercent||0);
    const intro=discount>previous?introduction(previous):'';
    const monthly=standardMonthly?w.monthly(format(50)):offer.maintenance;
    return [intro,w.value(format(amount)),w.same,monthly,w.question].filter(Boolean).join('\n\n');
  }
  const lines=[];
  if(discount)lines.push(introduction(0));
  if(scopeConfirmed){
    const summary=normalize(offer.scopeSummary||String(offer.scope||'').split('\n')[0]);
    if(summary)lines.push(summary.length<=260?summary:summary.slice(0,257).replace(/\s+\S*$/,'')+'…');
  }
  lines.push(scopeConfirmed?w.project(format(amount)):w.quote(offer.title,format(amount)));
  if(!scopeConfirmed&&offer.scope)lines.push(offer.scope);
  if(offer.terms)lines.push(standardMonthly&&normalize(offer.terms)===normalize(standardTerms[code])?w.terms:offer.terms);
  const deadline=String(offer.deadline||'');
  const patterns={
    'pt-BR':/^(\d+) a (\d+) dias úteis, contados a partir do pagamento inicial \(integral ou entrada de 50%\)\. O recebimento precisa ser confirmado por Ronald\.$/,
    'pt-PT':/^(\d+) a (\d+) dias úteis, a contar do pagamento inicial \(integral ou entrada de 50%\)\. A receção do pagamento tem de ser confirmada pelo Ronald\.$/,
    'en-US':/^(\d+) to (\d+) business days from the initial payment \(full payment or the 50% deposit\)\. Receipt of payment must be confirmed by Ronald\.$/,
    'es-ES':/^(\d+) a (\d+) días hábiles desde el pago inicial \(pago íntegro o entrada del 50%\)\. Ronald debe confirmar la recepción del pago\.$/
  };
  const days=deadline.match(patterns[code]);
  if(deadline)lines.push(days?w.days(days[1],days[2]):deadline);
  if(offer.maintenance)lines.push(standardMonthly?w.maintenance:offer.maintenance);
  lines.push(w.question);
  return lines.join('\n\n');
}
module.exports={compactQuote,sameSentOffer};
