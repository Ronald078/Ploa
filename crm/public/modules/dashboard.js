'use strict';
// Controlador de dashboard: mantém eventos e renderização na mesma área.
window.PloaAppModules.dashboard = function createController(ctx) {
function latestLeadMatching(predicate, eventTime = lead => lead.ultima_resposta || lead.ultima_atividade) {
  return (ctx.state.dashboard?.leads || [])
    .filter(predicate)
    .sort((first, second) => {
      const firstTime = Date.parse(eventTime(first) || 0) || 0;
      const secondTime = Date.parse(eventTime(second) || 0) || 0;
      return secondTime - firstTime;
    })[0] || null;
}

function leadDisplayName(lead) {
  return lead?.nome || lead?.numero_mascarado || 'Contato sem nome';
}

function leadNewsTime(lead) {
  return lead?.ultima_resposta || lead?.ultima_atividade || null;
}

function commercialEventTime(lead, accepted = false) {
  const times = [...(lead?.pagamentos || []).map(item => item.at),
    ...(lead?.propostas || []).map(item => accepted ? item.acceptedAt : item.sentAt)]
    .filter(value => Number.isFinite(Date.parse(value))).sort((a,b) => Date.parse(b)-Date.parse(a));
  return times[0] || lead?.atualizado_em || null;
}

function buildAttentionNews(summary) {
  const news = [];
  const add = (item) => news.push(item);
  const latestSale = ctx.latestLeadMatching((lead) => lead.status === 'ganho', lead => commercialEventTime(lead,true));
  const latestFollowUp = ctx.latestLeadMatching((lead) => lead.retorno_atrasado || lead.retorno_hoje);
  const latestHumanReply = ctx.latestLeadMatching((lead) => lead.fila_atendimento?.actionNow && lead.ultima_resposta);
  const latestProposal = ctx.latestLeadMatching((lead) => ['proposta', 'negociacao'].includes(lead.status), lead => commercialEventTime(lead));
  const search = ctx.state.operations?.search;
  const messages = ctx.state.operations?.messages;

  if (latestSale && Date.now() - Date.parse(commercialEventTime(latestSale,true) || 0) < 7 * 86400000) {
    add({
      score: 100,
      tone: 'success',
      title: `${ctx.leadDisplayName(latestSale)} entrou como cliente`,
      detail: latestSale.valor_recebido
        ? `Recebimento confirmado em ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: latestSale.moeda || 'BRL' }).format(latestSale.valor_recebido)}.`
        : 'Aceite registrado; ainda não há pagamento confirmado.',
      timestamp: commercialEventTime(latestSale,true),
      attention: latestSale.valor_recebido ? 'vendas' : 'clientes',
    });
  }

  if (summary.retornos_pendentes > 0) {
    add({
      score: 116,
      tone: 'urgent',
      title: `${summary.retornos_pendentes} retorno${summary.retornos_pendentes === 1 ? '' : 's'} para resolver`,
      detail: latestFollowUp
        ? `${ctx.leadDisplayName(latestFollowUp)} está entre os contatos que precisam de acompanhamento.`
        : 'Há conversas vencidas ou programadas para hoje.',
      timestamp: latestFollowUp?.proximo_contato || ctx.leadNewsTime(latestFollowUp),
      attention: 'retornos',
    });
  }

  if (messages?.executionStatus && ['em_execucao', 'reconectando'].includes(messages.executionStatus)) {
    add({
      score: 112,
      tone: 'live',
      title: messages.executionStatus === 'reconectando' ? 'Envios estão reconectando' : 'Envio de mensagens em andamento',
      detail: `${ctx.formatInteger(messages.executionSent)} de ${ctx.formatInteger(messages.executionTarget)} contatos concluídos nesta execução.`,
      timestamp: messages.updatedAt,
      targetView: 'messages',
    });
  }

  if (summary.acao_ronald > 0) {
    add({
      score: 108,
      tone: 'info',
      title: `${summary.acao_ronald} conversa${summary.acao_ronald === 1 ? '' : 's'} precisa${summary.acao_ronald === 1 ? '' : 'm'} de você agora`,
      detail: latestHumanReply
        ? latestHumanReply.atencao_ia?.kind==='payment_review'
          ? `${ctx.leadDisplayName(latestHumanReply)} informou um pagamento que precisa ser conferido.`
          : `${ctx.leadDisplayName(latestHumanReply)} respondeu e ainda precisa ser classificado.`
        : 'Abra a fila para identificar novas oportunidades.',
      timestamp: ctx.leadNewsTime(latestHumanReply),
      attention: 'acao_agora',
    });
  }

  if (summary.propostas_abertas > 0) {
    add({
      score: 102,
      tone: 'commercial',
      title: `${summary.propostas_abertas} conversa${summary.propostas_abertas === 1 ? '' : 's'} em proposta ou negociação`,
      detail: latestProposal
        ? `${ctx.leadDisplayName(latestProposal)} está entre as oportunidades mais avançadas.`
        : 'Acompanhe as oportunidades próximas da conversão.',
      timestamp: commercialEventTime(latestProposal),
      attention: 'propostas',
    });
  }

  if (search && Number(search.newLeads) > 0) {
    add({
      score: 96,
      tone: 'discovery',
      title: `${ctx.formatInteger(search.newLeads)} lead${Number(search.newLeads) === 1 ? '' : 's'} novo${Number(search.newLeads) === 1 ? '' : 's'} na última busca`,
      detail: search.lastCity ? `A coleta mais recente passou por ${search.lastCity}.` : 'A base de prospecção recebeu novos contatos.',
      timestamp: search.updatedAt,
      targetView: 'search',
    });
  }

  if (summary.oportunidades > 0) {
    add({
      score: 88,
      tone: 'commercial',
      title: `${summary.oportunidades} oportunidade${summary.oportunidades === 1 ? '' : 's'} no funil`,
      detail: 'Contatos com interesse identificado até a etapa de cliente.',
      timestamp: null,
      attention: 'oportunidades',
    });
  }

  if (Number(messages?.sentToday ?? summary.enviados_hoje) > 0) {
    const sentToday = Number(messages?.sentToday ?? summary.enviados_hoje);
    add({
      score: 74,
      tone: 'neutral',
      title: `${ctx.formatInteger(sentToday)} contato${sentToday === 1 ? '' : 's'} novo${sentToday === 1 ? '' : 's'} abordado${sentToday === 1 ? '' : 's'} hoje`,
      detail: 'Acompanhe a execução e o limite diário na área de mensagens.',
      timestamp: messages?.updatedAt,
      targetView: 'messages',
    });
  }

  if (summary.respostas_automaticas > 0) {
    add({
      score: 48,
      tone: 'neutral',
      title: `${summary.respostas_automaticas} atendimento${summary.respostas_automaticas === 1 ? '' : 's'} automático${summary.respostas_automaticas === 1 ? '' : 's'} separado${summary.respostas_automaticas === 1 ? '' : 's'}`,
      detail: 'Bots e menus não estão sendo tratados como interesse comercial.',
      timestamp: null,
      attention: 'automaticos',
    });
  }

  if (news.length < 3 && summary.sem_resposta > 0) {
    add({
      score: 20,
      tone: 'neutral',
      title: `${summary.sem_resposta} contato${summary.sem_resposta === 1 ? '' : 's'} aguardando retorno`,
      detail: 'A fila permanece disponível para acompanhamento e novas tentativas planejadas.',
      timestamp: null,
      attention: 'sem_resposta',
    });
  }

  return news.sort((first, second) => second.score - first.score).slice(0, 3);
}

function renderAttentionFeed(summary) {
  if (!ctx.elements.attentionFeed) return;
  const news = ctx.buildAttentionNews(summary);
  if (!news.length) {
    const empty = ctx.createElement('div', 'attention-news-empty');
    empty.append(ctx.createElement('strong', null, 'Nenhuma ação pendente agora'),
      ctx.createElement('p', null, 'Novas respostas, propostas e recebimentos aparecerão aqui quando forem registrados.'));
    ctx.elements.attentionFeed.replaceChildren(empty); return;
  }
  ctx.elements.attentionFeed.replaceChildren(...news.map((item) => {
    const button = ctx.createElement('button', 'attention-news-item');
    button.type = 'button';
    button.dataset.tone = item.tone;
    if (item.attention) button.dataset.attention = item.attention;
    if (item.targetView) button.dataset.targetView = item.targetView;
    const marker = ctx.createElement('span', 'attention-news-marker');
    const copy = ctx.createElement('span', 'attention-news-copy');
    copy.append(ctx.createElement('strong', null, item.title), ctx.createElement('small', null, item.detail));
    const time = ctx.createElement('time', 'attention-news-time', item.timestamp ? ctx.formatRelativeTime(item.timestamp) : '');
    time.hidden = !item.timestamp;
    if (item.timestamp) time.dateTime = item.timestamp;
    button.append(marker, copy, time);
    return button;
  }));
}

function renderSummary() {
  const summary = ctx.state.dashboard.resumo;
  ctx.setText(ctx.elements.metricRevenue, ctx.formatCurrency(summary.faturamento_ganho));
  ctx.setText(ctx.elements.metricPipelineValue, ctx.formatCurrency(summary.valor_pipeline_aberto));
  ctx.setText(ctx.elements.metricSales, summary.ganhos);
  ctx.setText(ctx.elements.metricTicket, ctx.formatCurrency(summary.ticket_medio));
  ctx.setText(ctx.elements.metricResponseRate, `${summary.taxa_resposta}%`);
  ctx.setText(ctx.elements.signalToQualify, summary.acao_ronald ?? summary.respostas_para_classificar);
  ctx.setText(ctx.elements.signalOpenProposals, summary.propostas_abertas);
  ctx.setText(ctx.elements.signalFollowUps, summary.retornos_pendentes);
  ctx.renderAttentionFeed(summary);

  const conversionRate = summary.total ? (summary.ganhos / summary.total) * 100 : 0;
  ctx.setText(ctx.elements.funnelConversionRate, ctx.formatPercent(conversionRate));

  const rate = Math.max(0, Math.min(100, Number(summary.taxa_resposta) || 0));
  const circumference = 339.292;
  ctx.elements.responseRingValue.setAttribute('stroke-dashoffset', String(circumference * (1 - rate / 100)));
}

function renderRevenueStageChart() {
  ctx.elements.revenueStageChart.replaceChildren();
  const summary = ctx.state.dashboard.resumo;
  const values = summary.valores_por_status || {};
  const stages = [
    { id: 'qualificado', label: 'Interesse', value: values.qualificado || 0 },
    { id: 'proposta', label: 'Proposta', value: values.proposta || 0 },
    { id: 'negociacao', label: 'Negociação', value: values.negociacao || 0 },
    { id: 'ganho', label: 'Vendas', value: values.ganho || 0 },
  ];
  const largest = Math.max(...stages.map((stage) => stage.value), 1);

  for (const stage of stages) {
    const item = ctx.createElement('button', `revenue-stage stage-${stage.id}`);
    item.type = 'button';
    item.dataset.status = stage.id;
    item.setAttribute('aria-label', `${stage.label}: ${ctx.formatCurrency(stage.value)}. Abrir contatos.`);
    const copy = ctx.createElement('span', 'revenue-stage-copy');
    copy.append(ctx.createElement('span', null, stage.label), ctx.createElement('strong', null, ctx.formatCurrency(stage.value)));
    const track = ctx.createElement('span', 'revenue-stage-track');
    const fill = ctx.createElement('i', 'revenue-stage-fill');
    fill.style.width = `${Math.max(stage.value > 0 ? 8 : 0, (stage.value / largest) * 100)}%`;
    track.append(fill);
    item.append(copy, track);
    ctx.elements.revenueStageChart.append(item);
  }
}

  function bindEvents() {
ctx.elements.attentionFeed?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.attention) ctx.applyAttentionFilter(button.dataset.attention);
  else if (button.dataset.targetView) ctx.setActiveView(button.dataset.targetView, { focus: true });
});

ctx.elements.revenueStageChart.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-status]');
  if (button) ctx.applyStatusFilter(button.dataset.status);
});
  }
  return { latestLeadMatching, leadDisplayName, leadNewsTime, buildAttentionNews, renderAttentionFeed, renderSummary, renderRevenueStageChart, bindEvents };
};
