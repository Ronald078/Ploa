'use strict';
// Controlador de copies: mantém eventos e renderização na mesma área.
window.PloaAppModules.copies = function createController(ctx) {
const preview=window.PloaCopyPreview.create({elements:ctx.elements,state:ctx.state,node:ctx.createElement,
  getList:()=>ctx.currentCopyList(),getCategory:()=>ctx.state.copyCategory==='__generic__'?'Negócio de exemplo':ctx.copyCategoryLabel(ctx.normalizeSearch(ctx.state.copyCategory))});

function canChangeCopyGroup() {
  if((ctx.state.copyFormDirty||ctx.state.copyCategoryFormDirty)&&!window.confirm('Há texto em edição ainda não adicionado à biblioteca. Trocar de grupo e descartar esse texto?'))return false;
  ctx.state.copyFormDirty=false;ctx.state.copyCategoryFormDirty=false;ctx.elements.copyNewText.value='';return true;
}
function marketMetadata(marketId = ctx.state.copyMarket) {
  return ctx.state.copySettings?.supportedMarkets?.find((market) => market.id === marketId) || null;
}

function copyCategoryLabel(categoryId) {
  if (categoryId === '__generic__') return 'Genéricas';
  const catalogMatch = ctx.CATEGORY_CATALOG.find((item) => ctx.normalizeSearch(item.name) === categoryId);
  if (catalogMatch) return catalogMatch.name;
  const configuredMatch = ctx.state.operationSettings?.settings?.search?.categories?.find(
    (item) => ctx.normalizeSearch(item.name) === categoryId,
  );
  if (configuredMatch) return configuredMatch.name;
  return categoryId.replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

function firstContactCategoryOptions() {
  const market=ctx.state.copySettings?.settings?.firstContact?.[ctx.state.copyMarket];
  return Object.entries(market?.porCategoria||{})
    .filter(([,messages])=>Array.isArray(messages)&&messages.length>0)
    .map(([category])=>[category,ctx.copyCategoryLabel(ctx.normalizeSearch(category))])
    .sort((first,second)=>first[1].localeCompare(second[1],'pt-BR'));
}

function searchCategoriesWithoutCopies() {
  const categories=new Map();
  // Apenas categorias efetivamente ativas, sem o catálogo de sugestões.
  for(const item of ctx.CATEGORY_CATALOG.filter(item=>item.included))categories.set(ctx.normalizeSearch(item.name),item.name);
  for (const item of ctx.state.operationSettings?.settings?.search?.categories || []) {
    categories.set(ctx.normalizeSearch(item.name), item.name);
  }
  const market=ctx.state.copySettings?.settings?.firstContact?.[ctx.state.copyMarket];
  const populated=new Set(Object.entries(market?.porCategoria||{}).filter(([,messages])=>Array.isArray(messages)&&messages.length>0).map(([key])=>ctx.normalizeSearch(key)));
  return [...categories.entries()].filter(([key])=>!populated.has(key)).sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'));
}

function renderCopyCategoryCreation() {
  ctx.elements.copyCategoryCreate.hidden=ctx.state.copyType!=='firstContact';
  if(ctx.elements.copyCategoryCreate.hidden)return;
  const pending=ctx.searchCategoriesWithoutCopies();
  const previous=ctx.elements.copyNewCategory.value;
  const entries=[['','Selecione uma categoria da busca'],...pending];
  const signature=JSON.stringify(entries);
  if(ctx.elements.copyNewCategory.dataset.options!==signature){
    ctx.elements.copyNewCategory.replaceChildren(...entries.map(([id,label])=>{const option=ctx.createElement('option',null,label);option.value=id;return option;}));
    if(pending.some(([id])=>id===previous))ctx.elements.copyNewCategory.value=previous;
    ctx.elements.copyNewCategory.dataset.options=signature;
  }
  const blocked=Boolean(ctx.state.settingsDirty)||!pending.length;
  ctx.elements.copyNewCategory.disabled=blocked;
  ctx.elements.copyNewText.disabled=blocked;
  ctx.elements.copyCreateCategory.disabled=blocked;
  ctx.setText(ctx.elements.copyCategoryCreateDescription,`Cadastre a primeira mensagem para ${ctx.state.copyMarket}. A categoria aparecerá em Copys cadastradas quando tiver uma mensagem.`);
  ctx.setText(ctx.elements.copyCategoryCreateStatus,ctx.state.settingsDirty
    ?'Salve as mudanças em Buscar leads antes de cadastrar mensagens para as novas categorias.'
    :pending.length?`${pending.length} categoria${pending.length===1?'':'s'} da busca sem mensagens para ${ctx.state.copyMarket}.`
    :`Todas as categorias ativas da busca já têm copys para ${ctx.state.copyMarket}. Adicione e salve uma nova categoria em Buscar leads para continuar.`);
}

function automaticCategoryOptions() {
  return (ctx.state.copySettings?.automaticCategories || []).map((category) => [category.id, category.label]);
}

function currentCopyList({ create = false } = {}) {
  const settings = ctx.state.copySettings?.settings;
  if (!settings) return [];

  if (ctx.state.copyType === 'firstContact') {
    const market = settings.firstContact[ctx.state.copyMarket];
    if (!market) return [];
    if (ctx.state.copyCategory === '__generic__') return market.genericas;
    if (!Array.isArray(market.porCategoria[ctx.state.copyCategory]) && create) {
      market.porCategoria[ctx.state.copyCategory] = [];
    }
    return market.porCategoria[ctx.state.copyCategory] || [];
  }

  const locale = ctx.marketMetadata()?.locale;
  const category = settings.automaticReplies.categorias[ctx.state.copyCategory];
  if (!locale || !category) return [];
  return category.porIdioma[locale] || [];
}

function resetCopyItemForm() {
  ctx.state.copyFormDirty=false;
  ctx.elements.copyEditIndex.value = '';
  ctx.elements.copyText.value = '';
  ctx.setText(ctx.elements.copyFormLabel, 'Adicionar variação a este grupo');
  ctx.setText(ctx.elements.submitCopyItem, 'Adicionar copy');
  ctx.elements.cancelCopyEdit.hidden = true;
}

function renderCopyEditor() {
  const snapshot = ctx.state.copySettings;
  if (!snapshot?.settings) {
    ctx.elements.copyFilterFieldset.disabled = true;
    ctx.elements.copyEditorFieldset.disabled = true;
    ctx.setText(ctx.elements.copySettingsStatus, 'Não foi possível carregar a biblioteca de copys.');
    return;
  }
  // These controls only choose what is displayed. Running scripts protect
  // editing/saving, but must not prevent consulting another country/category.
  ctx.elements.copyFilterFieldset.disabled = false;

  ctx.elements.copyType.value = ctx.state.copyType;
  const previousMarket = ctx.state.copyMarket;
  ctx.elements.copyMarket.replaceChildren(...snapshot.supportedMarkets.map((market) => {
    const option = ctx.createElement('option', null, market.label);
    option.value = market.id;
    return option;
  }));
  ctx.state.copyMarket = snapshot.supportedMarkets.some((market) => market.id === previousMarket)
    ? previousMarket
    : snapshot.supportedMarkets[0].id;
  ctx.elements.copyMarket.value = ctx.state.copyMarket;

  const categories = ctx.state.copyType === 'firstContact'
    ? [['__generic__', 'Genéricas'], ...ctx.firstContactCategoryOptions()]
    : ctx.automaticCategoryOptions();
  if (!categories.some(([id]) => id === ctx.state.copyCategory)) ctx.state.copyCategory = categories[0]?.[0] || '';
  ctx.elements.copyCategory.replaceChildren(...categories.map(([id, label]) => {
    const option = ctx.createElement('option', null, label);
    option.value = id;
    return option;
  }));
  ctx.elements.copyCategory.value = ctx.state.copyCategory;
  ctx.renderCopyCategoryCreation();

  const list = ctx.currentCopyList();
  const categoryLabel = categories.find(([id]) => id === ctx.state.copyCategory)?.[1] || 'Categoria';
  ctx.setText(ctx.elements.copyContextLabel, ctx.state.copyType === 'firstContact' ? 'Primeiro contato' : 'Resposta automática');
  ctx.setText(ctx.elements.copyContextTitle, `${ctx.state.copyMarket} · ${categoryLabel}`);
  ctx.setText(ctx.elements.copyCount, `${list.length} copy${list.length === 1 ? '' : 's'}`);

  if (ctx.state.copyType === 'automaticReplies') {
    const metadata = snapshot.automaticCategories.find((category) => category.id === ctx.state.copyCategory);
    ctx.setText(ctx.elements.copyContextDescription, metadata?.description || 'Resposta enviada depois que uma mensagem automática é identificada.');
  } else if (ctx.state.copyCategory === '__generic__') {
    ctx.setText(ctx.elements.copyContextDescription, 'Usadas quando o contato não possui uma categoria com copy própria.');
  } else {
    ctx.setText(ctx.elements.copyContextDescription, 'Uma variação deste grupo é sorteada para contatos desta categoria. {nome} e {categoria} são substituídos no envio.');
  }

  ctx.elements.copyList.replaceChildren(...(
    list.length
      ? list.map((message, index) => {
        const card = ctx.createElement('article', 'copy-card');
        const number = ctx.createElement('span', 'copy-card-number', String(index + 1).padStart(2, '0'));
        const text = ctx.createElement('p', 'copy-card-text', message);
        const actions = ctx.createElement('div', 'copy-card-actions');
        const edit = ctx.createElement('button', 'copy-action copy-action-edit', 'Editar');
        edit.type = 'button';
        edit.dataset.copyAction = 'edit';
        edit.dataset.copyIndex = String(index);
        const remove = ctx.createElement('button', 'copy-action copy-action-remove', 'Excluir');
        remove.type = 'button';
        remove.dataset.copyAction = 'remove';
        remove.dataset.copyIndex = String(index);
        const show=ctx.createElement('button','copy-action','Pré-visualizar');show.type='button';show.dataset.copyAction='preview';show.dataset.copyIndex=String(index);
        actions.append(show, edit, remove);
        card.append(number, text, actions);
        return card;
      })
      : [ctx.createElement('p', 'copy-empty', 'Este filtro ainda não possui copys. Adicione a primeira variação abaixo.')]
  ));

  const anyScriptRunning = Object.entries(ctx.state.processes || {}).some(([id,processState]) => id!=='whatsapp'&&processState.running);
  ctx.elements.copyEditorFieldset.disabled = anyScriptRunning;
  const unsaved=ctx.state.copySettingsDirty||ctx.state.copyFormDirty||ctx.state.copyCategoryFormDirty;
  ctx.elements.saveCopySettings.disabled = anyScriptRunning || !unsaved;
  ctx.elements.discardCopySettings.disabled = anyScriptRunning || !unsaved;
  ctx.elements.copySettingsStatus.dataset.saveState=unsaved?'pending':'saved';
  if (anyScriptRunning) {
    ctx.setText(ctx.elements.copySettingsStatus, 'Consulta liberada por tipo, país e categoria. Para editar ou salvar copys, encerre os disparos ou a busca em execução.');
  } else if(ctx.state.copyFormDirty||ctx.state.copyCategoryFormDirty){
    ctx.setText(ctx.elements.copySettingsStatus,'Texto em edição ainda não salvo. Salvar alterações da biblioteca também inclui esta edição.');
  } else if (!ctx.state.copySettingsDirty) {
    ctx.setText(ctx.elements.copySettingsStatus, 'Biblioteca salva. Estas são as mensagens disponíveis para o script.');
  }
  preview.render();
}

function markCopySettingsDirty(message) {
  ctx.state.copySettingsDirty = true;
  ctx.setText(ctx.elements.copySettingsStatus, message);
  ctx.renderCopyEditor();
}

async function loadCopySettings() {
  ctx.setText(ctx.elements.copySettingsStatus, 'Carregando a biblioteca de copys…');
  try {
    const snapshot = await ctx.fetchJson('/api/copies');
    ctx.state.copySettings = snapshot;
    ctx.state.copySettingsBaseline = ctx.cloneJson(snapshot);
    ctx.state.copySettingsDirty = false;
    ctx.renderCopyEditor();
    ctx.renderFunnelOperation();
  } catch (error) {
    ctx.setText(ctx.elements.copySettingsStatus, 'Não foi possível carregar as copys usadas pelo script.');
    ctx.showToast(error.message, 'error');
  }
}

async function saveCopySettings() {
  if(ctx.state.copyFormDirty)ctx.elements.copyItemForm.requestSubmit();
  if(ctx.state.copyCategoryFormDirty)ctx.elements.copyCategoryCreateForm.requestSubmit();
  if(ctx.state.copyFormDirty||ctx.state.copyCategoryFormDirty){ctx.showToast('Confira o texto e a categoria antes de salvar a biblioteca.','error');return;}
  if (!ctx.state.copySettings?.settings || !ctx.state.copySettingsDirty) return;
  ctx.elements.saveCopySettings.disabled = true;
  ctx.elements.discardCopySettings.disabled = true;
  ctx.setText(ctx.elements.copySettingsStatus, 'Salvando copys…');
  try {
    const response = await fetch('/api/copies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(ctx.state.copySettings.settings),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar as copys.');
    ctx.state.copySettings = result;
    ctx.state.copySettingsBaseline = ctx.cloneJson(result);
    ctx.state.copySettingsDirty = false;
    ctx.resetCopyItemForm();
    ctx.renderCopyEditor();
    ctx.showToast('Copys salvas para a próxima execução.');
    document.dispatchEvent(new Event('ploa-copies-saved'));
  } catch (error) {
    ctx.setText(ctx.elements.copySettingsStatus, error.message);
    ctx.showToast(error.message, 'error');
    ctx.renderCopyEditor();
  }
}

  function bindEvents() {
ctx.elements.copyText.addEventListener('input',()=>{ctx.state.copyFormDirty=true;preview.showDraft();ctx.renderCopyEditor();});
ctx.elements.copyNewText.addEventListener('input',()=>{ctx.state.copyCategoryFormDirty=true;ctx.renderCopyEditor();});
ctx.elements.copyType.addEventListener('change', () => {
  if(!canChangeCopyGroup()){ctx.renderCopyEditor();return;}
  ctx.state.copyType = ctx.elements.copyType.value;
  ctx.state.copyCategory = ctx.state.copyType === 'firstContact' ? '__generic__' : '';
  ctx.resetCopyItemForm();
  ctx.elements.copyNewText.value='';
  ctx.renderCopyEditor();
});

ctx.elements.copyMarket.addEventListener('change', () => {
  if(!canChangeCopyGroup()){ctx.renderCopyEditor();return;}
  ctx.state.copyMarket = ctx.elements.copyMarket.value;
  ctx.resetCopyItemForm();
  ctx.elements.copyNewText.value='';ctx.elements.copyNewCategory.value='';
  ctx.renderCopyEditor();
});

ctx.elements.copyCategory.addEventListener('change', () => {
  if(!canChangeCopyGroup()){ctx.renderCopyEditor();return;}
  ctx.state.copyCategory = ctx.elements.copyCategory.value;
  ctx.resetCopyItemForm();
  ctx.renderCopyEditor();
});

ctx.elements.copyOpenSearch.addEventListener('click',()=>ctx.setActiveView('search',{focus:true}));

ctx.elements.copyCategoryCreateForm.addEventListener('submit',(event)=>{
  event.preventDefault();
  if(ctx.state.copyType!=='firstContact'||ctx.state.settingsDirty||Object.entries(ctx.state.processes||{}).some(([id,item])=>id!=='whatsapp'&&item.running))return;
  const selected=ctx.elements.copyNewCategory.value;
  const available=ctx.searchCategoriesWithoutCopies();
  if(!available.some(([key])=>key===selected)){
    ctx.setText(ctx.elements.copyCategoryCreateStatus,'Selecione uma categoria adicionada e salva em Buscar leads.');return;
  }
  const text=ctx.elements.copyNewText.value.replace(/\r\n/g,'\n').trim();
  if(!text){ctx.setText(ctx.elements.copyCategoryCreateStatus,'Escreva a primeira copy desta categoria.');ctx.elements.copyNewText.focus();return;}
  const market=ctx.state.copySettings.settings.firstContact[ctx.state.copyMarket];
  const key=Object.keys(market.porCategoria).find(key=>ctx.normalizeSearch(key)===selected)||selected;
  market.porCategoria[key]=[text];ctx.state.copyCategory=key;
  ctx.state.copyCategoryFormDirty=false;
  ctx.elements.copyNewText.value='';ctx.elements.copyNewCategory.value='';ctx.resetCopyItemForm();
  ctx.markCopySettingsDirty('Categoria e primeira copy adicionadas. Salve as alterações da biblioteca para usar no script.');
  ctx.elements.copyContextTitle.scrollIntoView({block:'center',behavior:'smooth'});
  ctx.showToast('Primeira copy adicionada à categoria. Salve a biblioteca para aplicar.');
});

ctx.elements.copyList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-copy-action]');
  if (!button) return;
  const list = ctx.currentCopyList();
  const index = Number(button.dataset.copyIndex);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return;

  if(button.dataset.copyAction==='preview'){preview.show(index);return;}

  if (button.dataset.copyAction === 'edit') {
    ctx.elements.copyEditIndex.value = String(index);
    ctx.elements.copyText.value = list[index];
    ctx.setText(ctx.elements.copyFormLabel, `Editar copy ${index + 1}`);
    ctx.setText(ctx.elements.submitCopyItem, 'Salvar edição');
    ctx.elements.cancelCopyEdit.hidden = false;
    ctx.elements.copyText.focus();
    preview.showDraft();
    return;
  }

  if (ctx.state.copyType === 'automaticReplies' && list.length === 1) {
    ctx.setText(ctx.elements.copySettingsStatus, 'Respostas automáticas precisam manter ao menos uma copy por país e categoria.');
    return;
  }
  list.splice(index, 1);
  ctx.resetCopyItemForm();
  ctx.markCopySettingsDirty('Copy removida desta seleção. Salve para confirmar a exclusão.');
});

ctx.elements.copyItemForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = ctx.elements.copyText.value.replace(/\r\n/g, '\n').trim();
  if (!message) {
    ctx.setText(ctx.elements.copySettingsStatus, 'Escreva o texto da copy antes de adicionar.');
    ctx.elements.copyText.focus();
    return;
  }
  const list = ctx.currentCopyList({ create: true });
  const editIndex = ctx.elements.copyEditIndex.value === '' ? -1 : Number(ctx.elements.copyEditIndex.value);
  const duplicateIndex = list.findIndex((item, index) => item === message && index !== editIndex);
  if (duplicateIndex >= 0) {
    ctx.setText(ctx.elements.copySettingsStatus, `Essa copy já existe como variação ${duplicateIndex + 1}.`);
    return;
  }
  if (editIndex >= 0 && editIndex < list.length) {
    list[editIndex] = message;
    ctx.resetCopyItemForm();
    ctx.markCopySettingsDirty('Copy atualizada. Salve a biblioteca para aplicar a alteração.');
    return;
  }
  list.push(message);
  ctx.resetCopyItemForm();
  ctx.markCopySettingsDirty('Nova copy adicionada. Salve a biblioteca para aplicá-la.');
});

ctx.elements.cancelCopyEdit.addEventListener('click', () => {
  ctx.resetCopyItemForm();
  ctx.setText(ctx.elements.copySettingsStatus, ctx.state.copySettingsDirty
    ? 'Há alterações de copys ainda não salvas.'
    : 'Edição cancelada.');
});

ctx.elements.saveCopySettings.addEventListener('click', ctx.saveCopySettings);

ctx.elements.discardCopySettings.addEventListener('click', () => {
  if (!ctx.state.copySettingsBaseline) return;
  ctx.state.copySettings = ctx.cloneJson(ctx.state.copySettingsBaseline);
  ctx.state.copySettingsDirty = false;
  ctx.state.copyCategoryFormDirty=false;ctx.elements.copyNewText.value='';
  ctx.resetCopyItemForm();
  ctx.renderCopyEditor();
  ctx.showToast('Alterações de copys descartadas.');
});
  }
  return { marketMetadata, copyCategoryLabel, firstContactCategoryOptions, searchCategoriesWithoutCopies, renderCopyCategoryCreation, automaticCategoryOptions, currentCopyList, resetCopyItemForm, renderCopyEditor, markCopySettingsDirty, loadCopySettings, saveCopySettings, bindEvents };
};
