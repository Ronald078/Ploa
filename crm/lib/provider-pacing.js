'use strict';
function durationMs(value){
  const text=String(value||'').trim();
  if(/^\d+(?:\.\d+)?$/.test(text))return Number(text)*1000;
  let total=0,matched=false;
  for(const m of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)){matched=true;total+=Number(m[1])*({ms:1,s:1000,m:60000,h:3600000}[m[2]]);}
  return matched?total:null;
}
function createRatePacer(now=Date.now,{outputTokensPerMinute=0}={}){
  const buckets={};let pauseUntil=0;
  if(outputTokensPerMinute>0)buckets.output={limit:outputTokensPerMinute,remaining:outputTokensPerMinute,at:now(),rate:outputTokensPerMinute/60000};
  function observe(headers){
    if(!headers?.get)return;
    for(const name of ['tokens','requests']){
      const rawLimit=headers.get('x-ratelimit-limit-'+name),rawRemaining=headers.get('x-ratelimit-remaining-'+name);
      const limit=Number(rawLimit),remaining=Number(rawRemaining),reset=durationMs(headers.get('x-ratelimit-reset-'+name));
      if(rawLimit!==null&&rawRemaining!==null&&limit>0&&Number.isFinite(remaining)){
        const missing=Math.max(0,limit-remaining);
        buckets[name]={limit,remaining,at:now(),rate:reset>0&&missing>0?missing/reset:limit/(name==='tokens'?60000:86400000)};
      }
    }
  }
  function waitMs(tokens,outputTokens=0){
    let wait=Math.max(0,pauseUntil-now());
    for(const [name,bucket] of Object.entries(buckets)){
      const needed=name==='tokens'?tokens:name==='output'?outputTokens:1;
      if(needed>bucket.limit)throw Object.assign(new Error('O contexto da IA ultrapassa a cota por minuto do modelo. Revise instruções muito extensas antes de reenviar.'),{retryable:false});
      const available=Math.min(bucket.limit,bucket.remaining+Math.max(0,now()-bucket.at)*bucket.rate);
      wait=Math.max(wait,Math.ceil(Math.max(0,needed-available)/bucket.rate));
    }
    return wait?wait+250:0;
  }
  function consumeOutput(count){
    const bucket=buckets.output;if(!bucket)return;
    bucket.remaining=Math.max(0,Math.min(bucket.limit,bucket.remaining+(now()-bucket.at)*bucket.rate)-count);bucket.at=now();
  }
  function retryAfter(headers,tokens,outputTokens=0){
    const value=headers?.get?.('retry-after');
    const explicit=durationMs(value)??(Number.isFinite(Date.parse(value))?Math.max(0,Date.parse(value)-now()):null);
    const wait=Math.min(900000,Math.max(1000,explicit??(waitMs(tokens,outputTokens)||10000)));
    pauseUntil=now()+wait;return wait;
  }
  return{observe,waitMs,retryAfter,consumeOutput};
}
function sleepWithSignal(ms,signal){
  if(signal?.aborted)return Promise.reject(Object.assign(new Error('Cancelado.'),{name:'AbortError'}));
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(Object.assign(new Error('Cancelado.'),{name:'AbortError'}));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
module.exports={createRatePacer,durationMs,sleepWithSignal};
