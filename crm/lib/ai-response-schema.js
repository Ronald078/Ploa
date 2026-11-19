'use strict';
const {isGreeting}=require('./conversation-funnel');
const str={type:'string'},boolean={type:'boolean'};
const choice=values=>({type:'string',enum:values});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
function evidenceBindings(context){
  const texts=[...(context.history||[]).filter(e=>e.role==='contato').map(e=>e.text),...Object.values(context.memory||{}).map(e=>e.evidence).filter(Boolean)];
  return [...new Set(texts)].map((text,index)=>({id:'c'+(index+1),text}));
}
function decodeEvidence(value,context){
  const refs=new Map(evidenceBindings(context).map(e=>[e.id,e.text.slice(0,600)]));
  const decode=items=>(items||[]).map(item=>({...item,evidence:refs.get(item.evidence)||item.evidence}));
  return{...value,memory:decode(value.memory),...(value.assessment?{assessment:{...value.assessment,requirements:decode(value.assessment.requirements),drivers:decode(value.assessment.drivers)}}:{})};
}
function responseFormat(context){
  const latest=String(context.latestMessage||'').slice(0,600);
  const bindings=evidenceBindings(context),refs=bindings.map(e=>e.id);
  // "Sim" e saudações podem constar no histórico/memória, mas não provam
  // sozinhos um requisito funcional para o diagnóstico do projeto.
  const scopeRefs=bindings.filter(e=>e.text.trim().length>=4&&!isGreeting(e.text)
    &&!/^(?:sim|isso|isto|certo|correto|exatamente|ok|yes|right|exactly|si|sí|correcto)[.!?,\s]*$/i.test(e.text.trim())).map(e=>e.id);
  if(!refs.length)refs.push('c0');
  const assessment=object({serviceType:choice(['site','system','site_system']),work:choice(['new','update','replace']),summary:str,
    requirements:{type:'array',items:object({text:str,evidence:choice(scopeRefs.length?scopeRefs:['c0'])})},
    drivers:{type:'array',items:object({dimension:choice(['presentation','contentManagement','purchaseFlow','businessRules','dataHandling','externalConnections','changeEffort']),level:choice(['basic','moderate','advanced']),evidence:choice(scopeRefs.length?scopeRefs:['c0'])})},technicalReview:boolean});
  assessment.type=['object','null'];
  const activeAssessment=context.funnel?.allowScope===false||!scopeRefs.length?{type:'null'}:assessment;
  const schema=object({reply:str,intent:choice(['unknown','bot','question','objection','interested','proposal_request','acceptance','refusal','opt_out']),reason:str,
    evidence:choice([latest]),nextStep:str,needsReview:boolean,
    decision:object({action:choice(['reply',...(context.funnel?.allowScope===false||!scopeRefs.length||(!context.funnel&&context.responseGuide?.id==='contextual_confirmation'&&!context.project?.pending)?[]:['scope']),...(context.funnel?.allowQuote===false?[]:['quote','proposal']),'accept','handoff','close']),offerId:str,proposalId:str,discountPercent:{type:'number'},confirmScope:boolean,reason:str}),
    memory:{type:'array',items:object({field:choice(['need','objection','decisionMaker','currentChannel','requirements','agreed','nextStep']),value:str,evidence:choice(refs)})},assessment:activeAssessment});
  return{type:'json_schema',json_schema:{name:'ploa_conversation_response',strict:true,schema}};
}
module.exports={responseFormat,evidenceBindings,decodeEvidence};
