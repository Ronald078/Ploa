import {useEffect,useState} from 'react';
import {accountApi as api} from './account-api';
export function useDesktopLogin({available,onError}){
 const [pending,setPending]=useState(false);
 const [client]=useState(()=>{
  try{if(new URL(location.href).searchParams.get('desktop')==='1')sessionStorage.setItem('ploa-desktop','1');return sessionStorage.getItem('ploa-desktop')==='1';}catch{return new URL(location.href).searchParams.get('desktop')==='1';}
 });
 useEffect(()=>{
  if(!pending)return;
  let active=true,timer;const controller=new AbortController();
  async function check(){
   try{const result=await api('desktop/status',{},controller.signal);if(!active)return;if(result.completed){location.assign('/?desktop=1');return;}timer=setTimeout(check,2000);}
   catch(error){if(active){setPending(false);onError(error.message);}}
  }
  timer=setTimeout(check,1500);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[pending,onError]);
 async function start(remember,purpose='login'){
  const result=await api('desktop/start',{remember:remember===true,purpose});
  if(!/^\/desktop-login\?ticket=[a-f0-9]{64}$/.test(result.url))throw Error('Não foi possível abrir a entrada no navegador.');
  setPending(purpose);window.open(result.url,'_blank');
 }
 async function cancel(){await api('desktop/cancel',{});setPending(false);}
 return{enabled:client&&available,pending,start,cancel};
}
