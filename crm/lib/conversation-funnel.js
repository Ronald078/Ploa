'use strict';
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const isGreeting=text=>/^(?:(?:oi+|oie|ola|hello|hi|hey)[!?,.\s]*)?(?:bom dia|boa tarde|boa noite|good morning|good afternoon|good evening|hola|buenas|buenos dias|buenas tardes|buenas noches)?[!?,.\s]*$/.test(norm(text).trim())&&/[a-z]/.test(norm(text));
const clinicIdeas={
  'pt-BR':'Posso criar um site que apresente os serviços da clínica e organize os agendamentos. Você prefere que o paciente escolha um horário disponível ou envie o pedido pelo WhatsApp?',
  'pt-PT':'Posso criar um site que apresente os serviços da clínica e organize as marcações. Prefere que o paciente escolha um horário disponível ou envie o pedido pelo WhatsApp?',
  'en-US':'I can build a website that presents your clinic’s services and organizes appointments. Should patients choose an available time themselves or send a request through WhatsApp?',
  'es-ES':'Puedo crear una web que presente los servicios de tu clínica y organice las citas. ¿Prefieres que el paciente elija un horario disponible o envíe la solicitud por WhatsApp?'
};
const examples={
  'clinica':{
    'pt-BR':['Como vocês organizam os agendamentos hoje?','O que você gostaria de facilitar na clínica?'],
    'pt-PT':['Como organizam as marcações atualmente?','O que gostaria de facilitar na clínica?'],
    'en-US':['How do you manage appointments today?','What would you like to make easier at your clinic?'],
    'es-ES':['¿Cómo organizáis las citas actualmente?','¿Qué te gustaría facilitar en tu clínica?']},
  'restaurante':{
    'pt-BR':['Hoje vocês recebem pedidos por ali ou usam mais para mostrar o cardápio?','Claro! O que você gostaria que o site ajudasse a fazer no restaurante?'],
    'pt-PT':['Recebem pedidos por aí ou usam mais para mostrar a ementa?','Claro! O que gostaria que o site ajudasse a fazer no restaurante?'],
    'en-US':['Do you take orders there, or mainly use it to show the menu?','Sure! What would you like the website to do for your restaurant?'],
    'es-ES':['¿Recibís pedidos por ahí o lo usáis sobre todo para mostrar la carta?','Claro. ¿Qué te gustaría que hiciera la web para tu restaurante?']},
  'clinica de estetica':{
    'pt-BR':['E os horários são marcados pelo WhatsApp também?','Claro! O que você gostaria de facilitar na clínica com esse projeto?'],
    'pt-PT':['E as marcações também são feitas pelo WhatsApp?','Claro! O que gostaria de facilitar na clínica com este projeto?'],
    'en-US':['Do clients book appointments through WhatsApp too?','Sure! What would you like this project to make easier at the clinic?'],
    'es-ES':['¿Las citas también se piden por WhatsApp?','Claro. ¿Qué te gustaría facilitar en la clínica con este proyecto?']},
  'salao de beleza':{
    'pt-BR':['Os clientes marcam os horários pelo WhatsApp ou de outra forma?','Claro! O que você tem em mente para o site do salão?'],
    'pt-PT':['Os clientes fazem as marcações pelo WhatsApp ou de outra forma?','Claro! O que tem em mente para o site do salão?'],
    'en-US':['Do clients book through WhatsApp, or another way?','Sure! What do you have in mind for the salon website?'],
    'es-ES':['¿Los clientes reservan por WhatsApp o de otra forma?','Claro. ¿Qué tienes en mente para la web del salón?']},
  'loja de roupa':{
    'pt-BR':['Quando alguém gosta de uma peça, como vocês seguem com o pedido?','Claro! O que você gostaria que o site fizesse pela loja?'],
    'pt-PT':['Quando alguém gosta de uma peça, como seguem com a encomenda?','Claro! O que gostaria que o site fizesse pela loja?'],
    'en-US':['When someone likes an item, how do you handle the order?','Sure! What would you like the website to do for your shop?'],
    'es-ES':['Cuando a alguien le gusta una prenda, ¿cómo gestionáis el pedido?','Claro. ¿Qué te gustaría que hiciera la web para tu tienda?']},
  'barbearia':{
    'pt-BR':['E os horários são marcados pelo WhatsApp ou vocês atendem por ordem de chegada?','Claro! O que você tem em mente para o site da barbearia?'],
    'pt-PT':['As marcações são pelo WhatsApp ou atendem por ordem de chegada?','Claro! O que tem em mente para o site da barbearia?'],
    'en-US':['Do clients book through WhatsApp, or do you take walk-ins?','Sure! What do you have in mind for the barbershop website?'],
    'es-ES':['¿Los clientes reservan por WhatsApp o atendéis por orden de llegada?','Claro. ¿Qué tienes en mente para la web de la barbería?']},
  'pet shop':{
    'pt-BR':['Vocês vendem produtos, fazem banho e tosa ou trabalham com os dois?','Claro! O que você gostaria de facilitar no pet shop com esse projeto?'],
    'pt-PT':['Vendem produtos, fazem banhos e tosquias ou trabalham com ambos?','Claro! O que gostaria de facilitar na loja com este projeto?'],
    'en-US':['Do you sell products, offer grooming, or both?','Sure! What would you like this project to make easier at your pet shop?'],
    'es-ES':['¿Vendéis productos, ofrecéis peluquería para mascotas o ambas cosas?','Claro. ¿Qué te gustaría facilitar en tu negocio con este proyecto?']},
  'academia':{
    'pt-BR':['Quais informações sobre os planos ou modalidades vocês mais precisam explicar no atendimento?','Claro! O que você gostaria que o site facilitasse na academia?'],
    'pt-PT':['Que informações sobre os planos ou modalidades precisam mais de explicar no atendimento?','Claro! O que gostaria que o site facilitasse no ginásio?'],
    'en-US':['What do people most often ask about your memberships or classes?','Sure! What would you like the website to make easier at your gym?'],
    'es-ES':['¿Qué os suelen preguntar más sobre las tarifas o las actividades?','Claro. ¿Qué te gustaría facilitar en el gimnasio con la web?']},
  'clinica odontologica':{
    'pt-BR':['Quando alguém quer marcar uma avaliação, como vocês organizam esse contato?','Claro! O que você gostaria que o site ajudasse a organizar na clínica?'],
    'pt-PT':['Quando alguém quer marcar uma avaliação, como organizam esse contacto?','Claro! O que gostaria que o site ajudasse a organizar na clínica?'],
    'en-US':['How do you handle requests for a first appointment?','Sure! What would you like the website to help organize at the clinic?'],
    'es-ES':['¿Cómo gestionáis las solicitudes de una primera cita?','Claro. ¿Qué te gustaría organizar en la clínica con la web?']}
};
const generic={
  'pt-BR':{opening:'Claro! Que tipo de negócio você tem?',goal:'E o que você tem em mente para esse projeto?',idea:'Uma possibilidade é mostrar as peças num catálogo e deixar o cliente montar o pedido antes de falar com você. Isso ajudaria no atendimento?',channel:'Hoje vocês recebem os pedidos por ali também?'},
  'pt-PT':{opening:'Claro! Que tipo de negócio tem?',goal:'E o que tem em mente para este projeto?',idea:'Uma possibilidade é mostrar as peças num catálogo e deixar o cliente preparar a encomenda antes de falar consigo. Isso ajudaria no atendimento?',channel:'Também recebem encomendas por aí?'},
  'en-US':{opening:'Sure! What kind of business do you run?',goal:'What do you have in mind for this project?',idea:'One option is a catalog where customers choose their items before messaging you. Would that help with your orders?',channel:'Do you take orders there too?'},
  'es-ES':{opening:'Claro. ¿A qué se dedica tu negocio?',goal:'¿Qué tienes en mente para este proyecto?',idea:'Una opción sería un catálogo donde el cliente eligiera las prendas antes de escribirte. ¿Te ayudaría a gestionar los pedidos?',channel:'¿También recibís pedidos por ahí?'}
};
const catalogSolutions={
  'pt-BR':'Dá para facilitar essa consulta, sim. Com um catálogo, a pessoa já conhece as opções antes de chamar você. A ideia é manter os pedidos por aqui ou também permitir a compra pelo site?',
  'pt-PT':'Podemos facilitar essa consulta com um catálogo, para a pessoa conhecer as opções antes de falar consigo. Prefere manter as encomendas pelo WhatsApp ou permitir a compra no site?',
  'en-US':'We could make this easier with a catalog that lets customers explore the items before contacting you. Would you prefer keeping orders on WhatsApp or letting people buy on the website?',
  'es-ES':'Podemos facilitar esa consulta con un catálogo para que el cliente vea las opciones antes de escribirte. ¿Prefieres mantener los pedidos por WhatsApp o permitir la compra en la web?'
};
function categoryKey(value){const key=norm(value).trim();return Object.hasOwn(examples,key)?key:'';}
function categoryFromCustomer(text){
  const value=norm(text),patterns=[['clinica odontologica',/odont|dentist|dental/],['clinica de estetica',/estetica|aesthetic|skincare/],['barbearia',/barbearia|barber/],['pet shop',/pet ?shop|pet store|loja de animais|tienda de mascotas/],['academia',/academia|ginasio|\bgym\b|gimnasio/],['salao de beleza',/salao|salon/],['restaurante',/restaurante|restaurant/],['loja de roupa',/roupa|clothing|clothes|prendas|tienda de moda/]];
  return patterns.find(([,pattern])=>pattern.test(value))?.[0]||(/\bclinica|\bclinic\b/.test(value)?'clinica':'');
}
function funnelContext({category,language,history,record,openingMessage}){
  const last=history.filter(e=>e.role==='contato').at(-1)?.text||'',value=norm(last);
  const incoming=history.filter(e=>e.role==='contato').map(e=>e.text);
  const categoryId=categoryFromCustomer(incoming.join(' '))||categoryKey(category),labels=generic[language]||generic['pt-BR'];
  const ideaRequested=/\b(?:sugere|sugeres|sugieres|sugiere|suggest|recommend|recomenda|recomendas|recomienda)\b|(?:alguma?|uma?|any|an?|alguna).{0,15}\b(?:ideia|idea|sugestao|suggestion)\b/.test(value);
  const ideaReply=ideaRequested&&categoryId.startsWith('clinica')?(clinicIdeas[language]||clinicIdeas['pt-BR']):ideaRequested&&categoryId==='loja de roupa'?labels.idea:null;
  const businessKnown=Boolean(categoryId)||/(?:restaurante|restaurant|loja|shop|store|tienda|barbearia|barber|sal[aã]o|salon|clinica|clinic|pet ?shop|academia|ginasio|gym|negocio de|business selling|empresa de)/.test(norm(incoming.join(' ')));
  const functional=/(?:mostrar|apresentar|exibir|agend|marcar|gerenc|control|cadastrar|atualizar|pedid|vender|estoque|catalog|cardapio|ementa|show|display|book|appointment|manage|update|orders?|sell|inventory|mostrar|presentar|reservar|gestionar|actualizar|vender)/;
  // Clientes descrevem o resultado que desejam, não necessariamente a ferramenta.
  const visibilityGoal=text=>/\b(?:ver|verem|vejam|vissem|consultar|consultem|acessar|acessem|see|view|browse|find|vieran|vean|consulten|acceder)\b/.test(text)
    &&/\b(?:pecas?|produtos?|disponibilidade|disponiveis|servicos?|tratamentos?|precos?|products?|items?|availability|available|services?|treatments?|prices?|prendas?|productos?|disponibilidad|disponibles|servicios?|tratamientos?|precios?)\b/.test(text);
  const wants=/(?:quero|preciso|gostaria|gostava|gostavamos|queria|queriamos|want|need|would like|i['’]d like|quiero|necesito|gustaria)/;
  const previous=norm([...history].reverse().find(e=>e.role==='Ronald')?.text);
  const affirmedIdea=/^(?:sim|quero sim|isso mesmo|exatamente|yes|that would help|sounds good|si|exacto)\b/.test(value.trim())&&!/\b(?:mas|se|but|if|pero)\b/.test(value)
    &&/(?:possibilidade|poderia|poderiamos|uma ideia|one option|could|una opcion|podria|(?:posso|podemos|i can|we can|puedo|podemos)\s+(?:criar|montar|construir|build|create|crear))/.test(previous)
    &&/(?:ajudaria|interessa|faz sentido|gostaria|would.*help|would you like|ayudaria|te interesa)/.test(previous)&&functional.test(previous);
  const statedFunction=incoming.some(text=>wants.test(norm(text))&&functional.test(norm(text)));
  const statedOutcome=incoming.some(text=>wants.test(norm(text))&&visibilityGoal(norm(text)));
  // Uma resposta a uma escolha futura é diferente de informar o canal atual.
  const offeredChoice=/(?:posso|podemos|poderia|possibilidade|opcao|da para|a ideia|i can|we can|could|one option|a possibility|one possibility|puedo|podemos|podria|opcion|una idea)/.test(previous)
    &&/(?:prefere|preferia|gostaria|quer|prefer|would you|prefieres|quieres|a ideia e|the idea is|la idea es)/.test(previous)
    &&/(?:site|catalog|pagina|web|pedid|order|compra|checkout)/.test(previous);
  const chosenOption=offeredChoice&&(/^(?:(?:prefiro|quero|i prefer|i want|prefiero|quiero)\s+)?(?:(?:receber|mandar|enviar|receive|send|recibir)\s+(?:(?:os?|the|los?)\s+)?(?:pedidos?|orders?)\s+)?(?:(?:pelo|no|por|via|through|on|by|en)\s+)?(?:whatsapp|zap|site|website|web|catalogo|catalog|checkout)[.!\s]*$/.test(value.trim())
    ||(/^(?:por )?aqui(?: mesmo)?[.!\s]*$/.test(value.trim())&&/whatsapp|por aqui/.test(previous)));
  const declared=affirmedIdea||statedFunction||statedOutcome||chosenOption;
  const needsFunctionalChoice=statedOutcome&&!statedFunction&&!affirmedIdea&&!chosenOption;
  const generalRequest=wants.test(value)&&/(?:projeto|site|sistema|website|project|system|web|proyecto)/.test(value)&&!functional.test(value);
  const greeting=isGreeting(last);
  const priceQuestion=/quanto (?:custa|fica)|qual (?:e )?(?:o )?(?:valor|preco)|how much|what(?: is|'s) (?:the |your )?(?:price|cost)|cuanto (?:cuesta|sale)|cual (?:es|seria) (?:el )?(?:precio|coste)|^(?:[¿?]\s*)?(?:price|cost|precio|presupuesto)[?!.]*$/.test(value.trim());
  const commerceNeedsDetail=/(?:loja (?:on ?line|virtual)|online (?:store|shop)|tienda online)/.test(value)
    &&!/(?:whatsapp|pedido|checkout|pagamento|pagar|payment|pay online|pay by|order|pago|carrito|cart|carrinho|estoque|inventory)/.test(value);
  const isReopening=Boolean(generalRequest&&(record.projectDraft||record.projectAssessment||record.lastQuotedOffer));
  const awaitingConfirmation=Boolean(record.projectDraft?.status==='pending'&&!generalRequest);
  let phase=awaitingConfirmation?'scope_confirmation':record.lastQuotedOffer&&!generalRequest?'commercial':declared&&!generalRequest?'requirements':'discovery';
  if(!declared&&businessKnown&&/(?:que tipo.*negocio|com o que.*trabalh|what kind.*business|que.*negocio|a que.*dedica)/.test(previous))phase='opening';
  if(commerceNeedsDetail&&wants.test(value))phase='requirements';
  if(generalRequest||greeting)phase='opening';
  const diagnosticQuestions=history.filter(e=>e.role==='Ronald'&&e.text.includes('?')).length;
  const solutionDue=!generalRequest&&!greeting&&!awaitingConfirmation&&!record.projectAssessment&&!record.lastQuotedOffer
    &&businessKnown&&(declared||diagnosticQuestions>=2);
  const solutionExample=solutionDue?(categoryId==='loja de roupa'?(catalogSolutions[language]||catalogSolutions['pt-BR']):categoryId.startsWith('clinica')?(clinicIdeas[language]||clinicIdeas['pt-BR']):null):null;
  const matching=categoryId?(examples[categoryId]?.[language]||examples[categoryId]?.['pt-BR']):null;
  const sampleOpening=businessKnown?(generalRequest&&!/site|website|web/.test(value)?labels.goal:matching?.[1]||labels.goal):labels.opening;
  const samples=solutionDue?(solutionExample?[{customer:last,reply:solutionExample}]:[]):phase==='opening'?[{customer:language==='en-US'?'I’d like a project for my business.':language==='es-ES'?'Quiero un proyecto para mi negocio.':'Gostaria de fazer um projeto para meu negócio.',reply:sampleOpening}]:
    [{previousTopic:'Pergunta da primeira copy sobre apresentação do negócio.',customer:'Instagram / WhatsApp',reply:matching?.[0]||labels.channel}];
  if(ideaReply)samples.push({customer:last,reply:ideaReply});
  const channels=['instagram','whatsapp'].filter(channel=>norm(incoming.join(' ')).includes(channel));
  const replyToOutreach=Boolean(openingMessage)&&!incoming.some(text=>wants.test(norm(text)));
  return{phase,categoryKnown:businessKnown,category:categoryId,openingMessage,isReopening,knownChannels:channels,replyToOutreach,affirmedIdea,ideaRequested,ideaReply,solutionDue,solutionExample,diagnosticQuestions,needsFunctionalChoice,
    allowScope:declared&&!generalRequest&&!greeting&&!awaitingConfirmation&&!commerceNeedsDetail&&!needsFunctionalChoice,
    allowQuote:priceQuestion||Boolean((record.projectAssessment||record.lastQuotedOffer||awaitingConfirmation)&&!generalRequest&&!greeting),
    nextStep:solutionDue?'Já há informação para apresentar uma possibilidade concreta. Explique em uma frase o que Ronald pode construir e como ajudaria neste fluxo, sem prometer integrações ou automatização ainda não confirmadas. Pergunte no máximo uma escolha indispensável para definir o projeto, como pedido pelo WhatsApp ou compra no site, ou criar versus atualizar. Se o funcionamento já foi definido pelo cliente, use scope para resumir e confirmar, sem outra rodada sobre dores, rotina ou o que mais toma tempo. Não trate a sua sugestão como requisito aceito e não antecipe preço.':ideaRequested&&businessKnown?'O cliente pediu uma sugestão. Explique uma solução que Ronald pode construir para este negócio, como funcionaria e uma escolha útil para avançar. Não responda apenas contando o que outras empresas fazem, não invente prova de mercado e não devolva a pergunta sobre o que ele quer melhorar.':commerceNeedsDetail?'O cliente já disse que quer uma loja online. Pergunte se quer concluir a compra no site ou receber o pedido pelo WhatsApp; não pergunte de novo qual é o objetivo da loja.':phase==='opening'?(businessKnown?'Pergunte o que a pessoa quer fazer ou facilitar, sem presumir site se ela só disse projeto.':'Pergunte o tipo de negócio, a menos que a própria mensagem já o informe.'):
      phase==='discovery'?'Continue a pergunta da primeira copy. Entenda o atendimento atual com uma pergunta específica; não presuma que a pessoa já quer um site ou projeto só porque respondeu à copy. Não pergunte o que espera do site antes de ela dizer que quer um. Não repita canais informados. Se ela disse que atende dúvidas por WhatsApp, pergunte quais dúvidas, não se atende por WhatsApp.':
      phase==='requirements'?'Esclareça só a escolha funcional ainda necessária. Se o pedido já estiver definido, resuma para confirmação; não reinicie o diagnóstico.':
      phase==='scope_confirmation'?'Interprete a resposta ao resumo enviado. Só avance se for confirmação desse resumo sem alterações.':'Responda ao ponto comercial atual usando as condições autorizadas.',
    examples:samples};
}
module.exports={funnelContext,categoryKey,examples,generic,isGreeting};
