'use strict';
const {isGreeting}=require('./conversation-funnel');
const {clarificationQuestion}=require('./pricing-calibration');
const normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const phrases={
  'pt-BR':{hello:'Oi!',business:'Que tipo de negócio você tem?',goal:'O que você gostaria de facilitar no seu negócio?',outreach:'Posso explicar a ideia para o seu negócio?',work:'Você já usa algum sistema que precisamos aproveitar ou vamos criar essa estrutura do zero?',booking:'Posso montar o agendamento em que o cliente escolhe o horário, com um painel para você administrar a agenda.'},
  'pt-PT':{hello:'Olá!',business:'Que tipo de negócio tem?',goal:'O que gostaria de facilitar no seu negócio?',outreach:'Posso explicar a ideia para o seu negócio?',work:'Já utiliza algum sistema que precisemos de aproveitar ou vamos criar esta estrutura de raiz?',booking:'Posso criar as marcações em que o cliente escolhe o horário, com um painel para gerir a agenda.'},
  'en-US':{hello:'Hello!',business:'What kind of business do you run?',goal:'What would you like to make easier in your business?',outreach:'May I explain the idea for your business?',work:'Do you already use a system we need to work with, or would we build this from scratch?',booking:'I can build appointment booking where customers choose a time, with a panel for you to manage the schedule.'},
  'es-ES':{hello:'Hola.',business:'¿A qué se dedica tu negocio?',goal:'¿Qué te gustaría facilitar en tu negocio?',outreach:'¿Te explico la idea para tu negocio?',work:'¿Ya utilizas algún sistema que debamos aprovechar o lo crearíamos desde cero?',booking:'Puedo crear las reservas donde el cliente elige un horario, con un panel para que gestiones la agenda.'}
};
function recoverConversation(context,issue,{scope=false}={}){
  const message=normalize(context.latestMessage),funnel=context.funnel;
  if(!funnel||context.automation?.mode!=='autonomous'||context.automation?.manualRequest||context.responseGuide?.stopIntent
    ||['human_request','virtual_assistant','payment','attachment','site_link','ownership'].includes(context.responseGuide?.id)
    ||/\b(?:nao quero|sem interesse|nao me contacte|nao me contate|not interested|stop messaging|no quiero|no me contactes)\b/.test(message)
    ||context.project?.pending||context.project?.confirmed||context.confirmedOffer)return null;
  const words=phrases[context.language]||phrases['pt-BR'];let reply='';
  if(String(issue).startsWith('CALIBRATION_CLARIFY')){
    reply=clarificationQuestion(context.language);
  }else if(isGreeting(context.latestMessage)){
    const hello=/^pt/.test(context.language)&&message.includes('boa noite')?'Boa noite!':words.hello;
    reply=hello+' '+(!funnel.categoryKnown?words.business:funnel.replyToOutreach?words.outreach:words.goal);
  }else if(funnel.ideaRequested&&funnel.ideaReply&&['opening','discovery','requirements'].includes(funnel.phase)){
    reply=funnel.ideaReply;
  }else if(funnel.solutionDue&&funnel.solutionExample&&['discovery','requirements'].includes(funnel.phase)
    &&/nao ha recusa explicita|pergunta apenas sobre rotina|outra pergunta apenas sobre|objetivo ou o fluxo ja permite/.test(normalize(issue))){
    // Só recupera a resposta comum que foi rejeitada. Não cria escopo, preço,
    // aceite nem contorna uma recusa real, integração ou pedido de intervenção.
    reply=funnel.solutionExample;
  }else if(scope&&funnel.allowScope&&/evidencia|requisito|fatores/.test(normalize(issue))
    &&! /integr|sincron|google|api\b|pagamento|payment|pago/.test(message)){
    const booking=/agend|marcac|appointment|booking|citas|reservas/.test(message);
    const management=/administr|gerenc|gerir|gestiona|manage/.test(message);
    reply=(booking&&management?words.booking+' ':'')+words.work;
  }
  if(!reply||context.history?.some(e=>e.role==='Ronald'&&normalize(e.text)===normalize(reply)))return null;
  return{reply,intent:'question',evidence:String(context.latestMessage||'').slice(0,600),reason:'Resposta contextual recuperada após falha de validação, sem preço, escopo ou confirmação financeira.',
    nextStep:'Continuar com uma escolha útil, sem deixar uma mensagem comum sem retorno.',needsReview:false,decision:{action:'reply'},memory:[]};
}
module.exports={recoverConversation};
