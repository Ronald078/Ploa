'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {countSheet}=require('./sheet-count');
const {readSmallJson}=require('./json-files');
const {confirmedPayments}=require('./commercial-records');
const ZONE='America/Sao_Paulo';
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const dayKey=value=>{if(value==null||value==='')return null;const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return date.toISOString().slice(0,10)===value?value:null;
  return clock.format(date);};
const round=value=>Math.round((Number(value)||0)*100)/100;
function periodWindow(days=30,now=Date.now()){
  const end=dayKey(now);
  const start=days?new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10):null;
  return{days,start,end,timeZone:ZONE,label:days?`Últimos ${days} dias`:'Todo o histórico'};
}
function financialWindows(records,leads,now=Date.now()){
  const result={};
  for(const days of [0,30,90,365]){
    const period=periodWindow(days,now);result[days]={period,currencies:{}};
    for(const currency of ['BRL','EUR','USD']){
      let received=0;const customers=new Set();
      for(const [contact,record]of Object.entries(records||{}))for(const payment of confirmedPayments(record)){
        const day=dayKey(payment.at);
        if(payment.confirmed===true&&payment.currency===currency&&day&&day<=period.end&&(!period.start||day>=period.start)&&Number(payment.amount)>0){received+=Number(payment.amount);customers.add(contact);}
      }
      const matching=leads.filter(lead=>lead.moeda===currency&&!lead.vinculo_pendente);
      result[days].currencies[currency]={received:round(received),customersWithPayment:customers.size,averageReceived:round(customers.size?received/customers.size:0),
        pipelineNow:round(matching.filter(lead=>['qualificado','proposta','negociacao'].includes(lead.status)).reduce((sum,lead)=>sum+Number(lead.valor_estimado||0),0)),
        contractedHistory:round(matching.reduce((sum,lead)=>sum+Number(lead.valor_contratado||0),0)),outstandingNow:round(matching.reduce((sum,lead)=>sum+Number(lead.valor_a_receber||0),0))};
    }
  }
  return result;
}
function responseMetric(leads,now=Date.now()){
  const linked=leads.filter(lead=>!lead.vinculo_pendente);
  const numerator=linked.filter(lead=>lead.respostas_recebidas>0).length;
  const automaticCount=linked.filter(lead=>lead.respostas_recebidas>0&&lead.status==='automatico').length;
  const withoutText=linked.filter(lead=>lead.respostas_recebidas>0&&lead.status!=='automatico'&&!String(lead.ultima_mensagem||'').trim()).length;
  const dates=linked.map(lead=>lead.primeiro_contato).filter(value=>Number.isFinite(Date.parse(value))).sort();
  return{value:linked.length?Math.round(numerator/linked.length*1000)/10:0,numerator,denominator:linked.length,unit:'contatos acompanhados',
    automaticCount,withoutText,scope:'Respostas registradas no histórico, incluindo atendimentos automáticos',source:'Histórico de conversas e contatos vinculados',from:dates[0]||null,to:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
}
function createSheetMetrics(root,{readWorkbook=countSheet,retryDelayMs=30000}={}){
  const file=path.join(root,'contatos.xlsx'),sidecar=file+'.metrics.json';
  let cached=null,signature='',inFlight=null,retryAt=0,failedSignature='';
  const controller=new AbortController();
  const key=stat=>String(stat.size)+':'+String(stat.mtimeNs);
  const metric=(rows,stat)=>({value:rows,unit:'linhas da planilha',source:'contatos.xlsx',updatedAt:new Date(Number(stat.mtimeMs)).toISOString(),available:true});
  async function persist(record){
    const temp=sidecar+'.'+randomUUID()+'.tmp';
    try{await fs.promises.writeFile(temp,JSON.stringify(record),{mode:0o600,flag:'wx'});await fs.promises.rename(temp,sidecar);}
    catch{await fs.promises.unlink(temp).catch(()=>{});}
  }
  const read=async()=>{
    try{
      const stat=await fs.promises.stat(file,{bigint:true}),next=key(stat);
      if(next===signature&&cached)return cached;
      const saved=await readSmallJson(sidecar,4096);
      if(saved.version===1&&Number.isSafeInteger(saved.rows)&&saved.rows>=0&&saved.size===String(stat.size)&&saved.mtimeNs===String(stat.mtimeNs)){
        cached=metric(saved.rows,stat);signature=next;return cached;
      }
      if(!inFlight&&!controller.signal.aborted&&(next!==failedSignature||Date.now()>=retryAt)){
        // Recount is isolated; HTTP callers never wait for a large worksheet.
        inFlight=(async()=>{
          const result=await readWorkbook(file,{signal:controller.signal});
          const after=await fs.promises.stat(file,{bigint:true});
          if(key(after)!==next)return;
          const rows=typeof result==='number'?result:result.rows;
          if(!Number.isSafeInteger(rows)||rows<0)throw new Error('Contagem inválida');
          if(typeof result==='object'&&(result.size!==String(after.size)||result.mtimeNs!==String(after.mtimeNs)))return;
          cached=metric(rows,after);signature=next;
          await persist({version:1,rows,size:String(after.size),mtimeNs:String(after.mtimeNs)});
        })().catch(()=>{failedSignature=next;retryAt=Date.now()+retryDelayMs;}).finally(()=>{inFlight=null;});
      }
      return{value:null,unit:'linhas da planilha',source:'contatos.xlsx',updatedAt:null,available:false,counting:Boolean(inFlight),reason:'Contagem da planilha em andamento'};
    }catch(error){return{value:null,unit:'linhas da planilha',source:'contatos.xlsx',updatedAt:null,available:false,reason:error.code==='ENOENT'?'Planilha ainda não encontrada':'Planilha temporariamente indisponível'};}
  };
  read.waitForCount=()=>inFlight;
  read.close=()=>controller.abort();
  return read;
}
module.exports={dayKey,periodWindow,financialWindows,responseMetric,createSheetMetrics};
