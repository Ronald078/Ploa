'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pareceMensagemAutomaticaDeBot:detect}=require('../lib/bot-detector');
const { normalizarTextoBot } = require('../lib/bot-patterns');
const { automaticos, humanos } = require('./fixtures/bot-cases');
test('boas-vindas e ajuda isoladas não comprovam atendimento automático',()=>{
 for(const text of ['Boa noite, bem vindo a hostinger.','Seja bem-vindo! Como posso ajudar?',
  'Obrigado por nos contactar. Sou a Ana, em que posso ajudar?',
  'Welcome to our shop! How can I help?','Bienvenido. ¿Cómo puedo ayudarte?',
  'Thank you for contacting us. How can we help?','Gracias por contactar. ¿Qué necesitas?'])assert.equal(detect(text),false,text);
});
test('avisos explícitos e menus continuam identificados nos idiomas atendidos',()=>{
 for(const text of ['Esta é uma resposta automática.','Digite 1 para vendas e 2 para suporte.',
  'We are currently unavailable.','Select option 1 for sales.','Soy un asistente virtual.',
  'Selecciona la opción 1.','Estamos fora do horário de atendimento.'])assert.equal(detect(text),true,text);
});
test('boas-vindas com estrutura comercial automática continuam detectadas',()=>{
 assert.equal(detect('Seja bem-vindo! Veja nosso cardápio e faça o pedido em https://example.com'),true);
 assert.equal(detect('Welcome to our restaurant! Menu and booking: https://example.com'),true);
 assert.equal(detect('Bienvenido. Consulta el menú y la carta para reservar: https://example.com'),true);
});

for (const [situacao, idiomas] of Object.entries(automaticos)) {
  for (const [idioma, texto] of Object.entries(idiomas)) test(`${idioma}: ${situacao}`, () => assert.equal(detect(texto), true));
}
for (const [index, texto] of humanos.entries()) test(`preserva resposta humana ou ambígua ${index + 1}`, () => assert.equal(detect(texto), false));

test('normaliza alfabeto estilizado, aspas, marcação e caracteres invisíveis', () => {
  assert.equal(detect('𝑵𝒂̃𝒐 𝒆𝒔𝒕𝒂𝒎𝒐𝒔 𝒂𝒃𝒆𝒓𝒕𝒐𝒔 𝒂𝒈𝒐𝒓𝒂.'), true);
  assert.equal(detect('*Nosso horário de atendimento* é:\n\u200eSegunda: 09h às 18h'), true);
  assert.equal(detect('Thank you for your message. We\u2019re unavailable.'), true);
  assert.equal(normalizarTextoBot('\u200e*Opção*\u00a01️⃣\n2️⃣'), 'opcao 1\n2');
});

test('um único emoji numérico não vira duas opções de menu', () => {
  assert.equal(detect('Bem-vindo! 1️⃣ - Reserva'), false);
});

test('a resposta de loja física com catálogo e tamanhos é reconhecida', () => {
  assert.equal(detect('Seja bem-vindo. Somos loja física e não fazemos entrega. Estamos localizados no endereço informado no perfil. Dê um print no modelo desejado que informamos cores e tamanhos disponíveis. Não estamos atendendo encomendas, somente as peças prontas na loja.'), true);
});
