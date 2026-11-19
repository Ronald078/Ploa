'use strict';

const LANGUAGE_LABELS = Object.freeze({
  'pt-BR': 'Português do Brasil',
  'pt-PT': 'Português de Portugal',
  'en-US': 'Inglês',
  'es-ES': 'Espanhol',
});

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguage(text, number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.startsWith('351')) return 'pt-PT';
  if (digits.startsWith('34')) return 'es-ES';
  if (digits.startsWith('1')) return 'en-US';
  if (digits.startsWith('55')) return 'pt-BR';

  const scores = {
    'pt-BR': (text.match(/\b(?:nao|voce|valor|orcamento|gostaria|tenho|obrigado|site)\b/g) || []).length,
    'en-US': (text.match(/\b(?:not|you|price|quote|interested|website|thanks|proposal)\b/g) || []).length,
    'es-ES': (text.match(/\b(?:no|usted|precio|presupuesto|interesa|gracias|propuesta|pagina)\b/g) || []).length,
  };
  return Object.entries(scores).sort((first, second) => second[1] - first[1])[0]?.[0] || 'pt-BR';
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const RULES = Object.freeze([
  {
    id: 'opt_out',
    status: 'nao_contatar',
    suggestedStatus: 'nao_contatar',
    confidence: null,
    needsReview: false,
    reason: 'A mensagem contém um pedido explícito para interromper o contato.',
    nextAction: 'Não enviar novas abordagens',
    patterns: [
      /\b(?:nao|nunca) (?:me )?(?:mande|envie|contacte|contate) (?:mais )?(?:mensagens?|nada)\b/,
      /\bnao (?:quero|queremos|desejo|desejamos) (?:mais )?receber (?:mais )?(?:mensagens?|contactos?|contatos?|publicidade)\b/,
      /\b(?:pare|para) de (?:me )?(?:mandar|enviar|contactar|contatar)\b/,
      /\bremov[ae] (?:meu numero|me|o meu contacto)\b/,
      /\bdo not (?:message|contact|text) me\b/,
      /\b(?:do not|don t) want to (?:receive|get) (?:any more |any |more )?(?:messages|texts|advertising)\b/,
      /\bstop (?:messaging|contacting|texting) me\b/,
      /\bremove me from (?:your|the) list\b/,
      /\bno (?:me )?(?:envies|mandes) mas mensajes\b/,
      /\bno (?:quiero|queremos|deseo|deseamos) recibir (?:mas )?(?:mensajes|publicidad|contactos)\b/,
      /\bdeja de (?:escribirme|contactarme|enviarme mensajes)\b/,
    ],
  },
  {
    id: 'lost',
    status: 'perdido',
    confidence: 0.95,
    needsReview: false,
    reason: 'O contato recusou a oferta ou informou que não possui interesse.',
    nextAction: 'Encerrar oportunidade sem novo avanço',
    patterns: [
      /\bnao (?:tenho|temos|possuo|possuimos) interesse\b/,
      /\bnao (?:estou|estamos) interessado?s?\b/,
      /\bsem interesse\b/,
      /\bagora nao (?:tenho|temos) interesse\b/,
      /\bnot interested\b/,
      /\bno thanks?\b/,
      /\bwe are not interested\b/,
      /\bno (?:me|nos) interesa\b/,
      /\bno estamos interesados?\b/,
      /\bno gracias\b/,
    ],
  },
  {
    id: 'won',
    status: 'qualificado',
    suggestedStatus: 'ganho',
    confidence: null,
    needsReview: true,
    reason: 'Existe sinal de aceite. Confirme qual proposta e quais condições foram aceitas antes de registrar o contrato.',
    nextAction: 'Confirmar aceite e condições da proposta',
    patterns: [
      /\baceito (?:a |o )?(?:proposta|orcamento)\b/,
      /\b(?:proposta|orcamento) aceit[ao]\b/,
      /\bvamos fechar\b/,
      /\bpodemos fechar\b/,
      /\bfechado vamos (?:fazer|seguir|comecar)\b/,
      /\bpode (?:comecar|iniciar) (?:o |os )?(?:servico|trabalho|projeto)\b/,
      /\bi accept (?:the )?(?:proposal|quote)\b/,
      /\blet s (?:close|move forward|start)\b/,
      /\bwe have a deal\b/,
      /\bacepto (?:la |el )?(?:propuesta|presupuesto)\b/,
      /\bpodemos (?:cerrar|empezar)\b/,
      /\badelante con (?:el |la )?(?:proyecto|propuesta)\b/,
    ],
  },
  {
    id: 'negotiation',
    status: 'negociacao',
    confidence: 0.92,
    needsReview: false,
    reason: 'A mensagem discute preço, desconto, parcelamento ou condições do serviço.',
    nextAction: 'Responder condições e conduzir negociação',
    patterns: [
      /\b(?:tem|consegue|pode dar|faz) (?:algum )?desconto\b/,
      /\bconsegue (?:me )?dar (?:algum )?desconto\b/,
      /\bconsegue fazer por\b/,
      /\b(?:parcelar|parcelamento|dividir o valor)\b/,
      /\b(?:ficou|esta|achei) (?:muito )?(?:caro|acima do orcamento)\b/,
      /\bajustar (?:o )?valor\b/,
      /\b(?:discount|payment plan|payment terms|lower the price)\b/,
      /\bcan you do it for\b/,
      /\btoo expensive\b/,
      /\b(?:descuento|pago a plazos|formas de pago|ajustar el precio)\b/,
      /\bpuedes hacerlo por\b/,
      /\bes demasiado caro\b/,
    ],
  },
  {
    id: 'proposal_received',
    status: 'proposta',
    confidence: 0.92,
    needsReview: false,
    reason: 'O contato confirmou que recebeu ou está analisando uma proposta já apresentada.',
    nextAction: 'Acompanhar análise da proposta',
    patterns: [
      /\brecebi (?:a |o )?(?:proposta|orcamento)\b/,
      /\b(?:vou|vamos|estou|estamos) analisar (?:a |o )?(?:proposta|orcamento)\b/,
      /\bsobre (?:a |o )?(?:proposta|orcamento) (?:que )?(?:recebi|enviou|mandou)\b/,
      /\bi (?:received|am reviewing|will review) (?:the |your )?(?:proposal|quote)\b/,
      /\babout (?:the |your )?(?:proposal|quote)\b/,
      /\b(?:recibi|estoy revisando|voy a revisar) (?:la |el )?(?:propuesta|presupuesto)\b/,
      /\bsobre (?:la |el )?(?:propuesta|presupuesto)\b/,
    ],
  },
  {
    id: 'proposal_request',
    status: 'qualificado',
    confidence: 0.93,
    needsReview: false,
    reason: 'O contato pediu orçamento ou proposta; a etapa permanece em interesse até a proposta ser realmente enviada.',
    nextAction: 'Preparar e enviar proposta',
    patterns: [
      /\b(?:mande|envie|pode mandar|pode enviar|quero|gostaria de receber) (?:uma |um )?(?:proposta|orcamento)\b/,
      /\bpode (?:me )?(?:mandar|enviar) (?:uma |um )?(?:proposta|orcamento)\b/,
      /\b(?:faz|faca|consegue fazer) (?:um )?orcamento\b/,
      /\b(?:send|give) me (?:a )?(?:proposal|quote)\b/,
      /\b(?:can|could) you (?:send|prepare) (?:a |the )?(?:proposal|quote)\b/,
      /\b(?:envia|mandame|puedes enviar|quiero) (?:una |un )?(?:propuesta|presupuesto)\b/,
      /\b(?:haz|hacer) (?:un )?presupuesto\b/,
    ],
  },
  {
    id: 'interest',
    status: 'qualificado',
    confidence: 0.89,
    needsReview: false,
    reason: 'A mensagem demonstra interesse, pede detalhes ou pergunta sobre preço e funcionamento.',
    nextAction: 'Responder interesse e entender a necessidade',
    patterns: [
      /\b(?:tenho|temos|gostaria|estou) interesse\b/,
      /\bquero saber mais\b/,
      /\b(?:como funciona|como seria|pode explicar|me passa mais informacoes)\b/,
      /\b(?:quanto custa|qual (?:o )?valor|qual (?:o )?preco)\b/,
      /\b(?:i am|i m|we are) interested\b/,
      /\b(?:tell me more|how does it work|how much|what is the price)\b/,
      /\b(?:me|nos) interesa\b/,
      /\b(?:quiero saber mas|como funciona|puedes explicar|cuanto cuesta|cual es el precio)\b/,
    ],
  },
]);

function classifyLeadResponse({ responses = [], number = '' } = {}) {
  const latest = Array.isArray(responses) ? responses.find((response) => String(response?.texto || '').trim()) : null;
  if (!latest) return null;

  const text = normalizeText(latest.texto);
  const language = detectLanguage(text, number);
  // Frases citadas, condicionais e negações não representam compromisso atual.
  const uncertain = /\b(?:se eu|se nos|se voces|talvez|ainda nao|nao aceito|nao vamos fechar|nao podemos fechar|if i|if we|not accept|no acepto|si acepto)\b/.test(text);
  let rule = RULES.find((candidate) => matchesAny(text, candidate.patterns)
    && !(uncertain && ['won', 'proposal_received', 'interest'].includes(candidate.id)));
  let contextual = false;
  if (!rule && !uncertain && text.length < 300) {
    // Uma confirmação breve não apaga uma etapa sustentada por mensagem anterior.
    const neutral = /^(?:ok|okay|certo|entendi|obrigad[oa]|obrigad[oa]s|thanks|thank you|gracias|perfeito|perfect|bom dia|boa tarde|boa noite|ola|oi|hello|hi)[\sa-z0-9]*$/.test(text);
    if (neutral) for (const previous of responses.slice(1, 8)) {
      if (Date.parse(latest.data) - Date.parse(previous.data) > 30 * 86400000) continue;
      const prior = normalizeText(previous.texto);
      if (/\b(?:nao|not|no|if|se|talvez)\b/.test(prior)) continue;
      const candidate = RULES.find((item) => ['negotiation','proposal_received','proposal_request','interest'].includes(item.id) && matchesAny(prior, item.patterns));
      if (candidate) { rule = candidate; contextual = true; break; }
    }
  }

  if (!rule) {
    return {
      status: 'respondeu',
      suggestedStatus: 'respondeu',
      confidence: null,
      needsReview: true,
      reason: 'A mensagem é humana, mas não possui sinais suficientes para definir a etapa comercial com segurança.',
      nextAction: 'Ler resposta e classificar interesse',
      language,
      languageLabel: LANGUAGE_LABELS[language],
      intent: 'human_review',
      messageAt: latest.data || null,
    };
  }

  return {
    status: rule.status,
    suggestedStatus: rule.suggestedStatus || rule.status,
    confidence: null,
    evidence: String(latest.texto).slice(0, 600),
    needsReview: rule.needsReview || contextual,
    reason: contextual ? 'A última mensagem é uma confirmação breve. A etapa foi preservada pelo contexto anterior; confira a conversa antes do próximo passo.' : rule.reason,
    nextAction: rule.nextAction,
    language,
    languageLabel: LANGUAGE_LABELS[language],
    intent: rule.id,
    messageAt: latest.data || null,
  };
}

module.exports = {
  classifyLeadResponse,
  detectLanguage,
  normalizeText,
};
