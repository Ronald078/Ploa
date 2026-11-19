'use strict';

const {randomUUID}=require('node:crypto');
const CURRENCIES=new Set(['BRL','EUR','USD']);
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=(value,maximum)=>String(value??'').trim().slice(0,maximum);
const roundMoney=value=>Math.round((Number(value)||0)*100)/100;

function moneyAmount(value){
 const amount=Number(value),cents=Math.round(amount*100);
 if(!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(cents)||cents<=0||Math.abs(cents/100-amount)>1e-8){
  throw fail('Informe um valor positivo com no máximo duas casas decimais.');
 }
 return cents/100;
}

function requestId(value){
 if(value===undefined)return '';
 if(typeof value!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(value))throw fail('Identificador da confirmação inválido.');
 return value;
}

function existingRequest(rows,id,fields){
 if(!id)return null;
 const existing=rows.find(row=>row.requestId===id);
 if(!existing)return null;
 if(Object.entries(fields).some(([key,value])=>existing[key]!==value)){
  throw fail('Esta confirmação já foi registrada com outros dados. Confira o registro antes de tentar novamente.',409);
 }
 return existing;
}

function addProposal(record,body,now=new Date().toISOString()){
 if(!CURRENCIES.has(body.currency))throw fail('Informe valor e moeda válidos.');
 const fields={amount:moneyAmount(body.amount),currency:body.currency,title:text(body.title,160)||'Proposta de website',scope:text(body.scope,5000),terms:text(body.terms,3000)};
 const id=requestId(body.requestId),existing=existingRequest(record.proposals,id,fields);
 if(existing)return{reused:true,value:existing};
 const value={id:randomUUID(),version:record.proposals.length+1,...fields,status:'draft',createdAt:now,...(id?{requestId:id}:{})};
 record.proposals.push(value);return{reused:false,value};
}

function addPayment(record,body,now=new Date().toISOString()){
 if(body.confirmed!==true)throw fail('Confirme que verificou o recebimento.');
 if(!CURRENCIES.has(body.currency))throw fail('Informe valor e moeda válidos.');
 const fields={amount:moneyAmount(body.amount),currency:body.currency,description:text(body.description,500)};
 const id=requestId(body.requestId),existing=existingRequest(record.payments,id,fields);
 if(existing)return{reused:true,value:existing};
 const value={id:randomUUID(),...fields,confirmed:true,at:now,confirmedBy:'Ronald',...(id?{requestId:id}:{})};
 record.payments.push(value);return{reused:false,value};
}

function confirmedPayments(record){
 const rows=[],ids=new Set(),requests=new Set();
 for(const payment of record?.payments||[]){
  if(!payment||payment.confirmed!==true||!CURRENCIES.has(payment.currency))continue;
  let amount;try{amount=moneyAmount(payment.amount);}catch{continue;}
  if(payment.id&&ids.has(payment.id)||payment.requestId&&requests.has(payment.requestId))continue;
  if(payment.id)ids.add(payment.id);if(payment.requestId)requests.add(payment.requestId);
  rows.push({...payment,amount});
 }
 return rows;
}

module.exports={addProposal,addPayment,confirmedPayments,roundMoney};
