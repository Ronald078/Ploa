'use strict';
const {randomUUID}=require('node:crypto');
const HOURS=[6,12,24],MAX_WATCHES=12;
function createCreativeWatch({db,connection,enqueue,now=Date.now,autoStart=true}){
  let closed=false,ticking=false;
  const read=()=>db.setting('catalogWatches')||[];
  const write=rows=>db.setting('catalogWatches',rows);
  const stamp=()=>new Date(now()).toISOString();
  const update=(id,values)=>write(read().map(row=>row.id===id?{...row,...values}:row));
  // A search interrupted by shutdown is not retried immediately at the next startup.
  write(read().map(row=>db.job(row.lastJobId)?.status==='interrupted'?{...row,lastError:'Atualização interrompida ao fechar o Ploa.',nextAt:new Date(Math.max(Date.parse(row.nextAt)||0,now()+3600000)).toISOString()}:row));
  function snapshot(){const hasToken=connection().hasToken;
    return read().map(row=>({...row,status:!row.enabled?'paused':!hasToken?'waiting_token':row.accessBlocked?'access_blocked':db.activeJobs().some(job=>db.jobPayload(job.id)?.watchId===row.id)?'syncing':row.lastError?'waiting_retry':'scheduled'}));
  }
  function save(input){
    const query=String(input.query||'').trim();if(!query||query.length>100)throw new Error('Digite uma pesquisa de até 100 caracteres.');
    if(!['PT','ES'].includes(input.country))throw new Error('A coleta automática comercial disponível cobre Portugal e Espanha. Brasil e EUA ainda não têm uma fonte conectada.');
    const rows=read(),same=rows.find(row=>row.id===input.id)||rows.find(row=>row.country===input.country&&row.query.toLocaleLowerCase()===query.toLocaleLowerCase());
    if(input.id&&!same)throw new Error('Pesquisa acompanhada não encontrada.');
    if(!same&&rows.length>=MAX_WATCHES)throw new Error('Acompanhe até 12 pesquisas. Remova uma antes de acrescentar outra.');
    const enabled=input.enabled!==false,intervalHours=Number(input.intervalHours||same?.intervalHours||6);
    if(!HOURS.includes(intervalHours))throw new Error('Escolha atualização a cada 6, 12 ou 24 horas.');
    const row={...same,id:same?.id||randomUUID(),query,country:input.country,niche:String(input.niche||same?.niche||'Sem nicho').trim().slice(0,90),enabled,intervalHours,
      createdAt:same?.createdAt||stamp(),nextAt:!same||!same.enabled&&enabled?stamp():same.nextAt,lastError:'',accessBlocked:false};
    write([...rows.filter(item=>item.id!==row.id),row]);kick();return row;
  }
  async function tick(){if(closed||ticking||!connection().hasToken)return;ticking=true;
    try{let added=0;for(const row of read()){
      if(added>=3||db.activeJobs().length>=10)break;
      if(!row.enabled||row.accessBlocked||Date.parse(row.nextAt)>now()||db.activeJobs().some(job=>db.jobPayload(job.id)?.watchId===row.id))continue;
      try{const job=enqueue('search',{...row,watchId:row.id,pages:3});
        update(row.id,{lastAttemptAt:stamp(),lastJobId:job.id,nextAt:new Date(now()+row.intervalHours*3600000).toISOString(),lastError:''});added++;
      }catch(error){update(row.id,{lastError:String(error.message).slice(0,500),nextAt:new Date(now()+3600000).toISOString()});}
    }}finally{ticking=false;}
  }
  function kick(){if(!closed&&autoStart)setImmediate(()=>void tick().catch(()=>{}));}
  function finished(payload,status,progress,error){if(!payload.watchId)return;
    const at=stamp(),row=read().find(row=>row.id===payload.watchId);if(!row)return;
    update(row.id,status==='done'?{lastSuccessAt:at,lastError:'',accessBlocked:false,lastAdded:progress.added||0,lastUpdated:progress.updated||0}
      :{lastError:progress.stage,accessBlocked:Boolean(error?.metaAccessBlocked),nextAt:new Date(now()+(status==='cancelled'?row.intervalHours:1)*3600000).toISOString()});
  }
  const timer=autoStart?setInterval(()=>void tick().catch(()=>{}),60000):null;timer?.unref?.();if(autoStart)kick();
  return{snapshot,save,tick,finished,
    remove:id=>{if(!read().some(row=>row.id===id))throw new Error('Pesquisa não encontrada.');write(read().filter(row=>row.id!==id));return{removed:true};},
    pause:(id,paused)=>{const row=read().find(row=>row.id===id);if(!row)throw new Error('Pesquisa não encontrada.');return save({...row,enabled:!paused});},
    refresh:id=>{const row=read().find(row=>row.id===id);if(!row)throw new Error('Pesquisa não encontrada.');if(!connection().hasToken)throw new Error('Cadastre o token da Meta para atualizar.');
      if(db.activeJobs().some(job=>db.jobPayload(job.id)?.watchId===id))throw new Error('Esta pesquisa já está sendo atualizada.');
      const job=enqueue('search',{...row,watchId:id,pages:3});update(id,{lastJobId:job.id,lastAttemptAt:stamp(),lastError:'',accessBlocked:false,nextAt:new Date(now()+row.intervalHours*3600000).toISOString()});return job;},
    connectionChanged:()=>{write(read().map(row=>({...row,accessBlocked:false,nextAt:stamp(),lastError:''})));kick();},
    close:()=>{closed=true;if(timer)clearInterval(timer);}};
}
module.exports={createCreativeWatch};
