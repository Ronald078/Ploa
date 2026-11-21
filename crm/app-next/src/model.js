export const integer = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
export const money = (value, currency) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value) || 0);
export const percent = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(value) || 0) + '%';
export function dateLabel(value, time = false) {
  if (!value) return 'Sem data disponível';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date) : 'Data indisponível';
}
export const legacyLink = (view = 'overview', attention, status) => '/operacao?' + new URLSearchParams({ view, ...(attention ? { attention } : {}), ...(status ? { status } : {}) });

export function financeModel(data, currency, period) {
  const window = data.report.financialWindows?.[period], totals = window?.currencies?.[currency];
  if (!totals) return null;
  const stages = { qualificado: 0, proposta: 0, negociacao: 0, ganho: 0 };
  for (const lead of data.dashboard.leads || []) if (lead.moeda === currency && Object.hasOwn(stages, lead.status)) {
    stages[lead.status] += Number(lead.status === 'ganho' ? lead.valor_recebido : lead.valor_estimado || 0);
  }
  const rows = (data.report.daily || []).filter(row => row.currency === currency && row.day <= window.period.end && (!window.period.start || row.day >= window.period.start));
  const bars = [], size = Math.max(1, Math.ceil(rows.length / 31));
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    bars.push({ label: dateLabel(chunk[0].day) + (chunk.length > 1 ? ' a ' + dateLabel(chunk.at(-1).day) : ''), value: chunk.reduce((sum, row) => sum + row.received, 0) });
  }
  return { ...totals, period: window.period, stages, bars };
}

export function attentionNews(data, now = Date.now()) {
  const summary = data.dashboard.resumo, leads = data.dashboard.leads || [], { search, messages } = data.operations;
  const latest = (predicate, time = lead => lead.ultima_resposta || lead.ultima_atividade) => leads.filter(predicate).sort((a, b) => (Date.parse(time(b)) || 0) - (Date.parse(time(a)) || 0))[0];
  const commercialAt = (lead, accepted = false) => [...(lead?.pagamentos || []).map(p => p.at), ...(lead?.propostas || []).map(p => accepted ? p.acceptedAt : p.sentAt)].filter(at => Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || lead?.atualizado_em;
  const name = lead => lead?.nome || lead?.numero_mascarado || 'Contato sem nome';
  const news = [], sale = latest(lead => lead.status === 'ganho', lead => commercialAt(lead, true));
  if (sale && now - Date.parse(commercialAt(sale, true) || 0) < 7 * 86400000) news.push({ score: 100, tone: 'success', title: `${name(sale)} entrou como cliente`, detail: sale.valor_recebido ? `Recebimento confirmado em ${money(sale.valor_recebido, sale.moeda || 'BRL')}.` : 'Aceite registrado; ainda não há pagamento confirmado.', timestamp: commercialAt(sale, true), attention: sale.valor_recebido ? 'vendas' : 'clientes' });
  if (summary.retornos_pendentes > 0) {
    const lead = latest(lead => lead.retorno_atrasado || lead.retorno_hoje);
    news.push({ score: 116, tone: 'urgent', title: `${summary.retornos_pendentes} retorno${summary.retornos_pendentes === 1 ? '' : 's'} para resolver`, detail: lead ? `${name(lead)} está entre os contatos que precisam de acompanhamento.` : 'Há conversas vencidas ou programadas para hoje.', timestamp: lead?.proximo_contato || lead?.ultima_resposta || lead?.ultima_atividade, attention: 'retornos' });
  }
  if (messages?.executionActive === true && ['ready', 'reconnecting'].includes(messages.connectionStatus)) news.push({ score: 112, tone: 'live', title: messages.connectionStatus === 'reconnecting' ? 'Envios estão reconectando' : 'Envio de mensagens em andamento', detail: `${integer(messages.executionSent)} de ${integer(messages.executionTarget)} contatos concluídos nesta execução.`, timestamp: messages.updatedAt, targetView: 'messages' });
  if (summary.acao_ronald > 0) {
    const lead = latest(lead => lead.fila_atendimento?.actionNow && lead.ultima_resposta);
    news.push({ score: 108, tone: 'info', title: `${summary.acao_ronald} conversa${summary.acao_ronald === 1 ? '' : 's'} precisa${summary.acao_ronald === 1 ? '' : 'm'} de você agora`, detail: lead ? lead.atencao_ia?.kind === 'payment_review' ? `${name(lead)} informou um pagamento que precisa ser conferido.` : `${name(lead)} respondeu e ainda precisa ser classificado.` : 'Abra a fila para identificar novas oportunidades.', timestamp: lead?.ultima_resposta || lead?.ultima_atividade, attention: 'acao_agora' });
  }
  if (summary.propostas_abertas > 0) {
    const lead = latest(lead => ['proposta', 'negociacao'].includes(lead.status), lead => commercialAt(lead));
    news.push({ score: 102, tone: 'commercial', title: `${summary.propostas_abertas} conversa${summary.propostas_abertas === 1 ? '' : 's'} em proposta ou negociação`, detail: lead ? `${name(lead)} está entre as oportunidades mais avançadas.` : 'Acompanhe as oportunidades próximas da conversão.', timestamp: commercialAt(lead), attention: 'propostas' });
  }
  if (search && Number(search.newLeads) > 0) news.push({ score: 96, tone: 'discovery', title: `${integer(search.newLeads)} lead${Number(search.newLeads) === 1 ? '' : 's'} novo${Number(search.newLeads) === 1 ? '' : 's'} na última busca`, detail: search.lastCity ? `A coleta mais recente passou por ${search.lastCity}.` : 'A base de prospecção recebeu novos contatos.', timestamp: search.updatedAt, targetView: 'search' });
  if (summary.oportunidades > 0) news.push({ score: 88, tone: 'commercial', title: `${summary.oportunidades} oportunidade${summary.oportunidades === 1 ? '' : 's'} no funil`, detail: 'Contatos com interesse identificado até a etapa de cliente.', attention: 'oportunidades' });
  const sent = Number(messages?.sentToday ?? summary.enviados_hoje);
  if (sent > 0) news.push({ score: 74, tone: 'neutral', title: `${integer(sent)} contato${sent === 1 ? '' : 's'} novo${sent === 1 ? '' : 's'} abordado${sent === 1 ? '' : 's'} hoje`, detail: 'Acompanhe a execução e o limite diário na área de mensagens.', timestamp: messages?.updatedAt, targetView: 'messages' });
  if (summary.respostas_automaticas > 0) news.push({ score: 48, tone: 'neutral', title: `${summary.respostas_automaticas} atendimento${summary.respostas_automaticas === 1 ? '' : 's'} automático${summary.respostas_automaticas === 1 ? '' : 's'} separado${summary.respostas_automaticas === 1 ? '' : 's'}`, detail: 'Bots e menus não estão sendo tratados como interesse comercial.', attention: 'automaticos' });
  if (news.length < 3 && summary.sem_resposta > 0) news.push({ score: 20, tone: 'neutral', title: `${summary.sem_resposta} contato${summary.sem_resposta === 1 ? '' : 's'} aguardando retorno`, detail: 'A fila permanece disponível para acompanhamento e novas tentativas planejadas.', attention: 'sem_resposta' });
  return news.sort((a, b) => b.score - a.score).slice(0, 3);
}
