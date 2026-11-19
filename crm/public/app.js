'use strict';
// Entrada da interface. Controladores recebem o estado compartilhado explicitamente.
const appContext = {
  get VIEW_META() { return VIEW_META; },
  get PAGE_SIZE() { return PAGE_SIZE; },
  get LOCALITY_CATALOG() { return LOCALITY_CATALOG; },
  get CATEGORY_CATALOG() { return CATEGORY_CATALOG; },
  get state() { return state; },
  get elements() { return elements; },
  get dateFormatter() { return dateFormatter; },
  get dateTimeFormatter() { return dateTimeFormatter; },
  get longDateFormatter() { return longDateFormatter; },
  get relativeTimeFormatter() { return relativeTimeFormatter; },
  get normalizeSearch() { return normalizeSearch; },
  get formatDate() { return formatDate; },
  get formatRelativeTime() { return formatRelativeTime; },
  get formatCurrency() { return formatCurrency; },
  get formatPercent() { return formatPercent; },
  get formatInteger() { return formatInteger; },
  get setText() { return setText; },
  get createElement() { return createElement; },
  get showToast() { return showToast; },
  get activeViewTransition() { return activeViewTransition; },
  get setActiveView() { return setActiveView; },
  get cloneJson() { return cloneJson; },
  get renderAll() { return renderAll; },
  get fetchJson() { return fetchJson; },
  get loadProcesses() { return loadProcesses; },
  get triggerProcessAction() { return triggerProcessAction; },
  get loadDashboard() { return loadDashboard; },
  get closeInspector() { return closeInspector; },
  get normalizedLocalityQuery() { return normalizedLocalityQuery; },
  get localitySuggestionsForInput() { return localitySuggestionsForInput; },
  get closeLocalitySuggestions() { return closeLocalitySuggestions; },
  get updateLocalitySuggestionSelection() { return updateLocalitySuggestionSelection; },
  get renderLocalitySuggestions() { return renderLocalitySuggestions; },
  get chooseLocalitySuggestion() { return chooseLocalitySuggestion; },
  get localityIsInBaseSearch() { return localityIsInBaseSearch; },
  get categorySuggestionsForInput() { return categorySuggestionsForInput; },
  get closeCategorySuggestions() { return closeCategorySuggestions; },
  get updateCategorySuggestionSelection() { return updateCategorySuggestionSelection; },
  get renderCategorySuggestions() { return renderCategorySuggestions; },
  get chooseCategorySuggestion() { return chooseCategorySuggestion; },
  get categoryIsInBaseSearch() { return categoryIsInBaseSearch; },
  get latestLeadMatching() { return latestLeadMatching; },
  get leadDisplayName() { return leadDisplayName; },
  get leadNewsTime() { return leadNewsTime; },
  get buildAttentionNews() { return buildAttentionNews; },
  get renderAttentionFeed() { return renderAttentionFeed; },
  get renderSummary() { return renderSummary; },
  get renderRevenueStageChart() { return renderRevenueStageChart; },
  get applyStatusFilter() { return applyStatusFilter; },
  get applyAttentionFilter() { return applyAttentionFilter; },
  get renderPipeline() { return renderPipeline; },
  get leadMatchesFilters() { return leadMatchesFilters; },
  get describeNextAction() { return describeNextAction; },
  get createLeadRow() { return createLeadRow; },
  get renderLeadQueues() { return renderLeadQueues; },
  get renderLeadList() { return renderLeadList; },
  get selectedLead() { return selectedLead; },
  get renderStatusOptions() { return renderStatusOptions; },
  get createHistoryItem() { return createHistoryItem; },
  get renderHistory() { return renderHistory; },
  get renderInspector() { return renderInspector; },
  get attentionFilterForFunnelStep() { return attentionFilterForFunnelStep; },
  get funnelHeight() { return funnelHeight; },
  get renderConnectedFunnel() { return renderConnectedFunnel; },
  get renderFunnelPreview() { return renderFunnelPreview; },
  get renderFunnelChart() { return renderFunnelChart; },
  get copyLibrarySummary() { return copyLibrarySummary; },
  get renderFunnelOperation() { return renderFunnelOperation; },
  get renderFunnelInsights() { return renderFunnelInsights; },
  get renderFunnelOutcomes() { return renderFunnelOutcomes; },
  get setToolStatus() { return setToolStatus; },
  get renderOperations() { return renderOperations; },
  get createSettingsItem() { return createSettingsItem; },
  get renderSearchSettingsLists() { return renderSearchSettingsLists; },
  get renderSettingsAvailability() { return renderSettingsAvailability; },
  get renderOperationSettings() { return renderOperationSettings; },
  get markSettingsDirty() { return markSettingsDirty; },
  get settingsPayload() { return settingsPayload; },
  get saveOperationSettings() { return saveOperationSettings; },
  get removeSearchSetting() { return removeSearchSetting; },
  get marketMetadata() { return marketMetadata; },
  get copyCategoryLabel() { return copyCategoryLabel; },
  get firstContactCategoryOptions() { return firstContactCategoryOptions; },
  get searchCategoriesWithoutCopies() { return searchCategoriesWithoutCopies; },
  get renderCopyCategoryCreation() { return renderCopyCategoryCreation; },
  get automaticCategoryOptions() { return automaticCategoryOptions; },
  get currentCopyList() { return currentCopyList; },
  get resetCopyItemForm() { return resetCopyItemForm; },
  get renderCopyEditor() { return renderCopyEditor; },
  get markCopySettingsDirty() { return markCopySettingsDirty; },
  get loadCopySettings() { return loadCopySettings; },
  get saveCopySettings() { return saveCopySettings; },
  get getProcessElements() { return getProcessElements; },
  get separateQrFromProcessLogs() { return separateQrFromProcessLogs; },
  get formatProcessLogs() { return formatProcessLogs; },
  get fitMessagesQrCode() { return fitMessagesQrCode; },
  get renderProcess() { return renderProcess; },
  get renderProcesses() { return renderProcesses; },
  get scaleTone() { return scaleTone; },
  get filteredAds() { return filteredAds; },
  get createAdSignal() { return createAdSignal; },
  get createAdCard() { return createAdCard; },
  get createAdCatalogRow() { return createAdCatalogRow; },
  get renderAdsNiches() { return renderAdsNiches; },
  get renderAdsCatalog() { return renderAdsCatalog; },
  get selectedAd() { return selectedAd; },
  get openAdDetails() { return openAdDetails; }
};

const suggestionsController = window.PloaAppModules.suggestions(appContext);
let { normalizedLocalityQuery, localitySuggestionsForInput, closeLocalitySuggestions, updateLocalitySuggestionSelection, renderLocalitySuggestions, chooseLocalitySuggestion, localityIsInBaseSearch, categorySuggestionsForInput, closeCategorySuggestions, updateCategorySuggestionSelection, renderCategorySuggestions, chooseCategorySuggestion, categoryIsInBaseSearch } = suggestionsController;

const dashboardController = window.PloaAppModules.dashboard(appContext);
let { latestLeadMatching, leadDisplayName, leadNewsTime, buildAttentionNews, renderAttentionFeed, renderSummary, renderRevenueStageChart } = dashboardController;

const leadsController = window.PloaAppModules.leads(appContext);
let { applyStatusFilter, applyAttentionFilter, renderPipeline, leadMatchesFilters, describeNextAction, createLeadRow, renderLeadQueues, renderLeadList, selectedLead, renderStatusOptions, createHistoryItem, renderHistory, renderInspector } = leadsController;

const funnelController = window.PloaAppModules.funnel(appContext);
let { attentionFilterForFunnelStep, funnelHeight, renderConnectedFunnel, renderFunnelPreview, renderFunnelChart, copyLibrarySummary, renderFunnelOperation, renderFunnelInsights, renderFunnelOutcomes } = funnelController;

const settingsController = window.PloaAppModules.settings(appContext);
let { setToolStatus, renderOperations, createSettingsItem, renderSearchSettingsLists, renderSettingsAvailability, renderOperationSettings, markSettingsDirty, settingsPayload, saveOperationSettings, removeSearchSetting } = settingsController;

const copiesController = window.PloaAppModules.copies(appContext);
let { marketMetadata, copyCategoryLabel, firstContactCategoryOptions, searchCategoriesWithoutCopies, renderCopyCategoryCreation, automaticCategoryOptions, currentCopyList, resetCopyItemForm, renderCopyEditor, markCopySettingsDirty, loadCopySettings, saveCopySettings } = copiesController;

const processesController = window.PloaAppModules.processes(appContext);
let { getProcessElements, separateQrFromProcessLogs, formatProcessLogs, fitMessagesQrCode, renderProcess, renderProcesses } = processesController;

const adsController = window.PloaAppModules.ads(appContext);
let { scaleTone, filteredAds, createAdSignal, createAdCard, createAdCatalogRow, renderAdsNiches, renderAdsCatalog, selectedAd, openAdDetails } = adsController;

suggestionsController.bindEvents();
dashboardController.bindEvents();
leadsController.bindEvents();
funnelController.bindEvents();
settingsController.bindEvents();
copiesController.bindEvents();
processesController.bindEvents();
adsController.bindEvents();

for (const button of elements.navButtons) {
  button.addEventListener('click', () => setActiveView(button.dataset.viewTarget, { focus: true }));
}

for (const button of elements.openViewButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.attentionShortcut) {
      state.statusFilter = null;
      state.attentionFilter = button.dataset.attentionShortcut;
      elements.attentionFilter.value = state.attentionFilter;
      state.visibleLeadLimit = PAGE_SIZE;
    }
    setActiveView(button.dataset.openView, { focus: true });
  });
}

for (const button of elements.copyCommandButtons) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyCommand);
      showToast('Comando copiado.');
    } catch {
      showToast('Não foi possível copiar. Selecione o comando exibido na tela.', 'error');
    }
  });
}

elements.refreshButton.addEventListener('click', () => loadDashboard());

window.addEventListener('resize', () => {
  const mobileOpen = state.activeView === 'leads' && Boolean(state.selectedLeadId) && window.innerWidth <= 860;
  elements.mobileBackdrop.hidden = !mobileOpen;
  document.body.classList.toggle('inspector-open', mobileOpen);
  fitMessagesQrCode();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.formDirty && !state.settingsDirty) loadDashboard({ quiet: true });
});

elements.todayLabel.textContent = longDateFormatter.format(new Date());

try {
  const savedView = window.sessionStorage.getItem('crm-active-view');
  if (VIEW_META[savedView]) state.activeView = savedView;
} catch {
  // Usa a visão geral quando o armazenamento de sessão não está disponível.
}

// A link from the isolated dashboard can open an existing page/filter. This
// changes navigation only; it never starts a process or saves a lead.
const initialNavigation = new URLSearchParams(window.location.search);
const requestedView = initialNavigation.get('view');
if (requestedView && Object.hasOwn(VIEW_META, requestedView)) {
  state.activeView = requestedView;
  // Carry the explicit React navigation's filters into the legacy IA triage.
  // This is a local view preference only, not an instruction to run analysis.
  if (initialNavigation.get('from') === 'next') {
    try {
      const filters = JSON.parse(sessionStorage.getItem('ploa-next-filters') || '{}');
      if ([...elements.attentionFilter.options].some(option => option.value === filters.attention)) {
        state.attentionFilter = filters.attention; elements.attentionFilter.value = filters.attention;
      }
      if (['novo','respondeu','automatico','qualificado','proposta','negociacao','ganho','perdido','nao_contatar'].includes(filters.status)) state.statusFilter = filters.status;
      state.search = normalizeSearch(String(filters.search || '').slice(0,140)); elements.searchInput.value = String(filters.search || '').slice(0,140);
      state.nextFilters = { country: String(filters.country || '').slice(0,60), category: String(filters.category || '').slice(0,80), mode: ['human','automatic'].includes(filters.mode) ? filters.mode : '' };
    } catch { /* Invalid or unavailable view preferences do not block the panel. */ }
  }
  const attention = initialNavigation.get('attention');
  if (requestedView === 'leads' && [...elements.attentionFilter.options].some(option => option.value === attention)) {
    state.attentionFilter = attention;
    elements.attentionFilter.value = attention;
  }
  const requestedStatus = initialNavigation.get('status');
  if (requestedView === 'leads' && ['novo','respondeu','automatico','qualificado','proposta','negociacao','ganho','perdido','nao_contatar'].includes(requestedStatus)) state.statusFilter = requestedStatus;
  initialNavigation.delete('view'); initialNavigation.delete('attention'); initialNavigation.delete('status');
  initialNavigation.delete('from');
  const query = initialNavigation.toString();
  window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
}
setActiveView(state.activeView);
document.documentElement.dataset.ploaReady = 'true';

loadDashboard();

loadCopySettings();

window.setInterval(() => {
  if (!document.hidden && !state.formDirty && !state.settingsDirty) loadDashboard({ quiet: true });
}, 30000);

window.setInterval(() => {
  const processPageOpen = ['search', 'messages', 'ai'].includes(state.activeView);
  const processRunning = Object.values(state.processes || {}).some((processState) => processState.running);
  if (!document.hidden && (processPageOpen || processRunning)) loadProcesses();
}, 2500);
