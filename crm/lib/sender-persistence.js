'use strict';
const nativeFs=require('node:fs'),path=require('node:path');
const ALERT_FILE='ALERTA_PERSISTENCIA.json';
function createSenderPersistence({root,fs=nativeFs,pid=process.pid,now=()=>new Date().toISOString(),warn=console.warn,
 wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 const file=name=>path.join(root,name);
 function readAlert(){try{return JSON.parse(fs.readFileSync(file(ALERT_FILE),'utf8').replace(/^\uFEFF/,''));}catch{return null;}}
 function rename(from,to){for(let attempt=0;;attempt++){try{return fs.renameSync(from,to);}catch(error){if(attempt>=2||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;wait(40*(attempt+1));}}}
 function write(target,text){const fd=fs.openSync(target,'wx');try{fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function save(name,data,{manterBackup=true}={}){
  const destination=file(name),suffix=pid+'.'+Date.now()+'.'+Math.random().toString(16).slice(2),temp=destination+'.'+suffix+'.tmp',backup=destination+'.bak',backupTemp=backup+'.'+suffix+'.tmp';
  try{
   const text=JSON.stringify(data,null,2);JSON.parse(text);write(temp,text);rename(temp,destination);
   if(manterBackup)try{write(backupTemp,text);rename(backupTemp,backup);}catch(error){warn('Não foi possível atualizar o backup de '+name+': '+error.message);}
  }catch(cause){throw Object.assign(new Error('Falha na gravação protegida de '+name+': '+cause.message,{cause}),{code:'PERSISTENCIA_JSON_GRAVACAO',arquivo:name});}
  finally{for(const tempFile of[temp,backupTemp])try{if(fs.existsSync(tempFile))fs.unlinkSync(tempFile);}catch{}}
  if(name!==ALERT_FILE)resolve(name);
 }
 function alert(error,status='aguardando recuperação'){
  const previous=readAlert();
  const data={status,arquivo:error?.arquivo||'',erro:String(error?.message||error),atualizadoEm:now(),proximaTentativaEmSegundos:status==='resolvido'?null:60};
  if(status==='resolvido'&&previous?.status!=='resolvido'&&previous)data.falhaAnterior={arquivo:previous.arquivo,erro:previous.erro,atualizadoEm:previous.atualizadoEm};
  try{save(ALERT_FILE,data);return true;}catch(error){warn('Também não foi possível gravar o alerta de persistência: '+error.message);return false;}
 }
 function resolve(name){const current=readAlert();if(!current||current.status==='resolvido'||current.arquivo!==name)return false;return alert({arquivo:name,message:'Gravação protegida de '+name+' confirmada; persistência recuperada.'},'resolvido');}
 // Usado pelo comando de manutenção: não regrava o contador nem inicia o agente.
 function resolveHistoricalCounter(){
  const previous=readAlert();if(!previous||previous.status==='resolvido'||previous.arquivo!=='contador_diario.json')return{resolved:false,reason:'Não há alerta pendente do contador.'};
  const main=file('contador_diario.json'),backup=main+'.bak',raw=fs.readFileSync(main,'utf8'),copy=fs.readFileSync(backup,'utf8'),counter=JSON.parse(raw),copyData=JSON.parse(copy);
  const stamp=Date.parse(previous.atualizadoEm);
  if(!validCounter(counter)||!validCounter(copyData)||counter.data!==copyData.data||counter.enviados!==copyData.enviados)throw new Error('Contador e backup precisam estar válidos e iguais.');
  if(!Number.isFinite(stamp)||fs.statSync(main).mtimeMs<=stamp||fs.statSync(backup).mtimeMs<=stamp)throw new Error('Não há gravação confirmada posterior ao alerta.');
  if(raw!==fs.readFileSync(main,'utf8')||copy!==fs.readFileSync(backup,'utf8')||JSON.stringify(previous)!==JSON.stringify(readAlert()))throw new Error('O estado mudou durante a conferência. Tente novamente.');
  const resolved=alert({arquivo:'contador_diario.json',message:'Alerta histórico reconciliado: contador e backup válidos, iguais e gravados após a falha. Contagem preservada.'},'resolvido');
  return{resolved,counter};
 }
 return{save,alert,resolve,readAlert,resolveHistoricalCounter};
}
function validCounter(value){return value&&typeof value==='object'&&!Array.isArray(value)&&/^\d{4}-\d{2}-\d{2}$/.test(value.data)&&Number.isSafeInteger(value.enviados)&&value.enviados>=0;}
module.exports={createSenderPersistence,validCounter,ALERT_FILE};
