'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { idiomaRespostaAutomatica: idioma } = require('../lib/automatic-reply-language');
const { pareceMensagemAutomaticaDeBot } = require('../lib/bot-detector');
const copys = require('../../copys_respostas_automaticas.json');

for (const [numero, esperado] of [['5511999990000', 'pt-BR'], ['351211111111','pt-PT'], ['12125550000','en-US'], ['34911111111','es-ES']]) {
  test(`texto ambíguo conserva país ${esperado}`, () => assert.equal(idioma('OK', numero), esperado));
}
test('espanhol em número dos EUA recebe espanhol; inglês em Portugal recebe inglês', () => {
  assert.equal(idioma('Gracias por tu mensaje. En este momento no podemos responder.', '12125550000'), 'es-ES');
  assert.equal(idioma('Thank you for contacting us. We are currently unavailable.', '351211111111'), 'en-US');
  assert.equal(idioma('Obrigado por nos contactar! Estamos à sua disposição.', '12125550000'), 'pt-PT');
});
test('português mantém a variante de Portugal; empate usa o país', () => {
  assert.equal(idioma('Obrigado pela mensagem, entraremos em contacto.', '351211111111'), 'pt-PT');
  assert.equal(idioma('Obrigado por contactar. Thank you for contacting.', '351211111111'), 'pt-PT');
  assert.equal(idioma('OK', '123456789012345@lid'), 'pt-BR');
  assert.equal(idioma('OK', '123456789012345@lid', 'es-ES'), 'es-ES');
});
test('recusa curta e menu explícito têm idioma reconhecido sem depender do país', () => {
  assert.equal(idioma('No gracias', '12125550000'), 'es-ES');
  assert.equal(idioma('No thanks', '5511999990000'), 'en-US');
  assert.equal(idioma('Não tenho interesse', '12125550000'), 'pt-BR');
  assert.equal(idioma('Pulse 1 para citas', '12125550000'), 'es-ES');
  assert.equal(idioma('Press 1 for bookings', '351211111111'), 'en-US');
  assert.equal(idioma('Digite 1 para pedidos', '12125550000'), 'pt-BR');
});
test('duas categorias possuem variantes válidas nos quatro idiomas, sem agradecimento na de bot', () => {
  for (const [categoria, config] of Object.entries(copys.categorias)) for (const locale of ['pt-BR','pt-PT','en-US','es-ES']) {
    assert.ok(config.porIdioma[locale].length > 0, `${categoria}/${locale}`);
    assert.equal(new Set(config.porIdioma[locale]).size, config.porIdioma[locale].length);
    if (categoria === 'bot-atendimento') {
      assert.equal(config.porIdioma[locale].length, 5);
      for (const copy of config.porIdioma[locale]) {
        assert.match(copy, /Ronald/); assert.match(copy, /\?/);
        assert.doesNotMatch(copy, /obrigad|agradec|thank you|thanks|gracias/i);
      }
    }
  }
});
test('integração mantém recusa antes do detector e escolhe só uma resposta localizada', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../enviar_mensagens_whatsapp.js'), 'utf8');
  const definitions = source.slice(source.indexOf('const CATEGORIAS_RESPOSTA_AUTOMATICA_PADRAO ='), source.indexOf('function carregarCopysRespostasAutomaticas('));
  const selector = source.slice(source.indexOf('function identificarCategoriaDaResposta('), source.indexOf('// --- Limite diário'));
  const ctx = { pareceMensagemAutomaticaDeBot, normalizarTexto: text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase() };
  vm.createContext(ctx);
  vm.runInContext(definitions + '\nconst CATEGORIAS_RESPOSTA_AUTOMATICA = CATEGORIAS_RESPOSTA_AUTOMATICA_PADRAO;\n' + selector + '\nglobalThis.classify = identificarCategoriaDaResposta;', ctx);
  assert.equal(ctx.classify('Resposta automática. Não tenho interesse.').nome, 'agradecimento');
  assert.equal(ctx.classify('Automated reply. Please do not contact us.').nome, 'agradecimento');
  assert.equal(ctx.classify('Respuesta automática. No nos interesa.').nome, 'agradecimento');
  assert.equal(ctx.classify('Mensagem automática. Não nos contacte.').nome, 'agradecimento');
  assert.equal(ctx.classify('Thank you for contacting Example Shop! Please let us know how we can help you.').nome, 'bot-atendimento');
  assert.match(source, /idiomaDaRespostaAutomatica\(numero, texto\)/);
  assert.match(source, /const textoResposta = sortearRespostaAutomatica\(/);
});

test('sorteio devolve uma única copy de cada idioma, não as cinco juntas', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../enviar_mensagens_whatsapp.js'), 'utf8');
  const helpers = source.slice(source.indexOf('const FILAS_RESPOSTAS_AUTOMATICAS ='), source.indexOf('validarCategoriasRespostasAutomaticas(CATEGORIAS_RESPOSTA_AUTOMATICA,'));
  const ctx = vm.createContext({});
  vm.runInContext(helpers + '\nglobalThis.draw = sortearRespostaAutomatica;', ctx);
  const categoria = { nome: 'bot-atendimento', respostasPorIdioma: copys.categorias['bot-atendimento'].porIdioma };
  for (const locale of ['pt-BR','pt-PT','en-US','es-ES']) {
    const drawn = Array.from({ length: 5 }, () => ctx.draw(categoria, {}, locale));
    assert.equal(new Set(drawn).size, 5);
    for (const copy of drawn) assert.equal(categoria.respostasPorIdioma[locale].includes(copy), true);
  }
});

test('duas mensagens automáticas simultâneas reservam só uma resposta, inclusive por alias', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../enviar_mensagens_whatsapp.js'), 'utf8');
  const helpers = source.slice(source.indexOf('function chaveRespostaAutomaticaUnica('), source.indexOf('function carregarRespostasAutomaticasUnicas('));
  const ctx = vm.createContext({});
  vm.runInContext(helpers + '\nglobalThis.reserve = reservarRespostaAutomatica;globalThis.key = chaveRespostaAutomaticaUnica;', ctx);
  const keys = ['5511999990000', '109876543210000@lid'].map(number => ctx.key('bot-atendimento', number));
  const reservations = new Set(); let sends = 0;
  const reply = async aliases => { if (!ctx.reserve(reservations, aliases)) return; await Promise.resolve(); sends++; };
  await Promise.all([reply(keys), reply(keys), reply([keys[1]])]);
  assert.equal(sends, 1);
  const restored = new Set([...reservations]);
  assert.equal(ctx.reserve(restored, keys), false);
});
