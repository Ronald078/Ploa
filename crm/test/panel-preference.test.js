'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('destino lembrado só reaparece para a mesma conta e empresa ainda disponível',async()=>{
 const {preferredWorkspace,rememberWorkspace}=await import('../app-next/src/cloud/panel-preference.js');
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const spaces=[{id:'empresa-a'},{id:'empresa-b'}];
 assert.equal(preferredWorkspace(storage,'conta-a',spaces),null);
 rememberWorkspace(storage,'conta-a','empresa-a');
 assert.equal(preferredWorkspace(storage,'conta-a',spaces),'empresa-a');
 assert.equal(preferredWorkspace(storage,'conta-b',spaces),null);
 assert.equal(preferredWorkspace(storage,'conta-a',[spaces[1]]),null);
 rememberWorkspace(storage,'conta-a','empresa-b');
 assert.equal(preferredWorkspace(storage,'conta-a',spaces),'empresa-b');
});
test('navegador sem armazenamento mantém entrada manual disponível',async()=>{
 const {preferredWorkspace,rememberWorkspace}=await import('../app-next/src/cloud/panel-preference.js');
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 assert.equal(preferredWorkspace(storage,'conta',[{id:'empresa'}]),null);
 assert.doesNotThrow(()=>rememberWorkspace(storage,'conta','empresa'));
});
