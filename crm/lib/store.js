const fs = require('fs');
const path = require('path');
const { classifyLeadResponse } = require('./lead-classifier');
const { planFollowUp } = require('./followup-planner');
const { uniqueConversationEvents } = require('./conversation-events');
const {responseMetric}=require('./metrics');
const {confirmedPayments,roundMoney}=require('./commercial-records');
const {queueFor}=require('./triage');
const clocks = new Map();
function zonedClock(timeZone) {
  const minute = Math.floor(Date.now() / 60000);
  const cached = clocks.get(timeZone);
  if (cached?.minute === minute) return cached.parts;
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date()).reduce((result,part)=>({...result,[part.type]:part.value}),{});
  clocks.set(timeZone,{minute,parts});
  return parts;
}

const STATUS = Object.freeze([
  { id: 'novo', label: 'Sem resposta' },
  { id: 'automatico', label: 'Atendimento automático' },
  { id: 'respondeu', label: 'Resposta humana' },
  { id: 'qualificado', label: 'Interesse identificado' },
  { id: 'proposta', label: 'Proposta apresentada' },
  { id: 'negociacao', label: 'Em negociação' },
  { id: 'ganho', label: 'Cliente' },
  { id: 'perdido', label: 'Sem avanço' },
  { id: 'nao_contatar', label: 'Recusou / não contatar' },
]);

const PIPELINE_STATUS = Object.freeze([
  { id: 'vinculo_pendente', label: 'A vincular' },
  ...STATUS,
]);

const STATUS_IDS = new Set(STATUS.map((item) => item.id));
const STATUS_LABELS = Object.fromEntries(PIPELINE_STATUS.map((item) => [item.id, item.label]));
const FINAL_STATUS = new Set(['ganho', 'perdido', 'nao_contatar']);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJson(filePath, fallback, { required = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT' && !required) return fallback;
      if (attempt < 2 && (error instanceof SyntaxError || error.code === 'EBUSY')) {
        await sleep(30 * (attempt + 1));
        continue;
      }
      if (!required && error.code === 'ENOENT') return fallback;
      throw new Error(`Não foi possível ler ${path.basename(filePath)}.`);
    }
  }
  return fallback;
}

async function readEvents(filePath) {
  try {
    const text = await fs.promises.readFile(filePath, 'utf8');
    return text.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await fs.promises.writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });

  try {
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.promises.copyFile(temporaryPath, filePath);
    await fs.promises.unlink(temporaryPath);
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function validDateTimestamp(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestIso(...values) {
  const winner = values
    .filter(Boolean)
    .map((value) => ({ value, timestamp: validDateTimestamp(value) }))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  return winner && winner.timestamp ? new Date(winner.timestamp).toISOString() : null;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function maskContact(value) {
  const original = String(value || '');
  const suffix = original.includes('@') ? `@${original.split('@').slice(1).join('@')}` : '';
  const digits = original.replace(/\D/g, '');
  if (!digits) return 'Identificador protegido';
  if (digits.length <= 4) return `••${digits}`;
  return `•••• ${digits.slice(-4)}${suffix === '@lid' ? ' · ID WhatsApp' : ''}`;
}

function normalizeCrmData(value) {
  const object = asObject(value);
  return {
    versao: 1,
    leads: asObject(object.leads),
  };
}

function mappingEntry(value) {
  if (typeof value === 'string') return { numero: value, nome: '' };
  const object = asObject(value);
  return {
    numero: String(object.numero || object.pn || ''),
    nome: String(object.nome || ''),
  };
}

function canonicalId(value, mappings) {
  const original = String(value || '');
  const direct = mappingEntry(mappings[original]);
  if (direct.numero) return direct.numero.replace('@c.us', '');
  return original.replace('@c.us', '');
}

function aggregateBaseLeads(rawLeads, mappings) {
  const aggregated = new Map();

  for (const [key, rawValue] of Object.entries(rawLeads)) {
    const value = asObject(rawValue);
    const sourceId = String(value.numero || key);
    const id = canonicalId(sourceId, mappings);
    const map = mappingEntry(mappings[sourceId]);
    const current = aggregated.get(id) || {
      numero: id,
      nome: '',
      status: 'frio',
      primeiro_contato: null,
      ultimo_contato: null,
      ultima_resposta: null,
      mensagens_enviadas: 0,
      respostas_recebidas: 0,
    };

    const incomingStatus = String(value.status || '');
    const statusPriority = { frio: 0, quente: 1, comprou: 2 };
    if ((statusPriority[incomingStatus] ?? 0) > (statusPriority[current.status] ?? 0)) {
      current.status = incomingStatus;
    }
    current.nome = String(value.nome || '').trim() || map.nome || current.nome;
    current.pais = value.pais || value.país || current.pais || '';
    current.categoria = value.categoria || current.categoria || '';
    current.cidade = value.cidade || current.cidade || '';
    current.primeiro_contato = [current.primeiro_contato, value.primeiro_contato]
      .filter(Boolean)
      .sort((a, b) => validDateTimestamp(a) - validDateTimestamp(b))[0] || null;
    current.ultimo_contato = latestIso(current.ultimo_contato, value.ultimo_contato);
    current.ultima_resposta = latestIso(current.ultima_resposta, value.ultima_resposta);
    current.mensagens_enviadas += asNonNegativeInteger(value.mensagens_enviadas);
    current.respostas_recebidas += asNonNegativeInteger(value.respostas_recebidas);
    aggregated.set(id, current);
  }

  return aggregated;
}

function classification(status, origin, reason, options = {}) {
  return {
    status,
    origin,
    confidence: options.confidence ?? null,
    reason,
    language: options.language || null,
    languageLabel: options.languageLabel || null,
    needsReview: Boolean(options.needsReview),
    suggestedStatus: options.suggestedStatus || status,
    nextAction: options.nextAction || '',
    intent: options.intent || null,
    messageAt: options.messageAt || null,
  };
}

function deriveClassification(id, baseLead, responseCount, blocked, metadata, automatedResponse, semantic, record = {}) {
  if (id.endsWith('@lid')) {
    return classification('vinculo_pendente', 'automatica', 'O identificador do WhatsApp ainda não foi associado a um telefone.');
  }
  if (blocked) {
    return classification('nao_contatar', 'automatica', 'O contato está na lista de bloqueio e não deve receber novos envios.', {
      confidence: 1,
      nextAction: 'Manter contato encerrado',
    });
  }
  if (semantic?.intent === 'opt_out') return classification('nao_contatar', 'automatica', semantic.reason, semantic);
  const hasNewReply = validDateTimestamp(semantic?.messageAt) > validDateTimestamp(metadata.status_definido_em || metadata.atualizado_em);
  if (STATUS_IDS.has(metadata.status) && (metadata.classificacao_modo === 'manual'
    || FINAL_STATUS.has(metadata.status) || !hasNewReply)) {
    return classification(metadata.status, 'manual', 'Etapa definida manualmente no CRM.', {
      language: semantic?.language,
      languageLabel: semantic?.languageLabel,
      messageAt: semantic?.messageAt,
    });
  }
  if (baseLead.status === 'comprou') {
    return classification('ganho', 'automatica', 'O histórico anterior já registrava este contato como cliente.', {
      confidence: 1,
      nextAction: 'Confirmar escopo e iniciar atendimento',
    });
  }
  if((record.proposals||[]).some(item=>item.status==='accepted'&&item.acceptedBy==='explicit-contact-message')){
    return classification('ganho','ia_contexto','Aceite explícito registrado em uma proposta apresentada, dentro das regras autorizadas. Pagamento é apurado separadamente.',{nextAction:'Acompanhar os próximos passos e o recebimento'});
  }
  if((record.proposals||[]).some(item=>item.status==='sent'&&item.createdBy==='ai')&&!['perdido','nao_contatar'].includes(semantic?.status)){
    return classification(semantic?.status==='negociacao'?'negociacao':'proposta','ia_contexto','Uma proposta gerada pelo catálogo teve o envio confirmado.',{nextAction:record.memory?.nextStep?.value||'Acompanhar a avaliação da proposta'});
  }
  if (baseLead.status === 'quente') {
    return classification('qualificado', 'automatica', 'O histórico anterior já registrava interesse comercial.', {
      confidence: null,
      nextAction: 'Entender a necessidade e preparar diagnóstico',
    });
  }
  if (automatedResponse) {
    return classification('automatico', 'automatica', 'O script reconheceu uma saudação, menu ou robô de atendimento.', {
      confidence: null,
      nextAction: 'Aguardar encaminhamento ao responsável',
      messageAt: automatedResponse.data || null,
    });
  }
  if (semantic) {
    return classification(semantic.status, semantic.intent==='ai_context' ? 'ia_contexto' : semantic.needsReview ? 'revisao' : 'automatica', semantic.reason, semantic);
  }
  if (responseCount > 0) {
    return classification('respondeu', 'revisao', 'Existe uma resposta humana sem texto suficiente para classificação segura.', {
      confidence: null,
      needsReview: true,
      nextAction: 'Ler resposta e classificar interesse',
    });
  }
  return classification('novo', 'automatica', 'A primeira mensagem foi enviada e ainda não há resposta.', {
    confidence: 1,
    nextAction: 'Aguardar resposta',
  });
}

function sanitizeText(value, maximum, fieldName) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${fieldName} deve ser um texto.`);
  const clean = value.trim();
  if (clean.length > maximum) throw new Error(`${fieldName} deve ter no máximo ${maximum} caracteres.`);
  return clean;
}

function sanitizeDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('A data do próximo contato deve usar o formato AAAA-MM-DD.');
  }
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || localDateKey(parsed) !== value) {
    throw new Error('A data do próximo contato é inválida.');
  }
  return value;
}

function sanitizeValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000000000) {
    throw new Error('O valor estimado precisa ser um número válido e positivo.');
  }
  return Math.round(parsed * 100) / 100;
}

function createCrmStore(projectRoot) {
  const root = path.resolve(projectRoot);
  const paths = {
    leads: path.join(root, 'leads.json'),
    responses: path.join(root, 'respostas_recebidas.json'),
    automatedResponses: path.join(root, 'respostas_automaticas_enviadas.json'),
    blocked: path.join(root, 'bloqueados.json'),
    dailyCounter: path.join(root, 'contador_diario.json'),
    pendingSends: path.join(root, 'envios_pendentes.json'),
    contactMappings: path.join(root, 'mapeamento_contatos.json'),
    crm: path.join(root, 'crm_dados.json'),
    workspace: path.join(root, 'ploa_workspace.json'),
    events: path.join(root, 'ploa_conversas.jsonl'),
    sentLog: path.join(root, 'log_envios.json'),
  };

  let writeQueue = Promise.resolve();
  let dashboardCache = null;
  let dashboardSignature = '';

  async function readSources() {
    const [rawLeads, responses, automatedResponses, blocked, dailyCounter, pendingSends, contactMappings, crmData] = await Promise.all([
      readJson(paths.leads, {}, { required: true }),
      readJson(paths.responses, []),
      readJson(paths.automatedResponses, []),
      readJson(paths.blocked, []),
      readJson(paths.dailyCounter, {}),
      readJson(paths.pendingSends, {}),
      readJson(paths.contactMappings, {}),
      readJson(paths.crm, { versao: 1, leads: {} }),
    ]);

    const mappings = asObject(contactMappings);
    const [workspace, rawEvents, sentLog] = await Promise.all([
      readJson(paths.workspace, { records: {} }), readEvents(paths.events), readJson(paths.sentLog, []),
    ]);
    const events=uniqueConversationEvents(rawEvents.map(event=>({...event,contact:canonicalId(event.contact||event.numero,mappings)})));
    const responseIndex = new Map();
    const automaticIndex = new Map();
    const eventIndex = new Map();
    const indexInto = (index, entry) => {
      const id = canonicalId(entry.numero || entry.contact, mappings);
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(entry);
    };
    for (const entry of asArray(responses)) indexInto(responseIndex, entry);
    // Eventos novos também alimentam a triagem, mesmo antes de o arquivo legado
    // receber a mensagem. O mesmo ID não conta duas vezes nas duas fontes.
    for(const event of events)if(event.direction==='in'&&event.actor==='contact'&&event.text){
      const id=canonicalId(event.contact,mappings),existing=responseIndex.get(id)||[];
      if(!existing.some(item=>(event.messageId&&item.mensagemId===event.messageId)||(item.texto===event.text&&item.data===event.at))){
        indexInto(responseIndex,{numero:event.contact,texto:event.text,data:event.at,mensagemId:event.messageId});
      }
    }
    for (const entry of asArray(automatedResponses)) indexInto(automaticIndex, entry);
    for (const index of [responseIndex, automaticIndex]) for (const items of index.values()) items.sort((a,b) => validDateTimestamp(b.data) - validDateTimestamp(a.data));
    const knownMessages = new Set(events.map((event) => event.messageId).filter(Boolean));
    for (const event of events) indexInto(eventIndex, event);
    for (const response of asArray(responses)) if (!knownMessages.has(response.mensagemId)) indexInto(eventIndex, {
      numero: response.numero, id: response.mensagemId || `legacy-in-${response.numero}-${response.data}`,
      direction: 'in', text: response.texto, at: response.data, actor: 'contact',
    });
    for (const response of asArray(automatedResponses)) if (!events.some((event) => event.direction === 'out' && event.contact === response.numero && event.text === response.texto && Math.abs(validDateTimestamp(event.at)-validDateTimestamp(response.data)) < 10000)) indexInto(eventIndex, {
      numero: response.numero, id: `legacy-auto-${response.numero}-${response.data}`, direction: 'out',
      text: response.texto, at: response.data, actor: 'bot',
    });
    for (const sent of asArray(sentLog)) if (sent.status === 'enviado' && sent.mensagem
      && !events.some((event) => event.direction === 'out' && event.contact === sent.numero && event.text === sent.mensagem)) indexInto(eventIndex, {
      numero: sent.numero, id: `legacy-out-${sent.numero}`, direction: 'out', text: sent.mensagem,
      at: sent.data || null, actor: 'script',
    });
    for (const items of eventIndex.values()) items.sort((a,b) => validDateTimestamp(a.at) - validDateTimestamp(b.at));

    return {
      rawLeads: asObject(rawLeads),
      responses: asArray(responses),
      automatedResponses: asArray(automatedResponses),
      blocked: new Set(asArray(blocked).map((item) => canonicalId(item, mappings))),
      dailyCounter: asObject(dailyCounter),
      pendingSends: asObject(pendingSends),
      mappings,
      crmData: normalizeCrmData(crmData),
      workspace: asObject(workspace), responseIndex, automaticIndex, eventIndex,
    };
  }

  function mergeLead(id, baseValue, source) {
    const baseLead = asObject(baseValue);
    const record = source.workspace.records?.[id] || {};
    const metadata = asObject(source.crmData.leads[id]);
    const leadResponses = source.responseIndex.get(id) || [];
    const responseCount = Math.max(asNonNegativeInteger(baseLead.respostas_recebidas), leadResponses.length);
    const automatedResponse = (source.automaticIndex.get(id) || [])
      .find((response) => ['bot-atendimento', 'opt-out'].includes(String(response.categoria || '')));
    const isBlocked = source.blocked.has(id);
    let semantic = classifyLeadResponse({
      responses: leadResponses,
      number: baseLead.numero || id,
    });
    const aiAnalysis=source.workspace.records?.[id]?.aiAnalysis;
    const aiCurrent=aiAnalysis && validDateTimestamp(aiAnalysis.sourceMessageAt)===validDateTimestamp(leadResponses[0]?.data)
      && aiAnalysis.sourceText===String(leadResponses[0]?.texto||'').slice(0,2000) && Boolean(aiAnalysis.evidence);
    if(aiCurrent&&semantic?.intent==='human_review'&&aiAnalysis.automatic&&['qualificado'].includes(aiAnalysis.suggestedStatus)){
      semantic={...semantic,status:aiAnalysis.suggestedStatus,suggestedStatus:aiAnalysis.suggestedStatus,
        needsReview:false,reason:aiAnalysis.reason,nextAction:aiAnalysis.nextStep,intent:'ai_context'};
    }
    if(aiCurrent&&semantic?.intent==='human_review'&&aiAnalysis.autonomous&&!aiAnalysis.needsReview){
      semantic={...semantic,needsReview:false,reason:aiAnalysis.reason,nextAction:aiAnalysis.nextStep,intent:'ai_context'};
    }
    const automatedResponseIsLatest = Boolean(automatedResponse) && (
      !semantic?.messageAt
      || !automatedResponse.data
      || validDateTimestamp(automatedResponse.data) >= validDateTimestamp(semantic.messageAt)
    );
    const leadClassification = deriveClassification(
      id,
      baseLead,
      responseCount,
      isBlocked,
      metadata,
      automatedResponseIsLatest ? automatedResponse : null,
      semantic,
      record,
    );
    const latestResponseAt = latestIso(baseLead.ultima_resposta, leadResponses[0]?.data);
    let status = leadClassification.status;
    const triage=record.triageAnalysis;
    const triageCurrent=triage&&metadata.classificacao_modo!=='manual'&&triage.sourceText===String(leadResponses[0]?.texto||'')
      &&triage.sourceAt===latestResponseAt&&triage.factsAt===(record.facts?.updatedAt||'');
    if(triageCurrent&&!triage.needsReview&&status==='respondeu'&&['respondeu','qualificado','perdido','nao_contatar','automatico'].includes(triage.suggestedStatus))status=triage.suggestedStatus;
    const latestActivity = latestIso(baseLead.ultimo_contato, latestResponseAt, metadata.atualizado_em);
    const nextContact = typeof metadata.proximo_contato === 'string' ? metadata.proximo_contato : '';
    const timezone = metadata.fuso || (String(baseLead.numero || id).startsWith('351') ? 'Europe/Lisbon'
      : String(baseLead.numero || id).startsWith('34') ? 'Europe/Madrid'
      : String(baseLead.numero || id).startsWith('1') ? 'America/New_York' : 'America/Sao_Paulo');
    const parts = zonedClock(timezone);
    const today = parts.year + '-' + parts.month + '-' + parts.day;
    const clock = parts.hour + ':' + parts.minute;
    const proposals = asArray(record.proposals);
    const payments = asArray(record.payments);
    const currency = metadata.moeda || (String(baseLead.numero || id).startsWith('55') ? 'BRL'
      : /^(351|34)/.test(baseLead.numero || id) ? 'EUR' : 'USD');
    const accepted = proposals.filter((p) => p.status === 'accepted' && p.currency === currency);
    const contracted = accepted.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const received = roundMoney(confirmedPayments(record).filter((p) => p.currency === currency)
      .reduce((sum, p) => sum + p.amount, 0));

    const merged = {
      id,
      numero: String(baseLead.numero || id),
      numero_mascarado: maskContact(baseLead.numero || id),
      nome: String(baseLead.nome || '').trim() || 'Contato sem nome',
      pais: baseLead.pais || (currency === 'BRL' ? 'Brasil' : currency === 'USD' ? 'Estados Unidos' : String(baseLead.numero || id).startsWith('351') ? 'Portugal' : 'Espanha'),
      categoria: baseLead.categoria || '',
      cidade: baseLead.cidade || '',
      moeda: currency,
      valor_contratado: contracted,
      valor_recebido: received,
      valor_a_receber: Math.max(0, contracted - received),
      propostas: proposals,
      pagamentos: payments,
      atendimento_modo: record.mode || 'automatic',
      analise_ia: aiCurrent ? aiAnalysis : null,
      ficha: record.facts || {},
      memoria_ia: record.memory || {},
      etapa_conversa:record.conversationStage||'',
      atencao_ia:record.attention&&!record.attention.resolvedAt?record.attention:null,
      historico_completo: source.eventIndex.get(id) || [],
      classificacao_modo: metadata.classificacao_modo || 'automatica',
      status,
      status_label: STATUS_LABELS[status],
      classificacao_origem: triageCurrent?'triagem':leadClassification.origin,
      classificacao_confianca: leadClassification.confidence,
      classificacao_motivo: triageCurrent?triage.reason:leadClassification.reason,
      classificacao_idioma: leadClassification.language,
      classificacao_idioma_label: leadClassification.languageLabel,
      classificacao_revisao: triageCurrent?triage.needsReview:leadClassification.needsReview,
      triagem:triageCurrent?triage:null,
      classificacao_sugestao: triageCurrent?triage.suggestedStatus:leadClassification.suggestedStatus,
      classificacao_sugestao_label: STATUS_LABELS[triageCurrent?triage.suggestedStatus:leadClassification.suggestedStatus] || STATUS_LABELS[status],
      classificacao_em: leadClassification.messageAt || latestResponseAt,
      acao_sugerida: triageCurrent?triage.nextStep:leadClassification.nextAction,
      atendimento_automatico: Boolean(automatedResponse),
      primeiro_contato: baseLead.primeiro_contato || null,
      ultimo_contato: baseLead.ultimo_contato || null,
      ultima_resposta: latestResponseAt,
      ultima_atividade: latestActivity,
      mensagens_enviadas: asNonNegativeInteger(baseLead.mensagens_enviadas),
      respostas_recebidas: responseCount,
      ultima_mensagem: String(leadResponses[0]?.texto || ''),
      respostas: leadResponses.slice(0, 12).map((response) => ({
        texto: String(response.texto || ''),
        data: response.data || null,
      })),
      proxima_acao: String(metadata.proxima_acao || ''),
      proximo_contato: nextContact,
      retorno_hora: metadata.retorno_hora || '',
      fuso: timezone,
      valor_estimado: metadata.valor_estimado !== null
        && metadata.valor_estimado !== ''
        && Number.isFinite(Number(metadata.valor_estimado))
        ? Number(metadata.valor_estimado)
        : null,
      notas: asArray(metadata.notas).slice(-100),
      atualizado_em: metadata.atualizado_em || null,
      vinculo_pendente: id.endsWith('@lid'),
      retorno_atrasado: Boolean(nextContact && (nextContact < today || (nextContact === today && metadata.retorno_hora && metadata.retorno_hora < clock)) && !FINAL_STATUS.has(status)),
      retorno_hoje: Boolean(nextContact && nextContact === today && !FINAL_STATUS.has(status)),
    };
    merged.retorno_sugerido=planFollowUp(merged,record);
    merged.fila_atendimento=queueFor(merged,record);
    return merged;
  }

  function sortLeads(leads) {
    const priority = {
      negociacao: 0,
      proposta: 1,
      qualificado: 2,
      respondeu: 3,
      automatico: 4,
      novo: 5,
      vinculo_pendente: 6,
      ganho: 7,
      perdido: 8,
      nao_contatar: 9,
    };

    return leads.sort((a, b) => {
      if(a.fila_atendimento?.actionNow!==b.fila_atendimento?.actionNow)return a.fila_atendimento?.actionNow?-1:1;
      if (a.retorno_atrasado !== b.retorno_atrasado) return a.retorno_atrasado ? -1 : 1;
      if (a.retorno_hoje !== b.retorno_hoje) return a.retorno_hoje ? -1 : 1;
      if (priority[a.status] !== priority[b.status]) return priority[a.status] - priority[b.status];
      return validDateTimestamp(b.ultima_atividade) - validDateTimestamp(a.ultima_atividade);
    });
  }

  async function getDashboard() {
    const signature = (await Promise.all(Object.values(paths).map(async (file) => {
      try { const stat = await fs.promises.stat(file); return `${stat.mtimeMs}:${stat.size}`; } catch { return 'missing'; }
    }))).join('|') + Math.floor(Date.now() / 60000);
    if (dashboardCache && signature === dashboardSignature) return dashboardCache;
    const source = await readSources();
    const aggregatedLeads = aggregateBaseLeads(source.rawLeads, source.mappings);
    // Conversations started outside outreach have no spreadsheet row. Display
    // their live events without rewriting the prospecting spreadsheet/leads file.
    for(const [id,history] of source.eventIndex){
      if(aggregatedLeads.has(id)||!/^\d{7,16}(?:@lid)?$/.test(id))continue;
      const messages=history.filter(event=>['in','out'].includes(event.direction));
      if(!messages.length)continue;
      const outgoing=messages.filter(event=>event.direction==='out');
      const incoming=messages.filter(event=>event.direction==='in');
      aggregatedLeads.set(id,{numero:id,nome:[...messages].reverse().find(event=>event.contactName)?.contactName||'Contato '+id.replace('@lid',''),status:'frio',
        primeiro_contato:outgoing[0]?.at||null,ultimo_contato:messages.at(-1)?.at||null,ultima_resposta:incoming.at(-1)?.at||null,
        mensagens_enviadas:outgoing.length,respostas_recebidas:incoming.length,origem:'whatsapp_external'});
    }
    const leads = sortLeads(
      [...aggregatedLeads.entries()].map(([id, baseLead]) => mergeLead(id, baseLead, source))
    );

    const statusCounts = Object.fromEntries(PIPELINE_STATUS.map((item) => [item.id, 0]));
    for (const lead of leads) statusCounts[lead.status] += 1;

    const linkedLeads = leads.filter((lead) => !lead.vinculo_pendente);
    const withResponse = linkedLeads.filter((lead) => lead.respostas_recebidas > 0).length;
    const automatedResponses = linkedLeads.filter((lead) => lead.status === 'automatico').length;
    const humanResponses = linkedLeads.filter((lead) => (
      lead.respostas_recebidas > 0 && lead.status !== 'automatico'
    )).length;
    const pendingFollowUps = linkedLeads.filter((lead) => lead.retorno_atrasado || lead.retorno_hoje).length;
    const opportunities = linkedLeads.filter((lead) => ['qualificado', 'proposta', 'negociacao', 'ganho'].includes(lead.status)).length;
    const openOpportunities = linkedLeads.filter((lead) => ['qualificado', 'proposta', 'negociacao'].includes(lead.status));
    const wonLeads = linkedLeads.filter((lead) => lead.status === 'ganho');
    const currencies = ['BRL', 'EUR', 'USD'];
    const finance = currencies.map((currency) => {
      const contacts = linkedLeads.filter((lead) => lead.moeda === currency);
      const sales = contacts.filter((lead) => lead.valor_recebido > 0);
      const received = contacts.reduce((sum, lead) => sum + lead.valor_recebido, 0);
      return { currency, received, contracted: contacts.reduce((sum, lead) => sum + lead.valor_contratado, 0),
        receivable: contacts.reduce((sum, lead) => sum + lead.valor_a_receber, 0), sales: sales.length,
        pipeline: contacts.filter((lead) => ['qualificado', 'proposta', 'negociacao'].includes(lead.status)).reduce((sum, lead) => sum + (lead.valor_estimado || 0), 0),
        average: sales.length ? received / sales.length : 0 };
    });
    const revenueWon = finance[0].received;
    const openPipelineValue = finance[0].pipeline;
    const valuedSales = linkedLeads.filter((lead) => lead.valor_recebido > 0);
    const averageTicket = finance[0].average;
    const proposalsOpen = linkedLeads.filter((lead) => ['proposta', 'negociacao'].includes(lead.status)).length;
    const proposalsPresented = linkedLeads.filter((lead) => ['proposta', 'negociacao', 'ganho'].includes(lead.status)).length;
    const recordedSales = valuedSales.length;
    const funnelSteps = [
      { id: 'primeiro_contato', label: 'Primeiro contato', count: linkedLeads.length },
      { id: 'apresentacao_proposta', label: 'Proposta', count: proposalsPresented },
      { id: 'conversao_cliente', label: 'Conversão em cliente', count: wonLeads.length },
      { id: 'vendas', label: 'Venda registrada', count: recordedSales },
    ];
    const valuesByStatus = Object.fromEntries(STATUS.map((item) => [item.id, 0]));
    for (const lead of linkedLeads) {
      if (lead.moeda === 'BRL') valuesByStatus[lead.status] = (valuesByStatus[lead.status] || 0)
        + (lead.status === 'ganho' ? lead.valor_recebido : lead.valor_estimado || 0);
    }
    const dailyCount = source.dailyCounter.data === localDateKey()
      ? asNonNegativeInteger(source.dailyCounter.enviados)
      : 0;

    dashboardSignature = signature;
    dashboardCache = {
      status_options: STATUS,
      pipeline_options: PIPELINE_STATUS,
      funnel_steps: funnelSteps,
      financeiro_moedas: finance,
      response_metric:responseMetric(leads),
      resumo: {
        total: linkedLeads.length,
        total_registros: leads.length,
        conversas_sem_vinculo: statusCounts.vinculo_pendente,
        com_resposta: withResponse,
        taxa_resposta: linkedLeads.length ? Math.round((withResponse / linkedLeads.length) * 1000) / 10 : 0,
        respostas_totais: withResponse,
        respostas_humanas: humanResponses,
        respostas_automaticas: automatedResponses,
        sem_resposta: statusCounts.novo,
        respostas_para_classificar: linkedLeads.filter(lead=>lead.status==='respondeu'&&lead.classificacao_revisao&&String(lead.ultima_mensagem||'').trim()).length,
        respostas_pendentes_total: linkedLeads.filter(lead=>lead.status==='respondeu'&&lead.classificacao_revisao).length,
        acao_ronald:linkedLeads.filter(lead=>lead.fila_atendimento.actionNow).length,
        historico_para_triagem:linkedLeads.filter(lead=>lead.fila_atendimento.history).length,
        historico_sem_texto:linkedLeads.filter(lead=>lead.fila_atendimento.withoutText).length,
        propostas_abertas: proposalsOpen,
        oportunidades: opportunities,
        ganhos: statusCounts.ganho,
        vendas_registradas: recordedSales,
        faturamento_ganho: Math.round(revenueWon * 100) / 100,
        valor_pipeline_aberto: Math.round(openPipelineValue * 100) / 100,
        ticket_medio: Math.round(averageTicket * 100) / 100,
        valores_por_status: valuesByStatus,
        retornos_pendentes: pendingFollowUps,
        enviados_hoje: dailyCount,
        envios_pendentes: Object.keys(source.pendingSends).length,
        por_status: statusCounts,
        atualizado_em: new Date().toISOString(),
      },
      leads,
    };
    return dashboardCache;
  }

  async function updateLead(id, patch) {
    if (!id || typeof id !== 'string' || id.length > 160) throw new Error('Identificador de lead inválido.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Atualização inválida.');

    const allowedFields = new Set(['status', 'proxima_acao', 'proximo_contato', 'valor_estimado', 'nota', 'moeda', 'classificacao_modo', 'retorno_hora', 'fuso']);
    const unknownField = Object.keys(patch).find((field) => !allowedFields.has(field));
    if (unknownField) throw new Error(`Campo não permitido: ${unknownField}.`);

    writeQueue = writeQueue.catch(() => {}).then(async () => {
      const source = await readSources();
      const leadExists = aggregateBaseLeads(source.rawLeads, source.mappings).has(id);
      if (!leadExists) throw new Error('Lead não encontrado.');

      const current = asObject(source.crmData.leads[id]);
      const next = { ...current };

      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        if (!STATUS_IDS.has(patch.status)) throw new Error('Etapa do funil inválida.');
        next.status = patch.status;
        next.status_definido_em = new Date().toISOString();
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'proxima_acao')) {
        next.proxima_acao = sanitizeText(patch.proxima_acao, 240, 'Próxima ação');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'proximo_contato')) {
        next.proximo_contato = sanitizeDate(patch.proximo_contato);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'valor_estimado')) {
        next.valor_estimado = sanitizeValue(patch.valor_estimado);
      }
      if (patch.moeda !== undefined) {
        if (!['BRL', 'EUR', 'USD'].includes(patch.moeda)) throw new Error('Moeda inválida.');
        const financial = source.workspace.records?.[id];
        if ([...(financial?.proposals || []), ...(financial?.payments || [])].some((item)=>item.currency !== patch.moeda)) {
          throw new Error('Não é permitido trocar a moeda de um contato com propostas ou recebimentos em outra moeda.');
        }
        next.moeda = patch.moeda;
      }
      if (patch.classificacao_modo !== undefined) {
        if (!['automatica', 'manual'].includes(patch.classificacao_modo)) throw new Error('Modo inválido.');
        next.classificacao_modo = patch.classificacao_modo;
        if (patch.classificacao_modo === 'automatica') delete next.status;
      }
      if (patch.retorno_hora !== undefined) {
        if (patch.retorno_hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.retorno_hora)) throw new Error('Horário inválido.');
        next.retorno_hora = patch.retorno_hora;
      }
      if (patch.fuso !== undefined) {
        try { new Intl.DateTimeFormat('pt-BR', { timeZone: patch.fuso }); } catch { throw new Error('Fuso inválido.'); }
        next.fuso = patch.fuso;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'nota')) {
        const note = sanitizeText(patch.nota, 1000, 'Nota');
        if (note) {
          next.notas = [...asArray(current.notas), { texto: note, criado_em: new Date().toISOString() }].slice(-100);
        }
      }

      next.atualizado_em = new Date().toISOString();
      source.crmData.leads[id] = next;
      await writeJsonAtomic(paths.crm, source.crmData);
    });

    await writeQueue;
    const dashboard = await getDashboard();
    return dashboard.leads.find((lead) => lead.id === id);
  }

  return {
    getDashboard,
    updateLead,
    paths: { ...paths },
  };
}

module.exports = {
  STATUS,
  createCrmStore,
  localDateKey,
};
