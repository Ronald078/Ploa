'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeCopies}=require('../lib/sales-analysis');

const at=hour=>'2026-10-24T'+hour+':00:00Z';
const copy=(hour,id='one',extra={})=>({contact:'a',direction:'out',actor:'script',kind:'copy',copyId:id,country:'BR',category:'Restaurante',at:at(hour),...extra});
const reply=hour=>({contact:'a',direction:'in',actor:'contact',text:'Pode explicar.',at:at(hour)});

test('repetição do mesmo registro de copy não perde a resposta nem os resultados',()=>{
 const initial=copy('12','one',{messageId:'sent-1'});
 const records={a:{proposals:[{sentAt:at('14'),acceptedAt:at('15')}],payments:[{id:'p1',confirmed:true,currency:'BRL',amount:100,at:at('16')}]}};
 const result=analyzeCopies([initial,{...initial},reply('13')],records);
 assert.equal(result.cohort.sent,1);assert.equal(result.cohort.humanResponses,1);assert.equal(result.cohort.proposals,1);assert.equal(result.cohort.clients,1);assert.equal(result.copies[0].received.BRL,100);
});

test('nova abordagem da mesma variação mantém um contato e considera a resposta posterior',()=>{
 const result=analyzeCopies([copy('12','one',{messageId:'first'}),copy('13','one',{messageId:'second'}),reply('14')],{});
 assert.equal(result.cohort.sent,1);assert.equal(result.cohort.humanResponses,1);assert.equal(result.cohort.responseRate,100);assert.equal(result.cohort.medianResponseHours,1);
});

test('resultados são associados à última abordagem anterior, sem dobrar os pagamentos',()=>{
 const records={a:{proposals:[{sentAt:at('15'),acceptedAt:at('16')}],payments:[{id:'p1',confirmed:true,currency:'BRL',amount:100,at:at('17')}]}};
 const result=analyzeCopies([copy('12'),copy('14','two'),reply('15')],records);
 const one=result.copies.find(row=>row.id==='one'),two=result.copies.find(row=>row.id==='two');
 assert.equal(one.humanResponses,0);assert.deepEqual(one.received,{});assert.equal(two.humanResponses,1);assert.equal(two.received.BRL,100);assert.equal(result.cohort.clients,1);
});

test('bot, espaços, confirmação textual falsa e valores inválidos não viram resultados',()=>{
 const records={a:{payments:[{confirmed:'false',amount:90,currency:'BRL',at:at('15')},{confirmed:true,amount:-5,currency:'BRL',at:at('15')},{confirmed:true,amount:'inválido',currency:'BRL',at:at('15')},{confirmed:true,amount:30,currency:'XYZ',at:at('15')},{confirmed:true,amount:'100.10',currency:'EUR',at:at('15')},{confirmed:true,amount:0.2,currency:'EUR',at:at('15')}]}};
 const result=analyzeCopies([copy('12'),{...reply('13'),actor:'bot'},{...reply('14'),text:'   '}],records);
 assert.equal(result.cohort.humanResponses,0);assert.deepEqual(result.copies[0].received,{EUR:100.3});
});

test('entrada e saldo são separados; a repetição do mesmo ID não duplica recebimento',()=>{
 const payment={id:'entry',confirmed:true,amount:100,currency:'BRL',at:at('15')};
 const result=analyzeCopies([copy('12')],{a:{payments:[payment,{...payment},{...payment,id:'balance',at:at('16')}]}});
 assert.equal(result.copies[0].received.BRL,200);
});

test('registro futuro não entra no relatório emitido antes de acontecer',()=>{
 const result=analyzeCopies([copy('12'),reply('15'),copy('17','two')],{a:{payments:[{id:'future',amount:100,currency:'BRL',confirmed:true,at:at('16')}] }},{now:Date.parse(at('14'))});
 assert.equal(result.cohort.sent,1);assert.equal(result.cohort.humanResponses,0);assert.deepEqual(result.copies[0].received,{});assert.equal(result.cohort.updatedAt,new Date(at('14')).toISOString());
});
