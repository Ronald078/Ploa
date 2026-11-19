/* Coordenação do atendimento, atualização e integração entre áreas. */
(() => {
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);

const localGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

const localSet = (key,value) => { try { localStorage.setItem(key,value); } catch {} };

const node = (tag, className, text) => createElement(tag, className || null, text);

const money = (value, currency = 'BRL') => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value) || 0);

const view = (name) => $('[data-view-panel="' + name + '"]');

let snapshot = null;

let report = null;

let loading = false;

let dirty = false;

const dirtySections = new Set();

const sectionRevisions = new Map();
const confirmationRequests = new Map();

const contactDrafts = new Map();

const selectWidgets = new Map();

let nextSelectId = 0;

let openPicker = null;

function markDirty(section) {
    dirtySections.add(section);
    sectionRevisions.set(section, (sectionRevisions.get(section) || 0) + 1);
    dirty = true;
  }

function saveStamp(section) { return {id:selectedLead()?.id,revision:sectionRevisions.get(section)||0}; }

function markSaved(section, stamp) {
    if (selectedLead()?.id !== stamp.id || (sectionRevisions.get(section)||0) !== stamp.revision) return;
    dirtySections.delete(section);
    dirty = dirtySections.size > 0;
    ctx.rememberDraft();
  }

let selected = null;

let currency = localGet('ploa-currency') || 'BRL';

if (!['BRL', 'EUR', 'USD'].includes(currency)) currency = 'BRL';

const drafts = new Map();

const suggestionDrafts = new Map();

let displayedSuggestion = null;

const extra = { country: '', category: '', mode: '', ...state.nextFilters };
state.extraFilters = extra;

const button = (text, fn, primary = false) => {
    const item = node('button', 'button ' + (primary ? 'button-primary' : 'button-secondary'), text);
    item.type = 'button';
    item.addEventListener('click', async () => {
      if(item.disabled)return;
      item.disabled = true;
      item.setAttribute('aria-busy','true');
      try { await fn(); } catch (error) { showToast(error.message, 'error'); }
      finally { item.removeAttribute('aria-busy'); item.disabled = false; }
    });
    return item;
  };

async function api(url, method = 'GET', body) {
    const response = await fetch(url, { method, headers: { Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.erro || 'Não foi possível salvar. Confira se o painel está conectado.');
    return data;
  }

async function loadWorkspace() {
    if (loading) return;
    loading = true;
    try {
      [snapshot, report] = await Promise.all([api('/api/workspace'), api('/api/reports')]);
      renderFinance();
      if(!openPicker)ctx.renderExtras();
      ctx.renderKnowledge();
      window.PloaMessageSections?.update();
      if(state.activeView==='ai')void triageControl.refresh();
      if(state.activeView==='search')void searchPreview.refresh();
      ctx.renderVersions();
      if(!openPicker)ctx.renderSavedFilters();
      ctx.renderRuns();
      renderAcquisition();
      if(!openPicker)ctx.renderBusiness();ctx.renderAiAttention();
    } catch (error) { showToast(error.message, 'error'); }
    finally { loading = false; }
  }

async function command(action, body = {}) {
    const lead = selectedLead();
    if (!lead) throw new Error('Selecione um contato.');
    let payload={action,...body};
    if(['proposal','payment'].includes(action)){
      const key=JSON.stringify([lead.id,action,sectionRevisions.get(action)||0,body]);
      if(!confirmationRequests.has(key)){
        confirmationRequests.set(key,crypto.randomUUID());
        if(confirmationRequests.size>200)confirmationRequests.delete(confirmationRequests.keys().next().value);
      }
      payload={...payload,requestId:confirmationRequests.get(key)};
    }
    const result = await api('/api/workspace/leads/' + encodeURIComponent(lead.id), 'POST', payload);
    await loadDashboard({ quiet: true });
    await loadWorkspace();
    return result;
  }

function section(title, detail) {
    const el = node('section', 'ploa-section');
    el.append(node('h3', null, title));
    if (detail) el.append(node('p', 'ploa-note', detail));
    return el;
  }

function field(label, type = 'text', wide = false) {
    const wrap = node('label', wide ? 'ploa-wide' : '');
    const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    if (input.tagName === 'INPUT') input.type = type;
    wrap.append(node('span', null, label), input);
    return { wrap, input };
  }

function options(select, entries, initial) {
    select.replaceChildren(...entries.map(([value, label]) => {
      const option = node('option', null, label); option.value = value; return option;
    }));
    if (initial !== undefined) select.value = initial;
  }

function details(title) {
    const el = node('details', 'ploa-section');
    el.append(node('summary', null, title));
    return el;
  }

function actions(...items) {
    const group=node('div','ploa-actions');group.append(...items);return group;
  }

function refreshList() {
    state.visibleLeadLimit = PAGE_SIZE;
    renderLeadList();
    renderInspector();
  }

const workspaceContext = Object.defineProperties({}, {
    $: { enumerable: true, get: () => $ },
    localGet: { enumerable: true, get: () => localGet },
    localSet: { enumerable: true, get: () => localSet },
    node: { enumerable: true, get: () => node },
    money: { enumerable: true, get: () => money },
    view: { enumerable: true, get: () => view },
    snapshot: { enumerable: true, get: () => snapshot, set: value => { snapshot = value; } },
    report: { enumerable: true, get: () => report, set: value => { report = value; } },
    loading: { enumerable: true, get: () => loading, set: value => { loading = value; } },
    dirty: { enumerable: true, get: () => dirty, set: value => { dirty = value; } },
    dirtySections: { enumerable: true, get: () => dirtySections },
    sectionRevisions: { enumerable: true, get: () => sectionRevisions },
    contactDrafts: { enumerable: true, get: () => contactDrafts },
    selectWidgets: { enumerable: true, get: () => selectWidgets },
    nextSelectId: { enumerable: true, get: () => nextSelectId, set: value => { nextSelectId = value; } },
    openPicker: { enumerable: true, get: () => openPicker, set: value => { openPicker = value; } },
    markDirty: { enumerable: true, get: () => markDirty },
    saveStamp: { enumerable: true, get: () => saveStamp },
    markSaved: { enumerable: true, get: () => markSaved },
    selected: { enumerable: true, get: () => selected, set: value => { selected = value; } },
    currency: { enumerable: true, get: () => currency, set: value => { currency = value; } },
    drafts: { enumerable: true, get: () => drafts },
    suggestionDrafts: { enumerable: true, get: () => suggestionDrafts },
    displayedSuggestion: { enumerable: true, get: () => displayedSuggestion, set: value => { displayedSuggestion = value; } },
    extra: { enumerable: true, get: () => extra },
    button: { enumerable: true, get: () => button },
    api: { enumerable: true, get: () => api },
    loadWorkspace: { enumerable: true, get: () => loadWorkspace },
    command: { enumerable: true, get: () => command },
    section: { enumerable: true, get: () => section },
    field: { enumerable: true, get: () => field },
    options: { enumerable: true, get: () => options },
    details: { enumerable: true, get: () => details },
    actions: { enumerable: true, get: () => actions },
    refreshList: { enumerable: true, get: () => refreshList },
    triageControl: { enumerable: true, get: () => triageControl },
    insights: { enumerable: true, get: () => insights },
    renderAcquisition: { enumerable: true, get: () => renderAcquisition },
    renderFinance: { enumerable: true, get: () => renderFinance },
    originalSetActiveView: { enumerable: true, get: () => originalSetActiveView },
    oldCopyEditor: { enumerable: true, get: () => oldCopyEditor },
    poll: { enumerable: true, get: () => poll }
});
const ctx = workspaceContext;
function mountArea(name) {
  const area = window.PloaWorkspaceModules[name](workspaceContext);
  Object.defineProperties(workspaceContext, Object.getOwnPropertyDescriptors(area));
}
// Navigation must not depend on optional attendance modules loading successfully.
mountArea('sidebar');
mountArea('selects');
mountArea('conversation');
mountArea('filters');
mountArea('attendance');
mountArea('connection');
mountArea('business');
mountArea('knowledge');
mountArea('versions');
mountArea('priorities');
mountArea('runs');
mountArea('backup');
mountArea('processes');

const triageControl=window.PloaTriage.create({node,details,field,actions,button,api,showToast,host:$('#ai-history-anchor'),
    getCandidates:()=>state.dashboard?.leads.filter(leadMatchesFilters)||[],getSnapshot:()=>snapshot,isActive:()=>state.activeView==='ai',
    onChanged:async()=>{await loadDashboard({quiet:true});await loadWorkspace();},openContact: ctx.openContact,chooseContacts:()=>setActiveView('leads',{focus:true})});

const insights=window.PloaMetrics.create({node,section,field,options,view,$,elements,button,money,formatDate,localGet,localSet,
    getDashboard:()=>state.dashboard,getReport:()=>report,getOperations:()=>state.operations,onCurrency:value=>{currency=value;}});

const searchPreview=window.PloaSearchPlan.create({node,details,api,view,getState:()=>state,onLoaded:plan=>{state.searchPlan=plan;}});

function renderAcquisition(){insights.renderAcquisition();}

function renderFinance(){insights.renderFinance();}

const originalSetActiveView=setActiveView;

setActiveView=(name,opts)=>{
    if (!VIEW_META[name]) return;
    if(name!==state.activeView&&(state.formDirty||state.settingsDirty||state.copySettingsDirty||state.copyFormDirty||state.copyCategoryFormDirty||dirty||ctx.knowledgeDirty||ctx.connectionDirty||ctx.businessDirty||ctx.offerFormDirty||ctx.attendanceDirty)){
      if(!window.confirm('Há alterações ainda não salvas. Mudar de página mesmo assim?'))return;
    }
    ctx.closePicker();
    // This coordinator renders the active page once after navigation.
    originalSetActiveView(name,{...opts,renderLeads:false});
    window.PloaMessageSections?.update();
    if(state.dashboard)renderAll();
    void loadWorkspace();
  };

renderAll=()=>{
    if(!state.dashboard)return;
    renderSummary();renderStatusOptions();
    if(state.activeView==='overview'){renderRevenueStageChart();renderFunnelPreview();renderFinance();}
    if(state.activeView==='funnel'){renderFunnelChart();renderFunnelInsights();renderFunnelOutcomes();renderFunnelOperation();renderPipeline();}
    if(state.activeView==='leads'){renderLeadQueues();renderLeadList();if(!state.formDirty)renderInspector();ctx.renderSavedFilters();}
    if(['search','messages'].includes(state.activeView)){renderOperations();renderProcesses();renderOperationSettings();if(state.activeView==='messages')renderCopyEditor();}
    if(state.activeView==='ai'){renderProcesses();ctx.renderAttendance();ctx.renderKnowledge();ctx.renderBusiness();ctx.renderAiAttention();}
    if(state.activeView==='copies')renderCopyEditor();
    if(state.activeView==='ads')renderAdsCatalog();
    ctx.refreshSelects();
  };

const oldCopyEditor=renderCopyEditor;

renderCopyEditor=()=>{oldCopyEditor();ctx.renderVersions();};

document.addEventListener('ploa-copies-saved',()=>void loadWorkspace());

window.addEventListener('beforeunload',(event)=>{
    const otherDrafts=[...contactDrafts].some(([id,draft])=>id!==selected&&draft.dirty.length>0);
    const otherMessages=[...drafts].some(([id,text])=>id!==selected&&text.trim());
    if(state.formDirty||state.settingsDirty||state.copySettingsDirty||state.copyFormDirty||state.copyCategoryFormDirty||dirty||otherDrafts||otherMessages||ctx.knowledgeDirty||ctx.connectionDirty||ctx.businessDirty||ctx.offerFormDirty||ctx.attendanceDirty||suggestionDrafts.size||ctx.messageLabel.input.value.trim()){
      event.preventDefault();event.returnValue='';
    }
  });

const poll=window.setInterval(async()=>{
    if(document.hidden||!['leads','messages','ai','copies','overview','funnel'].includes(state.activeView)||loading||openPicker)return;
    try {
      if(state.activeView==='leads'&&!state.formDirty){
        state.dashboard=await api('/api/dashboard');
        renderLeadQueues();renderLeadList();renderInspector();
      }
      await loadWorkspace();
    } catch { /* A atualização geral mostra indisponibilidade do servidor. */ }
  },5000);

window.addEventListener('pagehide',()=>clearInterval(poll),{once:true});

window.addEventListener('resize',ctx.closePicker);

window.PloaSections.mount({root:view('messages'),aiRoot:view('ai'),copiesRoot:view('copies'),getState:()=>state,getSnapshot:()=>snapshot,navigate:name=>setActiveView(name,{focus:true}),api,notify:showToast,hasUnsaved:()=>ctx.connectionDirty||ctx.knowledgeDirty||ctx.businessDirty||ctx.offerFormDirty,onTabChange:()=>ctx.closePicker(),groups:{
    disparos:[$('.message-process-control'),$('.message-feature'),$('.progress-panel',view('messages')),$('.message-settings-panel')],
    attendance:[ctx.attendance,ctx.aiAttention],copies:[$('.copy-editor-panel'),ctx.versions,ctx.performance],offers:[ctx.businessSection],settings:[ctx.connection,ctx.knowledge],history:[$('.ploa-triage-panel')]
  }});

void loadWorkspace();
})();
