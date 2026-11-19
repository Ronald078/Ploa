'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {formatScope}=require('./scope-message');
const {calibrateAssessment,clarificationQuestion}=require('./pricing-calibration');
const SERVICE_TYPES=['site','system','site_system'];
const DIMENSIONS=['presentation','contentManagement','purchaseFlow','businessRules','dataHandling','externalConnections','changeEffort'];
const LEVELS={basic:0,moderate:0.5,advanced:1};
const clean=(value,max=800)=>String(value??'').trim().slice(0,max);
const normalize=value=>clean(value,16000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const monetaryOrPromise=value=>/(?:R\$|US\$|[€$£]|BRL|USD|EUR)\s*\d|\d\s*%|\d+\s*(?:dias?|days?|semanas?|weeks?|meses|months?)\b|pagamento confirmado|payment received|pago confirmado|garantid|guaranteed|garantiz|\[(?:CONTATO|LINK|EMAIL|NUMERO)\]/i.test(value);

function normalizeProjectPricing(raw){
  if(raw===undefined||raw===null)return null;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!['qualitative_factors_v1','qualitative_average_v1'].includes(raw.method))throw Object.assign(new Error('Configuração do cálculo de projeto inválida.'),{statusCode:400});
  return{enabled:raw.enabled===true,method:'qualitative_factors_v1'};
}

function assessmentFrom(raw,context){
  if(!raw||!SERVICE_TYPES.includes(raw.serviceType)||!['new','update','replace'].includes(raw.work)||typeof raw.technicalReview!=='boolean')throw new Error('Complete o tipo de projeto, o trabalho e a avaliação de viabilidade.');
  const sources=(context.evidenceSources||context.history?.filter(item=>item.role==='contato').map(item=>item.text)||[]).map(normalize);
  const supports=evidence=>{const value=normalize(evidence);return value.length>=4&&sources.some(source=>source.includes(value));};
  if(!Array.isArray(raw.requirements)||!raw.requirements.length||raw.requirements.length>8||!Array.isArray(raw.drivers)||!raw.drivers.length||raw.drivers.length>DIMENSIONS.length)throw new Error('O diagnóstico precisa de requisitos e fatores de complexidade sustentados pela conversa.');
  const requirements=raw.requirements.map(item=>{
    const text=clean(item?.text,220),evidence=clean(item?.evidence,600);
    if(!text||monetaryOrPromise(text)||!supports(evidence))throw new Error('Um requisito não tem evidência válida ou contém condição comercial não autorizada.');
    return{text,evidence};
  });
  const used=new Set();
  const drivers=raw.drivers.map(item=>{
    if(!item||!DIMENSIONS.includes(item.dimension)||!Object.hasOwn(LEVELS,item.level)||used.has(item.dimension)||!supports(item.evidence))throw new Error('Confira a evidência e o nível dos fatores de complexidade, sem repetir fatores.');
    used.add(item.dimension);return{dimension:item.dimension,level:item.level,evidence:clean(item.evidence,600)};
  }).sort((a,b)=>a.dimension.localeCompare(b.dimension));
  const summary=clean(raw.summary,800);
  if(summary.length<15||monetaryOrPromise(summary))throw new Error('O resumo deve explicar o funcionamento do projeto sem inventar preço, prazo ou garantia.');
  if(summary.length+requirements.reduce((sum,item)=>sum+item.text.length+3,0)>1700)throw new Error('Resuma o escopo em grupos de trabalho antes de preparar a proposta.');
  const assessment=calibrateAssessment({serviceType:raw.serviceType,work:raw.work,summary,requirements,drivers,technicalReview:raw.technicalReview},context);
  return{...assessment,basisHash:hash(assessment)};
}

function scopeAction(raw,context){
  try{
    const assessment=assessmentFrom(raw,context);
    if(assessment.calibration?.rule==='needs_functional_choice')return{status:'ready',action:'reply',text:clarificationQuestion(context.language),reason:'CALIBRATION_CLARIFY: falta distinguir gestão de conteúdo de operação própria antes do escopo e do preço.'};
    // O mesmo escopo que será precificado aparece antes para o contato confirmar.
    const text=formatScope(assessment,context.language);
    return{status:'ready',action:'scope',text,scopeDraft:{...assessment,id:randomUUID()},reason:'Resumo do funcionamento preparado para confirmação, sem aceite de proposta ou pagamento.'};
  }catch(error){return{status:'held',action:'handoff',text:'',reason:error.message};}
}

function catalogSignature(offer){return hash([offer.id,offer.market,offer.currency,offer.serviceType,offer.amount,offer.amountMax,offer.terms,offer.deadline,offer.maintenance]);}
function calculate(assessment,offer){
  // Combinação crescente: acrescentar um fator nunca reduz o preço anterior.
  const ratio=1-assessment.drivers.reduce((remaining,item)=>remaining*(1-LEVELS[item.level]),1);
  const minCents=Math.round(Number(offer.amount)*100),maxCents=Math.round(Number(offer.amountMax)*100);
  const amount=Math.round(minCents+(maxCents-minCents)*ratio)/100;
  if(!Number.isFinite(amount)||amount<offer.amount||amount>offer.amountMax)throw new Error('O cálculo saiu da faixa autorizada.');
  return{...assessment,offerId:offer.id,amount,currency:offer.currency,minimum:offer.amount,maximum:offer.amountMax,
    status:'confirmed',method:'qualitative_factors_v1',ratio,catalogSignature:catalogSignature(offer),confirmedAt:new Date().toISOString()};
}

function confirmsScope(message){
  const value=normalize(message);
  return /^(?:sim\b|isso (?:mesmo|ai)|exat(?:o|amente)\b|correto\b|esta (?:certo|correto)|perfeito\b|yes\b|exactly\b|correct\b|that s right|sounds good|si\b|exacto\b|correcto\b|de acuerdo\b|es eso\b)/.test(value)
    &&! /\b(?:nao|not|no|mas|but|pero|se|if|except|exceto|salvo|talvez|maybe)\b/.test(value);
}

function resolvedOffer(offer,assessment){
  return{...offer,pricingMode:'fixed',sourcePricingMode:'range',amount:assessment.amount,amountMax:assessment.amount,
    approvedMinimum:assessment.minimum,approvedMaximum:assessment.maximum,pricingBasisHash:assessment.basisHash,
    scopeSummary:assessment.summary,scope:[assessment.summary,...assessment.requirements.map(item=>'• '+item.text)].join('\n')};
}

function resolveProjectOffer(offer,record,context,decision,business){
  if(offer.pricingMode!=='range'||!business.projectPricing?.enabled)return{offer};
  const draft=record.projectDraft;
  let assessment=record.projectAssessment;
  if(draft?.status==='pending'){
    if(decision.confirmScope!==true)return{offer,pending:true};
    if(record.lastInbound===draft.inbound||!confirmsScope(context.latestMessage))return{reason:'O cliente ainda não confirmou claramente o resumo. Esclareça alterações ou condições antes do preço fechado.'};
    if(!draft.sentAt)return{reason:'O resumo ainda não tem envio confirmado.'};
    if(draft.technicalReview)return{reason:'O projeto precisa de avaliação técnica de Ronald antes de uma proposta fechada.'};
    if(draft.serviceType!==offer.serviceType)return{reason:'A oferta selecionada não corresponde ao tipo de projeto confirmado.'};
    try{assessment=calculate(draft,offer);}catch(error){return{reason:error.message};}
    assessment={...assessment,confirmationEvidence:clean(context.latestMessage,900),confirmationInbound:record.lastInbound};
  }
  if(!assessment)return{offer,pending:true};
  if(assessment.offerId!==offer.id||assessment.serviceType!==offer.serviceType)return{reason:'O diagnóstico confirmado pertence a outra solução. Confirme um novo escopo antes de trocar a oferta.'};
  if(assessment.catalogSignature!==catalogSignature(offer))return{reason:'As condições do catálogo mudaram. Reconfirme o projeto antes de apresentar outro preço.'};
  if(assessment.technicalReview)return{reason:'O projeto precisa de avaliação técnica de Ronald.'};
  return{offer:resolvedOffer(offer,assessment),assessment};
}

function projectContext(record,safe){
  const draft=record.projectDraft?.status==='pending'?record.projectDraft:null;
  const confirmed=record.projectAssessment;
  return{pending:draft?{id:draft.id,serviceType:draft.serviceType,work:draft.work,summary:safe(draft.summary),
    requirements:draft.requirements.map(item=>safe(item.text)),technicalReview:draft.technicalReview}:null,
    confirmed:confirmed?{offerId:confirmed.offerId,serviceType:confirmed.serviceType,summary:safe(confirmed.summary),
      requirements:confirmed.requirements.map(item=>safe(item.text)),amount:confirmed.amount,currency:confirmed.currency,basisHash:confirmed.basisHash}:null};
}

const PRICING_INSTRUCTIONS=`No modo autonomous, quando automation.projectPricing.enabled=true e automation.manualRequest não for true, prepare action=scope e assessment somente depois de descobrir requisitos explicitamente solicitados e entender o que deve mudar, sem valores. Uma descrição do processo atual ou interesse geral em uma solução não basta para scope: nesse caso use reply, faça uma pergunta ao cliente e mantenha needsReview=false. O servidor envia o resumo e a lista de requisitos e pede confirmação; isso não é proposta nem aceite comercial. Só use fatos do contato e evidência literal, nunca os exemplos do guia. Em pedido manual de sugestão ou outro modo de atendimento, use reply com texto para revisão, sem ações de scope ou proposta automática e sem inventar valores; Ronald decide o envio.
assessment contém serviceType=site|system|site_system, work=new|update|replace, summary no idioma do contato, requirements=[{text,evidence}], drivers=[{dimension,level,evidence}] e technicalReview=true|false. Agrupe o escopo de forma curta e compreensível, preferindo até cinco grupos funcionais sem omitir requisitos; use evidências literais curtas e memória apenas para fatos novos. Não coloque valores, prazos ou benefícios da manutenção mensal no escopo funcional; vêm do catálogo. Os fatores aplicáveis são presentation, contentManagement, purchaseFlow, businessRules, dataHandling, externalConnections e changeEffort. Cada fator aparece uma vez; omita fatores desnecessários, sem inventar demanda. Use basic para trabalho direto com pouca lógica, moderate para gestão/fluxos de complexidade intermediária, advanced para regras, dependências e operações mais profundas. A evidência precisa mostrar o porquê. Não use quantidades rígidas de páginas/produtos, não classifique atualização como simples sem entender o trabalho e não pergunte níveis técnicos ao cliente. Integração ou viabilidade desconhecida exige technicalReview=true.
Tanto requirements[].evidence quanto drivers[].evidence devem copiar um trecho literal do contato; a explicação inferida do fator não serve como evidence. Por exemplo, se o cliente disse “quero alterar os textos sozinho”, esse trecho pode sustentar contentManagement; “gerenciamento de conteúdo” não é evidência literal. O fato de a mensagem conter palavras como estoque, foto ou WhatsApp não autoriza inventar uma integração ou registrar uma necessidade que não foi pedida.
O servidor calcula o preço pela combinação crescente dos fatores qualitativos aplicáveis dentro da faixa autorizada. Você não fornece preço, fórmula ou posição numérica. Se project.pending existe e a última mensagem confirma o resumo sem alterações, use quote ou proposal com confirmScope=true e o offerId do tipo de serviço correspondente. Confirmar resumo não significa aceitar a proposta. Mensagem condicional, correção ou novo requisito pede esclarecimento e, quando necessário, outro scope. Não faça scope de novo se o projeto já está confirmado e nada mudou.
Com project.confirmed, mantenha o preço original e o mesmo escopo ao negociar; não reclassifique complexidade para dar desconto disfarçado. Se o cliente só pede preço antes do diagnóstico, quote pode mostrar a faixa estimada sem proposta fechada. Para condições finais, o servidor usa o escopo confirmado, o preço calculado e os dados reais do catálogo. Qualquer pedido fora da viabilidade ou dos limites exige handoff.`;

module.exports={SERVICE_TYPES,DIMENSIONS,normalizeProjectPricing,scopeAction,resolveProjectOffer,projectContext,PRICING_INSTRUCTIONS,confirmsScope};
