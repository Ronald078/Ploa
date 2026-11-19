'use strict';
const { normalizarTextoBot: normalizarTexto, detectarPadraoAdicional } = require('./bot-patterns');

// Padrões que, sozinhos, são característicos de respostas automáticas.
// Todos recebem o texto já normalizado (sem acentos e em minúsculas).
const PADROES_BOT_FORTES = [
  /\b(digite|selecione|escolha|type|select|choose|reply with|selecciona|elige|escribe)\s*[0-9]+\s+(para|for)\b/,
  /\bresposta automatica\b/,
  /\bnao estamos (disponiveis|abertos|em horario)\b/,
  /\b(responderemos|retornaremos|entraremos em contato) (assim que possivel|em breve|o mais breve possivel)\b/,
  /\b(assim que possivel|em alguns minutos|em breve).{0,55}(responderemos|responderei|retornaremos|entraremos em contato)\b/,
  /\b(responderemos|responderei|retornaremos).{0,55}(assim que possivel|em alguns minutos|em breve)\b/,
  /\bfora do horario (de )?(atendimento|online)\b/,
  /\b(digite|selecione|escolha|escreva).{0,45}\b(opcao|opcoes|alternativa|assunto|numero)\b/,
  /\b(assistente|atendente) virtual\b/,
  /\b(desculpe|nao consegui).{0,45}\b(entender|opcao valida|opcao selecionada)\b/,
  /\b(para agilizar|para facilitar)[\s\S]{0,80}\batendimento[\s\S]{0,80}\b(informe|adiant|assunto)\b/,
  /\b(deseja|gostaria de)[\s\S]{0,35}\b(agendar|marcar)[\s\S]{0,140}(https?:\/\/|wa\.me\/)/,
  /\b(faca|realize)[\s\S]{0,25}\b(pedido|agendamento|reserva)[\s\S]{0,140}(https?:\/\/|wa\.me\/)/,
  /\bclique no link[\s\S]{0,90}\b(atendimento|pedido|agendamento)\b/,
  /\bwhatsapp desativado\b/,
  /\b(deixe|envie) (a |sua )?mensagem[\s\S]{0,65}\b(responderemos|responderei|retornaremos)\b/,
  /utilize os botoes\s+de\s+interacao/,
  /\bnosso atendimento (por|neste|nesse) (esse |este |o )?(canal|whatsapp)\b/,
  /\b(loja|estabelecimento) esta fechad[oa]\b/,
  /\bhorario de atendimento[\s\S]{0,90}\b\d{1,2}([:h]\d{0,2})?\b/,
  /\b(por favor[\s\S]{0,35})?(informe|nos fale|diga)[\s\S]{0,25}\b(seu|o seu) nome\b/,
  /\bcaros clientes\b/,
  /\b(currently unavailable|currently closed|outside (our )?business hours)\b/,
  /\b(we will|we'll) (reply|respond|get back to you)\b/,
  /\b(select|choose|type|reply with).{0,45}\b(option|number|topic)\b/,
  /\bvirtual assistant\b/,
  /\bno estamos disponibles\b/,
  /\bfuera de (nuestro )?horario\b/,
  /\b(responderemos|contestaremos) (en breve|lo antes posible)\b/,
  /\b(selecciona|elige|escribe).{0,45}\b(opcion|numero|tema)\b/,
  /\basistente virtual\b/,
];

// Sinais isolados que também aparecem em conversas humanas. Eles só
// identificam um bot quando combinados com estrutura de menu, link ou texto
// longo, reduzindo respostas indevidas a pessoas reais.
const GRUPOS_SINAIS_BOT = [
  // Saudações e ajuda também são humanas; juntas contam como um sinal fraco.
  /\bbem[- ]?vind[oa](?:\([oa]\))?s?\b|\bwelcome to\b|\bbienvenid[oa]s?\b|\b(em que|como) (podemos|posso) (te |lhe |vos )?ajudar\b|\bhow can (we|i) help\b|\bcomo (podemos ayudarte|puedo ayudarte)\b|\b(agradecemos|agradece).{0,25}(mensagem|contato|contacto)\b|\bobrigad[oa] por (nos )?(contatar|contactar|escrever|sua mensagem|seu contato)\b|\bthank you for (contacting|messaging|reaching out)\b|\bgracias por (contactar|escribir|tu mensaje|su mensaje)\b/,
  /\b(pedido|pedidos|encomenda|encomendas|order|orders)\b/,
  /\b(cardapio|menu|carta)\b/,
  /\b(agendamento|agendar|marcacao|marcar|reserva|reservar|booking|appointment|cita)\b/,
  /\b(horario de atendimento|horario de funcionamento|opening hours|business hours|horario de atencion)\b/,
  /\b(ifood|anota\.ai|booksy|delivery)\b/,
  /\b(catalogo|catalogue|catalog)\b/,
  /\b(loja fisica|tienda fisica|endereco|address|direccion|localizados?|ubicados?)\b/,
  /\b(cores e tamanhos|cor e tamanho|pecas prontas|disponibilidade|sizes? and colou?rs?|colores y tallas)\b/,
  /\b(banho e tosa|vacinacao|consultas veterinarias|penteados?|maquiagem|haircuts?|grooming|vacunacion)\b/,
];

function pareceMensagemAutomaticaDeBot(texto) {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return false;
  const adicional = detectarPadraoAdicional(normalizado);
  if (adicional !== null) return adicional;
  if (PADROES_BOT_FORTES.some(padrao => padrao.test(normalizado))) return true;

  const quantidadeSinais = GRUPOS_SINAIS_BOT
    .filter(padrao => padrao.test(normalizado))
    .length;
  const quantidadeOpcoesNumeradas = (
    normalizado.match(/(?:^|\s)[1-9]\s*[-.):]/g) || []
  ).length;
  const quantidadeOpcoesEmoji = (String(texto || '').match(/[1-9]\uFE0F?\u20E3/g) || []).length;
  const temLink = /https?:\/\/|\bwa\.me\//.test(normalizado);
  const temEstruturaAutomatica = temLink
    || Math.max(quantidadeOpcoesNumeradas, quantidadeOpcoesEmoji) >= 2
    || normalizado.length >= 220;

  return temEstruturaAutomatica && quantidadeSinais >= 2;
}


module.exports={pareceMensagemAutomaticaDeBot};
