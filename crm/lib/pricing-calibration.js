'use strict';
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const VERSION='2026-11-01-content-v1';
const PRINCIPLES='Classifique pelo funcionamento, não por palavras como painel, cadastro, sistema ou automático. Site inclui apresentação pública e gestão simples do próprio conteúdo. System organiza uma operação interna; site_system combina a parte pública com regras operacionais próprias. Cadastro/edição manual de textos, serviços, produtos e disponibilidade é basic; um botão ou pedido encaminhado ao WhatsApp não é checkout nem integração. Um sistema também pode ser básico: uma operação usual sem regras extras não é automaticamente moderate. Moderate exige fluxos adicionais concretos; advanced exige regras ou dependências profundas explicitadas. Não elevar o nível pelo nicho, banco de dados ou painel. Exemplos não são níveis obrigatórios: confira os detalhes. Atualização não garante desconto ou reaproveitamento. Se faltar a distinção funcional, faça uma pergunta curta antes do valor fechado. Use as faixas cadastradas; não reprecificar projeto confirmado.';

const SCENARIOS=[
  {id:'presentation',match:/site|website|servic|portfolio|pagina/,serviceType:'site',level:'basic',example:'Apresentar serviços, localização e contato: site. Botão para WhatsApp não cria um sistema.'},
  {id:'manual_catalog',match:/catalog|cardap|ementa|produt|pecas|prendas/,serviceType:'site',level:'basic',example:'Catálogo/cardápio com cadastro, preço, foto e disponibilidade alterados manualmente pelo dono, com pedido no WhatsApp: site com gestão de conteúdo.'},
  {id:'editorial',match:/editor|versoes|versions|aprovacao|approval|multiling/,serviceType:'site',level:'moderate',example:'Conteúdo com versões, aprovação editorial ou experiência visual realmente específica pode elevar a complexidade do site; editar conteúdo sozinho não basta.'},
  {id:'internal_records',match:/crm|cadastro de clientes|contacts|intern|private/,serviceType:'system',level:'basic',example:'Ferramenta apenas interna para cadastrar contatos, consultar e registrar observações: sistema simples, não site+sistema.'},
  {id:'internal_schedule',match:/agenda|agend|booking|cita/,serviceType:'system',level:'depends',example:'Agenda apenas interna: sistema. Registro e validações usuais podem ser básicos; políticas interligadas de equipes, recursos ou aprovação exigem avaliar complexidade adicional.'},
  {id:'public_booking',match:/agend|marcac|appointment|booking|reserva/,serviceType:'site_system',level:'depends',example:'Cliente agenda na área pública e equipe administra a agenda: site+sistema. Avaliar as regras para definir o nível; pedir horário pelo WhatsApp não é esse fluxo.'},
  {id:'inventory',match:/estoque|stock|inventory/,serviceType:'system',level:'depends',example:'Entradas, saídas e saldo de estoque: sistema, que pode ser simples. Rastreabilidade ou regras interligadas elevam trabalho; disponibilidade editada num catálogo é conteúdo do site.'},
  {id:'checkout',match:/checkout|carrinho|cart|pagamento online|online payment|pago online/,serviceType:'site_system',level:'depends',example:'Compra pública com carrinho, checkout, pedidos e estoque pode ser site+sistema. Confirmar plataforma, lógica e integrações antes de fechar o valor; não assumir construção própria nem reutilização.'},
  {id:'operations',match:/pedido|order|envio|delivery|status|financeir/,serviceType:'system',level:'depends',example:'Gerir etapas de pedidos/entregas é operação: registro manual é distinto de automações interligadas. Só encaminhar um pedido ao WhatsApp não é gestão operacional.'},
  {id:'roles',match:/permis|roles|acessos|usuarios|users/,serviceType:'depends',level:'depends',example:'Um login do dono para editar conteúdo não justifica nível alto. Permissões distintas, aprovação e acesso de equipes exigem avaliar as regras reais.'},
  {id:'integration',match:/integr|api\b|erp|legado|legacy|migrac|migration/,serviceType:'depends',level:'review',example:'Integrações, migração e sistemas legados: confirmar compatibilidade e dependências; viabilidade desconhecida não recebe preço fechado automático.'},
  {id:'existing_site',match:/ja tenho|already have|ya tengo|atualiz|reformul|redesign/,serviceType:'depends',level:'depends',example:'Melhorar algo existente exige entender o que será mantido e alterado. Ter um site não prova que o trabalho é simples ou que haverá desconto.'},
  {id:'included_support',match:/bug|correc|support|manutenc|maintenance/,serviceType:'depends',level:'included_if_confirmed',example:'Correção e conteúdo no escopo de projeto contratado seguem a mensalidade aprovada; não vender novamente o que já está coberto. Nova estrutura é avaliada separadamente.'}
];

function clarificationQuestion(language){
  return({
    'pt-BR':'Para te passar um valor coerente, esse painel vai apenas editar o conteúdo mostrado aos clientes ou também organizar a operação, como agenda, pedidos ou estoque?',
    'pt-PT':'Para lhe indicar um valor adequado, esse painel vai apenas editar o conteúdo mostrado aos clientes ou também gerir a operação, como agenda, encomendas ou stock?',
    'en-US':'To quote this accurately, will the panel only edit what customers see, or also manage operations such as appointments, orders, or inventory?',
    'es-ES':'Para darte un precio adecuado, ¿ese panel solo editará el contenido que ve el cliente o también gestionará operaciones como citas, pedidos o inventario?'
  })[language]||clarificationQuestion('pt-BR');
}

function pricingGuide(context){
  const text=norm([...(context.history||[]).filter(t=>t.role==='contato').map(t=>t.text),context.project?.pending?.summary].join(' '));
  const matches=SCENARIOS.filter(item=>item.match.test(text));
  const important=['integration','checkout','public_booking','inventory','manual_catalog','internal_records','editorial','operations','existing_site','roles','included_support','internal_schedule','presentation'];
  matches.sort((a,b)=>important.indexOf(a.id)-important.indexOf(b.id));
  return{version:VERSION,principles:PRINCIPLES,examples:matches.slice(0,3).map(({id,serviceType,level,example})=>({id,serviceType,level,example}))};
}

function operational(text){
  return /(?:controle|gestao|gerenci|administr|manage|gestion).{0,32}(?:estoque|stock|inventory|agenda|agend|pedidos|orders|financeir|caixa|cobranc|permis|clientes)|(?:estoque|stock|inventory).{0,45}(?:automatic|calcul|saldo|baixa|entrada|saida|moviment)|(?:automatic|calcul|baixa).{0,35}(?:estoque|stock|inventory)|(?:escolh|choose|select|elige).{0,35}(?:horario|slot)|(?:agenda|agend|booking|appointment|reserva).{0,45}(?:automatic|conflit|disponib|bloque|valid|self)|checkout|carrinho|shopping cart|pagamento online|online payment|pago online|aprovacao|approval|workflow|versoes|versioning|version histor|api\b|integrac|integration|integracion|sincron|erp\b|migrac|migration|legad|legacy|regras fiscais|calculo|calcula|permissoes|permissions|roles|prontuario|medical record|area do cliente|customer portal|client portal|login.{0,20}(?:clientes|customers|members)|historico de pedidos|relatorios|reports/.test(text);
}
function withoutExcludedFeatures(value){
  return norm(value).replace(/\b(?:sem|without|sin)\s+(?:checkout|carrinho|shopping cart|pagamento online|online payment|pago online|integracoes|integrations|integraciones)\b/g,'');
}
function basicPublicRequirement(text,whatsapp){
  const value=withoutExcludedFeatures(text);
  if(operational(value))return false;
  if(/catalog|cardap|ementa|vitrine|portfolio|landing|pagina|website|\bsite\b|apresenta|exibir|mostrar|display|present|show|localiza|horario de funcionamento|contato|contact form|formulario de contacto|formulario de contato/.test(value))return true;
  if(/(?:cadastr|editar|edit|atualiz|alterar|publicar|update|manage|gestao|gerir|gestionar|registrar).{0,40}(?:conteudo|textos|fotos|imagens|produt|pecas|precos|servic|noticias|content|products|photos|prices|prendas|productos|contenido|disponibilidade|availability|disponibilidad)/.test(value))return true;
  return whatsapp&&/(?:pedido|order|encomenda|horario).{0,40}(?:whatsapp|zap)|(?:whatsapp|zap).{0,40}(?:pedido|order|encomenda)/.test(value);
}

function calibrateAssessment(assessment,context){
  if(assessment.technicalReview||assessment.work!=='new')return assessment;
  const sources=[...(context.evidenceSources||[]),...(context.history||[]).filter(t=>t.role==='contato').map(t=>t.text)];
  const requested=sources.filter(t=>/quero|queria|preciso|gostaria|gostava|want|need|would like|quiero|necesito|gustaria/i.test(norm(t)));
  const scopeText=withoutExcludedFeatures(assessment.requirements.map(r=>r.text).join('\n'));
  const customerText=withoutExcludedFeatures([...assessment.requirements.map(r=>r.evidence),...requested].join('\n'));
  const evidence=scopeText+'\n'+customerText;
  if(operational(scopeText)&&!operational(customerText)){
    return{...assessment,calibration:{version:VERSION,rule:'needs_functional_choice',reason:'A descrição do sistema acrescentou operação que não está clara nas falas do cliente.'}};
  }
  const whatsapp=/whatsapp|\bzap\b/.test(norm([...sources,...assessment.requirements.map(r=>r.text)].join(' ')));
  const publicContent=/catalog|cardap|ementa|vitrine|portfolio|landing|apresenta|exibir|mostrar|website|\bsite\b|pagina|(?:clientes|pessoas|customers|clients).{0,30}(?:vejam|vissem|ver|see|view)/.test(evidence);
  const privateOnly=/\b(?:apenas|somente|only|solo).{0,18}(?:intern|private)|sem site|no public (?:site|website)|sin (?:sitio|web)/.test(evidence);
  const basicInternal=assessment.requirements.every(r=>/cadastr|consult|buscar|filtr|observa|notas|notes|contacts|contatos|clientes|list|registr/.test(norm(r.text)));
  if(operational(evidence)){
    const dependency=/api\b|integrac|integration|integracion|sincron|erp\b|migrac|migration|legad|legacy/.test(evidence);
    const type=privateOnly?'system':publicContent&&/checkout|carrinho|shopping cart|agendamento|booking|escolh.{0,20}horario|login.{0,20}cliente|area do cliente/.test(evidence)?'site_system':assessment.serviceType;
    return{...assessment,serviceType:type,technicalReview:dependency||assessment.technicalReview,
      ...(type!==assessment.serviceType||dependency?{calibration:{version:VERSION,rule:dependency?'external_dependency_review':'operational_scope',originalServiceType:assessment.serviceType,reason:dependency?'Dependência externa precisa de viabilidade confirmada antes do preço fechado.':'Área pública e operação própria são distintas de simples gestão de conteúdo.'}}:{})};
  }
  if(privateOnly){
    if(!basicInternal)return assessment;
    return{...assessment,serviceType:'system',drivers:assessment.drivers.map(d=>({...d,level:'basic'})),
      calibration:{version:VERSION,rule:'private_records_system',originalServiceType:assessment.serviceType,reason:'Cadastro e consulta apenas internos, sem área pública ou automações adicionais.'}};
  }
  if(publicContent&&assessment.requirements.every(r=>basicPublicRequirement(r.text,whatsapp))){
    return{...assessment,serviceType:'site',drivers:assessment.drivers.map(d=>({...d,level:'basic'})),
      calibration:{version:VERSION,rule:'public_content_site',originalServiceType:assessment.serviceType,reason:'Apresentação pública e gestão manual do próprio conteúdo; não foram pedidas regras operacionais próprias.'}};
  }
  return assessment;
}

module.exports={VERSION,PRINCIPLES,SCENARIOS,pricingGuide,calibrateAssessment,clarificationQuestion};
