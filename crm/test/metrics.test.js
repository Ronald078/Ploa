'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {dayKey,periodWindow,financialWindows,responseMetric,createSheetMetrics}=require('../lib/metrics');
const {analyzeCopies}=require('../lib/sales-analysis');
const {temporaryRoot}=require('./fixture-helpers');
test('datas financeiras respeitam São Paulo e preservam datas sem horário',()=>{
  assert.equal(dayKey('2026-10-24T01:00:00Z'),'2026-10-23');assert.equal(dayKey('2026-10-24'),'2026-10-24');assert.equal(dayKey(null),null);assert.equal(dayKey('2026-02-30'),null);
  assert.equal(periodWindow(30,Date.parse('2026-10-24T15:00:00Z')).start,'2026-09-25');
});
test('período e moeda separam recebimentos, clientes distintos e estimativas',()=>{
  const records={a:{payments:[{at:'2026-10-24',amount:100,currency:'BRL',confirmed:true},{at:'2026-10-23',amount:50,currency:'BRL',confirmed:true},{at:'2026-08-01',amount:500,currency:'BRL',confirmed:true},{at:'2026-10-23',amount:900,currency:'BRL',confirmed:false}]},b:{payments:[{at:'2026-10-24',amount:200,currency:'EUR',confirmed:true},{at:'2026-10-25',amount:1000,currency:'BRL',confirmed:true}]}};
  const windows=financialWindows(records,[{moeda:'BRL',status:'proposta',valor_estimado:900,valor_contratado:1000,valor_a_receber:350}],Date.parse('2026-10-24T15:00:00Z'));
  assert.equal(windows[30].currencies.BRL.received,150);assert.equal(windows[30].currencies.BRL.customersWithPayment,1);assert.equal(windows[30].currencies.BRL.averageReceived,150);
  assert.equal(windows[0].currencies.BRL.received,650);assert.equal(windows[30].currencies.EUR.received,200);assert.equal(windows[30].currencies.BRL.pipelineNow,900);
});
test('taxas expõem bases diferentes sem misturar histórico e abordagens identificadas',()=>{
  const metric=responseMetric([{id:'a',respostas_recebidas:1,status:'respondeu'},{id:'b',respostas_recebidas:1,status:'automatico'},{id:'c',respostas_recebidas:0,status:'novo'},{id:'lid',vinculo_pendente:true,respostas_recebidas:2,status:'respondeu'}]);
  assert.equal(metric.numerator,2);assert.equal(metric.denominator,3);assert.equal(metric.value,66.7);assert.equal(metric.automaticCount,1);
  const analysis=analyzeCopies([{contact:'a',kind:'copy',copyId:'one',at:'2026-10-24T12:00:00Z'},{contact:'a',direction:'in',actor:'contact',text:'Pode explicar.',at:'2026-10-24T12:01:00Z'}],{});
  assert.equal(analysis.cohort.sent,1);assert.equal(analysis.cohort.responseRate,100);assert.ok(analysis.cohort.from);
});
test('planilha ausente retorna ausência de medição; leitura válida usa cache',async t=>{
  const root=temporaryRoot(t);let calls=0;const read=createSheetMetrics(root,{readWorkbook:async()=>{calls++;return 12;}});
  t.after(()=>read.close());
  assert.equal((await read()).value,null);fs.writeFileSync(path.join(root,'contatos.xlsx'),'fixture');assert.equal((await read()).value,null);await read.waitForCount();assert.equal((await read()).value,12);assert.equal((await read()).value,12);assert.equal(calls,1);
});
