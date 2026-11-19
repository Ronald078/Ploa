'use strict';

// Commands use the existing parent/worker IPC channel. No phone/code is written to disk.
function attachPairingAgent(client,{channel=process,isReady=()=>false,setTimeout=global.setTimeout,clearTimeout=global.clearTimeout}={}){
  let session=null,busy=false,disposed=false,qrSeen=false,authenticated=false;
  const send=(status,extra={},id=session?.id)=>{if(id&&channel.connected)try{channel.send?.({type:'ploa-whatsapp-pairing',requestId:id,status,...extra},()=>{});}catch{}};
  const qr=()=>{qrSeen=true;};
  const linked=()=>{authenticated=true;qrSeen=false;send('linked');session=null;};
  const reset=()=>{qrSeen=false;authenticated=false;if(session)session.cancelled=true;session=null;};
  const code=value=>{if(session?.acceptEvents&&!session.cancelled&&!authenticated&&!isReady()&&typeof value==='string'&&/^[A-Z0-9]{8}$/.test(value))send('code',{code:value});};
  client.on('qr',qr);client.on('code',code);client.on('authenticated',linked);client.on('ready',linked);client.on('disconnected',reset);client.on('auth_failure',reset);
  async function waitForQr(target){
    if(qrSeen)return;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error('QR not ready')),30000);
      timer.unref?.();
      const onQr=()=>finish(),onReady=()=>finish(new Error('Already paired'));
      function finish(error){clearTimeout(timer);target.cancelWait=null;client.removeListener('qr',onQr);client.removeListener('ready',onReady);client.removeListener('authenticated',onReady);error?reject(error):resolve();}
      target.cancelWait=finish;
      client.once('qr',onQr);client.once('ready',onReady);client.once('authenticated',onReady);
    });
  }
  async function cancelSdk(){if(typeof client.cancelPairingCode==='function')await client.cancelPairingCode();}
  async function request(message){
    if(busy||isReady()||authenticated){send('error',{},message.requestId);return;}
    busy=true;const previous=session,target={id:message.requestId,cancelled:false,acceptEvents:false};
    if(previous)previous.cancelled=true;session=target;
    let deadline,browserTask=false;
    try{
      if(previous)await cancelSdk();
      await waitForQr(target);
      if(target.cancelled||session!==target||disposed)return;
      if(typeof client.requestPairingCode!=='function')throw new Error('Unsupported client');
      const operation=client.requestPairingCode(message.phone,true,180000);
      browserTask=true;
      // Keep the lock until the actual browser request settles, even if the UI timed out.
      const task=Promise.resolve(operation).finally(()=>{busy=false;if(target.cancelled&&!disposed)void cancelSdk().catch(()=>{});});
      const value=await Promise.race([task,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Pairing timeout')),20000);})]);
      if(session===target&&!target.cancelled){target.acceptEvents=true;code(value);}
    }catch{if(session===target&&!target.cancelled)send('error');}
    finally{clearTimeout(deadline);if(!browserTask)busy=false;}
  }
  async function onMessage(message){
    if(disposed||!/^ploa-pairing-(request|cancel)$/.test(message?.type||'')||typeof message.requestId!=='string'||message.requestId.length>100)return;
    if(message.type==='ploa-pairing-request'){
      if(!/^[1-9]\d{7,14}$/.test(message.phone||'')){send('error',{},message.requestId);return;}
      void request(message);return;
    }
    if(session&&session.id!==message.requestId)return;
    if(session){session.cancelled=true;session.cancelWait?.(new Error('Cancelled'));}
    const target=session;session=null;
    try{await cancelSdk();qrSeen=true;send('qr',{},message.requestId);}catch{send('error',{},message.requestId);}
    if(target)target.cancelled=true;
  }
  channel.on('message',onMessage);
  return{usesCode:()=>Boolean(session&&!session.cancelled),close(){disposed=true;if(session){session.cancelled=true;session.cancelWait?.(new Error('Closed'));}session=null;channel.removeListener('message',onMessage);for(const [event,handler] of [['qr',qr],['code',code],['authenticated',linked],['ready',linked],['disconnected',reset],['auth_failure',reset]])client.removeListener(event,handler);}};
}
module.exports={attachPairingAgent};
