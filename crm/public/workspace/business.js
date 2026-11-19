'use strict';
// Área de business; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.business = function mountArea(ctx) {
const businessSection=ctx.section('Base comercial da IA','Configure os serviços uma vez. A IA usa estas condições nas conversas, sem precisar preencher cada lead.');

const businessGrid=ctx.node('div','ploa-form-grid'),offerGrid=ctx.node('div','ploa-form-grid');

const allowProposals=ctx.field('Autorizar apresentação de preços e propostas do catálogo','checkbox',true);

const allowAcceptance=ctx.field('Autorizar registro de aceite explícito de uma proposta apresentada','checkbox',true);

const allowUnlimitedChanges=ctx.field('Correções e alterações de conteúdo sem cota dentro do projeto contratado','checkbox',true);
const calculateProjectPrice=ctx.field('Calcular o preço pela complexidade após o cliente confirmar o projeto','checkbox',true);

const businessRules=ctx.field('Orientações comerciais e limites','textarea',true);
const pixKey=ctx.field('Chave Pix para receber em reais'),pixRecipient=ctx.field('Nome do titular do Pix (opcional)');
pixKey.input.maxLength=140;pixKey.input.autocomplete='off';pixKey.input.placeholder='CPF, CNPJ, e-mail, telefone ou chave aleatória';
pixRecipient.input.maxLength=120;pixRecipient.input.autocomplete='off';

businessRules.input.maxLength=6000;

businessGrid.append(allowProposals.wrap,allowAcceptance.wrap,allowUnlimitedChanges.wrap,calculateProjectPrice.wrap,businessRules.wrap,pixKey.wrap,pixRecipient.wrap,
  ctx.node('p','ploa-note ploa-wide','Após o cliente escolher pagamento integral ou entrada de 50%, o Ploa envia a chave nas propostas em reais. O recebimento continua sendo confirmado por você.'));

const catalogList=ctx.node('div'),businessStatus=ctx.node('p','ploa-note');

businessStatus.setAttribute('role','status');

const offerName=ctx.field('Serviço / nome da oferta'),offerMarket=ctx.field('País','select'),offerCurrency=ctx.field('Moeda','select');

const offerCategory=ctx.field('Categoria atendida','select'),offerPrice=ctx.field('Preço aprovado','number'),offerDiscount=ctx.field('Desconto máximo autorizado (%)','number');

const offerPricingMode=ctx.field('Forma de preço','select'),offerPriceMax=ctx.field('Valor máximo da faixa','number');
ctx.options(offerPricingMode.input,[['fixed','Preço definido'],['range','Faixa com diagnóstico do projeto']],'fixed');
const offerServiceType=ctx.field('Solução oferecida','select');
ctx.options(offerServiceType.input,[['','Selecionar'],['site','Site'],['system','Sistema'],['site_system','Site + sistema']],'');
offerPriceMax.input.min='0.01';offerPriceMax.input.step='0.01';
function updatePriceFields(){
    const range=offerPricingMode.input.value==='range';
    offerPriceMax.wrap.hidden=!range;
    offerPrice.wrap.querySelector('span').textContent=range?'Valor mínimo da faixa':'Preço aprovado';
    offerDiscount.input.disabled=false;
  }
offerPricingMode.input.addEventListener('change',updatePriceFields);
updatePriceFields();

offerPrice.input.min='0.01';

offerPrice.input.step='0.01';

offerDiscount.input.min='0';

offerDiscount.input.max='50';

offerDiscount.input.step='0.5';

offerDiscount.input.value='0';

ctx.options(offerMarket.input,[['Brasil','Brasil'],['Portugal','Portugal'],['Estados Unidos','Estados Unidos'],['Espanha','Espanha']]);

ctx.options(offerCurrency.input,[['BRL','Real (BRL)'],['EUR','Euro (EUR)'],['USD','Dólar (USD)']]);

const categoryChoices=new Map(CATEGORY_CATALOG.filter(item=>item.included).map(item=>[normalizeSearch(item.name),item.name]));

const refreshOfferCategories=()=>{
    const current=offerCategory.input.value;
    for(const item of state.operationSettings?.settings?.search?.categories||[])categoryChoices.set(normalizeSearch(item.name),item.name);
    ctx.options(offerCategory.input,[['','Todas as categorias'],...categoryChoices],current);
  };

refreshOfferCategories();

const offerScope=ctx.field('O que está incluído','textarea',true),offerTerms=ctx.field('Condições de pagamento e execução','textarea',true);

const offerDeadline=ctx.field('Prazo autorizado'),offerMaintenance=ctx.field('Mensalidade e custos recorrentes','textarea',true);

const offerPermission=ctx.field('Permitir que a IA apresente esta oferta automaticamente','checkbox',true);

offerName.input.maxLength=150;

offerScope.input.maxLength=1800;

offerTerms.input.maxLength=1200;

offerDeadline.input.maxLength=300;

offerMaintenance.input.maxLength=500;

offerGrid.append(offerName.wrap,offerMarket.wrap,offerCategory.wrap,offerCurrency.wrap,offerServiceType.wrap,offerPricingMode.wrap,offerPrice.wrap,offerPriceMax.wrap,offerDiscount.wrap,offerScope.wrap,offerTerms.wrap,offerDeadline.wrap,offerMaintenance.wrap,offerPermission.wrap);

let businessDirty=false,offerFormDirty=false,businessDraft=null,editingOffer=null;

const emptyBusiness=()=>({offers:[],allowAutoProposals:false,allowAutoAcceptance:false,guidance:'Não inventar condições. Negociar somente dentro dos limites cadastrados. Pedidos especiais precisam de Ronald.'});

const clearOffer=()=>{
    editingOffer=null;offerFormDirty=false;
    for(const field of [offerName,offerPrice,offerPriceMax,offerScope,offerTerms,offerDeadline,offerMaintenance])field.input.value='';
    offerPricingMode.input.value='fixed';offerServiceType.input.value='';updatePriceFields();
    offerDiscount.input.value='0';offerCategory.input.value='';offerPermission.input.checked=false;
  };

async function persistBusiness() {
    const business={...(businessDraft||emptyBusiness()),allowAutoProposals:allowProposals.input.checked,allowAutoAcceptance:allowAcceptance.input.checked,
      allowUnlimitedInScopeChanges:allowUnlimitedChanges.input.checked,projectPricing:{enabled:calculateProjectPrice.input.checked,method:'qualitative_factors_v1'},guidance:businessRules.input.value,
      paymentDetails:{pixKey:pixKey.input.value.trim(),pixRecipient:pixRecipient.input.value.trim()}};
    ctx.snapshot=await ctx.api('/api/workspace/settings','PUT',{business});
    if(ctx.snapshot.settings.business?.paymentDetails?.pixKey!==business.paymentDetails.pixKey)throw new Error('Feche e reabra o Ploa para carregar o cadastro do Pix. A chave ainda não foi salva.');
    businessDirty=false;businessDraft=null;
  }

const addOffer=async()=>{
    if(!businessDraft)businessDraft=emptyBusiness();
    if(!offerName.input.value.trim()||!offerScope.input.value.trim()||!offerTerms.input.value.trim()||Number(offerPrice.input.value)<=0)throw new Error('Preencha serviço, preço, escopo e condições antes de adicionar a oferta.');
    if(offerPricingMode.input.value==='range'&&Number(offerPriceMax.input.value)<Number(offerPrice.input.value))throw new Error('Informe um máximo igual ou maior que o mínimo da faixa.');
    const id=editingOffer||crypto.randomUUID(),previous=businessDraft.offers.find(item=>item.id===id);
    const item={id,title:offerName.input.value.trim(),market:offerMarket.input.value,currency:offerCurrency.input.value,category:offerCategory.input.value,
      amount:Number(offerPrice.input.value),maxDiscountPercent:Number(offerDiscount.input.value||0),scope:offerScope.input.value.trim(),terms:offerTerms.input.value.trim(),
      pricingMode:offerPricingMode.input.value,amountMax:offerPricingMode.input.value==='range'?Number(offerPriceMax.input.value):Number(offerPrice.input.value),serviceType:offerServiceType.input.value,
      deadline:offerDeadline.input.value.trim(),maintenance:offerMaintenance.input.value.trim(),autoPresent:offerPermission.input.checked,active:previous?.active!==false};
    businessDraft.offers=businessDraft.offers.filter(item=>item.id!==id);businessDraft.offers.push(item);
    editingOffer=id;businessDirty=true;
    await persistBusiness();clearOffer();renderBusiness();
    showToast('Oferta e base comercial salvas. A IA usará apenas as condições autorizadas.');
  };

offerMarket.input.addEventListener('change',()=>{offerCurrency.input.value=offerMarket.input.value==='Brasil'?'BRL':offerMarket.input.value==='Estados Unidos'?'USD':'EUR';ctx.refreshSelects();});

offerGrid.addEventListener('input',()=>{offerFormDirty=true;});

offerGrid.addEventListener('change',()=>{offerFormDirty=true;});

businessGrid.addEventListener('input',()=>{businessDirty=true;});

businessGrid.addEventListener('change',()=>{businessDirty=true;});

const offerEditor=ctx.details('Adicionar ou editar uma oferta');

offerEditor.append(
    ctx.node('p','ploa-note','Cadastre a oferta no idioma do país atendido. Para calcular dentro da faixa, escolha a solução e habilite o diagnóstico. A IA resume o funcionamento para o cliente confirmar; depois o servidor calcula o preço. Descontos usam esse preço original, sem alterar a mensalidade.'),offerGrid,
    ctx.actions(ctx.button('Salvar oferta e base',addOffer,true),ctx.button('Limpar edição da oferta',()=>{clearOffer();ctx.refreshSelects();})));

businessSection.append(businessGrid,ctx.node('h4',null,'Ofertas cadastradas'),catalogList,offerEditor,businessStatus,
    ctx.actions(ctx.button('Descartar mudanças da base',()=>{businessDirty=false;clearOffer();businessDraft=null;renderBusiness();}),ctx.button('Salvar base e autorizações',async()=>{
      if(offerFormDirty){await addOffer();return;}
      await persistBusiness();renderBusiness();
      showToast('Base comercial salva. A IA usará somente as ofertas e os limites autorizados.');
    },true)));

ctx.view('messages').append(businessSection);

function renderCatalog(){
    catalogList.replaceChildren();
    for(const offer of businessDraft?.offers||[]){
      const row=ctx.node('article','ploa-ledger-row'),copy=ctx.node('div');
      const range=offer.pricingMode==='range';
      const price=ctx.money(offer.amount,offer.currency)+(range?' – '+ctx.money(offer.amountMax,offer.currency):'');
      copy.append(ctx.node('strong',null,offer.title+' · '+price),ctx.node('small',null,offer.market+' · '+(offer.category||'Todas as categorias')+' · '+(offer.active&&offer.autoPresent?'Permitida para IA':'Não liberada para IA')),
        ctx.node('p','ploa-note',offer.scope),ctx.node('small',null,range?'Faixa cadastrada · teto de desconto após preço definido: '+offer.maxDiscountPercent+'%':'Desconto máximo: '+offer.maxDiscountPercent+'%'));
      if(offer.maintenance)copy.append(ctx.node('p','ploa-note',offer.maintenance));
      row.append(copy,ctx.actions(ctx.button('Editar',()=>{
        offerEditor.open=true;editingOffer=offer.id;offerName.input.value=offer.title;offerMarket.input.value=offer.market;offerCurrency.input.value=offer.currency;offerCategory.input.value=offer.category;
        offerServiceType.input.value=offer.serviceType||'';offerPricingMode.input.value=offer.pricingMode||'fixed';offerPriceMax.input.value=offer.amountMax??offer.amount;
        offerPrice.input.value=offer.amount;offerDiscount.input.value=offer.maxDiscountPercent;updatePriceFields();offerScope.input.value=offer.scope;offerTerms.input.value=offer.terms;
        offerDeadline.input.value=offer.deadline;offerMaintenance.input.value=offer.maintenance;offerPermission.input.checked=offer.autoPresent;offerFormDirty=true;ctx.refreshSelects();offerName.input.focus();
      }),ctx.button(offer.active?'Pausar oferta':'Reativar oferta',()=>{offer.active=!offer.active;businessDirty=true;renderCatalog();businessStatus.textContent='Mudança pendente. Salve a base para aplicar.';}),ctx.button('Excluir da base',()=>{if(!window.confirm('Retirar esta oferta da base? A mudança será aplicada ao salvar.'))return;businessDraft.offers=businessDraft.offers.filter(item=>item.id!==offer.id);businessDirty=true;renderCatalog();businessStatus.textContent='Exclusão pendente. Salve a base para aplicar ou descarte as mudanças.';})));
      catalogList.append(row);
    }
    if(!catalogList.childElementCount)catalogList.append(ctx.node('p','ploa-note','Nenhuma oferta cadastrada. A IA pode conversar sobre o negócio, mas não pode inventar preços ou condições para uma proposta.'));
  }

function renderBusiness(){
    if(!ctx.snapshot||businessDirty||offerFormDirty)return;
    businessDraft=cloneJson(ctx.snapshot.settings.business||emptyBusiness());
    allowProposals.input.checked=businessDraft.allowAutoProposals;allowAcceptance.input.checked=businessDraft.allowAutoAcceptance;
    allowUnlimitedChanges.input.checked=businessDraft.allowUnlimitedInScopeChanges===true;businessRules.input.value=businessDraft.guidance;
    calculateProjectPrice.input.checked=businessDraft.projectPricing?.enabled===true;
    pixKey.input.value=businessDraft.paymentDetails?.pixKey||'';pixRecipient.input.value=businessDraft.paymentDetails?.pixRecipient||'';
    refreshOfferCategories();ctx.refreshSelects();renderCatalog();
    businessStatus.textContent=businessDraft.offers.length+' ofertas cadastradas · '+(businessDraft.allowAutoProposals?'Apresentação automática autorizada':'Propostas automáticas desativadas');
  }
  return Object.defineProperties({}, {
    businessSection: { enumerable: true, get: () => businessSection },
    businessGrid: { enumerable: true, get: () => businessGrid },
    offerGrid: { enumerable: true, get: () => offerGrid },
    allowProposals: { enumerable: true, get: () => allowProposals },
    allowAcceptance: { enumerable: true, get: () => allowAcceptance },
    businessRules: { enumerable: true, get: () => businessRules },
    catalogList: { enumerable: true, get: () => catalogList },
    businessStatus: { enumerable: true, get: () => businessStatus },
    offerName: { enumerable: true, get: () => offerName },
    offerMarket: { enumerable: true, get: () => offerMarket },
    offerCurrency: { enumerable: true, get: () => offerCurrency },
    offerCategory: { enumerable: true, get: () => offerCategory },
    offerPrice: { enumerable: true, get: () => offerPrice },
    offerDiscount: { enumerable: true, get: () => offerDiscount },
    categoryChoices: { enumerable: true, get: () => categoryChoices },
    refreshOfferCategories: { enumerable: true, get: () => refreshOfferCategories },
    offerScope: { enumerable: true, get: () => offerScope },
    offerTerms: { enumerable: true, get: () => offerTerms },
    offerDeadline: { enumerable: true, get: () => offerDeadline },
    offerMaintenance: { enumerable: true, get: () => offerMaintenance },
    offerPermission: { enumerable: true, get: () => offerPermission },
    businessDirty: { enumerable: true, get: () => businessDirty, set: value => { businessDirty = value; } },
    offerFormDirty: { enumerable: true, get: () => offerFormDirty, set: value => { offerFormDirty = value; } },
    businessDraft: { enumerable: true, get: () => businessDraft, set: value => { businessDraft = value; } },
    editingOffer: { enumerable: true, get: () => editingOffer, set: value => { editingOffer = value; } },
    emptyBusiness: { enumerable: true, get: () => emptyBusiness },
    clearOffer: { enumerable: true, get: () => clearOffer },
    addOffer: { enumerable: true, get: () => addOffer },
    offerEditor: { enumerable: true, get: () => offerEditor },
    renderCatalog: { enumerable: true, get: () => renderCatalog },
    renderBusiness: { enumerable: true, get: () => renderBusiness }
  });
};
