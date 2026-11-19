'use strict';

function normalizarTextoBot(texto) {
  // Compatibility normalization also converts decorative business alphabets.
  return String(texto || '').normalize('NFKD')
    .replace(/[\u0300-\u036f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufe0f\u20e3]/g, '')
    .replace(/[‘’ʼ]/g, "'").replace(/[*_`~]/g, '')
    .toLowerCase().replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').trim();
}

const EXPLICITOS = [
  /\b(?:resposta|mensagem|atendimento) automatic[ao]\b|\bauto[ -]?atendimento\b|\brobo (?:de |do )?(?:auto )?atendimento\b/,
  /\b(?:automated|automatic) (?:message|reply|response)\b|\bauto[ -]?reply\b|\bchatbot\b/,
  /\b(?:mensaje|respuesta|atencion) automatic[ao]\b|\bbot de atencion\b/,
  /\b(?:assistente|atendente|asistente) virtual\b|\bvirtual assistant\b/,
  /\b(?:digite|selecione|escolha|type|select|choose|reply with|selecciona|seleccione|elige|elija|escribe|escriba|pulsa|pulse|press)\s*\d+\s+(?:para|for)\b/,
  /\b(?:digite|selecione|escolha|escreva|select|choose|type|reply with|selecciona|seleccione|elige|escribe|pulsa|pulse).{0,45}\b(?:opcao|opcoes|alternativa|option|number|topic|opcion|numero|tema)\b/,
  /\b(?:mensagens?|atendimentos?) (?:serao |sao )?(?:respondid[ao]s?|atendid[ao]s?).{0,50}\bordem de chegada\b/,
  /\b(?:messages|inquiries) (?:are |will be )?(?:answered|responded to|handled).{0,45}\border (?:they (?:are |were )?)?received\b/,
  /\b(?:mensajes|consultas) (?:se )?(?:responden|responderan|atienden|atenderan).{0,40}\borden de (?:llegada|recepcion)\b/,
];
const SAUDACAO = /\bbem[ -]?vind[oa@](?:\([oa]\))?s?\b|\bwelcome (?:to|at)\b|\bbienvenid[oa@s]+\b|\b(?:agradecemos|agradece|obrigad[oa]).{0,35}(?:mensagem|contato|contacto|contactar)\b|\bthank(?:s| you) for (?:your message|contacting|messaging|reaching out)\b|\bgracias por (?:tu mensaje|su mensaje|contactar|comunicar|escribir)/;
const AJUDA = /\b(?:como|em que) (?:podemos|posso) (?:te |lhe |vos )?ajud(?:ar|a[- ]l[oa])\b|\bhow (?:(?:can|may) (?:we|i)|(?:we|i) can) help\b|\bcomo (?:podemos|puedo) ayud(?:arte|arle|arles|ar)\b/;
const HUMANA = /\b(?:me chamo|meu nome e|sou (?:a|o)|aqui e (?:a|o)|my name is|this is|me llamo|mi nombre es)\b|\b(?:ja encaminhei|ja passei|ja enviei|vou encaminhar|vou passar).{0,35}\b(?:mensagem|proposta)\b|\b(?:sua|tua|your|vuestra|tu) (?:proposta|proposal|quote|presupuesto)\b|\b(?:quero|gostaria de|preciso de).{0,30}\b(?:site|sistema|website)\b|\b(?:i need|i want|necesito|quiero).{0,25}\b(?:website|web|sistema)\b/;
const AUSENCIA = /\b(?:nao estamos|estamos temporariamente) (?:disponiveis|abertos|em horario|fechad[oa]s?)\b|\bfora (?:do horario|do expediente)\b|\bestamos encerrados\b|\b(?:de momento|no momento|agora) nao (?:podemos atender|estamos atendendo|estamos a atender|conseguimos responder)\b|\b(?:we(?:'re| are)|our team is) (?:unavailable|away|closed|offline)\b|\bno estamos disponibles\b|\bfuera (?:de|del) (?:nuestro )?horario\b|\b(?:ahora|en este momento) no podemos (?:responder|atender)\b/;
const ESPERA = /\b(?:responderemos|responderei|retornaremos|retornarei|atenderemos|respondemos|entraremos em contacto|entraremos em contato|vamos (?:te |lhe )?responder|iremos responder).{0,65}\b(?:assim que possivel|assim que puder|em breve|o mais (?:breve|rapido) possivel|proximo dia util)\b|\b(?:assim que possivel|em breve|em alguns instantes).{0,85}\b(?:responder|respondera|responderemos|responderao|atender|atende lo|atendimento|continuidade)\b|\b(?:aguarde|por favor aguarde|so um instante|so um momento).{0,60}\b(?:atender|atendido|responder)\b|\b(?:we(?:'ll| will)|will|i(?:'ll| will)) (?:reply|respond|get back to you).{0,40}\b(?:soon|shortly|asap|as soon as possible)\b|\b(?:en breve|en unos minutos|lo antes posible).{0,65}\b(?:responder|respondiendo|estaremos contigo|atender)\b|\b(?:responderemos|contestaremos|lo haremos|pondre en contacto).{0,40}\b(?:en breve|lo antes posible)\b/;
const HORARIO = /\b(?:horarios? de (?:atendimento|funcionamento|atencion|apertura)|opening hours|business hours|office hours)\b.{0,100}\b\d{1,2}(?::|h|am|pm|\b)/;
const CANAL = /\b(?:novo numero de atendimento|nosso (?:numero|telefone|contacto|contato)(?: de (?:atendimento|contacto|contato))? mudou|este numero foi desativado|whatsapp desativado)\b|\b(?:our (?:phone )?number has changed|this number is no longer (?:active|in use))\b|\b(?:nuestro numero ha cambiado|este numero (?:ya no esta activo|ha sido desactivado))\b/;
const ENCAMINHAR = /\b(?:faca|realize|agende|marque|reserve|efetue).{0,30}\b(?:pedido|agendamento|marcacao|reserva|horario)\b|\b(?:book|schedule|place your order).{0,35}\b(?:here|online|appointment|website|link)\b|\b(?:reserva|pide|haz tu pedido|solicita tu cita).{0,35}\b(?:aqui|web|enlace|cita)\b|\b(?:agendamentos?|pedidos|marcacoes).{0,45}\b(?:somente|apenas|exclusivamente).{0,30}\b(?:site|aplicativo|app|link)\b/;
const DADOS = /\b(?:deixe|envie|deixa).{0,30}\b(?:mensagem|nome|assunto|dia e horario)\b|\b(?:please )?(?:leave|send|provide).{0,35}\b(?:your name|brief description|message)\b|\b(?:deja|deje|indica|indique).{0,30}\b(?:nombre|mensaje|motivo)\b/;

// null delegates to the existing detector. false is a deliberate human/data guard.
function detectarPadraoAdicional(normalizado) {
  const text = normalizado.replace(/\s+/g, ' ');
  if (/^begin:vcard\b/.test(text)) return false;
  if (EXPLICITOS.some(pattern => pattern.test(text))) return true;
  if (HUMANA.test(text)) return false;
  if (/\b(?:minha ideia seria|a ideia seria|o sistema teria|o site poderia|the idea would|my idea is|mi idea seria)\b/.test(text)) return false;
  if (AUSENCIA.test(text) || CANAL.test(text) || HORARIO.test(text)) return true;
  const saudacao = SAUDACAO.test(text), link = /https?:\/\/|\bwa\.me\//.test(text);
  if (ESPERA.test(text) && (saudacao || DADOS.test(text) || /\b(?:equipe|team|equipo|atendimento|atencion)\b/.test(text))) return true;
  if (link && ENCAMINHAR.test(text)) return true;
  if (saudacao && AJUDA.test(text)) {
    if (/\b[^.!?]{2,100} agradece (?:o |seu |o seu |a sua |sua )?(?:contato|contacto|mensagem)[.!?]/.test(text)
      || /\bthank(?:s| you) for (?:contacting|messaging|reaching out to) (?!us\b|me\b)[a-z0-9][^.!?]{1,100}[.!?]/.test(text)
      || /\bgracias por (?:comunicarte|comunicarse|contactar|contactarte|contactarse) (?:con|a) (?!nosotros\b)[^.!?]{2,100}[.!?¿]/.test(text)) return true;
  }
  if (/^obrigad[oa] por nos contactar[!. ]+estamos a sua disposicao[!. ]+[^.!?]{2,100}[.! ]*$/.test(text)) return true;
  return null;
}
module.exports = { normalizarTextoBot, detectarPadraoAdicional };
