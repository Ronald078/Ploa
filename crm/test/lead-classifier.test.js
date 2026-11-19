'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyLeadResponse, detectLanguage } = require('../lib/lead-classifier');

function classify(texto, numero = '5511999999999') {
  return classifyLeadResponse({
    number: numero,
    responses: [{ texto, data: '2026-10-23T12:00:00.000Z' }],
  });
}

test('classifica interesse e pedido de proposta sem avançar antes do envio', () => {
  const interesse = classify('Tenho interesse. Pode me explicar como funciona?');
  const proposta = classify('Pode me enviar uma proposta?');

  assert.equal(interesse.status, 'qualificado');
  assert.equal(interesse.intent, 'interest');
  assert.equal(interesse.needsReview, false);
  assert.equal(proposta.status, 'qualificado');
  assert.equal(proposta.intent, 'proposal_request');
  assert.equal(proposta.nextAction, 'Preparar e enviar proposta');
});

test('distingue proposta recebida, negociação e aceite que precisa de contexto', () => {
  assert.equal(classify('Recebi a proposta e vou analisar.').status, 'proposta');
  assert.equal(classify('Consegue dar algum desconto?').status, 'negociacao');
  const aceite=classify('Aceito a proposta, podemos fechar.');
  assert.equal(aceite.status,'qualificado');assert.equal(aceite.suggestedStatus,'ganho');assert.equal(aceite.needsReview,true);
});

test('classifica recusa e respeita pedido explícito de interrupção', () => {
  const recusa = classify('Não tenho interesse, obrigado.');
  const bloqueio = classify('Não me envie mais mensagens.');

  assert.equal(recusa.status, 'perdido');
  assert.equal(recusa.needsReview, false);
  assert.equal(bloqueio.status, 'nao_contatar');
  assert.equal(bloqueio.suggestedStatus, 'nao_contatar');
  assert.equal(bloqueio.needsReview, false);
});

test('pedido para não receber mensagens prevalece sobre recusa comercial nos quatro idiomas',()=>{
 for(const [text,number]of [['Não tenho interesse. Não quero receber mais mensagens.','5511999999999'],['Não desejo receber mais contactos.','351912345678'],["I'm not interested. I don't want to receive any more messages.",'12025550123'],['No me interesa. No quiero recibir más mensajes.','34600000001']]){
  const result=classify(text,number);assert.equal(result.status,'nao_contatar',text);assert.equal(result.intent,'opt_out');assert.equal(result.needsReview,false);
 }
 assert.notEqual(classify('Não quero parar de receber as informações.').intent,'opt_out');
});

test('envia mensagens ambíguas para revisão humana', () => {
  const resultado = classify('Certo, vou ver aqui.');

  assert.equal(resultado.status, 'respondeu');
  assert.equal(resultado.intent, 'human_review');
  assert.equal(resultado.confidence, null);
  assert.equal(resultado.needsReview, true);
});

test('reconhece idioma pelo país e classifica inglês e espanhol', () => {
  const ingles = classify('I am interested. Tell me more.', '12025550123');
  const espanhol = classify('¿Puedes enviar una propuesta?', '34915550123');

  assert.equal(ingles.language, 'en-US');
  assert.equal(ingles.status, 'qualificado');
  assert.equal(espanhol.language, 'es-ES');
  assert.equal(espanhol.status, 'qualificado');
  assert.equal(detectLanguage('gostaria de receber um orcamento', '351912345678'), 'pt-PT');
});

test('ignora respostas vazias e preserva a data da mensagem classificada', () => {
  assert.equal(classifyLeadResponse({ responses: [{ texto: '   ' }] }), null);

  const resultado = classify('Quanto custa?');
  assert.equal(resultado.messageAt, '2026-10-23T12:00:00.000Z');
});
