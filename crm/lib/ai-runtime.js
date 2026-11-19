'use strict';

function describeAiRuntime(data, { hasKey, workerConnected, thinking = false, nextRequestAt = 0, now = Date.now() }) {
  const settings = data.settings || {};
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const usage = data.usage?.[today] || {};
  const jobs = (data.jobs || []).filter(job => job.kind === 'ai');
  const count = status => jobs.filter(job => job.status === status).length;
  const latest = field => jobs.map(job => job[field]).filter(value => Number.isFinite(Date.parse(value))).sort((a,b) => Date.parse(b)-Date.parse(a))[0] || null;
  const lastSentAt = jobs.filter(job => job.status === 'sent').map(job => job.finishedAt).filter(Boolean).sort((a,b) => Date.parse(b)-Date.parse(a))[0] || null;
  const modeLabel = settings.responseMode === 'review' ? 'Sugestões para aprovação' : settings.responseMode === 'automatic' ? 'Respostas simples automáticas' : 'Atendimento autônomo';
  const result = { modeLabel, queued: count('queued'), drafts: count('draft'), held: count('held'), lastSentAt,
    lastGeneratedAt: latest('generatedAt'), used: Number(usage.requests) || 0, limit: Number(settings.maxDailyRequests) || 0 };
  const state = (code, label, detail) => ({ ...result, code, label, detail });
  if (!settings.enabled) return state('off', 'IA desativada', 'Ative a conexão para atender novas mensagens com IA.');
  if (!hasKey) return state('no_key', 'IA sem chave disponível', 'Informe a chave na conexão para habilitar as consultas.');
  if (!settings.dataConsent || !settings.freeAccountConfirmed) return state('setup', 'Configuração da IA incompleta', 'Confira as confirmações da conta e salve a conexão.');
  if (thinking) return state('generating', count('thinking') ? 'IA preparando uma resposta' : 'IA analisando o histórico', 'Aguarde a conclusão da consulta em andamento.');
  if (count('sending')) return state('sending', 'Resposta da IA em envio', 'Aguardando confirmação do envio pelo WhatsApp.');
  if (result.used >= result.limit) return state('quota', 'Limite diário da IA atingido', 'O limite vale para novas consultas. Respostas já preparadas e atendimento manual continuam disponíveis.');
  if (!workerConnected) return state('offline', 'Aguardando conexão do WhatsApp', 'Conecte o atendimento para receber e enviar respostas pelo painel.');
  const unresolvedError = Date.parse(usage.lastErrorAt || '') > Date.parse(usage.lastSuccessAt || '1970-01-01')
    && Date.parse(usage.lastErrorAt || '') >= Date.parse(settings.updatedAt || '1970-01-01');
  if (unresolvedError) return state('error', 'Última consulta da IA falhou', 'Consulte o aviso da conversa para ver o motivo. Uma chave salva não confirma que o provedor aceitou a consulta.');
  if (result.drafts) return state('review', 'Há respostas aguardando aprovação', 'Abra as conversas para revisar as sugestões antes de enviar.');
  if (result.queued) return state('queued', 'IA aguardando para analisar', nextRequestAt > now ? 'Aguardando o intervalo entre consultas.' : 'Aguardando juntar as novas mensagens do contato.');
  if (count('ready')) return state('waiting', 'Resposta pronta para envio', 'O atendimento enviará quando a sessão do WhatsApp estiver disponível.');
  const verifiedAt=Math.max(Date.parse(usage.lastSuccessAt||'1970-01-01'),Date.parse(result.lastGeneratedAt||'1970-01-01'));
  if (!verifiedAt || verifiedAt<=Date.parse(settings.updatedAt||'1970-01-01')) return state('waiting', 'Aguardando a primeira consulta', 'A configuração está salva; o funcionamento desta configuração será confirmado na primeira consulta ao provedor.');
  return state('idle', 'IA disponível para novas mensagens', modeLabel + '. Casos fora das condições autorizadas ficam para Ronald.');
}

module.exports = { describeAiRuntime };
