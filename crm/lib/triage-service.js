'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {signature,localTriage,contextualTriage}=require('./triage');
const fail=message=>Object.assign(new Error(message),{statusCode:400});
function createTriageService(root,store,workspace){
  const file=path.join(root,'ploa_triagem.json');let busy=false,closed=false;
  let batch=null;
  try{batch=JSON.parse(fs.readFileSync(file,'utf8'));if(batch.status==='running'){batch.status='paused';batch.reason='Análise interrompida ao fechar o Ploa. Inicie outra análise para continuar.';}}catch(error){if(error.code!=='ENOENT')batch={status:'error',reason:'Não foi possível ler a última triagem. O histórico dos contatos foi preservado.',items:[]};}
  function save(){const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(batch,null,2),{mode:0o600});fs.renameSync(temp,file);}
  function snapshot(){if(!batch)return{status:'idle',items:[],total:0,processed:0,safe:0,pending:0,withoutText:0};const safe=batch.items.filter(item=>!item.analysis.needsReview).length;const withoutText=batch.items.filter(item=>item.analysis.category==='missing_history').length;const {undo,lastApplication,cache,...publicBatch}=batch;return{...publicBatch,canUndo:Boolean(lastApplication?.undo?.length||undo?.length),items:batch.items.slice(0,200),safe,withoutText,pending:batch.items.length-safe};}
  async function start({contacts,useAi=false,aiLimit=20}={}){
    if(batch?.status==='running'||busy)throw fail('Já existe uma triagem em andamento.');
    if(!Array.isArray(contacts)||!contacts.length||contacts.length>2000)throw fail('Selecione de 1 a 2000 contatos para analisar.');
    const requested=new Set(contacts.map(String));
    const leads=(await store.getDashboard()).leads.filter(lead=>requested.has(lead.id)&&!lead.vinculo_pendente&&lead.classificacao_modo!=='manual'&&!['ganho','perdido','nao_contatar'].includes(lead.status));
    if(!leads.length)throw fail('Nenhum contato elegível neste filtro. Etapas manuais e contatos encerrados são preservados.');
    const limit=Number(aiLimit);if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Use um limite de 1 a 100 consultas à IA por análise.');
    const lastApplication=batch?.lastApplication||(batch?.undo?.length?{id:batch.id,undo:batch.undo}:null);
    const cache={...(batch?.cache||{})};
    for(const item of batch?.items||[])if(item.analysis.source==='ai')cache[item.contact]=item.analysis;
    const cachedEntries=Object.entries(cache).slice(-2000);const keptCache=Object.fromEntries(cachedEntries);
    const records=workspace.read().records;
    batch={id:randomUUID(),status:'running',startedAt:new Date().toISOString(),useAi:useAi===true,aiLimit:limit,aiUsed:0,total:leads.length,processed:0,items:leads.map(lead=>{
      const previous=keptCache[lead.id],reused=previous?.signature===signature(lead);
      return{contact:lead.id,name:lead.nome,analysis:reused?previous:localTriage(lead),inbound:records[lead.id]?.lastInbound||'',factsAt:records[lead.id]?.facts?.updatedAt||'',aiDone:reused};
    }),cache:keptCache,undo:[],lastApplication,applied:0};
    batch.processed=batch.items.filter(item=>!item.analysis.needsReview||item.aiDone).length;
    if(!batch.useAi||!batch.items.some(item=>item.analysis.needsReview&&!item.aiDone)){batch.status='completed';batch.processed=batch.total;}
    save();return snapshot();
  }
  async function tick(){
    if(closed||busy||batch?.status!=='running')return;
    if(batch.aiUsed>=batch.aiLimit){batch.status='completed';batch.reason='Limite de consultas desta análise atingido. Os casos restantes continuam para revisão.';batch.processed=batch.total;save();return;}
    const item=batch.items.find(item=>item.analysis.needsReview&&item.analysis.canUseAi!==false&&!item.aiDone);
    if(!item){batch.status='completed';batch.processed=batch.total;save();return;}
    busy=true;
    try{
      const lead=(await store.getDashboard()).leads.find(lead=>lead.id===item.contact);
      if(!lead||signature(lead)!==item.analysis.signature){item.aiDone=true;item.skipped='O contato recebeu uma atualização.';return;}
      const result=await workspace.classifyHistory(lead);
      if(closed)return;
      batch.aiUsed++;item.analysis=contextualTriage(lead,result);item.aiDone=true;batch.reason='';
    }catch(error){
      if(error.triageBusy){batch.reason='O atendimento atual tem prioridade. A triagem continuará quando houver disponibilidade.';}
      else{batch.status='paused';batch.reason=error.message||'Não foi possível continuar a análise.';}
    }finally{busy=false;if(batch){batch.processed=batch.items.filter(item=>!item.analysis.needsReview||item.aiDone).length;save();}}
  }
  async function apply(){
    if(!batch||batch.status==='running')throw fail('Aguarde a conclusão da análise antes de aplicar.');
    if(batch.applied>0)throw fail('Esta triagem já foi aplicada. Desfaça a aplicação antes de aplicar novamente.');
    const current=new Map((await store.getDashboard()).leads.map(lead=>[lead.id,lead]));let applied=0,skipped=0;
    await workspace.mutate(data=>{
      const undo=[];
      for(const item of batch.items){
        const lead=current.get(item.contact),record=workspace.recordFor(data,item.contact);
        if(item.analysis.needsReview||!lead||lead.classificacao_modo==='manual'||signature(lead)!==item.analysis.signature||(record.lastInbound||'')!==(item.inbound||'')||(record.facts?.updatedAt||'')!==(item.factsAt||'')||record.triageAnalysis?.batchId===batch.id){skipped++;continue;}
        undo.push({contact:item.contact,previous:record.triageAnalysis||null});
        record.triageAnalysis={...item.analysis,batchId:batch.id,at:new Date().toISOString(),sourceText:lead.ultima_mensagem,sourceAt:lead.ultima_resposta,factsAt:record.facts?.updatedAt||''};applied++;
      }
      batch.undo=undo;
      batch.lastApplication={id:batch.id,undo};
      save();
    });
    batch.applied=applied;batch.skipped=skipped;save();return{applied,skipped,...snapshot()};
  }
  async function undo(){
    const application=batch?.lastApplication||(batch?.undo?.length?{id:batch.id,undo:batch.undo}:null);
    if(!application?.undo?.length)throw fail('Não há uma aplicação desta triagem para desfazer.');let restored=0;
    await workspace.mutate(data=>{for(const item of application.undo){const record=data.records[item.contact];if(record?.triageAnalysis?.batchId!==application.id)continue;if(item.previous)record.triageAnalysis=item.previous;else delete record.triageAnalysis;restored++;}});
    batch.undo=[];batch.lastApplication=null;if(application.id===batch.id)batch.applied=0;save();return{restored,...snapshot()};
  }
  const timer=setInterval(()=>{void tick().catch(()=>{});},2000);timer.unref?.();
  return{snapshot,start,apply,undo,tick,close(){closed=true;clearInterval(timer);}};
}
module.exports={createTriageService};
