'use strict';
const {scopeAction}=require('./project-pricing');
const {recoverConversation}=require('./conversation-recovery');
const normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function claims(text){
  const value=normalize(text),found=new Set();
  const patterns={integration:/(?:integr\w*|sincron\w*|connect\w*)[^.!?\n]{0,65}(?:instagram|whatsapp)|(?:instagram|whatsapp)[^.!?\n]{0,45}(?:integr\w*|sincron\w*)/g,
    automaticStock:/(?:estoque|disponibilidade|stock|availability)[^.!?\n]{0,45}(?:automatic\w*|tempo real|real.time|sozinh\w*)|automatic\w*[^.!?\n]{0,45}(?:estoque|disponibilidade|stock|availability)|(?:elimin\w*|dispens\w*|sem precisar|sem necessidade de)[^.!?\n]{0,45}(?:checagem|conferencia|verificacao|conferir|verificar|check)[^.!?\n]{0,30}(?:estoque|stock|disponibilidade|foto|peca)/g};
  for(const [kind,pattern] of Object.entries(patterns))for(const match of value.matchAll(pattern)){
    if(!/\b(?:sem|nao|no|not|without)(?:\s+\w+){0,2}\s*$/.test(value.slice(Math.max(0,match.index-25),match.index)))found.add(kind);
  }
  return found;
}
function issueFor(result,context){
  if(!result.evidence||!context.latestMessage.includes(result.evidence))return 'evidence da raiz deve copiar literalmente latestMessage. Não use a fala anterior como evidence da raiz.';
  if(result.intent==='refusal'&&!/(?:nao (?:quero|queremos|preciso|precisamos|tenho interesse|temos interesse|estou interessado|estamos interessados|vamos avancar|obrigad)|sem interesse|dispenso|pode encerrar|not interested|no thanks|don.t (?:want|need)|no (?:quiero|queremos|necesito|necesitamos|me interesa|nos interesa|gracias))/i.test(normalize(context.latestMessage)))return 'Não há recusa explícita. Manter WhatsApp/Instagram ou o processo atual não recusa um site solicitado. Releia o pedido positivo e use reply ou scope conforme a etapa; não encerre o contato.';
  if(context.funnel?.allowScope===false&&result.decision.action==='scope')return 'Ainda é abertura ou diagnóstico insuficiente. Use reply curto para entender o negócio ou a intenção atual; não confirme escopo antigo nem monte proposta.';
  if(context.funnel?.allowQuote===false&&['quote','proposal'].includes(result.decision.action))return 'O cliente ainda está explicando a intenção. Responda com uma pergunta curta e contextual; não avance para preço ou proposta sem pedido ou diagnóstico.';
  const scopeResult=result.decision.action==='scope'?scopeAction(result.assessment,context):null;
  if(scopeResult?.action==='reply'&&scopeResult.reason?.startsWith('CALIBRATION_CLARIFY'))return scopeResult.reason;
  if(result.decision.action==='reply'&&context.funnel?.allowScope&&context.automation?.mode==='autonomous'&&context.automation?.projectPricing?.enabled&&!context.automation?.manualRequest
    &&!context.project?.pending&&!context.project?.confirmed&&/\b(?:site|projeto|catalogo|sistema|website|project|web|proyecto)\b/.test(normalize(result.reply))
    &&/(?:e (?:isso|isto)(?: mesmo)?|\b(?:certo|correto|confere)\s*\?|is that (?:right|what)|does that (?:sound|match)|es (?:esto|eso))/.test(normalize(result.reply)))return 'Você já está confirmando um pedido funcional definido. Use action=scope com assessment sustentado pela conversa e reply vazio, para registrar o resumo e permitir avançar após a confirmação. Não repita esse resumo em reply.';
  if(context.funnel&&['opening','discovery'].includes(context.funnel.phase)&&result.decision.action==='handoff'
    &&!['human_request','virtual_assistant','payment','attachment','site_link','examples','busy','ownership'].includes(context.responseGuide.id)
    &&!context.responseGuide.stopIntent)return 'Ainda falta uma informação comum que o cliente pode responder. Use reply com uma pergunta curta e needsReview=false. Falta de objetivo ou de preço fechado não exige encaminhamento humano nesta etapa.';
  if(context.funnel&&['opening','discovery'].includes(context.funnel.phase)&&result.decision.action==='reply'
    &&(result.reply.length>360||result.reply.trim().split(/\s+/).length>55))return 'A resposta inicial ficou longa. Reescreva em 1 ou 2 frases, até 40 palavras e uma pergunta útil sobre o que ainda falta saber. Não faça apresentação completa nem resumo de escopo.';
  if(context.funnel&&result.decision.action==='reply'&&(result.reply.match(/\?/g)||[]).length>1)return 'Há mais de uma pergunta na resposta. Faça uma única pergunta curta sobre o próximo detalhe necessário, sem pedir de novo o objetivo já informado.';
  if(context.funnel?.solutionDue&&result.decision.action==='reply'){
    const reply=normalize(result.reply);
    const concrete=/(?:catalog|site|sistema|painel|pagina|agenda|web|system|dashboard|panel|booking|menu|ementa|cardapio|marcacoes|citas)/.test(reply)
      &&/(?:posso|podemos|poderia|possibilidade|opcao|montar|criar|organizar|permit|cliente|clientes|i can|we can|could|option|create|build|customers?|puedo|podemos|opcion|crear)/.test(reply);
    const moreDiagnosis=/(?:como.{0,65}(?:hoje|atualmente|costuma|organiza|funciona)|o que.{0,45}(?:mais|trava|toma|dificuldade|tempo)|qual.{0,35}(?:maior|problema|dificuldade)|how.{0,60}(?:today|currently|usually)|what.{0,45}(?:most|biggest|time)|como.{0,60}(?:hoy|actualmente|organiza)|que.{0,40}(?:mas|problema|tiempo))[^?]*\?/.test(reply);
    if(moreDiagnosis&&!concrete)return 'O objetivo ou o fluxo já permite uma possibilidade concreta. Não faça outra pergunta apenas sobre rotina, dor ou o que mais toma tempo. Explique a solução para este negócio e esclareça somente a escolha funcional indispensável; com requisitos suficientes, use scope. Não invente requisitos nem preço.';
  }
  if(context.funnel?.ideaRequested&&result.decision.action==='reply'&&/(?:muitas|outras|varias|algumas)\s+(?:clinicas|empresas|lojas|negocios)|(?:many|other|most)\s+(?:clinics|businesses|shops|companies)|(?:muchas|otras|varias)\s+(?:clinicas|empresas|tiendas|negocios)/.test(normalize(result.reply)))return 'O cliente pediu sua sugestão. Explique uma solução que você pode construir para o negócio dele e como funcionaria, com uma única escolha útil. Não substitua a solução por alegações sobre o que outras empresas fazem.';
  if(context.funnel?.replyToOutreach&&result.decision.action==='reply'&&/(?:espera\w*|quer\w*|precisa\w*|gostaria\w*).{0,35}(?:site|projeto).{0,25}(?:resolv|fa[cç]a|fazer)|(?:mente|objetivo).{0,25}(?:projeto|site)/i.test(result.reply))return 'O cliente só informou como atende hoje; não pediu um site. Continue essa conversa com uma pergunta curta sobre o atendimento, sem presumir um projeto ou perguntar o que espera do site.';
  const text=result.decision.action==='scope'?[result.assessment?.summary,...(result.assessment?.requirements||[]).map(r=>r.text)].join('\n'):result.reply;
  const allowed=claims([context.project?.confirmed?.summary,...(context.project?.confirmed?.requirements||[])].join('\n'));
  for(const event of context.history||[]){if(event.role!=='contato')continue;
    if(/\b(?:quero|preciso|gostaria|want|need|would like|quiero|necesito)\b/i.test(event.text))for(const kind of claims(event.text))allowed.add(kind);
  }
  if([...claims(text)].some(kind=>!allowed.has(kind)))return 'Não foi solicitada nem validada integração Instagram/WhatsApp ou disponibilidade/estoque automáticos. Retire essa promessa. Use reply para apresentar uma possibilidade de catálogo e pedido organizado, distinguindo-a de integração e sem garantir estoque automático; confirme apenas a escolha funcional que falta.';
  if(result.decision.action==='scope'){
    if(scopeResult.status==='held')return scopeResult.reason+' Corrija assessment com evidências literais curtas dos requisitos realmente solicitados, inclusive nos fatores; não use descrições suas como evidência.';
  }
  return null;
}
function oneQuestion(result,context){
  if(!context.funnel||context.automation?.mode!=='autonomous'||context.automation?.manualRequest||context.responseGuide?.requiresReview||context.responseGuide?.stopIntent
    ||context.project?.pending||context.project?.confirmed||context.confirmedOffer||result?.decision?.action!=='reply'||result.needsReview
    ||(result.reply.match(/\?/g)||[]).length<2||/[€$]|\b(?:pagamento|desconto|payment|discount|pago|descuento)\b/i.test(result.reply))return null;
  const shortened={...result,reply:result.reply.slice(0,result.reply.indexOf('?')+1).trim()};
  return issueFor(shortened,context)?null:shortened;
}
async function generateWithReview(provider,settings,context,{beforeRetry=async()=>true}={}){
  let first=null,issue;
  const recovery=(problem,scope=false)=>{const reply=recoverConversation(context,problem,{scope});return reply&&!issueFor(reply,context)?reply:null;};
  const finish=(value,second)=>({...value,model:second?.model||first?.model||'server-conversation-recovery',
    usage:{input:(first?.usage?.input||0)+(second?.usage?.input||0),output:(first?.usage?.output||0)+(second?.usage?.output||0)},
    timing:{quotaWaitMs:(first?.timing?.quotaWaitMs||0)+(second?.timing?.quotaWaitMs||0),providerMs:(first?.timing?.providerMs||0)+(second?.timing?.providerMs||0),attempts:second?2:1,recovered:value.reason?.startsWith('Resposta contextual recuperada')===true}});
  try{first=await provider.generate(settings,context,{beforeFallback:beforeRetry});issue=issueFor(first,context);}catch(error){if(!error.repairableFormat)throw error;issue='O JSON anterior não passou na validação. Use o esquema solicitado, evidências literais e assessment=null fora de scope.';}
  if(!issue)return first;
  const concise=oneQuestion(first,context);if(concise)return finish(concise);
  const immediate=recovery(issue);if(immediate)return finish(immediate);
  if(!await beforeRetry()){
    const safe=recovery(issue,true);if(safe)return finish(safe);
    return {...first,reply:'',intent:'unknown',reason:'Não houve cota ou o contexto mudou antes da correção: '+issue,needsReview:true,decision:{action:'handoff'},usage:first?.usage||{input:0,output:0}};
  }
  const repair={...context,repairInstructions:issue};
  Object.defineProperty(repair,'evidenceSources',{enumerable:false,value:context.evidenceSources});
  let corrected;
  try{corrected=await provider.generate(settings,repair,{beforeFallback:beforeRetry});}catch(error){if(!error.repairableFormat)throw error;const safe=recovery(issue,true);if(safe)return finish(safe,{model:first?.model});throw error;}
  const remainingIssue=issueFor(corrected,context);
  const value=remainingIssue?(oneQuestion(corrected,context)||recovery(remainingIssue,true)||{...corrected,reply:'',intent:'unknown',reason:remainingIssue,needsReview:true,decision:{action:'handoff'}}):corrected;
  return finish(value,corrected);
}
module.exports={claims,issueFor,generateWithReview};
