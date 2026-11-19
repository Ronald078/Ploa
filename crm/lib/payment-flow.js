'use strict';
const {createHash}=require('node:crypto');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function normalizePaymentDetails(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Object.assign(new Error('Dados de Pix inválidos.'),{statusCode:400});
  const pixKey=String(raw.pixKey||'').trim(),pixRecipient=String(raw.pixRecipient||'').trim();
  if(pixKey.length>140||/[\s\x00-\x1f]/.test(pixKey))throw Object.assign(new Error('Cole a chave Pix completa, sem espaços ou quebras de linha (até 140 caracteres).'),{statusCode:400});
  if(pixRecipient.length>120||/[\r\n]/.test(pixRecipient))throw Object.assign(new Error('Informe o nome do titular em uma linha, com até 120 caracteres.'),{statusCode:400});
  return{pixKey,pixRecipient};
}
function paymentOffer(record){
  return [record.lastQuotedOffer,...(record.proposals||[])]
    .filter(item=>item&&['quoted','sent','accepted'].includes(item.status)&&item.pricingMode!=='range'
      &&Number.isFinite(item.amount)&&item.amount>0&&(item.quotedAt||item.sentAt))
    .sort((a,b)=>Date.parse(a.quotedAt||a.sentAt)-Date.parse(b.quotedAt||b.sentAt)).at(-1);
}
function quoteKey(offer){return createHash('sha256').update(JSON.stringify([offer.id,offer.amount,offer.currency,offer.scope,offer.terms])).digest('hex');}
function paymentAction(settings,lead,record,context){
  if(settings.responseMode!=='autonomous'||context.automation?.manualRequest||!settings.business?.allowAutoProposals
    ||lead.pais!=='Brasil'||lead.moeda!=='BRL'||record.projectDraft?.status==='pending')return null;
  const offer=paymentOffer(record);if(!offer||offer.currency!=='BRL')return null;
  const message=normalize(context.latestMessage),terms=normalize(offer.terms);
  const reported=/\b(?:paguei|(?:fiz|efetuei|realizei|enviei) (?:o |a |um |uma )?(?:pix|pagamento|transferencia)|(?:enviei|mandei) (?:o )?comprovante|(?:pagamento|pix|transferencia) (?:feito|feita|realizado|realizada|efetuado|efetuada)|segue (?:o )?comprovante)\b/.test(message);
  const uncertain=/\b(?:nao|se|caso|talvez|ainda vou|vou pagar|vou fazer|quando)\b/.test(message)||message.includes('?');
  if(reported&&!uncertain)return{status:'ready',action:'payment',paymentNotice:true,
    text:'Certo. O recebimento ainda precisa ser conferido antes de começarmos o projeto.',
    reason:'O cliente informou pagamento; Ronald precisa conferir o recebimento. Não foi registrado dinheiro.'};
  const requestKey=/\bpix\b/.test(message)&&/\b(?:manda\w*|envia\w*|passa\w*|qual|chave|como pago|como pagar)\b/.test(message);
  if(/\bcomprovante\b/.test(message)&&!reported&&!/\bchave\b/.test(message))return null;
  if(/\b(?:se|talvez|caso|mas|desconto|barato|caro|nao|not|cancelar|desistir|cartao|boleto|paypal|wise|dinheiro|credito|debito)\b/.test(message))return null;
  if(!requestKey&&/\b(?:entender|saber|explicar|explica|funciona|duvida|informacoes|qual|quanto|como)\b/.test(message))return null;
  const choosing=/\b(?:quero|prefiro|vou|escolho|opto|pode ser|fico|pagamento|pagar|pago)\b/.test(message)||/^(?:integral|a vista|entrada|50\s*%|100\s*%)[.!]*$/.test(message);
  const deposit=choosing&&/\bentrada\b|50\s*%|\bmetade\b|\bmeio a meio\b/.test(message);
  const full=choosing&&/\bintegral\b|\ba vista\b|100\s*%|\bpor inteiro\b|\b(?:pagar|pago|pagamento)\s+(?:o )?(?:valor )?(?:todo|tudo|inteiro|total)\b/.test(message);
  if(/[?]/.test(message)&&!requestKey)return null;
  if((!deposit&&!full&&!requestKey)||(deposit&&full))return null;
  if(full&&/\b(?:na entrega|depois da entrega|apos a entrega|quando estiver pronto|depois de pronto|no final|no fim)\b/.test(message))return null;
  const basis=quoteKey(offer);
  let mode=deposit?'deposit':full?'full':record.paymentChoice?.basis===basis?record.paymentChoice.mode:null;
  const base={status:'ready',action:'payment',reason:'Instruções de pagamento compostas a partir da chave cadastrada e do valor já apresentado. Não confirma recebimento.'};
  if(!mode)return{...base,text:'Você prefere pagar o valor integral antes de começar ou 50% de entrada e o restante na entrega?'};
  if(mode==='deposit'&&!/50\s*%/.test(terms))return{status:'held',action:'handoff',reason:'A proposta apresentada não autoriza entrada de 50%. Confira as condições antes de enviar a chave.'};
  if(mode==='full'&&!/integral|a vista|antes do inicio|antes de iniciar/.test(terms))return{status:'held',action:'handoff',reason:'Confira o pagamento integral nas condições apresentadas antes de enviar a chave.'};
  const {pixKey,pixRecipient}=settings.business.paymentDetails||{};
  if(!pixKey)return{status:'held',action:'handoff',reason:'Cadastre a chave Pix na base comercial para enviar as instruções de pagamento.'};
  const total=Math.round(offer.amount*100),due=mode==='deposit'?Math.round(total/2):total;
  const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
  const lines=[mode==='deposit'?`Combinado! A entrada de 50% fica em ${money(due)}; os ${money(total-due)} restantes ficam para a entrega.`:`Combinado! O pagamento integral fica em ${money(due)}, antes de começarmos.`,
    `Chave Pix: ${pixKey}${pixRecipient?'\nTitular: '+pixRecipient:''}`,
    'Depois de pagar, pode enviar o comprovante por aqui. Vou conferir o recebimento antes de iniciar o projeto.'];
  return{...base,text:lines.join('\n\n'),paymentChoice:{mode,basis,amount:due/100,currency:'BRL',offerId:offer.id}};
}
function paymentResult(settings,lead,record,context){
  const action=paymentAction(settings,lead,record,context);if(!action)return null;
  return{reply:'',intent:'question',reason:action.reason,evidence:context.latestMessage,nextStep:'Informar o pagamento conforme a escolha do cliente.',needsReview:false,
    decision:{action:'reply'},memory:[],model:'server-payment-policy',usage:{input:0,output:0},timing:{quotaWaitMs:0,providerMs:0,attempts:0}};
}
module.exports={normalizePaymentDetails,paymentAction,paymentResult};
