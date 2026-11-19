'use strict';
// Controlador de leads: mantém eventos e renderização na mesma área.
window.PloaAppModules.leads = function createController(ctx) {
function applyStatusFilter(statusId) {
  ctx.state.statusFilter = ctx.state.statusFilter === statusId ? null : statusId;
  ctx.state.attentionFilter = 'todos';
  ctx.elements.attentionFilter.value = 'todos';
  ctx.state.visibleLeadLimit = ctx.PAGE_SIZE;
  ctx.renderPipeline();
  ctx.setActiveView('leads', { focus: true });
}

function applyAttentionFilter(filterId) {
  ctx.state.statusFilter = null;
  ctx.state.attentionFilter = filterId || 'todos';
  ctx.elements.attentionFilter.value = ctx.state.attentionFilter;
  ctx.state.visibleLeadLimit = ctx.PAGE_SIZE;
  ctx.renderPipeline();
  ctx.setActiveView('leads', { focus: true });
}

function renderPipeline() {
  ctx.elements.pipeline.replaceChildren();
  for (const status of ctx.state.dashboard.pipeline_options) {
    const button = ctx.createElement('button', `pipeline-button stage-${status.id}`);
    button.type = 'button';
    button.dataset.status = status.id;
    button.setAttribute('aria-pressed', String(ctx.state.statusFilter === status.id));
    button.setAttribute('aria-label', `Filtrar etapa ${status.label}: ${ctx.state.dashboard.resumo.por_status[status.id]} leads`);
    button.append(
      ctx.createElement('span', null, status.label),
      ctx.createElement('strong', null, ctx.state.dashboard.resumo.por_status[status.id])
    );
    ctx.elements.pipeline.append(button);
  }
}

function leadMatchesFilters(lead) {
  if(ctx.state.attentionFilter==='acao_agora'&&!lead.fila_atendimento?.actionNow)return false;
  if(ctx.state.attentionFilter==='historico_triagem'&&!lead.fila_atendimento?.history)return false;
  if(ctx.state.attentionFilter==='sem_texto'&&!lead.fila_atendimento?.withoutText)return false;
  if (ctx.state.statusFilter && lead.status !== ctx.state.statusFilter) return false;

  if (ctx.state.attentionFilter === 'precisam_acao' && !(
    lead.fila_atendimento?.actionNow
    || lead.retorno_atrasado
    || lead.retorno_hoje
    || ['proposta', 'negociacao'].includes(lead.status)
  )) return false;
  if (ctx.state.attentionFilter === 'sem_resposta' && lead.status !== 'novo') return false;
  if (ctx.state.attentionFilter === 'automaticos' && lead.status !== 'automatico') return false;
  if (ctx.state.attentionFilter === 'resposta_humana' && !(
    lead.respostas_recebidas > 0
    && lead.status !== 'automatico'
    && !lead.vinculo_pendente
  )) return false;
  if (ctx.state.attentionFilter === 'para_classificar' && (lead.status !== 'respondeu'||!lead.classificacao_revisao||!String(lead.ultima_mensagem||'').trim())) return false;
  if (ctx.state.attentionFilter === 'retornos' && !lead.retorno_atrasado && !lead.retorno_hoje) return false;
  if (ctx.state.attentionFilter === 'oportunidades' && !['qualificado', 'proposta', 'negociacao', 'ganho'].includes(lead.status)) return false;
  if (ctx.state.attentionFilter === 'propostas' && !['proposta', 'negociacao', 'ganho'].includes(lead.status)) return false;
  if (ctx.state.attentionFilter === 'negociacoes' && !['negociacao', 'ganho'].includes(lead.status)) return false;
  if (ctx.state.attentionFilter === 'clientes' && lead.status !== 'ganho') return false;
  if (ctx.state.attentionFilter === 'vendas' && !(Number(lead.valor_recebido) > 0)) return false;
  if (ctx.state.attentionFilter === 'encerrados' && !['perdido', 'nao_contatar'].includes(lead.status)) return false;
  if (ctx.state.attentionFilter === 'vinculos' && !lead.vinculo_pendente) return false;

  if (ctx.state.search) {
    const haystack = ctx.normalizeSearch(`${lead.nome} ${lead.numero} ${lead.numero_mascarado} ${lead.status_label} ${lead.ultima_mensagem}`);
    if (!haystack.includes(ctx.state.search)) return false;
  }
  return true;
}

function describeNextAction(lead) {
  if (lead.vinculo_pendente) return 'Aguardando vínculo com telefone';
  if (lead.proxima_acao) return lead.proxima_acao;
  if (lead.acao_sugerida) return lead.acao_sugerida;
  if (lead.status === 'automatico') return 'Aguardar atendimento humano';
  if (lead.status === 'respondeu') return 'Classificar resposta humana';
  if (lead.status === 'novo') return 'Aguardar resposta';
  if (lead.status === 'qualificado') return 'Preparar diagnóstico comercial';
  if (lead.status === 'proposta') return 'Acompanhar proposta';
  if (lead.status === 'negociacao') return 'Conduzir negociação';
  if (lead.status === 'ganho') return 'Iniciar atendimento';
  if (lead.status === 'nao_contatar') return 'Contato encerrado';
  if (lead.status === 'perdido') return 'Oportunidade encerrada';
  return 'Definir próxima ação';
}

function createLeadRow(lead) {
  const row = ctx.createElement('button', 'lead-row');
  row.type = 'button';
  row.dataset.leadId = lead.id;
  row.setAttribute('aria-current', String(ctx.state.selectedLeadId === lead.id));
  row.setAttribute('aria-label', `Abrir ${lead.nome}, etapa ${lead.status_label}`);

  const identity = ctx.createElement('span', 'lead-identity');
  identity.append(
    ctx.createElement('strong', null, lead.nome),
    ctx.createElement('span', null, lead.numero_mascarado)
  );

  const status = ctx.createElement('span', 'status-chip');
  status.dataset.status = lead.status;
  status.dataset.origin = lead.classificacao_origem;
  const hasConfidence = lead.classificacao_confianca !== null
    && lead.classificacao_confianca !== undefined
    && lead.classificacao_confianca !== '';
  const confidence = hasConfidence && Number.isFinite(Number(lead.classificacao_confianca))
    ? `${Math.round(Number(lead.classificacao_confianca) * 100)}%`
    : '';
  const originLabel = lead.classificacao_origem === 'manual'
    ? 'manual'
    : lead.classificacao_revisao
      ? `revisar${confidence ? ` · ${confidence}` : ''}`
      : `automática${confidence ? ` · ${confidence}` : ''}`;
  status.append(
    ctx.createElement('span', null, lead.status_label),
    ctx.createElement('small', null, originLabel),
  );

  const action = ctx.createElement('span', 'lead-action');
  action.append(
    ctx.createElement('strong', null, ctx.describeNextAction(lead)),
    ctx.createElement(
      'span',
      lead.retorno_atrasado ? 'follow-up-alert' : '',
      lead.proximo_contato
        ? `${lead.retorno_atrasado ? 'Atrasado · ' : lead.retorno_hoje ? 'Hoje · ' : ''}${ctx.formatDate(lead.proximo_contato)}`
        : 'Sem data definida'
    )
  );

  const activity = ctx.createElement('span', 'lead-activity');
  activity.append(
    ctx.createElement('strong', null, lead.ultima_atividade ? ctx.formatDate(lead.ultima_atividade, true) : 'Sem registro'),
    ctx.createElement('span', null, `${lead.respostas_recebidas} resposta${lead.respostas_recebidas === 1 ? '' : 's'}`)
  );

  row.append(identity, status, action, activity);
  return row;
}

function renderLeadQueues() {
  ctx.elements.leadQueues.replaceChildren();
  const summary = ctx.state.dashboard.resumo;
  const queues = [
    { id: 'para_classificar', label: 'Analisar respostas', count: summary.respostas_para_classificar, detail: 'respostas com texto para analisar' },
    { id: 'automaticos', label: 'Atendimento automático', count: summary.respostas_automaticas, detail: 'bots separados do interesse real' },
    { id: 'oportunidades', label: 'Oportunidades', count: summary.oportunidades, detail: 'interesse até fechamento' },
    { id: 'retornos', label: 'Retornos', count: summary.retornos_pendentes, detail: 'vencidos ou para hoje' },
  ];

  for (const queue of queues) {
    const button = ctx.createElement('button', 'lead-queue');
    button.type = 'button';
    button.dataset.attention = queue.id;
    button.setAttribute('aria-pressed', String(ctx.state.attentionFilter === queue.id && !ctx.state.statusFilter));
    button.append(
      ctx.createElement('span', null, queue.label),
      ctx.createElement('strong', null, queue.count),
      ctx.createElement('small', null, queue.detail),
    );
    ctx.elements.leadQueues.append(button);
  }
}

function renderLeadList() {
  if (!ctx.state.dashboard) return;
  const filteredLeads = ctx.state.dashboard.leads.filter(ctx.leadMatchesFilters);
  const visibleLeads = filteredLeads.slice(0, ctx.state.visibleLeadLimit);
  const selectedIsVisible = visibleLeads.some((lead) => lead.id === ctx.state.selectedLeadId);
  if (window.innerWidth > 860 && visibleLeads.length > 0 && !selectedIsVisible) {
    ctx.state.selectedLeadId = visibleLeads[0].id;
  } else if (filteredLeads.length === 0) {
    ctx.state.selectedLeadId = null;
  }
  ctx.elements.leadList.replaceChildren(...visibleLeads.map(ctx.createLeadRow));
  ctx.elements.emptyState.hidden = filteredLeads.length > 0;
  ctx.elements.loadMoreButton.hidden = visibleLeads.length >= filteredLeads.length;

  const visibleCopy = visibleLeads.length < filteredLeads.length ? ` · exibindo ${visibleLeads.length}` : '';
  ctx.setText(ctx.elements.resultCount, `${filteredLeads.length} registros${visibleCopy} · ${ctx.state.dashboard.resumo.total} leads vinculados`);
  if (!ctx.elements.loadMoreButton.hidden) {
    ctx.setText(ctx.elements.loadMoreButton, `Carregar mais ${Math.min(ctx.PAGE_SIZE, filteredLeads.length - visibleLeads.length)} leads`);
  }
}

function selectedLead() {
  return ctx.state.dashboard?.leads.find((lead) => lead.id === ctx.state.selectedLeadId) || null;
}

function renderStatusOptions() {
  const currentValue = ctx.elements.leadStatus.value;
  ctx.elements.leadStatus.replaceChildren();
  for (const status of ctx.state.dashboard.status_options) {
    const option = ctx.createElement('option', null, status.label);
    option.value = status.id;
    ctx.elements.leadStatus.append(option);
  }
  if (currentValue) ctx.elements.leadStatus.value = currentValue;
}

function createHistoryItem(item) {
  const wrapper = ctx.createElement('article', 'history-item');
  wrapper.dataset.kind = item.kind;
  wrapper.append(
    ctx.createElement('p', null, item.text),
    ctx.createElement('time', null, `${item.kind === 'note' ? 'Nota · ' : 'Resposta · '}${ctx.formatDate(item.date, true)}`)
  );
  return wrapper;
}

function renderHistory(lead) {
  const notes = lead.notas.map((note) => ({
    kind: 'note',
    text: String(note.texto || ''),
    date: note.criado_em || null,
  }));
  const responses = lead.respostas.map((response) => ({
    kind: 'response',
    text: String(response.texto || ''),
    date: response.data || null,
  }));
  const history = [...notes, ...responses]
    .filter((item) => item.text)
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))
    .slice(0, 20);

  ctx.setText(ctx.elements.historyCount, `${history.length} registro${history.length === 1 ? '' : 's'}`);
  if (history.length) {
    ctx.elements.historyList.replaceChildren(...history.map(ctx.createHistoryItem));
  } else {
    ctx.elements.historyList.replaceChildren(ctx.createElement('p', 'history-empty', 'Ainda não há respostas ou notas para este contato.'));
  }
}

function renderInspector() {
  const lead = ctx.selectedLead();
  const hasLead = Boolean(lead);
  const mobileOpen = ctx.state.activeView === 'leads' && hasLead && window.innerWidth <= 860;
  ctx.elements.inspectorPlaceholder.hidden = hasLead;
  ctx.elements.inspectorContent.hidden = !hasLead;
  ctx.elements.inspector.dataset.open = String(hasLead);
  ctx.elements.mobileBackdrop.hidden = !mobileOpen;
  document.body.classList.toggle('inspector-open', mobileOpen);

  if (!lead) return;

  ctx.setText(ctx.elements.inspectorTitle, lead.nome);
  ctx.setText(ctx.elements.inspectorNumber, lead.numero_mascarado);
  ctx.setText(ctx.elements.inspectorSent, lead.mensagens_enviadas);
  ctx.setText(ctx.elements.inspectorReceived, lead.respostas_recebidas);
  ctx.setText(ctx.elements.inspectorFirstContact, lead.primeiro_contato ? ctx.formatDate(lead.primeiro_contato) : '—');
  const hasConfidence = lead.classificacao_confianca !== null
    && lead.classificacao_confianca !== undefined
    && lead.classificacao_confianca !== '';
  const confidence = hasConfidence && Number.isFinite(Number(lead.classificacao_confianca))
    ? `${Math.round(Number(lead.classificacao_confianca) * 100)}%`
    : 'Não se aplica';
  const originLabel = lead.classificacao_origem === 'manual'
    ? 'Definida manualmente'
    : lead.classificacao_origem === 'ia_contexto'
      ? 'Interpretada pela IA'
    : lead.classificacao_revisao
      ? 'Precisa de revisão'
      : 'Classificada automaticamente';
  ctx.setText(ctx.elements.classificationOrigin, originLabel);
  ctx.elements.classificationOrigin.dataset.origin = lead.classificacao_origem;
  ctx.setText(ctx.elements.classificationReason, lead.classificacao_motivo || 'Ainda não existe informação suficiente para classificar este contato.');
  ctx.setText(ctx.elements.classificationConfidence, confidence);
  ctx.setText(ctx.elements.classificationLanguage, lead.classificacao_idioma_label || 'Não identificado');
  ctx.setText(ctx.elements.classificationAction, lead.acao_sugerida || ctx.describeNextAction(lead));
  const pendingOption = ctx.elements.leadStatus.querySelector('option[value="vinculo_pendente"]');
  if (pendingOption) pendingOption.remove();
  if (lead.vinculo_pendente) {
    const option = ctx.createElement('option', null, 'Aguardando vínculo');
    option.value = 'vinculo_pendente';
    option.disabled = true;
    ctx.elements.leadStatus.prepend(option);
  }
  ctx.elements.leadStatus.value = lead.status;
  ctx.elements.leadNextAction.value = lead.proxima_acao;
  ctx.elements.leadNextContact.value = lead.proximo_contato;
  ctx.elements.leadValue.value = lead.valor_estimado ?? '';
  ctx.elements.leadNote.value = '';
  const formControls = ctx.elements.form.querySelectorAll('input, select, textarea, button');
  for (const control of formControls) control.disabled = lead.vinculo_pendente;
  ctx.elements.formStatus.textContent = lead.vinculo_pendente
    ? 'Conversa antiga sem telefone associado. O histórico está disponível apenas para consulta.'
    : lead.valor_estimado
      ? `Potencial: ${ctx.formatCurrency(lead.valor_estimado)}`
      : 'Alterações ficam no CRM local.';
  ctx.state.formDirty = false;
  ctx.renderHistory(lead);
}

  function bindEvents() {
ctx.elements.pipeline.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-status]');
  if (button) ctx.applyStatusFilter(button.dataset.status);
});

ctx.elements.leadList.addEventListener('click', (event) => {
  const row = event.target.closest('button[data-lead-id]');
  if (!row) return;
  ctx.state.selectedLeadId = row.dataset.leadId;
  ctx.renderLeadList();
  ctx.renderInspector();
  if (window.innerWidth <= 860) ctx.elements.closeInspector.focus();
});

ctx.elements.leadQueues.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-attention]');
  if (button) ctx.applyAttentionFilter(button.dataset.attention);
});

ctx.elements.loadMoreButton.addEventListener('click', () => {
  ctx.state.visibleLeadLimit += ctx.PAGE_SIZE;
  ctx.renderLeadList();
});

ctx.elements.searchInput.addEventListener('input', () => {
  ctx.state.search = ctx.normalizeSearch(ctx.elements.searchInput.value);
  ctx.state.visibleLeadLimit = ctx.PAGE_SIZE;
  ctx.renderLeadList();
});

ctx.elements.attentionFilter.addEventListener('change', () => {
  ctx.state.statusFilter = null;
  ctx.state.attentionFilter = ctx.elements.attentionFilter.value;
  ctx.state.visibleLeadLimit = ctx.PAGE_SIZE;
  ctx.renderPipeline();
  ctx.renderLeadQueues();
  ctx.renderLeadList();
});

ctx.elements.clearFiltersButton.addEventListener('click', () => {
  ctx.state.statusFilter = null;
  ctx.state.attentionFilter = 'todos';
  ctx.state.search = '';
  ctx.state.visibleLeadLimit = ctx.PAGE_SIZE;
  ctx.elements.attentionFilter.value = 'todos';
  ctx.elements.searchInput.value = '';
  ctx.renderPipeline();
  ctx.renderLeadQueues();
  ctx.renderLeadList();
});

ctx.elements.closeInspector.addEventListener('click', ctx.closeInspector);

ctx.elements.mobileBackdrop.addEventListener('click', ctx.closeInspector);

ctx.elements.form.addEventListener('input', () => {
  ctx.state.formDirty = true;
});

ctx.elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const lead = ctx.selectedLead();
  if (!lead) return;

  const submitButton = ctx.elements.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  ctx.elements.formStatus.textContent = 'Salvando…';

  const payload = {
    proxima_acao: ctx.elements.leadNextAction.value,
    proximo_contato: ctx.elements.leadNextContact.value,
    valor_estimado: ctx.elements.leadValue.value,
    nota: ctx.elements.leadNote.value,
  };
  if (ctx.elements.leadStatus.value !== lead.status) payload.status = ctx.elements.leadStatus.value;

  try {
    const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar o acompanhamento.');
    ctx.state.formDirty = false;
    await ctx.loadDashboard({ quiet: true });
    ctx.showToast('Acompanhamento salvo.');
  } catch (error) {
    ctx.elements.formStatus.textContent = error.message;
    ctx.showToast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});
  }
  return { applyStatusFilter, applyAttentionFilter, renderPipeline, leadMatchesFilters, describeNextAction, createLeadRow, renderLeadQueues, renderLeadList, selectedLead, renderStatusOptions, createHistoryItem, renderHistory, renderInspector, bindEvents };
};
