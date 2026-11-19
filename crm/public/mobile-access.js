'use strict';
window.PloaMobileAccess={mount(root){
 const get=id=>root.querySelector('#'+id),refresh=get('refresh'),copy=get('copy'),checks=get('checks'),feedback=get('feedback');let url='',disposed=false;
 const lifecycle=new AbortController();
 async function load(){
  refresh.disabled=true;checks.setAttribute('aria-busy','true');feedback.textContent='Conferindo o notebook…';
  try{
   const response=await fetch('/api/mobile-access',{cache:'no-store',signal:AbortSignal.any([lifecycle.signal,AbortSignal.timeout(20000)])}),data=await response.json();if(!response.ok)throw new Error(data.erro||'Não foi possível conferir a conexão.');if(disposed)return;
   url=data.url||'';const link=get('private-url');link.hidden=!url;link.textContent=url;
   if(/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url)){link.href=url;copy.disabled=false;}else{url='';link.removeAttribute('href');copy.disabled=true;}
   get('address-description').textContent=url?'Abra este endereço no Chrome do celular, com o Tailscale conectado.':'Execute Acesso pelo celular.cmd no notebook para configurar o endereço.';
   checks.replaceChildren();for(const check of data.checks||[]){const item=document.createElement('li'),dot=document.createElement('span'),text=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');item.className=['ok','warning','error'].includes(check.status)?check.status:'warning';dot.className='indicator';dot.setAttribute('aria-hidden','true');title.textContent=check.label;detail.textContent=check.detail;const status=document.createElement('span');status.className='result';status.textContent=({ok:'Verificado',warning:'Conferir',error:'Ajustar'})[check.status]||'Conferir';text.append(title,detail);item.append(dot,text,status);checks.append(item);}
   get('updated').textContent='Conferido às '+new Date(data.checkedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
   get('phones').textContent=(data.phones||[]).map(phone=>phone.name+': '+(phone.online?'conectado':'desconectado')).join(' · ');
   const remote=location.protocol==='https:'&&location.origin===url;
   get('browser-status').textContent=remote?'Este navegador alcançou o Ploa pelo endereço privado. Se outro aparelho não abrir, confira o Tailscale e o DNS nele.':'Verificações feitas pelo notebook. Mesmo com tudo verificado aqui, o navegador do celular precisa resolver o endereço privado.';
   feedback.textContent=(data.checks||[]).some(item=>item.status==='error')?'Há itens para ajustar no notebook. Veja os detalhes abaixo.':'Conferência concluída. Os resultados podem ser reutilizados por até 30 segundos.';
  }catch(error){if(disposed)return;feedback.textContent=error.name==='TimeoutError'?'A conferência demorou. Tente novamente com o Ploa aberto.':error.message;checks.replaceChildren();const item=document.createElement('li');item.className='error';item.textContent='Não foi possível concluir a conferência. Reabra o Ploa para carregar o diagnóstico, se acabou de atualizar.';checks.append(item);}
  finally{refresh.disabled=false;checks.setAttribute('aria-busy','false');}
 }
 refresh.addEventListener('click',load);copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);feedback.textContent='Endereço copiado. Cole na barra do Chrome do celular.';}catch{feedback.textContent='Selecione o endereço acima para copiar.';}});void load();
 return{dispose(){disposed=true;lifecycle.abort();}};
}};
const standalone=document.querySelector('body.mobile-access-page .ploa-mobile-diagnostic');
if(standalone)window.PloaMobileAccess.mount(standalone);
