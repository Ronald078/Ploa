'use strict';
window.PloaIaTests={mount({host,configuration,api,notify,getState,hasUnsaved=()=>false,onTabChange=()=>{}}){
  const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const bar=make('div','ploa-ai-tabs');bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Áreas da IA');
  const settingsTab=make('button','button ploa-ai-tab','Configurações'),testsTab=make('button','button ploa-ai-tab','Testes');
  settingsTab.id='ai-settings-tab';testsTab.id='ai-tests-tab';
  configuration.id='ai-settings-panel';configuration.setAttribute('role','tabpanel');configuration.setAttribute('aria-labelledby',settingsTab.id);
  const panel=make('section','ploa-test-panel');panel.id='ai-tests-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',testsTab.id);panel.hidden=true;
  for(const [tab,id] of [[settingsTab,configuration.id],[testsTab,panel.id]]){tab.type='button';tab.setAttribute('role','tab');tab.setAttribute('aria-controls',id);bar.append(tab);}
  host.insertBefore(bar,configuration);configuration.after(panel);
  const header=make('div','ploa-test-heading'),title=make('div');
  title.append(make('h3',null,'Teste o atendimento com uma conversa real'),make('p','ploa-note','Acompanhe as respostas e ajuste as orientações antes de liberar a IA aos leads.'));
  const setup=make('button','text-action','Ajustar orientações');setup.type='button';header.append(title,setup);panel.append(header);
  const controls=make('section','ploa-test-control'),identity=make('div','ploa-test-identity');
  const dot=make('span','ploa-test-dot');dot.setAttribute('aria-hidden','true');
  const who=make('div'),contactName=make('strong',null,'Carregando contato…'),contactDetail=make('span',null,'Ensaio restrito ao contato configurado');who.append(contactName,contactDetail);identity.append(dot,who);
  const actions=make('div','ploa-test-actions'),start=make('button','button button-primary','Iniciar teste'),stop=make('button','button button-secondary','Encerrar teste'),refreshButton=make('button','button button-secondary','Atualizar');
  const resetButton=make('button','button button-secondary','Novo cenário');
  for(const button of [start,stop,resetButton,refreshButton]){button.type='button';actions.append(button);}start.disabled=true;stop.disabled=true;resetButton.disabled=true;
  controls.append(identity,actions);panel.append(controls);
  const statusLine=make('p','ploa-test-status','Carregando o estado do teste…');statusLine.setAttribute('role','status');
  const guidance=make('p','ploa-note','O teste usa somente este contato. O histórico fica salvo, sem prazo de 12 minutos ou corte de cinco respostas.');panel.append(statusLine,guidance);
  const warning=make('div','ploa-test-warning');warning.hidden=true;warning.setAttribute('role','status');panel.append(warning);
  const metrics=make('dl','ploa-test-metrics'),metricNodes={};
  for(const [key,label] of [['sent','Respostas nesta execução'],['time','Última resposta'],['usage','Consultas do teste hoje'],['stage','Etapa da conversa']]){
    const cell=make('div'),value=make('dd',null,'—');cell.append(make('dt',null,label),value);metrics.append(cell);metricNodes[key]=value;
  }panel.append(metrics);
  const timingNote=make('p','ploa-note');timingNote.hidden=true;panel.append(timingNote);
  const tokens=window.PloaTokenUsage.mount({host:panel,compact:true});
  const layout=make('div','ploa-test-grid'),conversation=make('section','ploa-test-conversation'),conversationHeading=make('div','ploa-test-subheading');
  conversationHeading.append(make('h3',null,'Conversa do teste'),make('span','ploa-note','Mensagens reais deste contato'));
  const messages=make('div','ploa-test-messages');messages.setAttribute('tabindex','0');messages.setAttribute('aria-label','Histórico da conversa de teste');conversation.append(conversationHeading,messages);
  const activity=make('section','ploa-test-activity'),activityHeading=make('div','ploa-test-subheading');activityHeading.append(make('h3',null,'O que está acontecendo'));
  const logList=make('ol','ploa-test-log');activity.append(activityHeading,logList);layout.append(conversation,activity);panel.append(layout);
  const labels={starting:'Iniciando o teste',waiting_for_contact:'Pronto para uma nova mensagem',queued:'Juntando as mensagens antes de responder',processing:'Preparando uma resposta',sending:'Resposta pronta · aguardando confirmação do WhatsApp',awaiting_review:'Precisa da sua intervenção · veja o motivo abaixo',manual:'Atendimento manual assumido',closed:'Conversa encerrada pelo contato',stopping:'Encerrando o teste',stopped:'Teste encerrado',error:'Não foi possível executar o teste'};
  const stages={discovery:'Entendendo a necessidade',scope_confirmation:'Confirmando o projeto',quotation:'Valor apresentado',proposal:'Proposta apresentada',negotiation:'Em negociação',accepted:'Aceite registrado',closed:'Conversa encerrada'};
  const time=value=>value?new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
  let snapshot=null,loading=false,busy=false,signature='',logSignature='',selected='settings';
  function activate(name,focus=false){
    onTabChange();
    selected=name;const testing=name==='tests';configuration.hidden=testing;panel.hidden=!testing;
    for(const [tab,active] of [[settingsTab,!testing],[testsTab,testing]]){tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
    if(focus)(testing?testsTab:settingsTab).focus();
    const target=testing?panel:configuration;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)target.animate([{opacity:.5,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
    if(testing)void refresh();
  }
  settingsTab.addEventListener('click',()=>activate('settings'));testsTab.addEventListener('click',()=>activate('tests'));setup.addEventListener('click',()=>activate('settings',true));
  bar.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();activate(event.key==='Home'?'settings':event.key==='End'?'tests':selected==='tests'?'settings':'tests',true);});
  function render(data){
    snapshot=data;contactName.textContent=data.contact.name;contactDetail.textContent='Final '+data.contact.ending+' · Somente este contato';dot.dataset.running=String(data.running);
    tokens.update(data.tokenUsage,{model:data.model});
    statusLine.textContent=data.status==='ignored_bot'?'Mensagem identificada como automática · aguardando nova mensagem':labels[data.status]||'Aguardando uma nova mensagem';
    if(data.running&&data.whatsapp!=='ready'&&!['stopping','error'].includes(data.status))statusLine.textContent='Aguardando conexão do WhatsApp';
    start.disabled=busy||!data.canStart;stop.disabled=busy||!data.running;refreshButton.disabled=busy;
    resetButton.disabled=busy||data.canReset===false||data.running;
    const notices=[];
    if(data.generalAiEnabled)notices.push('Desative a conexão de IA geral em Configurações antes de iniciar o teste restrito.');
    else if(!data.setupComplete)notices.push('Salve a chave e as confirmações da Groq em Configurações. A IA geral pode permanecer desativada.');
    if(data.running&&data.whatsapp!=='ready')notices.push('Conecte o WhatsApp em Configurações. Se aparecer um QR code, leia-o com o celular.');
    if(data.reason)notices.push(data.reason);
    if(data.status==='manual')notices.push('Uma resposta manual pausou a IA. Encerre e inicie o teste para retomar a automação.');
    warning.hidden=!notices.length;warning.textContent=notices.join(' ');
    metricNodes.sent.textContent=String(data.metrics.sent);metricNodes.time.textContent=data.metrics.lastResponseMs===null?'—':(data.metrics.lastResponseMs/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' s';
    metricNodes.usage.textContent=data.metrics.requests+' / '+data.metrics.limit;metricNodes.stage.textContent=stages[data.metrics.stage]||'Entendendo a necessidade';
    const timing=data.metrics.timing,seconds=value=>(Math.max(0,Number(value)||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' s';
    timingNote.hidden=!timing;
    if(timing)timingNote.textContent='Último envio: espera inicial '+seconds(timing.queueMs)+' · preparação '+seconds(timing.generationMs)+' · envio '+seconds(timing.deliveryMs)+(timing.quotaWaitMs?' · espera de cota incluída na preparação: '+seconds(timing.quotaWaitMs):'');
    guidance.textContent=data.running?'Envie uma nova mensagem pelo WhatsApp deste contato. O Ploa precisa continuar aberto, com o computador ligado e conectado.':'Iniciar continua o contexto salvo. Para testar outra ideia desde o começo, use Novo cenário; o histórico anterior do ensaio será guardado.';
    const next=JSON.stringify(data.messages);
    if(next!==signature){
      const bottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<60||!signature;signature=next;messages.replaceChildren();
      if(!data.messages.length)messages.append(make('p','ploa-test-empty','Envie uma mensagem pelo contato de teste. A conversa aparecerá aqui.'));
      for(const item of data.messages){
        const bubble=make('article','ploa-test-bubble');bubble.dataset.direction=item.direction;
        bubble.append(make('span','ploa-test-speaker',item.direction==='in'?data.contact.name:'Atendimento'),make('p',null,item.text),make('time',null,time(item.at)));messages.append(bubble);
      }if(bottom)messages.scrollTop=messages.scrollHeight;
    }
    const nextLogs=JSON.stringify(data.logs);if(nextLogs!==logSignature){
      logSignature=nextLogs;logList.replaceChildren();
      if(!data.logs.length)logList.append(make('li','ploa-test-empty','Os eventos da execução aparecerão aqui.'));
      for(const entry of data.logs.slice(-12).reverse()){
        const row=make('li');row.dataset.kind=entry.kind;row.append(make('time',null,time(entry.at)),make('span',null,entry.text));logList.append(row);
      }
    }
    host.dispatchEvent(new CustomEvent('ploa-test-state',{detail:data}));
  }
  async function refresh(){
    if(loading||document.hidden)return;loading=true;
    try{render(await api('/api/ai-tests'));}catch(error){
      statusLine.textContent='Controles do teste indisponíveis';warning.hidden=false;
      warning.textContent=/Rota não encontrada|carregar os controles/i.test(error.message)?'Feche e abra o Ploa para carregar os novos controles de teste.':error.message;
      start.disabled=true;stop.disabled=true;resetButton.disabled=true;
    }finally{loading=false;}
  }
  async function command(action){
    if(busy)return;if(action==='start'&&hasUnsaved()){notify('Salve as alterações em Configurações antes de iniciar o teste.');activate('settings',true);return;}
    busy=true;let failure='';if(snapshot)render(snapshot);
    try{render(await api('/api/ai-tests/'+action,'POST',{}));notify(action==='start'?'Teste iniciado para o contato configurado.':action==='reset'?'Novo cenário pronto. Inicie o teste e envie uma nova mensagem.':'Encerramento do teste solicitado.');}
    catch(error){failure=error.message;}
    finally{busy=false;if(snapshot)render(snapshot);if(failure){warning.hidden=false;warning.textContent=failure;}}
  }
  start.addEventListener('click',()=>void command('start'));stop.addEventListener('click',()=>void command('stop'));refreshButton.addEventListener('click',()=>void refresh());
  resetButton.addEventListener('click',()=>void command('reset'));
  const timer=setInterval(()=>{if(!document.hidden&&selected==='tests'&&getState().activeView==='ai')void refresh();},2500);
  window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});activate('settings');
  return{activate,refresh,getSnapshot:()=>snapshot};
}};
