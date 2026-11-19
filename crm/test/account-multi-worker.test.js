'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createAccountData}=require('../lib/account-data');
const {createLocalRuntimes}=require('../cloud/local-runtimes');
const {readOperationSettings,writeOperationSettings}=require('../lib/operation-settings');
const {readCopySettings,writeCopySettings}=require('../lib/copy-settings');
const {temporaryRoot}=require('./fixture-helpers');
test('duas empresas em servidores reais mantêm configurações próprias sem iniciar scripts',async t=>{
 const codeRoot=path.resolve(__dirname,'../..'),registry=createAccountData({directory:temporaryRoot(t),codeRoot});
 const a=registry.resolve({id:'11111111-1111-4111-8111-111111111111'},{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'owner',name:'Empresa A fictícia'});
 const b=registry.resolve({id:'22222222-2222-4222-8222-222222222222'},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'owner',name:'Empresa B fictícia'});
 const settings=await readOperationSettings(a.root);settings.messages.dailyLimit=17;await writeOperationSettings(a.root,settings);
 const copies=await readCopySettings(a.root);copies.firstContact.Brasil.genericas=['Copy exclusiva da empresa A fictícia'];await writeCopySettings(a.root,copies);
 const pool=createLocalRuntimes({codeRoot,origin:'http://127.0.0.1:4313'});const latencies=[];
 try{
  const ar=await pool.get(a,{cookie:'fixture-a'}),br=await pool.get(b,{cookie:'fixture-b'});
  async function get(worker,route){const start=performance.now(),response=await fetch('http://127.0.0.1:'+worker.port+route,{headers:{'x-ploa-local-token':worker.token}});assert.equal(response.status,200);const data=await response.json();latencies.push(performance.now()-start);return data;}
  const ac=await get(ar,'/api/copies'),bc=await get(br,'/api/copies');assert.match(JSON.stringify(ac),/Copy exclusiva/);assert.doesNotMatch(JSON.stringify(bc),/Copy exclusiva/);
  for(const worker of [ar,br]){
   const workspace=await get(worker,'/api/workspace');assert.equal(workspace.hasKey,false);assert.deepEqual(workspace.records,{});assert.equal(workspace.settings.enabled,false);
   for(let i=0;i<6;i++){for(const state of Object.values(await get(worker,'/api/processes')))assert.equal(state.running,false);}
   const wrong=await fetch('http://127.0.0.1:'+worker.port+'/api/workspace',{headers:{'x-ploa-local-token':worker===ar?br.token:ar.token}});assert.equal(wrong.status,403);
  }
  assert.equal((await readOperationSettings(a.root)).messages.dailyLimit,17);assert.equal((await readOperationSettings(b.root)).messages.dailyLimit,1);
  const sorted=latencies.toSorted((a,b)=>a-b);t.diagnostic(JSON.stringify({sample:'local isolated empty accounts',requests:sorted.length,medianMs:Math.round(sorted[Math.floor(sorted.length/2)]),p95Ms:Math.round(sorted[Math.floor(sorted.length*.95)])}));
 }finally{await pool.close();}
});
