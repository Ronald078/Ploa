'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('rascunhos só migram para o dono verificado e não aparecem em outra empresa',async()=>{
 const entries=new Map([['ploa-next-drafts-v1','dado anterior']]);
 const original=global.sessionStorage;
 global.sessionStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
 try{
  const {configureBrowserScope,scopedStorageKey}=await import('../app-next/src/browser-scope.js');
  configureBrowserScope('workspace:b');assert.equal(entries.get(scopedStorageKey('ploa-next-drafts-v1')),undefined);
  configureBrowserScope('workspace:a',{migrateLegacy:true});assert.equal(entries.get(scopedStorageKey('ploa-next-drafts-v1')),'dado anterior');assert.equal(entries.has('ploa-next-drafts-v1'),false);
  configureBrowserScope('workspace:b');assert.equal(entries.get(scopedStorageKey('ploa-next-drafts-v1')),undefined);
 }finally{global.sessionStorage=original;}
});
