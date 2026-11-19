'use strict';

async function initializeWithDeadline(client,{timeoutMs=90000,setTimeout=global.setTimeout,clearTimeout=global.clearTimeout}={}){
  let timer,resolveUsable;
  const usable=new Promise(resolve=>{resolveUsable=resolve;});
  const ready=()=>resolveUsable(),qr=()=>resolveUsable();
  client.once('ready',ready);client.once('qr',qr);
  try{
    await Promise.race([
      Promise.all([Promise.resolve().then(()=>client.initialize()),usable]),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('O WhatsApp não concluiu a inicialização no prazo. A sessão foi preservada; uma nova tentativa usará a mesma conexão.')),timeoutMs);}),
    ]);
  }finally{clearTimeout(timer);client.removeListener('ready',ready);client.removeListener('qr',qr);}
}
module.exports={initializeWithDeadline};
