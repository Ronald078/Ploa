'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {supabaseTemplates,codeEmail}=require('../cloud/email-template');
test('cadastro e recuperação preservam ConfirmationURL sem código fictício, imagem local ou prazo inventado',()=>{
  const templates=supabaseTemplates();
  for(const html of Object.values(templates)){
    assert.ok(html.includes('href="{{ .ConfirmationURL }}"'));
    assert.ok(html.includes('lang="pt-BR"'));
    assert.doesNotMatch(html,/654189|123456|5 minutos|<script|<img|127\.0\.0\.1|cid:/);
  }
  assert.ok(templates.recovery.includes('mesmo navegador'));
  assert.ok(templates.confirmation.includes('Depois de confirmar, entre'));
});
test('código inclui a mesma sequência exata em HTML/texto, sem depender de imagens',()=>{
  const message=codeEmail('012345');
  assert.ok(message.html.includes('012345'));
  assert.ok(message.text.includes('012345'));
  assert.ok(message.html.includes('5 minutos'));
  assert.doesNotMatch(message.html,/\{\{|<img|cid:/);
  assert.equal(message.attachments,undefined);
  for(const invalid of ['<img>','12345','1234567',123456,'１２３４５６'])assert.throws(()=>codeEmail(invalid),{code:'email'});
});
