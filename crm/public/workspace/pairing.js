/* Phone pairing shares the continuous WhatsApp session; no credential is stored here. */
(() => {
  'use strict';
  window.PloaWhatsappPairing={mount({host,api,refresh,notify}){
    const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
    const root=el('details','ploa-pairing');root.append(el('summary',null,'Conectar por código, sem câmera'));
    const intro=el('p','ploa-note','Escolha o país e digite só o DDD e o número do seu WhatsApp. O código do país será acrescentado automaticamente.');
    const form=el('form','ploa-pairing-form'),label=el('label'),input=el('input');
    const countryLabel=el('label'),countrySelect=el('select');countryLabel.append(el('span',null,'País do número'));
    const countries=[['55','Brasil (+55)',[10,11]],['351','Portugal (+351)',[9]],['1','Estados Unidos/Canadá (+1)',[10]],['34','Espanha (+34)',[9]],['','Outro · número internacional',[]]];
    for(const [value,name] of countries){const option=el('option',null,name);option.value=value;countrySelect.append(option);}countryLabel.append(countrySelect);
    label.append(el('span',null,'DDD e número do WhatsApp'));input.type='tel';input.inputMode='tel';input.autocomplete='off';input.placeholder='11 99999-9999';input.maxLength=30;input.required=true;label.append(input);
    const generate=el('button','button button-primary','Gerar código');generate.type='submit';form.append(countryLabel,label,generate);
    const phonePreview=el('p','ploa-note');phonePreview.setAttribute('aria-live','polite');
    const status=el('p','ploa-note');status.setAttribute('role','status');
    const codeBox=el('div','ploa-pairing-result'),code=el('output','ploa-pairing-code');code.setAttribute('aria-label','Código para conectar o WhatsApp');code.tabIndex=0;
    const expiry=el('p','ploa-note'),copy=el('button','button button-secondary','Copiar código');copy.type='button';
    codeBox.append(code,expiry,copy);codeBox.hidden=true;
    const instructions=el('ol','ploa-pairing-steps');
    for(const text of ['Abra o WhatsApp no celular.','Entre em Aparelhos conectados → Conectar um aparelho.','Escolha Conectar com número de telefone e digite o código mostrado aqui.'])instructions.append(el('li',null,text));
    const qr=el('button','button button-secondary','Usar QR Code');qr.type='button';qr.hidden=true;
    const correct=el('button','button button-secondary','Corrigir número');correct.type='button';correct.hidden=true;
    root.append(intro,form,phonePreview,status,codeBox,instructions,correct,qr,el('p','ploa-note','Este é o código de conexão de um aparelho. Não é o código de SMS nem o PIN da conta. A confirmação acontece no próprio WhatsApp.'));
    host.append(root);let processState=null,pairing=null,busy=false,lastCode='';
    function internationalPhone(){
      const raw=input.value.trim(),digits=raw.replace(/\D/g,''),prefix=countrySelect.value;
      if(!raw||!/^\+?[\d\s().-]+$/.test(raw))return raw;
      if(raw.startsWith('+')||!prefix)return digits;
      const lengths=countries.find(row=>row[0]===prefix)[2];
      // Accept pasted international numbers without duplicating their country prefix.
      if(digits.startsWith(prefix)&&lengths.includes(digits.length-prefix.length))return digits;
      return prefix+digits;
    }
    function restorePhone(value){
      const digits=String(value).replace(/\D/g,''),match=countries.find(([prefix])=>prefix&&digits.startsWith(prefix));
      countrySelect.value=match?match[0]:'';input.value=match?digits.slice(match[0].length):digits;
      countrySelect.dispatchEvent(new Event('change',{bubbles:true}));
    }
    // Some desktop focus transitions leave the page active but its edit control unfocused.
    // A real pointer gesture can safely return focus to the exact control being clicked.
    root.addEventListener('pointerdown',event=>{
      const target=event.target.closest('input,button');
      if(!target||target.disabled)return;
      if(!document.hasFocus())window.focus();
      target.focus({preventScroll:true});
    });
    function render(){
      const ready=processState?.connection==='ready',linking=processState?.connection==='authenticating';
      const pending=pairing&&['requesting','cancelling','code','expired'].includes(pairing.status);
      const valid=pairing?.status==='code'&&pairing.expiresAt>Date.now()&&/^[A-Z0-9]{8}$/.test(pairing.code||'');
      generate.disabled=busy||ready||linking||Boolean(pending);input.disabled=busy||ready||linking||Boolean(pending);countrySelect.disabled=input.disabled;
      generate.textContent=pairing?.status==='requesting'?'Preparando código…':'Gerar código';
      qr.hidden=!pairing;qr.disabled=busy||pairing?.status==='cancelling'||ready||linking;
      correct.hidden=!pairing;correct.disabled=qr.disabled;
      const digits=String(pairing?.phone||internationalPhone()).replace(/\D/g,'');
      const country=[['351','Portugal'],['55','Brasil'],['34','Espanha'],['1','Estados Unidos/Canadá']].find(([prefix])=>digits.startsWith(prefix));
      phonePreview.textContent=digits?'Número '+(pairing?'informado':'a enviar')+': +'+digits+(country?' · '+country[1]:'')+'. Confira todos os dígitos no perfil do seu WhatsApp.':'O código do país selecionado será acrescentado automaticamente. Digite o DDD e o número.';
      codeBox.hidden=!valid;
      const value=valid?pairing.code:'';
      if(value!==lastCode){lastCode=value;code.textContent=value?value.slice(0,4)+' '+value.slice(4):'';}
      expiry.textContent=valid?'Válido por aproximadamente '+Math.max(1,Math.ceil((pairing.expiresAt-Date.now())/1000))+' segundos.':'';
      if(ready)status.textContent='WhatsApp conectado. Você já pode usar o atendimento.';
      else if(linking)status.textContent='Código confirmado. O WhatsApp está concluindo a conexão…';
      else if(pairing?.status==='requesting')status.textContent='Iniciando a conexão e solicitando o código. Isso pode levar alguns instantes.';
      else if(pairing?.status==='cancelling')status.textContent='Voltando à conexão por QR Code…';
      else if(pairing?.status==='error')status.textContent=pairing.error;
      else if(valid)status.textContent='Digite este código no WhatsApp de final '+pairing.phoneEnding+'.';
      else if(pairing&&['expired','code'].includes(pairing.status))status.textContent='Este código expirou. Aguardando a renovação; você também pode voltar ao QR Code.';
      else status.textContent='O código aparecerá aqui. A conexão atual será mantida se já estiver autenticada.';
      status.dataset.error=String(pairing?.status==='error');
    }
    const failure=error=>/Rota não encontrada|carregar a conexão por código/i.test(error.message)?'Reabra o Ploa no notebook para carregar a conexão por código.':error.message;
    input.addEventListener('input',render);
    countrySelect.addEventListener('change',()=>{input.placeholder=countrySelect.value==='55'?'11 99999-9999':countrySelect.value?'Número sem código do país':'+código do país e número';render();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||generate.disabled)return;busy=true;render();
      try{const result=await api('/api/whatsapp/pairing','POST',{phone:internationalPhone()});pairing=result.pairing;}
      catch(error){pairing={status:'error',error:failure(error),local:true};}
      finally{busy=false;render();void refresh();}
    });
    qr.addEventListener('click',async()=>{
      if(busy)return;busy=true;codeBox.hidden=true;code.textContent='';
      try{const result=await api('/api/whatsapp/pairing/cancel','POST',{});pairing=result.pairing;}
      catch(error){pairing={status:'error',error:failure(error),local:true};}
      finally{busy=false;render();void refresh();}
    });
    correct.addEventListener('click',async()=>{
      if(busy)return;const previous=pairing?.phone||internationalPhone();busy=true;codeBox.hidden=true;code.textContent='';
      try{const result=await api('/api/whatsapp/pairing/cancel','POST',{});pairing=result.pairing;restorePhone(previous);}
      catch(error){pairing={status:'error',error:failure(error),local:true};}
      finally{busy=false;render();void refresh();if(!input.disabled)input.focus({preventScroll:true});}
    });
    copy.addEventListener('click',async()=>{
      if(!pairing?.code||pairing.expiresAt<=Date.now())return;
      try{await navigator.clipboard.writeText(pairing.code);notify('Código copiado. Digite-o no WhatsApp.');}
      catch{notify('Selecione o código mostrado e copie manualmente.');}
    });
    const timer=setInterval(()=>{if(pairing&&root.isConnected)render();},1000);
    window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});render();
    return{root,update(value){processState=value;if(!busy&&(value?.pairing||!pairing?.local||value?.connection==='ready'))pairing=value?.pairing||null;if(pairing?.phone&&!input.value)restorePhone(pairing.phone);render();}};
  }};
})();
