'use strict';
const nativeFs=require('node:fs'),path=require('node:path');
const {validCounter}=require('./sender-persistence');
const FILE='registro_envios_diarios.jsonl';
function createDailySendLedger({root,fs=nativeFs,day,readCounter,saveCounter,now=()=>new Date().toISOString(),onSaved=()=>{}}){
 const file=path.join(root,FILE),pending=new Map();let records;
 const failure=error=>Object.assign(new Error('Não foi possível confirmar o registro diário: '+error.message,{cause:error}),{code:'PERSISTENCIA_JSON_GRAVACAO',arquivo:FILE});
 function load(){
  if(records)return records;
  try{
   const rows=new Map();if(fs.existsSync(file)){const text=fs.readFileSync(file,'utf8');if(text&&!text.endsWith('\n'))throw new Error('Registro diário incompleto; preserve o arquivo para recuperação.');
    for(const line of text.split('\n').filter(Boolean)){const row=JSON.parse(line);if(row.version!==1||!/^\d{6,20}$/.test(row.numero)||!validCounter({data:row.data,enviados:row.total})||row.total<1||!Number.isFinite(Date.parse(row.at)))throw new Error('Registro diário inválido.');const old=rows.get(row.numero);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw new Error('Confirmações diárias conflitantes.');rows.set(row.numero,row);}}
   records=rows;return records;
  }catch(error){throw failure(error);}
 }
 function append(row){
  let fd;try{fd=fs.openSync(file,'a+');const bytes=Buffer.from(JSON.stringify(row)+'\n');let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,null);if(!written)throw new Error('Gravação incompleta.');offset+=written;}fs.fsyncSync(fd);load().set(row.numero,row);pending.delete(row.numero);onSaved(FILE);}
  catch(error){records=null;throw failure(error);}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 function flush(){load();for(const row of pending.values()){if(load().has(row.numero)){pending.delete(row.numero);continue;}append(row);}}
 function recover(){
  flush();const saved=readCounter(),today=day();if(!validCounter(saved))throw failure(new Error('Contador inválido.'));
  const counter=saved.data===today?{...saved}:{data:today,enviados:0};let confirmed=0;
  for(const row of load().values())if(row.data===today){confirmed++;counter.enviados=Math.max(counter.enviados,row.total);}
  counter.enviados=Math.max(counter.enviados,confirmed);
  if(saved.data===today&&saved.enviados!==counter.enviados||saved.data!==today&&counter.enviados>0)saveCounter(counter);
  return counter;
 }
 function confirm(numero,counter,{runId='',receipt}={}){
  if(!/^\d{6,20}$/.test(numero)||!validCounter(counter))throw failure(new Error('Confirmação de envio inválida.'));
  if(receipt!==undefined&&(!receipt||typeof receipt.messageId!=='string'||!receipt.messageId||receipt.messageId.length>512||!Number.isInteger(receipt.ack)||receipt.ack<1||receipt.ack>4))throw failure(new Error('O servidor do WhatsApp ainda não confirmou o envio.'));
  const existing=load().get(numero);if(existing){Object.assign(counter,recover());return existing;}
  const today=day();if(counter.data!==today){counter.data=today;counter.enviados=0;}
  if(!pending.has(numero))pending.set(numero,{version:1,numero,data:today,total:counter.enviados+1,at:now(),runId:String(runId).slice(0,100),...(receipt?{confirmation:{messageId:receipt.messageId,ack:receipt.ack,stage:receipt.stage}}:{})});
  append(pending.get(numero));return load().get(numero);
 }
 function apply(counter){Object.assign(counter,recover());return counter;}
 return{recover,confirm,apply,confirmedNumbers:()=>{flush();return[...load().keys()];},campaignCount:id=>[...load().values()].filter(row=>row.runId===id).length,has:numero=>load().has(numero),file:FILE};
}
module.exports={createDailySendLedger,FILE};
