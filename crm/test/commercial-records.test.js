'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {workspaceFixture}=require('./fixture-helpers');

const payment=(requestId='payment-1')=>({action:'payment',requestId,amount:100,currency:'BRL',description:'Entrada',confirmed:true});
const proposal=(requestId='proposal-1')=>({action:'proposal',requestId,amount:200,currency:'BRL',title:'Site',scope:'Apresentação e WhatsApp',terms:'50% de entrada e 50% na entrega'});

test('repetir a mesma confirmação de recebimento registra um único pagamento',async t=>{
 const f=workspaceFixture(t);await Promise.all([f.workspace.command(f.contact,payment()),f.workspace.command(f.contact,payment())]);
 assert.equal(f.workspace.read().records[f.contact].payments.length,1);
 const report=await f.workspace.reports();assert.equal(report.byCurrency.BRL,100);
});

test('mesmo identificador com valor alterado é recusado; outra parcela igual é permitida',async t=>{
 const f=workspaceFixture(t);await f.workspace.command(f.contact,payment());
 await assert.rejects(f.workspace.command(f.contact,{...payment(),amount:150}),error=>error.statusCode===409);
 await f.workspace.command(f.contact,{...payment('payment-2'),description:'Saldo'});
 assert.equal(f.workspace.read().records[f.contact].payments.length,2);assert.equal((await f.workspace.reports()).byCurrency.BRL,200);
});

test('repetir a criação de uma proposta não cria duas versões nem registra pagamento',async t=>{
 const f=workspaceFixture(t);await f.workspace.command(f.contact,proposal());await f.workspace.command(f.contact,proposal());
 const r=f.workspace.read().records[f.contact];assert.equal(r.proposals.length,1);assert.equal(r.proposals[0].status,'draft');assert.equal(r.payments.length,0);
 await assert.rejects(f.workspace.command(f.contact,{...proposal(),scope:'Outro projeto'}),error=>error.statusCode===409);
});

test('reconfirmar um aceite preserva a data original e não cria novo recebimento',async t=>{
 const f=workspaceFixture(t);await f.workspace.command(f.contact,proposal());const id=f.workspace.read().records[f.contact].proposals[0].id;
 await f.workspace.command(f.contact,{action:'proposal-status',proposalId:id,status:'accepted'});
 const original='2026-10-24T12:00:00.000Z';await f.workspace.mutate(data=>{data.records[f.contact].proposals[0].acceptedAt=original;});
 await f.workspace.command(f.contact,{action:'proposal-status',proposalId:id,status:'accepted'});
 const record=f.workspace.read().records[f.contact];assert.equal(record.proposals[0].acceptedAt,original);assert.equal(record.payments.length,0);
 assert.equal((await f.workspace.reports()).financialWindows[0].currencies.BRL.received,0);
});

test('registros antigos com valor numérico em texto não concatenam valores no relatório',async t=>{
 const f=workspaceFixture(t),at=new Date().toISOString();
 await f.workspace.mutate(data=>{data.records[f.contact]={payments:[{id:'one',amount:'100',currency:'BRL',confirmed:true,at},{id:'two',amount:50,currency:'BRL',confirmed:true,at},{id:'bad',amount:900,currency:'BRL',confirmed:'false',at}]};});
 const report=await f.workspace.reports();assert.equal(report.byCurrency.BRL,150);assert.equal(report.daily[0].received,150);assert.equal(report.financialWindows[0].currencies.BRL.received,150);
});

test('nova tentativa conclui a etapa após falha parcial sem duplicar pagamento',async t=>{
 const f=workspaceFixture(t),update=f.store.updateLead;let failOnce=true;
 f.store.updateLead=async(...args)=>{if(failOnce){failOnce=false;throw new Error('Falha de gravação simulada');}return update(...args);};
 await assert.rejects(f.workspace.command(f.contact,payment()),/simulada/);
 assert.equal(f.workspace.read().records[f.contact].payments.length,1);
 await f.workspace.command(f.contact,payment());
 assert.equal(f.workspace.read().records[f.contact].payments.length,1);
 assert.equal((await f.store.getDashboard()).leads[0].status,'ganho');
});

test('valor fracionado abaixo de centavo e pedido sem confirmação não registram pagamento',async t=>{
 const f=workspaceFixture(t);
 await assert.rejects(f.workspace.command(f.contact,{...payment(),amount:100.001}),/duas casas/);
 await assert.rejects(f.workspace.command(f.contact,{...payment(),confirmed:false}),/Confirme/);
 assert.equal(f.workspace.read().records[f.contact]?.payments?.length||0,0);
});
