'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {temporaryRoot}=require('./fixture-helpers');
const {createOperationsSnapshot}=require('../lib/operations-snapshot');
const {createSheetMetrics}=require('../lib/metrics');
const {readSmallJson}=require('../lib/json-files');

test('progresso usa telemetria pequena e nunca abre checkpoint com fontes',async t=>{
 const root=temporaryRoot(t),file=path.join(root,'progresso_busca.json');
 fs.writeFileSync(file,'{"never":"read"}');
 fs.writeFileSync(path.join(root,'andamento_busca.json'),JSON.stringify({cidades_concluidas_quantidade:0,total_cidades:39,cidades_faltantes:39}));
 const open=fs.promises.open;
 fs.promises.open=async function(name,...rest){if(name===file)throw new Error('checkpoint não pode ser aberto');return open.call(this,name,...rest);};
 t.after(()=>{fs.promises.open=open;});
 const data=await createOperationsSnapshot({PROJECT_ROOT:root,sheetMetrics:async()=>({value:10})})();
 assert.equal(data.search.completedCities,0);assert.equal(data.search.remainingCities,39);
});

test('fallback limita tamanho e aceita cabeçalho pequeno do progresso',async t=>{
 const root=temporaryRoot(t),file=path.join(root,'progresso_busca.json');
 const handle=fs.openSync(file,'w');fs.ftruncateSync(handle,2*1024*1024);fs.closeSync(handle);
 assert.deepEqual(await readSmallJson(file),{});
 const snapshot=createOperationsSnapshot({PROJECT_ROOT:root,sheetMetrics:async()=>({value:5})});
 assert.equal((await snapshot()).search.completedCities,0);
 fs.writeFileSync(file,JSON.stringify({cidades_concluidas:['A','B']}));
 assert.equal((await snapshot()).search.completedCities,2);
});

test('contagem lenta não bloqueia API e várias leituras compartilham uma tarefa',async t=>{
 const root=temporaryRoot(t),file=path.join(root,'contatos.xlsx');fs.writeFileSync(file,'fixture');
 let finish,calls=0;const pending=new Promise(resolve=>{finish=resolve;});
 const read=createSheetMetrics(root,{readWorkbook:()=>{calls++;return pending;}});t.after(()=>read.close());
 const values=await Promise.race([Promise.all(Array.from({length:10},()=>read())),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Leitura bloqueou API')),500))]);
 assert.ok(values.every(value=>value.value===null));assert.equal(calls,1);
 finish(12);await read.waitForCount();assert.equal((await read()).value,12);
});

test('contador validado evita reabrir workbook; arquivo alterado não usa valor antigo',async t=>{
 const root=temporaryRoot(t),file=path.join(root,'contatos.xlsx');fs.writeFileSync(file,'fixture');
 const stat=fs.statSync(file,{bigint:true});
 fs.writeFileSync(file+'.metrics.json',JSON.stringify({version:1,rows:123,size:String(stat.size),mtimeNs:String(stat.mtimeNs)}));
 let calls=0;const read=createSheetMetrics(root,{readWorkbook:async()=>{calls++;return 124;}});t.after(()=>read.close());
 assert.equal((await read()).value,123);assert.equal(calls,0);
 fs.appendFileSync(file,'changed');assert.equal((await read()).value,null);
 await read.waitForCount();assert.equal((await read()).value,124);assert.equal(calls,1);
});

test('mudança durante recontagem descarta o resultado e falha tem espera limitada',async t=>{
 const root=temporaryRoot(t),file=path.join(root,'contatos.xlsx');fs.writeFileSync(file,'fixture');
 let finish;const read=createSheetMetrics(root,{readWorkbook:()=>new Promise(resolve=>{finish=resolve;})});t.after(()=>read.close());
 await read();fs.appendFileSync(file,'changed');finish(99);await read.waitForCount();
 assert.equal((await read()).value,null);finish(100);await read.waitForCount();assert.equal((await read()).value,100);
 let calls=0;const broken=createSheetMetrics(root,{readWorkbook:async()=>{calls++;throw new Error('failed');}});t.after(()=>broken.close());
 fs.appendFileSync(file,'again');await broken();await broken.waitForCount();await broken();assert.equal(calls,1);
});
