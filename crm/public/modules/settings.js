'use strict';
// Controlador de settings: mantém eventos e renderização na mesma área.
window.PloaAppModules.settings = function createController(ctx) {
let savedLocalityKeys = null;
const localityKey = item => ctx.normalizeSearch(`${item.market}|${item.city}`);
function setToolStatus(element, installed, idle = false) {
  if(!element)return;
  element.classList.toggle('ready', installed && !idle);
  element.classList.toggle('off', idle || !installed);
  ctx.setText(element, installed ? (idle ? 'Instalado · desligado' : 'Instalado') : 'Não encontrado');
}

function renderOperations() {
  if (!ctx.state.operations) return;
  const { search, messages, ads } = ctx.state.operations;

  ctx.setText(ctx.elements.searchLastCity, search.lastCity || 'Nenhuma registrada');
  ctx.setText(ctx.elements.searchUpdated, ctx.formatDate(search.updatedAt, true));
  const completedCities = Math.max(0, Number(search.completedCities) || 0);
  const totalCities = Math.max(0, Number(search.totalCities) || 0);
  const remainingCities = Math.max(0, Number(search.remainingCities) || 0);
  ctx.setText(ctx.elements.searchCityCount, totalCities ? `${ctx.formatInteger(completedCities)}/${ctx.formatInteger(totalCities)}` : completedCities);
  ctx.setText(
    ctx.elements.searchLiveSummary,
    totalCities
      ? `${ctx.formatInteger(completedCities)} de ${ctx.formatInteger(totalCities)} cidades`
      : `${ctx.formatInteger(completedCities)} ${completedCities === 1 ? 'cidade concluída' : 'cidades concluídas'}`,
  );
  ctx.setText(
    ctx.elements.searchLiveDetail,
    search.currentCity
      ? `${search.currentCity} · ${search.currentCategory || 'Preparando consulta'}${search.totalCategories ? ` (${search.categoryIndex}/${search.totalCategories})` : ''}`
      : search.lastCity
        ? `Última cidade: ${search.lastCity} · ${ctx.formatDate(search.updatedAt, true)}`
        : 'Aguardando a próxima execução.',
  );
  ctx.setText(ctx.elements.searchLiveRemaining, ctx.formatInteger(remainingCities));
  ctx.setText(ctx.elements.searchLiveNew, ctx.formatInteger(search.newLeads));
  ctx.setText(ctx.elements.searchLiveFound, ctx.formatInteger(search.foundLeads));
  ctx.setText(ctx.elements.searchLiveTotalLeads, search.totalLeads==null?'Sem medição':ctx.formatInteger(search.totalLeads));
  ctx.elements.searchLiveProgress.max = Math.max(1, totalCities);
  ctx.elements.searchLiveProgress.value = Math.min(completedCities, Math.max(1, totalCities));
  ctx.elements.searchLiveProgress.textContent = ctx.formatPercent(search.percentage);

  ctx.setText(ctx.elements.messageProgress, ctx.formatPercent(messages.percentage));
  ctx.setText(ctx.elements.messageIndex, messages.processed);
  ctx.setText(ctx.elements.messageTotal, messages.total);
  ctx.setText(ctx.elements.messageToday, messages.sentToday);
  ctx.setText(ctx.elements.messageUpdated, `Atualizado ${ctx.formatDate(messages.updatedAt, true)}`);
  ctx.elements.messageProgressBar.value = Math.max(0, Math.min(100, messages.percentage));
  ctx.elements.messageProgressBar.textContent = ctx.formatPercent(messages.percentage);

  const dailyLimit = Math.max(0, Number(ctx.state.operationSettings?.settings?.messages?.dailyLimit) || 0);
  const sentToday = Math.max(0, Number(messages.sentToday) || 0);
  const executionSent = Math.max(0, Number(messages.executionSent) || 0);
  const executionTarget = Math.max(0, Number(messages.executionTarget) || 0);
  const executionStatusCopy = {
    aguardando: 'Aguardando',
    em_execucao: 'Em execução',
    reconectando: 'Reconectando',
    limite_diario: 'Limite atingido',
    concluida: 'Concluída',
    aguardando_persistencia: 'Protegida',
    erro: 'Com erro',
    erro_autenticacao: 'Falha de autenticação',
    pausada: 'Pausada',
    interrompida: 'Interrompida',
    atendimento: 'Atendimento conectado',
  }[messages.executionStatus] || 'Aguardando';
  ctx.setText(ctx.elements.messagesLiveCurrent, ctx.formatInteger(executionSent));
  ctx.setText(ctx.elements.messagesLiveTarget, ctx.formatInteger(executionTarget));
  ctx.setText(
    ctx.elements.messagesLiveDetail,
    messages.currentContact
      ? `Contato atual: ${messages.currentContact} · hoje ${ctx.formatInteger(sentToday)} de ${ctx.formatInteger(dailyLimit)}`
      : messages.executionStartedAt
        ? `Iniciada ${ctx.formatDate(messages.executionStartedAt, true)} · hoje ${ctx.formatInteger(sentToday)} de ${ctx.formatInteger(dailyLimit)}`
        : 'Nenhuma execução registrada ainda.',
  );
  ctx.setText(ctx.elements.messagesLiveRemaining, ctx.formatInteger(messages.executionRemaining));
  ctx.setText(ctx.elements.messagesLiveProcessed, ctx.formatInteger(messages.executionProcessed));
  ctx.setText(ctx.elements.messagesLiveStatus, messages.listFinished?'Lista concluída':executionStatusCopy);
  const resultSummary=document.querySelector('#messages-result-summary');
  if(resultSummary){const result=messages.executionResults;
    const sent=Number(result?.sent)||0,skipped=Number(result?.skipped)||0,failed=Number(result?.failed)||0;
    resultSummary.textContent=result?`${sent} ${sent===1?'enviado':'enviados'} · ${skipped} ${skipped===1?'ignorado':'ignorados'} · ${failed} ${failed===1?'falha':'falhas'} · ${Number(result.uncertain)||0} para conferir no WhatsApp`:'O resumo de resultados estará disponível nas novas execuções.';
  }
  if(messages.nextSendAt&&messages.executionStatus==='em_execucao'&&ctx.state.processes?.messages?.running){
    const remaining=Math.max(0,Math.ceil((Date.parse(messages.nextSendAt)-Date.now())/1000));
    ctx.elements.messagesLiveDetail.textContent+=(remaining?` · ${messages.waitKind==='intervalo'?'Próxima verificação':'Próximo envio'} em ${remaining}s`:' · Preparando a próxima operação');
  }else if(messages.listFinished)ctx.elements.messagesLiveDetail.textContent+=' · Lista percorrida; confira o resultado dos contatos abaixo.';
  ctx.elements.messagesLiveProgress.max = Math.max(1, executionTarget);
  ctx.elements.messagesLiveProgress.value = Math.min(executionSent, Math.max(1, executionTarget));
  if(messages.listFinished)ctx.elements.messagesLiveProgress.value=ctx.elements.messagesLiveProgress.max;
  ctx.elements.messagesLiveProgress.textContent = executionTarget
    ? ctx.formatPercent((executionSent / executionTarget) * 100)
    : '0%';

  ctx.setToolStatus(ctx.elements.toolFfmpeg, ads.ffmpegInstalled);
  ctx.setToolStatus(ctx.elements.toolTesseract, ads.tesseractInstalled);
  ctx.setToolStatus(ctx.elements.toolOllama, ads.ollamaInstalled, true);
}

function createSettingsItem(primary, secondary, kind, index) {
  const item = ctx.createElement('div', 'settings-item');
  const copy = ctx.createElement('span', 'settings-item-copy');
  copy.append(ctx.createElement('strong', null, primary), ctx.createElement('small', null, secondary));
  const remove = ctx.createElement('button', 'settings-remove', 'Remover');
  remove.type = 'button';
  remove.dataset.settingsKind = kind;
  remove.dataset.settingsIndex = String(index);
  remove.setAttribute('aria-label', `Remover ${primary}`);
  item.append(copy, remove);
  return item;
}

function renderSearchSettingsLists() {
  const searchSettings = ctx.state.operationSettings?.settings?.search;
  if (!searchSettings) return;

  const localities = searchSettings.localities || [];
  if (!savedLocalityKeys || !ctx.state.settingsDirty) {
    savedLocalityKeys = new Set(localities.map(localityKey));
  }
  const wasOpen = ctx.elements.searchLocalityList.querySelector('.settings-saved-localities')?.open === true;
  const indexed = localities.map((item, index) => ({ item, index }));
  const pending = indexed.filter(({ item }) => !savedLocalityKeys.has(localityKey(item)));
  const saved = indexed.filter(({ item }) => savedLocalityKeys.has(localityKey(item)));
  ctx.elements.searchLocalityList.replaceChildren(...pending.map(({ item, index }) =>
    ctx.createSettingsItem(item.city, `${item.market} · Não salva`, 'locality', index)));
  if (saved.length) {
    const group = ctx.createElement('details', 'settings-saved-localities');
    group.open = wasOpen;
    const title = ctx.createElement('summary', null, `Gerenciar cidades salvas (${saved.length})`);
    const list = ctx.createElement('div', 'settings-list');
    list.append(...saved.map(({ item, index }) => ctx.createSettingsItem(item.city, item.market, 'locality', index)));
    group.append(title, list);
    ctx.elements.searchLocalityList.append(group);
  } else if (!pending.length) {
    ctx.elements.searchLocalityList.append(ctx.createElement('p', 'settings-empty', 'Adicione cidades e salve para incluí-las na próxima busca. A lista original continua ativa.'));
  }

  const categories = searchSettings.categories || [];
  ctx.elements.searchCategoryList.replaceChildren(...(
    categories.length
      ? categories.map((item, index) => ctx.createSettingsItem(item.name, `${item.key} = ${item.value}`, 'category', index))
      : [ctx.createElement('p', 'settings-empty', 'Nenhuma categoria adicional. As categorias atuais continuam ativas.')]
  ));
}

function renderSettingsAvailability() {
  const anyScriptRunning = Object.entries(ctx.state.processes || {}).some(([id,processState]) => id!=='whatsapp'&&processState.running);
  const settingsUnavailable = !ctx.state.operationSettings?.settings;
  for (const fieldset of [ctx.elements.searchSettingsFieldset, ctx.elements.messageSettingsFieldset]) {
    fieldset.disabled = anyScriptRunning || settingsUnavailable;
  }

  if (settingsUnavailable) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Não foi possível carregar as configurações locais.');
    ctx.setText(ctx.elements.messageSettingsStatus, 'Não foi possível carregar as configurações locais.');
  } else if (anyScriptRunning) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Encerre a execução atual antes de salvar mudanças.');
    ctx.setText(ctx.elements.messageSettingsStatus, 'Encerre a execução atual antes de salvar mudanças.');
  } else if (!ctx.state.settingsDirty) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'As alterações entram na próxima busca.');
    ctx.setText(ctx.elements.messageSettingsStatus, 'Respostas automáticas continuam fora deste limite.');
  }
}

function renderOperationSettings() {
  const snapshot = ctx.state.operationSettings;
  if (!snapshot?.settings) return;

  if (!ctx.state.settingsDirty) {
    const { messages } = snapshot.settings;
    ctx.elements.messageDelayMin.value = messages.delayMinSeconds;
    ctx.elements.messageDelayMax.value = messages.delayMaxSeconds;
    ctx.elements.messageDailyLimit.value = messages.dailyLimit;

    const selectedMarket = ctx.elements.searchMarket.value;
    ctx.elements.searchMarket.replaceChildren(...snapshot.supportedMarkets.map((market) => {
      const option = ctx.createElement('option', null, market.label);
      option.value = market.id;
      return option;
    }));
    if (snapshot.supportedMarkets.some((market) => market.id === selectedMarket)) {
      ctx.elements.searchMarket.value = selectedMarket;
    }
    ctx.renderSearchSettingsLists();
  }

  ctx.renderSettingsAvailability();
}

function markSettingsDirty(statusElement, message) {
  ctx.state.settingsDirty = true;
  document.dispatchEvent(new Event('ploa-settings-draft'));
  ctx.setText(statusElement, message);
}

function settingsPayload() {
  const searchSettings = ctx.state.operationSettings?.settings?.search || { localities: [], categories: [] };
  return {
    messages: {
      delayMinSeconds: Number(ctx.elements.messageDelayMin.value),
      delayMaxSeconds: Number(ctx.elements.messageDelayMax.value),
      dailyLimit: Number(ctx.elements.messageDailyLimit.value),
    },
    search: {
      localities: searchSettings.localities.map((item) => ({ ...item })),
      categories: searchSettings.categories.map((item) => ({ ...item })),
    },
  };
}

async function saveOperationSettings(statusElement) {
  const buttons = [
    ctx.elements.searchSettingsForm.querySelector('button[type="submit"]'),
    ctx.elements.messageSettingsForm.querySelector('button[type="submit"]'),
  ];
  for (const button of buttons) button.disabled = true;
  ctx.setText(statusElement, 'Salvando configurações…');

  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(ctx.settingsPayload()),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar as configurações.');
    ctx.state.operationSettings = result;
    ctx.state.settingsDirty = false;
    ctx.elements.searchLocalityList.querySelector('.settings-saved-localities')?.removeAttribute('open');
    document.dispatchEvent(new Event('ploa-settings-saved'));
    ctx.renderOperationSettings();
    ctx.renderCopyEditor();
    ctx.showToast('Configurações salvas para a próxima execução.');
  } catch (error) {
    ctx.setText(statusElement, error.message);
    ctx.showToast(error.message, 'error');
  } finally {
    for (const button of buttons) button.disabled = false;
    ctx.renderSettingsAvailability();
  }
}

function removeSearchSetting(event) {
  const button = event.target.closest('button[data-settings-kind]');
  if (!button) return;
  const index = Number(button.dataset.settingsIndex);
  const collection = button.dataset.settingsKind === 'locality'
    ? ctx.state.operationSettings.settings.search.localities
    : ctx.state.operationSettings.settings.search.categories;
  if (!Number.isInteger(index) || index < 0 || index >= collection.length) return;
  collection.splice(index, 1);
  ctx.markSettingsDirty(ctx.elements.searchSettingsStatus, 'Item removido. Salve para aplicar a alteração.');
  ctx.renderSearchSettingsLists();
}

  function bindEvents() {
ctx.elements.addSearchLocality.addEventListener('click', () => {
  const city = ctx.elements.searchLocality.value.replace(/\s+/g, ' ').trim();
  const market = ctx.elements.searchMarket.value;
  if (!city) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Informe a cidade ou localidade antes de adicionar.');
    ctx.elements.searchLocality.focus();
    return;
  }

  if (ctx.localityIsInBaseSearch(market, city)) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Essa cidade já faz parte da busca original.');
    ctx.closeLocalitySuggestions();
    return;
  }

  const localities = ctx.state.operationSettings.settings.search.localities;
  const duplicate = localities.some((item) => ctx.normalizeSearch(`${item.market}|${item.city}`) === ctx.normalizeSearch(`${market}|${city}`));
  if (duplicate) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Essa localidade já está na lista adicional.');
    return;
  }

  localities.push({ city, market });
  ctx.elements.searchLocality.value = '';
  ctx.closeLocalitySuggestions();
  ctx.markSettingsDirty(ctx.elements.searchSettingsStatus, 'Localidade adicionada. Salve para aplicar na próxima busca.');
  ctx.renderSearchSettingsLists();
});

ctx.elements.addSearchCategory.addEventListener('click', () => {
  const name = ctx.elements.searchCategoryName.value.replace(/\s+/g, ' ').trim();
  const key = ctx.elements.searchCategoryKey.value.trim();
  const value = ctx.elements.searchCategoryValue.value.trim();
  if (!name || !key || !value) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Preencha nome, chave e valor da categoria.');
    return;
  }
  if (!/^[a-zA-Z0-9_.:-]+$/.test(key) || !/^[a-zA-Z0-9_.:-]+$/.test(value)) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Chave e valor OSM contêm caracteres não permitidos.');
    return;
  }
  if (ctx.categoryIsInBaseSearch(name)) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Essa categoria já faz parte da busca original.');
    ctx.closeCategorySuggestions();
    return;
  }

  const categories = ctx.state.operationSettings.settings.search.categories;
  const duplicate = categories.some((item) => ctx.normalizeSearch(`${item.name}|${item.key}|${item.value}`) === ctx.normalizeSearch(`${name}|${key}|${value}`));
  if (duplicate) {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Essa categoria já está na lista adicional.');
    return;
  }

  categories.push({ name, key, value });
  ctx.elements.searchCategoryName.value = '';
  ctx.elements.searchCategoryKey.value = '';
  ctx.elements.searchCategoryValue.value = '';
  ctx.closeCategorySuggestions();
  ctx.markSettingsDirty(ctx.elements.searchSettingsStatus, 'Categoria adicionada. Salve para aplicar na próxima busca.');
  ctx.renderSearchSettingsLists();
});

ctx.elements.searchLocalityList.addEventListener('click', ctx.removeSearchSetting);

ctx.elements.searchCategoryList.addEventListener('click', ctx.removeSearchSetting);

ctx.elements.searchSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  ctx.saveOperationSettings(ctx.elements.searchSettingsStatus);
});

ctx.elements.messageSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  ctx.saveOperationSettings(ctx.elements.messageSettingsStatus);
});
  }
  return { setToolStatus, renderOperations, createSettingsItem, renderSearchSettingsLists, renderSettingsAvailability, renderOperationSettings, markSettingsDirty, settingsPayload, saveOperationSettings, removeSearchSetting, bindEvents };
};

