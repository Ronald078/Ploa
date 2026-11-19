'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {panelRedirect}=require('../lib/panel-navigation');
const route=path=>panelRedirect(new URL(path,'http://127.0.0.1:4310'));
test('entrada padrão é React e atalhos antigos das páginas migradas apontam para React',()=>{
 assert.equal(route('/'),null);assert.equal(route('/index.html'),null);
 assert.equal(route('/?view=overview'),'/app-next/dashboard');
 assert.equal(route('/?view=leads&attention=retornos'),'/app-next/leads?attention=retornos');
 assert.equal(route('/operacao?view=funnel'),'/app-next/funnel');
 assert.equal(route('/api/dashboard'),null);assert.equal(route('/app-next/leads'),null);
});
test('páginas ainda não migradas usam operação sem expor uma segunda versão das migradas',()=>{
 for(const view of ['ads']){
  assert.equal(route('/?view='+view),'/operacao?view='+view);
  assert.equal(route('/operacao?view='+view),null);
 }
 for(const view of ['search','messages','ai','copies']){
  assert.equal(route('/?view='+view),'/app-next/'+view);
  assert.equal(route('/operacao?view='+view),'/app-next/'+view);
 }
 assert.equal(route('/operacao'),'/app-next/messages');
 assert.equal(route('/operacao?view=invalid'),'/app-next/messages');
 assert.equal(route('/?view=https://evil.test'),'/app-next/dashboard');
});
