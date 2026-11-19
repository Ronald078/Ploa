'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {formatScope}=require('../lib/scope-message');
const {scopeAction}=require('../lib/project-pricing');
const raw={serviceType:'site_system',work:'new',summary:'Catálogo com painel de gestão e pedidos pelo WhatsApp.',
  requirements:[{text:'Catálogo para exibir os produtos.',evidence:'Quero um catálogo'},
    {text:'Painel para atualizar a disponibilidade.',evidence:'atualizar a disponibilidade num painel'},
    {text:'Pedidos pelo WhatsApp.',evidence:'Pedidos pelo WhatsApp'}],
  drivers:[{dimension:'presentation',level:'basic',evidence:'Quero um catálogo'},
    {dimension:'contentManagement',level:'moderate',evidence:'atualizar a disponibilidade num painel'}],technicalReview:false};

test('confirmação apresenta todos os requisitos uma vez, sem repetir o resumo e sem alterar o diagnóstico',()=>{
  const original=JSON.stringify(raw);
  for(const language of ['pt-BR','pt-PT','en-US','es-ES']){
    const text=formatScope(raw,language);
    assert.ok(!text.includes(raw.summary));
    for(const item of raw.requirements)assert.equal(text.split(item.text).length-1,1);
    assert.equal((text.match(/\?/g)||[]).length,1);
    assert.ok(!/R\$|USD|EUR|\d/.test(text));
  }
  assert.equal(JSON.stringify(raw),original);
});

test('mudança de apresentação preserva evidências, complexidade e base do preço',()=>{
  const context={language:'pt-BR',history:[{role:'contato',text:'Quero um catálogo e atualizar a disponibilidade num painel. Pedidos pelo WhatsApp'}]};
  const br=scopeAction(raw,context),pt=scopeAction(raw,{...context,language:'pt-PT'});
  assert.equal(br.status,'ready');assert.equal(pt.status,'ready');
  assert.equal(br.scopeDraft.summary,raw.summary);
  assert.deepEqual(br.scopeDraft.requirements,raw.requirements);
  assert.deepEqual(br.scopeDraft.drivers,pt.scopeDraft.drivers);
  assert.equal(br.scopeDraft.basisHash,pt.scopeDraft.basisHash);
  assert.match(br.text,/Pelo que você contou/);
});
