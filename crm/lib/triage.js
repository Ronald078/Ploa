'use strict';
const {createHash}=require('node:crypto');
const {classifyLeadResponse}=require('./lead-classifier');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const CATEGORIES={missing_history:'Histórico sem texto',greeting:'Saudação',permission:'Permissão para explicar',has_site:'Já possui solução',question:'Dúvida',interested:'Interesse identificado',proposal_request:'Pedido de proposta',negotiation:'Negociação',refusal:'Sem interesse',opt_out:'Não contatar',bot:'Atendimento automático',acceptance:'Aceite a conferir',ambiguous:'Contexto a conferir'};
function signature(lead){
  const history=(lead.historico_completo||[]).filter(event=>['in','out'].includes(event.direction)).slice(-6).map(event=>[event.direction,event.messageId||event.id||'',event.at,event.text]);
  return createHash('sha256').update(JSON.stringify([lead.id,lead.ultima_resposta||'',lead.ultima_mensagem||'',lead.classificacao_modo||'automatica',lead.ficha?.updatedAt||'',history,(lead.propostas||[]).map(item=>[item.id,item.status,item.updatedAt||''])])).digest('hex');
}
function localTriage(lead){
  const latest=String(lead.ultima_mensagem||''),text=normalize(latest);
  const semantic=classifyLeadResponse({responses:lead.respostas||[{texto:latest,data:lead.ultima_resposta}],number:lead.numero||lead.id});
  let category='ambiguous',needsReview=true,nextStep='Conferir o contexto antes de definir a próxima ação.',suggestedStatus='respondeu',reason='A última resposta não define com segurança uma intenção comercial.';
  if(!latest.trim()){category='missing_history';needsReview=false;reason='Existe um registro de resposta, mas não há texto recebido disponível para interpretar. Não é possível concluir interesse ou recusa.';nextStep='Aguardar uma nova mensagem com texto ou consultar este caso no WhatsApp, se necessário.';}
  else if(lead.status==='automatico'){category='bot';needsReview=false;suggestedStatus='automatico';reason='A resposta atual está identificada como atendimento automático.';nextStep='Aguardar contato com uma pessoa responsável.';}
  else if(semantic&&!semantic.needsReview&&semantic.intent!=='human_review'&&!/^(?:pode falar|pode explicar|pode mandar|pode enviar|sim pode falar|yes go ahead|go ahead|puedes explicar|puedes hablar)$/.test(text)){
    category=({interest:'interested',proposal_received:'negotiation',closing_intent:'acceptance',won:'acceptance',lost:'refusal',refusal:'refusal',opt_out:'opt_out'})[semantic.intent]||semantic.intent;
    if(!Object.hasOwn(CATEGORIES,category))category='ambiguous';
    needsReview=category==='ambiguous'||category==='acceptance';suggestedStatus=['ganho','proposta'].includes(semantic.status)?'respondeu':semantic.status;
    reason=semantic.reason;nextStep=semantic.nextAction;
  }else if(/^(?:oi|ola|bom dia|boa tarde|boa noite|hello|hi|good morning|good afternoon|hola|buenos dias|buenas tardes)(?: tudo bem| como vai| how are you| que tal)?$/.test(text)||/^(?:tudo bem|tudo bem e voce|tudo bem e vc|ola tudo bem e voce)$/.test(text)){
    category='greeting';needsReview=false;reason='Saudação sem manifestação de interesse ou recusa.';nextStep='Continuar o diagnóstico quando houver uma nova interação.';
  }else if(/^(?:pode falar|pode explicar|pode mandar|pode enviar|sim pode falar|yes go ahead|go ahead|puedes explicar|puedes hablar)$/.test(text)){
    category='permission';needsReview=false;reason='Permissão para explicar; não confirma compra nem interesse qualificado.';nextStep='Entender a necessidade antes de apresentar uma proposta.';
  }else if(/\b(?:ja temos (?:um )?site|ja tenho (?:um )?site|we already have a website|ya tenemos (?:una )?(?:web|pagina))\b/.test(text)&&!semantic?.status?.match(/perdido|nao_contatar/)){
    category='has_site';needsReview=false;reason='O contato informa uma solução existente; isso não confirma recusa.';nextStep='Entender como a solução atual atende ao negócio.';
  }
  return{category,label:CATEGORIES[category],needsReview,suggestedStatus,reason,nextStep,evidence:latest.slice(0,600),canUseAi:category!=='missing_history',source:'rules',signature:signature(lead)};
}
function contextualTriage(lead,result){
  const category=result.intent!=='missing_history'&&Object.hasOwn(CATEGORIES,result.intent)?result.intent:'ambiguous';
  const evidence=String(result.evidence||'').trim(),latest=normalize(lead.ultima_mensagem),proof=normalize(evidence);
  const supported=proof.length>=4&&latest.includes(proof);
  const needsReview=result.needsReview!==false||!supported||['acceptance','ambiguous'].includes(category);
  return{category,label:CATEGORIES[category],needsReview,suggestedStatus:({interested:'qualificado',proposal_request:'qualificado',refusal:'perdido',opt_out:'nao_contatar',bot:'automatico'})[category]||'respondeu',
    evidence,reason:String(result.reason||'').slice(0,700),nextStep:String(result.nextStep||'').slice(0,500),source:'ai',signature:signature(lead)};
}
function queueFor(lead,record={},now=Date.now()){
  const closed=['ganho','perdido','nao_contatar'].includes(lead.status);
  const recent=Number.isFinite(Date.parse(lead.ultima_resposta))&&now-Date.parse(lead.ultima_resposta)<=7*86400000;
  const customerLast=(lead.historico_completo||[]).filter(event=>['in','out'].includes(event.direction)).at(-1)?.direction==='in';
  const needsReview=lead.status==='respondeu'&&lead.classificacao_revisao;
  const withoutText=!closed&&lead.status!=='automatico'&&lead.respostas_recebidas>0&&!String(lead.ultima_mensagem||'').trim();
  const exception=Boolean(record.attention&&!record.attention.resolvedAt);
  const paymentReview=exception&&record.attention.kind==='payment_review';
  const actionNow=paymentReview||!closed&&(exception||lead.retorno_atrasado||lead.retorno_hoje||['proposta','negociacao'].includes(lead.status)||(needsReview&&recent&&customerLast&&record.mode==='human'));
  return{actionNow:Boolean(actionNow),history:needsReview&&!actionNow&&!withoutText,withoutText,exception,recent,
    label:paymentReview?'Pagamento a conferir':closed?'Encerrado':exception?'Precisa de Ronald':withoutText?'Histórico sem texto':record.mode==='human'?'Com Ronald':customerLast?'Disponível para atendimento':'Aguardando cliente'};
}
module.exports={CATEGORIES,signature,localTriage,contextualTriage,queueFor};
