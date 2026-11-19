import {useEffect,useRef,useState} from 'react';
import {configureBrowserScope} from './browser-scope.js';
export function useAccountContext(){
 const [state,setState]=useState({ready:false,data:null,error:''}),controller=useRef(null);
 async function refresh(){
  controller.current?.abort();const request=new AbortController();controller.current=request;
  try{
   const response=await fetch('/api/account-context',{cache:'no-store',signal:request.signal});
   if(response.status===404){configureBrowserScope('');setState({ready:true,data:null,error:''});return;}
   if(response.status===401){location.assign('/');return;}
   const value=await response.json();if(!response.ok)throw Error(value.error||value.erro||'Não foi possível conferir sua conta.');
   if(!value.account?.workspaceId)throw Error('Não foi possível conferir a empresa selecionada.');
   configureBrowserScope('workspace:'+value.account.workspaceId,{migrateLegacy:value.account.legacy===true});
   setState({ready:true,data:value,error:''});
  }catch(error){if(!request.signal.aborted)setState({ready:false,data:null,error:error.message});}
 }
 useEffect(()=>{void refresh();return()=>controller.current?.abort();},[]);
 return{...state,refresh};
}
