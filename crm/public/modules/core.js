'use strict';
// Estado, formatação e coordenação compartilhada. Não inicia scripts.
window.PloaAppModules = window.PloaAppModules || {};
'use strict';

const VIEW_META = {
  overview: { title: 'Dashboard', kicker: 'Visão da operação' },
  funnel: { title: 'Funil', kicker: 'Conversão comercial' },
  leads: { title: 'Leads', kicker: 'Acompanhamento individual' },
  search: { title: 'Buscar leads', kicker: 'Coleta no OpenStreetMap' },
  messages: { title: 'Mensagens', kicker: 'Progresso dos envios' },
  ai: { title: 'IA', kicker: 'Atendimento e orientações' },
  copies: { title: 'Copys', kicker: 'Biblioteca de mensagens' },
  ads: { title: 'Anúncios', kicker: 'Mineração de criativos' },
};

const PAGE_SIZE = 120;

const state = {
  dashboard: null,
  operations: null,
  processes: null,
  adsCatalog: null,
  operationSettings: null,
  searchPlan: null,
  settingsDirty: false,
  copySettings: null,
  copySettingsBaseline: null,
  copySettingsDirty: false,
  copyFormDirty: false,
  copyCategoryFormDirty: false,
  copyType: 'firstContact',
  copyMarket: 'Brasil',
  copyCategory: '__generic__',
  activeView: 'overview',
  selectedLeadId: null,
  statusFilter: null,
  attentionFilter: 'todos',
  search: '',
  formDirty: false,
  visibleLeadLimit: PAGE_SIZE,
  adsQuery: '',
  adsNiche: '',
  adsMinimumScale: 0,
  adsViewMode: 'cards',
  selectedAdId: null,
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const longDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Sem registro';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return includeTime ? dateTimeFormatter.format(date) : dateFormatter.format(date);
}

function formatRelativeTime(value) {
  if (!value) return 'Agora';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Agora';

  const difference = timestamp - Date.now();
  const units = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, milliseconds] of units) {
    if (Math.abs(difference) >= milliseconds || unit === 'minute') {
      return relativeTimeFormatter.format(Math.round(difference / milliseconds), unit);
    }
  }
  return 'Agora';
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatPercent(value) {
  const number = Number.isFinite(value) ? value : 0;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(number)}%`;
}

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0));
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

let actionFeedbackSource=null,actionFeedback=null;
if(typeof document!=='undefined'){
  document.addEventListener('click',event=>{actionFeedbackSource=event.target.closest?.('button,[role="button"]')||null;},true);
  document.addEventListener('submit',event=>{actionFeedbackSource=event.submitter||actionFeedbackSource;},true);
}
function showToast(message, kind = 'success') {
  actionFeedback?.();actionFeedback=null;
  if(kind==='success'){
    elements.toast.hidden=true;window.clearTimeout(showToast.timeoutId);
    if(!actionFeedbackSource?.isConnected)return;
    const source=actionFeedbackSource,oldMargin=source.style.marginBottom,oldLabel=source.getAttribute('aria-label');
    const label=source.textContent.trim(),minimum=parseFloat(getComputedStyle(source).marginBottom)||0;
    const item=document.createElement('span');item.className='ploa-action-success';item.setAttribute('role','status');item.setAttribute('aria-live','polite');
    item.textContent=/salv|registrad|cadastrad|adicionad|atualizad/i.test(message||'')?'Salvo com sucesso.':'Concluído com sucesso.';
    if(oldLabel===null)source.setAttribute('aria-label',label);source.classList.add('ploa-has-feedback');source.append(item);
    const reserve=()=>{source.style.marginBottom=Math.max(minimum,item.getBoundingClientRect().height+8)+'px';};reserve();
    const observer=new ResizeObserver(reserve);observer.observe(item);
    const clean=()=>{observer.disconnect();item.remove();source.classList.remove('ploa-has-feedback');source.style.marginBottom=oldMargin;if(oldLabel===null)source.removeAttribute('aria-label');};
    actionFeedback=clean;showToast.timeoutId=window.setTimeout(()=>{clean();if(actionFeedback===clean)actionFeedback=null;},3000);return;
  }
  elements.toast.dataset.kind = kind;
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

let activeViewTransition = null;

function setActiveView(view, { focus = false, renderLeads = true } = {}) {
  if (!VIEW_META[view]) return;
  const migrated = { overview: '/app-next/dashboard', funnel: '/app-next/funnel', leads: '/app-next/leads',copies:'/app-next/copies',messages:'/app-next/messages',search:'/app-next/search',ai:'/app-next/ai' };
  if (Object.hasOwn(migrated, view)) {
    try {
      const previous = JSON.parse(sessionStorage.getItem('ploa-next-filters') || '{}');
      sessionStorage.setItem('ploa-next-filters', JSON.stringify({ ...previous, ...state.extraFilters, attention: state.attentionFilter, status: state.statusFilter || '', search: state.search || '' }));
    } catch { /* Navigation works without optional filter storage. */ }
    const query = view === 'leads' ? new URLSearchParams({ attention: state.attentionFilter || 'todos', ...(state.statusFilter ? {status:state.statusFilter} : {}) }).toString() : '';
    window.location.assign(migrated[view] + (query ? '?' + query : ''));
    return;
  }
  const changed = state.activeView !== view;
  state.activeView = view;
  document.body.dataset.view = view;

  for (const button of elements.navButtons) {
    if (button.dataset.viewTarget === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  for (const panel of elements.viewPanels) {
    panel.hidden = panel.dataset.viewPanel !== view;
  }

  setText(elements.viewTitle, VIEW_META[view].title);
  setText(elements.viewKicker, VIEW_META[view].kicker);

  if (view === 'leads') {
    if (state.dashboard && renderLeads) {
      renderLeadQueues();
      renderLeadList();
      renderInspector();
    }
  } else {
    elements.leadList.replaceChildren();
    elements.mobileBackdrop.hidden = true;
    document.body.classList.remove('inspector-open');
  }

  try {
    window.sessionStorage.setItem('crm-active-view', view);
  } catch {
    // A navegação continua funcionando mesmo sem armazenamento de sessão.
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
  if (focus) elements.mainContent.focus({ preventScroll: true });
  if (changed) {
    activeViewTransition?.cancel();
    const panel = elements.viewPanels.find((item) => item.dataset.viewPanel === view);
    if (panel && typeof panel.animate === 'function') {
      // Movimento solicitado explicitamente para a navegação do Ploa, mesmo
      // quando o Windows desativa suas animações. Não altera efeitos globais.
      // O conteúdo permanece visível durante a subida para evitar uma piscada.
      const transition = panel.animate([
        { opacity: 0.45, transform: 'translateY(40px)' },
        { opacity: 1, transform: 'none' },
      ], {
        duration: 640,
        easing: 'cubic-bezier(.22,.61,.36,1)',
      });
      // Mantém o primeiro quadro durante a montagem síncrona da página.
      // O movimento começa no quadro seguinte, após os blocos estarem prontos.
      transition.pause();
      activeViewTransition = transition;
      window.requestAnimationFrame(() => {
        if (activeViewTransition === transition && !panel.hidden) transition.play();
        else transition.cancel();
      });
    }
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function renderAll() {
  renderSummary();
  renderRevenueStageChart();
  renderFunnelPreview();
  renderFunnelChart();
  renderFunnelInsights();
  renderFunnelOutcomes();
  renderFunnelOperation();
  renderPipeline();
  renderStatusOptions();
  renderOperations();
  renderProcesses();
  renderOperationSettings();
  renderCopyEditor();
  renderAdsCatalog();
  if (state.activeView === 'leads') {
    renderLeadQueues();
    renderLeadList();
    renderInspector();
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Falha ao carregar ${url}.`);
  return response.json();
}

async function loadProcesses() {
  try {
    const [processes, operations] = await Promise.all([
      fetchJson('/api/processes'),
      fetchJson('/api/operations').catch(() => null),
    ]);
    state.processes = processes;
    if (operations) state.operations = operations;
    renderOperations();
    renderProcesses();
  } catch {
    // A atualização geral exibirá uma falha caso o servidor deixe de responder.
  }
}

async function triggerProcessAction(id, action) {
  const relatedButtons = [
    ...elements.processStartButtons.filter((button) => button.dataset.processStart === id),
    ...elements.processStopButtons.filter((button) => button.dataset.processStop === id),
  ];
  for (const button of relatedButtons) button.disabled = true;

  try {
    const response = await fetch(`/api/processes/${id}/${action}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || 'Não foi possível controlar o script.');
    state.processes = { ...state.processes, [id]: result.process };
    renderProcess(id);
    showToast(action === 'start' ? 'Execução iniciada pelo painel.' : 'Encerramento solicitado.');
    window.setTimeout(loadProcesses, 450);
  } catch (error) {
    showToast(error.message, 'error');
    await loadProcesses();
  }
}

async function loadDashboard({ quiet = false } = {}) {
  if (!quiet) {
    elements.refreshButton.disabled = true;
    elements.syncStatus.textContent = 'Atualizando dados…';
  }

  try {
    const [dashboard, operations, processes, adsCatalog, operationSettings] = await Promise.all([
      fetchJson('/api/dashboard'),
      fetchJson('/api/operations').catch(() => null),
      fetchJson('/api/processes').catch(() => null),
      fetchJson('/api/ads').catch(() => null),
      fetchJson('/api/settings').catch(() => null),
    ]);
    state.dashboard = dashboard;
    state.operations = operations;
    state.processes = processes;
    state.adsCatalog = adsCatalog;
    if (!state.settingsDirty && operationSettings) state.operationSettings = operationSettings;
    if (state.selectedLeadId && !selectedLead()) state.selectedLeadId = null;
    renderAll();
    elements.syncStatus.textContent = `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
  } catch (error) {
    elements.syncStatus.textContent = 'Falha ao atualizar';
    if (!quiet) showToast('Não foi possível carregar os dados do CRM.', 'error');
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function closeInspector() {
  state.selectedLeadId = null;
  state.formDirty = false;
  renderLeadList();
  renderInspector();
}
