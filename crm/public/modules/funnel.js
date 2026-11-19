'use strict';
// Controlador de funnel: mantém eventos e renderização na mesma área.
window.PloaAppModules.funnel = function createController(ctx) {
function attentionFilterForFunnelStep(stepId) {
  return {
    primeiro_contato: 'todos',
    apresentacao_proposta: 'propostas',
    conversao_cliente: 'clientes',
    vendas: 'vendas',
  }[stepId] || 'todos';
}

function funnelHeight(count, firstCount, compact) {
  const maximum = compact ? 132 : 272;
  const minimum = compact ? 62 : 104;
  const ratio = firstCount ? Math.max(0, Math.min(1, count / firstCount)) : 0;
  return Math.round(minimum + (maximum - minimum) * Math.sqrt(ratio));
}

function renderConnectedFunnel(container, { compact = false } = {}) {
  const steps = ctx.state.dashboard.funnel_steps || [];
  container.replaceChildren();
  if (!steps.length) return;

  const firstCount = Math.max(steps[0]?.count || 0, 1);
  const width = 1200;
  const height = compact ? 188 : 356;
  const centerY = height / 2;
  const edge = compact ? 12 : 22;
  const startX = edge;
  const endX = width - edge;
  const segmentWidth = (endX - startX) / steps.length;
  const heights = steps.map((step) => ctx.funnelHeight(step.count, firstCount, compact));

  const shell = ctx.createElement('div', `connected-funnel${compact ? ' connected-funnel-compact' : ''}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connected-funnel-shape');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const fills = ['#426e9d', '#3a6084', '#344f69', '#2b404f'];
  steps.forEach((step, index) => {
    const x1 = startX + segmentWidth * index;
    const x2 = startX + segmentWidth * (index + 1);
    const leftHeight = heights[index];
    const rightHeight = index < steps.length - 1
      ? heights[index + 1]
      : Math.max(compact ? 38 : 58, Math.round(leftHeight * 0.84));
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', [
      `${x1},${centerY - leftHeight / 2}`,
      `${x2},${centerY - rightHeight / 2}`,
      `${x2},${centerY + rightHeight / 2}`,
      `${x1},${centerY + leftHeight / 2}`,
    ].join(' '));
    polygon.setAttribute('fill', fills[index] || fills[fills.length - 1]);
    polygon.setAttribute('class', 'connected-funnel-segment');
    svg.append(polygon);
  });

  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  const topPoints = heights.map((itemHeight, index) => `${startX + segmentWidth * index},${centerY - itemHeight / 2}`);
  const finalHeight = Math.max(compact ? 38 : 58, Math.round(heights.at(-1) * 0.84));
  topPoints.push(`${endX},${centerY - finalHeight / 2}`);
  outline.setAttribute('points', topPoints.join(' '));
  outline.setAttribute('class', 'connected-funnel-outline');
  svg.append(outline);

  const bottomOutline = outline.cloneNode();
  const bottomPoints = heights.map((itemHeight, index) => `${startX + segmentWidth * index},${centerY + itemHeight / 2}`);
  bottomPoints.push(`${endX},${centerY + finalHeight / 2}`);
  bottomOutline.setAttribute('points', bottomPoints.join(' '));
  svg.append(bottomOutline);

  const labels = ctx.createElement('div', 'connected-funnel-labels');
  steps.forEach((step, index) => {
    const conversion = (step.count / firstCount) * 100;
    const previousCount = index > 0 ? steps[index - 1].count : step.count;
    const passage = previousCount ? (step.count / previousCount) * 100 : 0;
    const button = ctx.createElement('button', 'connected-funnel-stage');
    button.type = 'button';
    button.dataset.attention = ctx.attentionFilterForFunnelStep(step.id);
    button.setAttribute('aria-label', `${step.label}: ${step.count}. Conversão acumulada de ${ctx.formatPercent(conversion)}.`);
    button.append(
      ctx.createElement('span', 'connected-funnel-index', String(index + 1).padStart(2, '0')),
      ctx.createElement('strong', 'connected-funnel-label', step.label),
      ctx.createElement('b', 'connected-funnel-count', step.count),
      ctx.createElement('small', 'connected-funnel-rate', compact
        ? ctx.formatPercent(conversion)
        : `${ctx.formatPercent(conversion)} do início · ${index === 0 ? 'base' : `${ctx.formatPercent(passage)} da anterior`}`),
    );
    labels.append(button);
  });

  shell.append(svg, labels);
  container.append(shell);
}

function renderFunnelPreview() {
  ctx.renderConnectedFunnel(ctx.elements.funnelPreview, { compact: true });
}

function renderFunnelChart() {
  ctx.renderConnectedFunnel(ctx.elements.funnelChart);
  const steps = ctx.state.dashboard.funnel_steps || [];

  ctx.setText(ctx.elements.funnelChartTotal, `${steps[0]?.count || 0} contatos`);
}

function copyLibrarySummary() {
  const settings = ctx.state.copySettings?.settings;
  const firstContact = [];
  const automatic = [];

  for (const market of Object.values(settings?.firstContact || {})) {
    firstContact.push(...(market.genericas || []));
    for (const messages of Object.values(market.porCategoria || {})) firstContact.push(...(messages || []));
  }
  for (const category of Object.values(settings?.automaticReplies?.categorias || {})) {
    for (const messages of Object.values(category.porIdioma || {})) automatic.push(...(messages || []));
  }

  return {
    firstContact: firstContact.filter(Boolean),
    automatic: automatic.filter(Boolean),
  };
}

function renderFunnelOperation() {
  if (!ctx.elements.funnelOperation || !ctx.state.dashboard) return;
  const steps = Object.fromEntries((ctx.state.dashboard.funnel_steps || []).map((step) => [step.id, step]));
  const copies = ctx.copyLibrarySummary();
  const summary = ctx.state.dashboard.resumo;
  const stages = [
    {
      id: 'primeiro_contato',
      title: 'Primeiro contato',
      count: steps.primeiro_contato?.count || 0,
      meta: `${copies.firstContact.length} copys ativas`,
      description: 'O script escolhe uma copy conforme o país e a categoria do negócio. Respostas humanas seguem para análise; bots ficam fora do avanço comercial.',
      advance: 'Avança quando a conversa chega a uma apresentação ou proposta registrada.',
      sample: copies.firstContact[0] || 'Nenhuma copy de primeiro contato carregada.',
      attention: 'todos',
    },
    {
      id: 'apresentacao_proposta',
      title: 'Proposta',
      count: steps.apresentacao_proposta?.count || 0,
      meta: 'Condução comercial',
      description: 'Reúne propostas apresentadas e negociações em andamento. A IA pode conduzir esta etapa usando ofertas autorizadas, e Ronald pode assumir quando necessário.',
      advance: 'Avança quando o contato aceita seguir como cliente.',
      sample: 'As propostas usam preço, escopo e condições cadastrados na base comercial. Pedidos fora desses limites ficam para Ronald.',
      attention: 'propostas',
    },
    {
      id: 'conversao_cliente',
      title: 'Conversão em cliente',
      count: steps.conversao_cliente?.count || 0,
      meta: `${summary.ganhos || 0} clientes`,
      description: 'O contato foi marcado como cliente depois do aceite. Esta etapa confirma a conversão, mesmo quando o valor ainda não foi informado.',
      advance: 'Avança para venda quando um pagamento é confirmado.',
      sample: 'O aceite pode ser registrado pela IA quando houver autorização e uma proposta apresentada, ou confirmado por Ronald. Recebimento é uma etapa separada.',
      attention: 'clientes',
    },
    {
      id: 'vendas',
      title: 'Venda',
      count: steps.vendas?.count || 0,
      meta: ctx.formatCurrency(summary.faturamento_ganho),
      description: 'Considera pagamentos confirmados. O valor contratado e o valor recebido são acompanhados separadamente.',
      advance: 'Etapa concluída: venda registrada e pronta para acompanhamento do atendimento.',
      sample: `${summary.vendas_registradas || 0} venda${summary.vendas_registradas === 1 ? '' : 's'} com valor · ticket médio ${ctx.formatCurrency(summary.ticket_medio)}`,
      attention: 'vendas',
    },
  ];

  ctx.elements.funnelOperation.replaceChildren(...stages.map((stage, index) => {
    const article = ctx.createElement('article', `operation-stage operation-stage-${stage.id}`);
    const head = ctx.createElement('div', 'operation-stage-head');
    const number = ctx.createElement('span', 'operation-stage-number', String(index + 1).padStart(2, '0'));
    const title = ctx.createElement('div', 'operation-stage-title');
    title.append(ctx.createElement('h4', null, stage.title), ctx.createElement('span', null, stage.meta));
    head.append(number, title, ctx.createElement('strong', 'operation-stage-count', stage.count));
    const action = ctx.createElement('button', 'operation-stage-action', 'Abrir contatos');
    action.type = 'button';
    action.dataset.attention = stage.attention;
    article.append(
      head,
      ctx.createElement('p', 'operation-stage-description', stage.description),
      ctx.createElement('p', 'operation-stage-advance', stage.advance),
      ctx.createElement('blockquote', 'operation-stage-copy', stage.sample),
      action,
    );
    return article;
  }));

  ctx.elements.funnelCopySupport.replaceChildren();
  const supportCopy = ctx.createElement('div', 'funnel-copy-support-text');
  supportCopy.append(
    ctx.createElement('span', null, 'Triagem paralela'),
    ctx.createElement('strong', null, `${copies.automatic.length} copys para atendimento automático`),
    ctx.createElement('p', null, 'Essas respostas ajudam a pedir encaminhamento ao responsável, mas não contam como interesse nem avançam o funil de vendas.'),
  );
  const manage = ctx.createElement('button', 'button button-secondary', 'Ver biblioteca de copys');
  manage.type = 'button';
  manage.addEventListener('click', () => ctx.setActiveView('copies', { focus: true }));
  ctx.elements.funnelCopySupport.append(supportCopy, manage);
}

function renderFunnelInsights() {
  const summary = ctx.state.dashboard.resumo;
  const largest = (ctx.state.dashboard.funnel_steps || [])
    .slice(1)
    .filter(stage => stage.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  const opportunityRate = summary.total ? (summary.oportunidades / summary.total) * 100 : 0;
  const clientRate = summary.total ? (summary.ganhos / summary.total) * 100 : 0;

  ctx.setText(ctx.elements.insightLargestStage, largest?.label || '—');
  ctx.setText(ctx.elements.insightLargestDetail, largest ? `${largest.count} contatos chegaram a esta etapa.` : 'Nenhum avanço comercial registrado ainda.');
  ctx.setText(ctx.elements.insightOpportunityRate, ctx.formatPercent(opportunityRate));
  ctx.setText(ctx.elements.insightClientRate, ctx.formatPercent(clientRate));
}

function renderFunnelOutcomes() {
  ctx.elements.funnelOutcomes.replaceChildren();
  const summary = ctx.state.dashboard.resumo;
  const outcomes = [
    { label: 'Sem resposta', detail: 'Aguardando reação à primeira copy', count: summary.sem_resposta, attention: 'sem_resposta' },
    { label: 'Atendimento automático', detail: 'Bot ou menu identificado pelo script', count: summary.respostas_automaticas, attention: 'automaticos' },
    { label: 'Recusou contato', detail: 'Bloqueado para novos envios', count: summary.por_status.nao_contatar || 0, status: 'nao_contatar' },
    { label: 'Sem avanço', detail: 'Oportunidade encerrada sem venda', count: summary.por_status.perdido || 0, status: 'perdido' },
  ];

  for (const outcome of outcomes) {
    const button = ctx.createElement('button', 'funnel-outcome');
    button.type = 'button';
    if (outcome.attention) button.dataset.attention = outcome.attention;
    if (outcome.status) button.dataset.status = outcome.status;
    button.append(
      ctx.createElement('span', 'funnel-outcome-label', outcome.label),
      ctx.createElement('strong', 'funnel-outcome-count', outcome.count),
      ctx.createElement('small', 'funnel-outcome-detail', outcome.detail),
    );
    ctx.elements.funnelOutcomes.append(button);
  }
}

  function bindEvents() {
ctx.elements.funnelPreview.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-attention]');
  if (button) ctx.applyAttentionFilter(button.dataset.attention);
});

ctx.elements.funnelChart.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-attention]');
  if (button) ctx.applyAttentionFilter(button.dataset.attention);
});

ctx.elements.funnelOperation.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-attention]');
  if (button) ctx.applyAttentionFilter(button.dataset.attention);
});

ctx.elements.funnelOutcomes.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-attention], button[data-status]');
  if (!button) return;
  if (button.dataset.status) ctx.applyStatusFilter(button.dataset.status);
  else ctx.applyAttentionFilter(button.dataset.attention);
});
  }
  return { attentionFilterForFunnelStep, funnelHeight, renderConnectedFunnel, renderFunnelPreview, renderFunnelChart, copyLibrarySummary, renderFunnelOperation, renderFunnelInsights, renderFunnelOutcomes, bindEvents };
};
