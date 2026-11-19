'use strict';
const { normalizarTextoBot } = require('./bot-patterns');

// Text may differ from a number's country. Ambiguous messages retain that fallback.
function idiomaRespostaAutomatica(texto, numero, preferido) {
  const suportados = ['pt-BR', 'pt-PT', 'en-US', 'es-ES'];
  const identificador = String(numero || '');
  const digitos = identificador.includes('@lid') ? '' : identificador.replace(/\D/g, '');
  const base = suportados.includes(preferido) ? preferido : digitos.startsWith('351') ? 'pt-PT' : digitos.startsWith('34') ? 'es-ES' : digitos.startsWith('1') ? 'en-US' : 'pt-BR';
  const normalizado = normalizarTextoBot(texto);
  const scores = {
    pt: (normalizado.match(/\b(?:obrigad[oa]|agradecemos|agradece|contato|contacto|contactar|mensagem|atendimento|agendamento|marcacoes|horario de funcionamento|estamos encerrados|bem[ -]vind[oa])\b/g) || []).length,
    en: (normalizado.match(/\b(?:thank you|thanks|welcome|message|contacting|please|business hours|booking|appointment|we're|we are|unavailable|we will|we'll|leave your name)\b/g) || []).length,
    es: (normalizado.match(/\b(?:gracias|bienvenid[oa]|mensaje|atencion|comunicarte|comunicarse|ayudarte|ayudarle|podemos ayudarte|en breve|estaremos contigo|lo antes posible|fuera de horario|horario de atencion)\b/g) || []).length,
  };
  if (/\b(?:no thanks|no thank you|not interested|do not contact|please stop|automated (?:reply|message)|press \d+ for|we(?:'re| are) (?:away|closed|unavailable))\b/.test(normalizado)) scores.en += 2;
  if (/\b(?:no gracias|no (?:me|nos) interesa|no (?:nos |me )?contactes|respuesta automatica|pulse \d+ para|fuera (?:de|del) horario)\b/.test(normalizado)) scores.es += 2;
  if (/\b(?:nao obrigad[oa]|nao (?:tenho|temos) interesse|nao (?:me|nos) contacte|resposta automatica|(?:digite|escolha|selecione) \d+ para)\b/.test(normalizado)) scores.pt += 2;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 2 || ranked[0][1] === ranked[1][1]) return base;
  if (ranked[0][0] === 'es') return 'es-ES';
  if (ranked[0][0] === 'en') return 'en-US';
  return base === 'pt-PT' || !base.startsWith('pt-') && /\b(?:contacto|contactar|equipa|vosso|vossa|marcacoes|encerrados)\b/.test(normalizado) ? 'pt-PT' : 'pt-BR';
}
module.exports = { idiomaRespostaAutomatica };
