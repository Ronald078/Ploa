'use strict';
const http=require('node:http');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function failedPanelNavigation(base,target,status){try{return Number(status)>=400&&new URL(target).origin===new URL(base).origin;}catch{return false;}}
function probeServer(url,{get=http.get,timeoutMs=900}={}){
  return new Promise(resolve=>{
    let request,settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{finish('offline');request?.destroy();},timeoutMs);
    try{
      request=get(url+'/healthz',response=>{response.resume();finish(response.statusCode===200?'ready':response.statusCode===503?'stopping':'offline');});
      request.on('error',()=>finish('offline'));
    }catch{finish('offline');}
  });
}
async function waitForServer({probe,start,isRunning,error=()=>'',signal,now=Date.now,pause=wait,timeoutMs=20000}){
  const deadline=now()+timeoutMs;let started=false;
  while(now()<deadline){
    if(signal?.aborted)throw new Error('Abertura cancelada.');
    const status=await probe();
    if(signal?.aborted)throw new Error('Abertura cancelada.');
    if(status==='ready')return;
    if(status==='offline'&&!isRunning()){
      if(started)throw new Error(error()||'O servidor interno encerrou durante a abertura.');
      start();started=true;
    }
    await pause(250);
  }
  throw new Error(error()||'O servidor interno não respondeu a tempo.');
}
function within(promise,ms,signal){
  return new Promise((resolve,reject)=>{
    let timer;
    const cancel=()=>finish(reject,new Error('Abertura cancelada.'));
    const finish=(callback,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);callback(value);};
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>finish(reject,new Error('O carregamento da janela excedeu o tempo esperado.')),ms);
    Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
function createWindowLoader(window,{url,loadingFile,ensureServer,onError=()=>{},attempts=3,loadTimeoutMs=15000,readyTimeoutMs=8000,now=Date.now,pause=wait,readyScript="document.documentElement.dataset.ploaReady === 'true' && !!document.querySelector('[data-view-panel]:not([hidden])')"}){
  const controller=new AbortController();let active=null,disposed=false,fallback=true,recoveries=0;
  const alive=()=>!disposed&&!window.isDestroyed();
  const show=()=>{if(alive()&&!window.isVisible())window.show();};
  async function showPage(hash){
    fallback=true;await within(window.loadFile(loadingFile,{hash}),loadTimeoutMs,controller.signal);show();
  }
  async function unavailable(error){
    if(!alive())return false;
    onError(error);
    try{await showPage('unavailable');}catch(failure){onError(failure);}
    return false;
  }
  async function run(){
    for(let attempt=0;attempt<attempts&&alive();attempt++){
      try{
        await showPage('loading');
        await ensureServer(controller.signal);
        if(!alive())return false;
        fallback=false;
        await within(window.loadURL(url),loadTimeoutMs,controller.signal);
        const deadline=now()+readyTimeoutMs;
        while(alive()&&now()<deadline){
          const ready=await within(window.webContents.executeJavaScript(readyScript),2000,controller.signal);
          if(ready){show();return true;}
          await pause(250);
        }
        throw new Error('Os componentes do painel não terminaram de iniciar.');
      }catch(error){
        if(!alive())return false;
        onError(error);window.webContents.stop();
        if(attempt+1<attempts)await pause(400*(attempt+1));
        else return unavailable(error);
      }
    }
    return false;
  }
  function start(){
    if(!alive())return Promise.resolve(false);
    if(active)return active;
    active=run().finally(()=>{active=null;});return active;
  }
  return{start,retry:()=>{recoveries=0;return start();},
    recover:()=>active||(++recoveries<=2?start():unavailable(new Error('A janela falhou repetidamente. Use Tentar novamente.'))),
    get fallback(){return fallback;},dispose:()=>{disposed=true;controller.abort();}};
}
module.exports={probeServer,waitForServer,createWindowLoader,failedPanelNavigation};
