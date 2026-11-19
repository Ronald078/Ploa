'use strict';
const fs=require('node:fs'),path=require('node:path');
const {durationMs}=require('./provider-pacing');
const SOURCE='https://console.groq.com/docs/rate-limits';
const GROQ_MODELS=Object.freeze([
  Object.freeze({id:'qwen/qwen3.8-27b',label:'Qwen 3.8 27B',reasoning:'none',outputTokensPerMinute:1000,dailyTokenLimitReference:200000}),
  Object.freeze({id:'openai/gpt-oss-120b',label:'GPT-OSS 120B',reasoning:'low',outputTokensPerMinute:1000,dailyTokenLimitReference:200000}),
  Object.freeze({id:'openai/gpt-oss-20b',label:'GPT-OSS 20B',reasoning:'low',outputTokensPerMinute:1000,dailyTokenLimitReference:200000}),
]);
const IDS=new Set(GROQ_MODELS.map(model=>model.id));
function routingStore(root){
  const file=path.join(root,'ploa_rotacao_ia.json');
  return{load:()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return{};}},save:value=>{
    const temp=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);
  }};
}
function retryDelay(headers,detail={},now=Date.now()){
  const raw=headers?.get?.('retry-after');
  const explicit=raw?(durationMs(raw)??Math.max(0,Date.parse(raw)-now)):null;
  const daily=/\b(?:TPD|RPD)\b|(?:tokens|requests) per day|daily (?:token|request)/i.test(String(detail.error?.message||''));
  return Math.min(86400000,Math.max(1000,Number.isFinite(explicit)?explicit:daily?3600000:60000));
}
function createModelRouter({now=Date.now,store}={}){
  let saved={};try{saved=store?.load()||{};}catch{}
  const pauses=new Map();let lastModel=IDS.has(saved.lastModel)?saved.lastModel:'',lastSwitch=null,warning='';
  for(const [id,value] of Object.entries(saved.pauses||{}))if(IDS.has(id)&&value&&Number.isFinite(value.until)&&value.until>now()&&value.until<=now()+86400000){
    pauses.set(id,{until:value.until,reason:['quota','waiting','unavailable'].includes(value.reason)?value.reason:'unavailable'});
  }
  const persist=()=>{try{store?.save({version:1,lastModel,pauses:Object.fromEntries(pauses)});warning='';}catch{warning='Não foi possível salvar a pausa dos modelos; ela continua válida nesta execução.';}};
  const models=settings=>settings.provider==='groq'?GROQ_MODELS.slice(0,settings.modelFallback===false?1:3):[];
  function pause(model,delay,reason){pauses.set(model,{until:now()+Math.min(86400000,Math.max(1000,delay)),reason});persist();}
  function remaining(model){return Math.max(0,(pauses.get(model)?.until||0)-now());}
  function success(model){
    if(lastModel&&lastModel!==model)lastSwitch={from:lastModel,to:model,at:new Date(now()).toISOString()};
    const changed=lastModel!==model||pauses.has(model);lastModel=model;pauses.delete(model);if(changed)persist();
  }
  function exhausted(candidates){
    const retryAfterMs=Math.max(1000,Math.min(...candidates.map(model=>remaining(model.id)||1000)));
    return Object.assign(new Error('Os modelos disponíveis estão temporariamente em pausa. O Ploa tentará novamente quando houver cota.'),{retryable:true,routingUnavailable:true,retryAfterMs});
  }
  function snapshot(settings){
    const pool=models(settings);
    return{enabled:settings.provider==='groq'&&settings.modelFallback!==false,activeModel:pool.some(m=>m.id===lastModel)?lastModel:pool[0]?.id||'',lastUsedModel:lastModel,lastSwitch,warning,
      models:pool.map((model,index)=>({id:model.id,label:model.label,priority:index+1,role:index?'Reserva '+index:'Principal',
        status:remaining(model.id)>0?'paused':'available',reason:remaining(model.id)>0?pauses.get(model.id).reason:'',
        availableAt:remaining(model.id)>0?new Date(pauses.get(model.id).until).toISOString():null,
        dailyLimit:model.dailyTokenLimitReference,reference:true,source:SOURCE}))};
  }
  return{models,pause,remaining,success,exhausted,snapshot};
}
module.exports={GROQ_MODELS,createModelRouter,routingStore,retryDelay};
