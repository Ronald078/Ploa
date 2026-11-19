'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {spawn:spawnProcess}=require('node:child_process');
const {configFor,preflight,productionEvents}=require('../ai-contact-test');
const {uniqueConversationEvents}=require('./conversation-events');
const {describeAiRuntime}=require('./ai-runtime');
const {PROVIDERS}=require('./ai-provider');
const {readTokenUsage}=require('./ai-token-usage');
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return{};}};
const isAlive=pid=>{if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
function createAiTestManager({root,codeRoot=root,port,workspace,store,getWhatsapp=()=>({}),spawn=spawnProcess,alive=isAlive}){
  const folder=path.join(root,'teste_ia_local');let child=null,launchAt=0,starting=false,stopping=false,lastError='',logs=[];
  const log=(kind,text)=>{logs.push({at:new Date().toISOString(),kind,text:String(text).trim().slice(0,600)});logs=logs.slice(-50);};
  function snapshot(){
    let config={};try{config=configFor(root);}catch{}
    const state=read(path.join(folder,'status.json')),lock=read(path.join(folder,'execucao.lock.json'));
    const running=starting||Boolean(child&&child.exitCode===null)||alive(lock.pid);
    const data=config.contact?read(path.join(folder,config.contact,'ploa_workspace.json')):{};
    const record=data.records?.[config.contact]||{},settings=workspace.publicSnapshot(),whatsapp=getWhatsapp();
    const fresh=!launchAt||Date.parse(state.startedAt||0)>=launchAt-1000;
    const jobs=data.jobs||[],latest=jobs.filter(j=>j.kind==='ai').at(-1),lastSent=[...jobs].reverse().find(j=>j.status==='sent');
    const runtime=describeAiRuntime(data,{hasKey:settings.hasKey,workerConnected:whatsapp.connection==='ready',thinking:latest?.status==='thinking'});
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),usage=data.usage?.[today]||{requests:0};
    const status=running?(stopping?'stopping':!fresh?'starting':record.mode==='human'?(record.autoClosed?'closed':'manual'):state.status||'starting'):(lastError||state.status==='error'?'error':'stopped');
    let messages=[];if(config.contact)try{messages=uniqueConversationEvents(productionEvents(root,config.contact)).filter(e=>['in','out'].includes(e.direction)&&e.text).slice(-40).map(e=>({id:e.id||e.messageId,direction:e.direction,text:e.text,at:e.at}));}catch{}
    const elapsed=lastSent?Math.max(0,Date.parse(lastSent.finishedAt)-Date.parse(lastSent.createdAt)):null;
    return {running,status,contact:{name:config.name||'Contato não configurado',ending:config.contact?.slice(-4)||''},
      canStart:Boolean(config.contact)&&!running&&!settings.settings.enabled&&settings.hasKey&&settings.settings.dataConsent&&settings.settings.freeAccountConfirmed,
      setupComplete:settings.hasKey&&settings.settings.dataConsent&&settings.settings.freeAccountConfirmed,
      generalAiEnabled:settings.settings.enabled,hasKey:settings.hasKey,whatsapp:whatsapp.connection||'offline',
      model:PROVIDERS[settings.settings.provider]?.model||'',runtime,
      canReset:!running,sceneStartedAt:read(path.join(folder,'cenario.json')).since||null,
      tokenUsage:config.contact?{...readTokenUsage(path.join(folder,config.contact),data.usage||{}),
        quota:settings.tokenUsage?.quota,
        sharedToday:Object.values(settings.tokenUsage?.sources||{}).reduce((sum,item)=>sum+(Number(item.today?.total)||0),0)}:null,
      reason:lastError||(['awaiting_review','error','ignored_bot'].includes(status)?state.reason||latest?.reason||'':''),
      metrics:{sent:fresh?state.deliveries||0:0,requests:usage.requests||0,limit:data.settings?.maxDailyRequests||settings.settings.maxDailyRequests,
        lastResponseMs:Number.isFinite(elapsed)?elapsed:null,stage:record.conversationStage||'discovery',
        timing:lastSent?{queueMs:lastSent.timing?.queueMs||0,quotaWaitMs:lastSent.timing?.quotaWaitMs||0,
          generationMs:lastSent.timing?.generationMs||0,deliveryMs:Math.max(0,Date.parse(lastSent.finishedAt)-Date.parse(lastSent.generatedAt))}:null},
      startedAt:fresh?state.startedAt:null,lastSentAt:lastSent?.finishedAt||null,messages,
      logs:logs.length?logs:jobs.slice(-8).map(job=>({at:job.generatedAt||job.createdAt,kind:['held','review'].includes(job.status)?'error':'system',text:job.reason||job.analysis?.nextStep||'Atendimento registrado.'}))};
  }
  async function start(){
    if(snapshot().running)return snapshot();
    starting=true;launchAt=Date.now();stopping=false;lastError='';logs=[];
    try{
      try{await preflight(root,async route=>route==='/api/workspace'?workspace.publicSnapshot():store.getDashboard());}
      catch(error){error.statusCode=409;throw error;}
      if(stopping){stopping=false;return snapshot();}
      if(!fs.existsSync(path.join(codeRoot,'crm','ai-contact-test.js')))throw Object.assign(new Error('O executor de testes não está instalado.'),{statusCode:503});
      log('system','Iniciando o teste restrito ao contato configurado.');
      child=spawn(process.execPath,[path.join(codeRoot,'crm','ai-contact-test.js')],{cwd:root,windowsHide:true,shell:false,
        env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PLOA_DATA_ROOT:root,PLOA_PANEL_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
      const current=child;
      for(const [name,kind] of [['stdout','output'],['stderr','error']])current[name]?.on('data',chunk=>{
        for(const line of String(chunk).split(/\r?\n/).filter(Boolean))log(kind,line);
      });
      current.once('error',error=>{lastError=error.message;log('error','Não foi possível iniciar o teste.');if(child===current)child=null;});
      current.once('exit',(code)=>{if(code&&!stopping)lastError=logs.filter(e=>e.kind==='error').at(-1)?.text||'O executor foi encerrado com erro.';log('system','Execução do teste encerrada.');if(child===current)child=null;stopping=false;});
    }catch(error){lastError=error.message;child=null;error.statusCode||=500;throw error;}
    finally{starting=false;}
    return snapshot();
  }
  function stop(){
    if(!snapshot().running)return snapshot();
    fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'parar.flag'),new Date().toISOString());stopping=true;
    if(child?.connected)child.send({type:'ploa-test-stop'},()=>{});
    log('system','Encerramento solicitado. Aguardando concluir a operação em andamento.');return snapshot();
  }
  function reset(){
    if(snapshot().running)throw Object.assign(new Error('Encerre o teste antes de começar outro cenário.'),{statusCode:409});
    const config=configFor(root),dataDir=path.join(folder,config.contact),db=path.join(dataDir,'ploa_workspace.json');
    const data=fs.existsSync(db)?JSON.parse(fs.readFileSync(db,'utf8').replace(/^\uFEFF/,'')):{settings:{},usage:{}};
    const archive=path.join(folder,'cenarios',Date.now()+'-'+randomUUID().slice(0,8));fs.mkdirSync(archive,{recursive:true});
    for(const [file,source] of [['ploa_workspace.json',db],['ploa_conversas.jsonl',path.join(dataDir,'ploa_conversas.jsonl')],['cenario.json',path.join(folder,'cenario.json')]])if(fs.existsSync(source))fs.copyFileSync(source,path.join(archive,file));
    const now=new Date().toISOString(),ignoreKeys=[...new Set([...(read(path.join(folder,'cenario.json')).ignoreKeys||[]),...productionEvents(root,config.contact).map(e=>e.id||e.messageId||[e.at,e.direction,e.text].join('|'))])];
    fs.mkdirSync(dataDir,{recursive:true});
    fs.writeFileSync(db,JSON.stringify({version:1,settings:data.settings||{},records:{},jobs:[],usage:data.usage||{}},null,2));
    fs.writeFileSync(path.join(dataDir,'ploa_conversas.jsonl'),'');
    fs.writeFileSync(path.join(folder,'cenario.json'),JSON.stringify({since:now,ignoreKeys},null,2));
    fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify({status:'stopped',deliveries:0,reason:'',finishedAt:now},null,2));
    launchAt=0;lastError='';logs=[];log('system','Novo cenário criado. O histórico anterior do teste foi guardado; a cota do dia foi preservada.');return snapshot();
  }
  async function close(){
    const current=child;if(!current)return;stop();
    await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{if(current.exitCode===null)current.kill();finish();},3000);current.once('exit',finish);if(current.exitCode!==null)finish();});
  }
  return{snapshot,start,stop,reset,close};
}
module.exports={createAiTestManager};
