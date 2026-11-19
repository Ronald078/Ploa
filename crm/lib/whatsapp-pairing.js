'use strict';
const crypto=require('node:crypto');

function pairingPhone(value){
  const text=String(value||'').trim();
  if(!/^\+?[\d\s().-]+$/.test(text))throw Object.assign(new Error('Informe o número com código do país e DDD, por exemplo +55 11 99999-9999.'),{statusCode:400});
  const phone=text.replace(/\D/g,'');
  if(!/^[1-9]\d{7,14}$/.test(phone))throw Object.assign(new Error('Informe de 8 a 15 dígitos, incluindo o código do país, sem o prefixo 00.'),{statusCode:400});
  return phone;
}

// Pairing information is memory-only, deliberately separate from logs/settings/backups.
function createPairingControl({getState,start,active,now=Date.now,setTimeout=global.setTimeout,clearTimeout=global.clearTimeout}){
  let current=null,timer=null;
  const error=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
  function clear(){clearTimeout(timer);timer=null;current=null;}
  function snapshot(){
    if(!current)return null;
    if(current.status==='code'&&current.expiresAt<=now())current={...current,status:'expired',code:''};
    const {requestId,...publicData}=current;return publicData;
  }
  function command(type,extra={}){
    const state=getState();
    if(!state?.child?.connected||state.status==='stopping')throw error('O WhatsApp está iniciando ou encerrando. Tente novamente em instantes.');
    const requestId=current.requestId;
    state.child.send({type,requestId,...extra},failure=>{
      if(failure&&current?.requestId===requestId){clearTimeout(timer);timer=null;current={...current,status:'error',code:'',error:'Não foi possível comunicar com o WhatsApp. Reconecte o atendimento.'};}
    });
  }
  function request(value){
    const phone=pairingPhone(value),state=getState();
    if(state?.connection==='ready'||state?.connection==='authenticating')throw error('O WhatsApp já está conectado ou concluindo a conexão.');
    if(state?.status==='stopping')throw error('Aguarde o encerramento do atendimento antes de conectar novamente.');
    const previous=snapshot();
    if(previous&&['requesting','code','expired','cancelling'].includes(previous.status))throw error('Já existe um pareamento em andamento. Use QR Code para trocar o número.');
    if(!active.has(state.status))start();
    clear();current={requestId:crypto.randomUUID(),status:'requesting',code:'',expiresAt:0,phone,phoneEnding:phone.slice(-4),error:''};
    const id=current.requestId;
    timer=setTimeout(()=>{if(current?.requestId===id&&current.status==='requesting')current={...current,status:'error',code:'',error:'O WhatsApp não gerou o código a tempo. Use QR Code ou reconecte o atendimento para tentar novamente.'};},55000);timer.unref?.();
    try{command('ploa-pairing-request',{phone});}catch(e){clear();throw e;}
    return snapshot();
  }
  function cancel(){
    if(!current)return null;
    const id=current.requestId;clearTimeout(timer);
    current={...current,status:'cancelling',code:'',expiresAt:0,error:''};
    timer=setTimeout(()=>{if(current?.requestId===id)current={...current,status:'error',code:'',error:'Não foi possível voltar ao QR Code. Reconecte o atendimento.'};},20000);timer.unref?.();
    try{command('ploa-pairing-cancel');}catch(e){clear();throw e;}return snapshot();
  }
  function receive(message){
    if(message?.type!=='ploa-whatsapp-pairing'||!current||message.requestId!==current.requestId)return;
    if(message.status==='qr'){clear();getState().connection='qr';return;}
    if(message.status==='linked'){clear();getState().connection='authenticating';return;}
    if(current.status==='cancelling'&&message.status!=='error')return;
    if(message.status==='code'&&typeof message.code==='string'&&/^[A-Z0-9]{8}$/.test(message.code)){
      clearTimeout(timer);timer=null;current={...current,status:'code',code:message.code,expiresAt:now()+180000,error:''};getState().connection='pairing';
    }else if(message.status==='error'){
      clearTimeout(timer);timer=null;current={...current,status:'error',code:'',expiresAt:0,error:'Não foi possível gerar o código. Confira o número e tente pelo QR Code ou reconecte o atendimento.'};
    }
  }
  return{request,cancel,receive,snapshot,clear};
}
module.exports={pairingPhone,createPairingControl};
