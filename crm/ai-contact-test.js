'use strict';
// Iniciador local de ensaio: nunca inicia disparos nem habilita a IA geral.
const fs=require('node:fs'),path=require('node:path');
const {createWorkspaceService}=require('./lib/workspace-service');
const {pareceMensagemAutomaticaDeBot}=require('./lib/bot-detector');
const {createCredentialStore}=require('./lib/credential-store');
const {credentialDirectory}=require('./lib/runtime-paths');
const ROOT=require('./lib/runtime-paths').dataRoot();
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function configFor(root){
  const value=readJson(path.join(root,'crm','ai-test-contact.json'));
  if(!/^\d{7,16}$/.test(value.contact)||!value.name)throw Error('O contato do teste não está configurado corretamente.');
  return value;
}
function productionEvents(root,contact){
  const file=path.join(root,'ploa_conversas.jsonl');if(!fs.existsSync(file))return[];
  let scene={};try{scene=readJson(path.join(root,'teste_ia_local','cenario.json'));}catch{}
  const ignored=new Set(scene.ignoreKeys||[]),since=Date.parse(scene.since||'')||0;
  return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).flatMap(line=>{try{
    const e=JSON.parse(line),key=e.id||e.messageId||[e.at,e.direction,e.text].join('|');
    return e.contact===contact&&(!since||Date.parse(e.at)>=since-1000)&&!ignored.has(key)?[e]:[];
  }catch{return[];}});
}
function lockFor(file){
  if(fs.existsSync(file)){
    const old=readJson(file);let alive=false;
    if(Number.isInteger(old.pid)&&old.pid>0){try{process.kill(old.pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')alive=true;}}
    if(alive)throw Error('O teste já está aberto. Use a janela existente ou o arquivo Encerrar teste da IA.');
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx'});
  return()=>{if(fs.existsSync(file)&&readJson(file).pid===process.pid)fs.unlinkSync(file);};
}
async function createApi(port){
  const base='http://127.0.0.1:'+port;
  return async(route,method='GET',body)=>{
    let response;
    try{response=await fetch(base+route,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});}
    catch{throw Error('O Ploa não está acessível. Abra o painel e mantenha-o aberto durante o teste.');}
    const value=await response.json();if(!response.ok)throw Error(value.erro||'Falha no painel: HTTP '+response.status);return value;
  };
}
async function preflight(root,api){
  const config=configFor(root),w=await api('/api/workspace'),d=await api('/api/dashboard');
  const lead=d.leads.find(item=>item.id===config.contact);
  if(!lead||lead.nome!==config.name)throw Error('O contato salvo não confere com o contato autorizado para o teste.');
  if(w.settings.enabled)throw Error('Desative a conexão de IA geral no painel antes de iniciar este teste restrito.');
  if(!w.hasKey||!w.settings.dataConsent||!w.settings.freeAccountConfirmed)throw Error('Salve a conexão Groq, a autorização de contexto e a confirmação da conta gratuita no painel. A IA geral pode ficar desativada.');
  if(w.settings.provider!=='groq')throw Error('O ensaio usa a conexão Groq configurada no Ploa.');
  if(lead.vinculo_pendente||lead.status==='nao_contatar')throw Error('O contato está sem vínculo ou marcado para não receber mensagens.');
  return{config,w,lead};
}
async function run(root=ROOT,{api,log=console.log,makeWorkspace=createWorkspaceService,wait=sleep}={}){
  api=api||await createApi(Number(process.env.PLOA_PANEL_PORT||4310));
  const checked=await preflight(root,api),{config,w,lead}=checked,contact=config.contact;
  const folder=path.join(root,'teste_ia_local');fs.mkdirSync(folder,{recursive:true});
  const stop=path.join(folder,'parar.flag'),release=lockFor(path.join(folder,'execucao.lock.json'));
  let workspace,stopping=false,changed=false,previousMode=w.records[contact]?.mode||'automatic',settingsAt=w.settings.updatedAt,lastWarning='';
  const dataDir=path.join(folder,contact);fs.mkdirSync(dataDir,{recursive:true});
  const state={contactName:config.name,status:'starting',startedAt:new Date().toISOString(),deliveries:0};
  const save=()=>fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify(state,null,2));
  const signal=()=>{stopping=true;};
  process.on('SIGINT',signal);process.on('SIGTERM',signal);process.on('SIGHUP',signal);
  const command=message=>{if(message?.type==='ploa-test-stop')signal();};
  process.on('message',command);if(process.connected)process.once('disconnect',signal);
  const settings=source=>({...source,enabled:true,responseMode:'autonomous',keepConnected:false,debounceSeconds:5});
  const issue=message=>{if(message!==lastWarning){log(message);lastWarning=message;}};
  try{
    if(fs.existsSync(stop))fs.unlinkSync(stop);
    const db=path.join(dataDir,'ploa_workspace.json');
    if(!fs.existsSync(db))fs.writeFileSync(db,JSON.stringify({version:1,settings:settings(w.settings),records:{},jobs:[],usage:{}}));
    const captured=productionEvents(root,contact),seen=new Set(captured.map(e=>e.id||e.messageId));
    // O histórico do painel é a fonte dos envios reais. Abrir o teste não reenvia o passado.
    fs.writeFileSync(path.join(dataDir,'ploa_conversas.jsonl'),captured.map(e=>JSON.stringify(e)).join('\n')+'\n');
    const recordLead={...lead,respostas:captured.filter(e=>e.direction==='in').map(e=>({texto:e.text,data:e.at}))};
    workspace=makeWorkspace(dataDir,{getDashboard:async()=>({leads:[recordLead]}),updateLead:async(id,patch)=>{if(id!==contact)throw Error('Contato fora do ensaio.');Object.assign(recordLead,patch);}},{neutralDefaults:fs.existsSync(path.join(root,'.ploa-account.json')),identityRoot:root,credentialStore:createCredentialStore({directory:credentialDirectory(root)})});
    await workspace.mutate(data=>{data.settings=settings(w.settings);const record=workspace.recordFor(data,contact);record.mode='automatic';record.manualOverride=false;});
    let connection=await api('/api/whatsapp');
    if(!connection.running)await api('/api/whatsapp/start','POST',{});
    state.status='waiting_for_contact';save();
    log('Teste restrito: '+config.name+' (final '+contact.slice(-4)+').');
    log('Sem prazo de encerramento e sem limite de cinco respostas. Vale a cota configurada no Ploa e na Groq.');
    log('Mande uma NOVA mensagem pelo WhatsApp desse contato. O histórico e o contexto ficam salvos.');
    log('Para encerrar, use Encerrar teste da IA.cmd ou Ctrl+C. Mantenha o Ploa e esta janela abertos.');
    let checkedAt=0;const ownEchoes=[];
    while(!stopping&&!fs.existsSync(stop)){
      if(Date.now()-checkedAt>3000){
        const current=await api('/api/workspace');checkedAt=Date.now();
        if(current.settings.enabled)throw Error('A IA geral foi ativada no painel. O ensaio separado foi encerrado para evitar dois atendimentos.');
        if(!current.hasKey||!current.settings.dataConsent||!current.settings.freeAccountConfirmed)throw Error('A conexão foi desativada/removida no painel. O teste foi encerrado.');
        if(current.settings.updatedAt!==settingsAt){
          await workspace.saveSettings(settings(current.settings));settingsAt=current.settings.updatedAt;
          log('Instruções e condições atualizadas a partir do painel. Se trocou a chave, encerre e abra este teste novamente.');
        }
      }
      for(const event of productionEvents(root,contact)){
        const key=event.id||event.messageId;if(seen.has(key))continue;seen.add(key);
        if(event.direction==='out'){
          const echo=ownEchoes.find(e=>e.text===event.text&&Math.abs(Date.parse(event.at)-e.at)<15000);
          if(echo)continue;
          await workspace.ingest({...event,eligible:false});
          log('Resposta manual detectada. A IA ficará pausada até encerrar e reabrir este teste.');continue;
        }
        if(event.direction!=='in')continue;
        recordLead.ultima_mensagem=event.text;recordLead.ultima_resposta=event.at;recordLead.respostas.push({texto:event.text,data:event.at});
        // O worker pode ter iniciado antes da atualização do detector.
        // Reavalia somente o contato autorizado para este ensaio.
        const automatic=event.actor==='bot'&&pareceMensagemAutomaticaDeBot(event.text);
        if(!automatic&&recordLead.status==='automatico')recordLead.status='respondeu';
        await workspace.ingest({...event,actor:automatic?'bot':'contact',eligible:!automatic});
        state.status=automatic?'ignored_bot':'queued';
        state.reason=automatic?'Mensagem identificada como automática; não foi enviada à IA. Envie uma nova mensagem para continuar o teste.':'';
        lastWarning='';save();log(automatic?state.reason:'Mensagem recebida. Aguardando juntar as mensagens do contato...');
      }
      connection=await api('/api/whatsapp');
      if(connection.connection!=='ready'){issue('Aguardando conexão do WhatsApp. Consulte a página IA no Ploa.');await wait(1000);continue;}
      const job=await workspace.nextDelivery();
      if(job){
        state.status='sending';state.reason='';save();
        if(job.contact!==contact)throw Error('A trava de destinatário bloqueou uma entrega fora do ensaio.');
        const before=await api('/api/workspace');if(before.settings.enabled)throw Error('A IA geral foi ativada. Encerrando o teste separado.');
        const ids=new Set(before.jobs.map(j=>j.id)),at=Date.now();ownEchoes.push({text:job.text,at});
        try{
          await api('/api/workspace/leads/'+contact,'POST',{action:'message',text:job.text});changed=true;
          let delivered=false;const end=Date.now()+40000;
          while(Date.now()<end&&!stopping){
            const snapshot=await api('/api/workspace');const actual=snapshot.jobs.find(j=>!ids.has(j.id)&&j.contact===contact&&j.text===job.text);
            if(actual?.status==='sent'){ownEchoes.at(-1).at=Date.parse(actual.finishedAt)||Date.now();await workspace.ack({id:job.id,ok:true,messageId:'relay-'+actual.id});delivered=true;break;}
            if(actual&&['held','review','cancelled'].includes(actual.status))break;
            await wait(500);
          }
          if(!delivered){await workspace.ack({id:job.id,ok:false,error:'Sem confirmação de envio. Confira o WhatsApp; não haverá reenvio automático.'});issue('Envio não confirmado. Confira o WhatsApp antes de qualquer nova tentativa.');}
          else{state.deliveries++;state.status='waiting_for_contact';state.reason='';state.lastSentAt=new Date().toISOString();save();log('Enviado: '+job.text);}
        }catch(error){await workspace.ack({id:job.id,ok:false,error:error.message});issue(error.message);}
      }
      const currentData=workspace.read();
      const pending=currentData.jobs.filter(j=>j.contact===contact&&j.inbound===currentData.records?.[contact]?.lastInbound).at(-1);
      const progress={queued:'queued',thinking:'processing',ready:'sending',sending:'sending'}[pending?.status];
      if(progress&&state.status!==progress){state.status=progress;state.reason='';save();}
      const held=currentData.jobs.filter(j=>j.contact===contact&&['held','review'].includes(j.status)&&j.inbound===currentData.records?.[contact]?.lastInbound).at(-1);
      if(held){state.status='awaiting_review';state.reason=held.reason;save();issue('Aguardando revisão: '+held.reason+' O teste permanece aberto para novas mensagens.');}
      await wait(1000);
    }
    state.status='stopped';
  }catch(error){state.status='error';state.reason=error.message;throw error;}
  finally{
    workspace?.close();
    if(changed)try{await api('/api/workspace/leads/'+contact,'POST',{action:'mode',mode:previousMode});}catch{log('O painel fechou antes de restaurar a preferência do contato.');}
    state.finishedAt=new Date().toISOString();save();release();
    process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);process.removeListener('SIGHUP',signal);
    process.removeListener('message',command);process.removeListener('disconnect',signal);
    log('Teste encerrado. Contexto salvo para a próxima abertura.');
  }
}
async function main(){
  if(process.argv.includes('--stop')){const folder=path.join(ROOT,'teste_ia_local');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'parar.flag'),new Date().toISOString());console.log('Encerramento solicitado. Aguarde a janela do teste concluir.');return;}
  if(process.argv.includes('--check')){const value=await preflight(ROOT,await createApi(4310));console.log('Configuração válida para '+value.config.name+'. Nenhuma mensagem foi enviada.');return;}
  await run();
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{if(process.connected)process.disconnect();});
module.exports={run,preflight,configFor,lockFor,productionEvents};
