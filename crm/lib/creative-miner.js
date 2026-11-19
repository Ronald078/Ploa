'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCreativeDb}=require('./creative-db');
const {createMetaSource,libraryUrl}=require('./creative-meta');
const {createMediaService}=require('./creative-media');
const {createCredentialStore}=require('./credential-store');
const {createCreativeWatch}=require('./creative-watch');
const {createCreativePreview}=require('./creative-preview');
const {createCreativeEvidence}=require('./creative-evidence');
const production=require('./creative-production');
const {createCreativeSite}=require('./creative-site');
const {createCreativeRenderer}=require('./creative-render');
function createCreativeMiner({root,workspace,credentials,fetchImpl,mediaOptions,siteReader,now=Date.now,autoStart=true}){
  const db=createCreativeDb(root,{now}),renderer=createCreativeRenderer({db}),media=createMediaService(db,{...mediaOptions,extraBytes:renderer.usedBytes}),meta=createMetaSource({credentials:credentials||createCredentialStore({directory:path.join(os.homedir(),'AppData','Local','Ploa','minerador')}),fetchImpl});
  let active=null,running=null,closed=false;
  const preview=createCreativePreview({db,media,meta,fetchImpl,now});
  const visualEvidence=createCreativeEvidence({db,media,...mediaOptions,extraBytes:renderer.usedBytes});
  const offerSite=createCreativeSite({db,meta,workspace,reader:siteReader});
  const legacy=path.join(root,'crm','anuncios_catalogo.json');
  if(!db.setting('legacyImported')&&fs.existsSync(legacy)){
    try{const raw=JSON.parse(fs.readFileSync(legacy,'utf8').replace(/^\uFEFF/,'')),ads=Array.isArray(raw)?raw:raw.ads||[];
      for(let start=0;start<ads.length;start+=500)db.importMany(ads.slice(start,start+500));db.setting('legacyImported',true);
    }catch{db.close();throw new Error('O catálogo antigo não pôde ser importado. O arquivo original foi preservado.');}
  }
  const content=ad=>[ad.body,...ad.media.flatMap(item=>[item.extracted?.ocr,item.extracted?.transcript])].filter(Boolean).join('\n\n');
  const detail=id=>{const ad=db.detail(id);return ad?{...ad,preview:preview.status(id)||null,rendered:renderer.info(id),materials:renderer.materials.list(id)}:null;};
  function snapshot(filters={}){return{...db.list(filters),watches:watcher.snapshot(),jobs:db.jobs(),tools:media.status(),connection:meta.status(),settings:{version:db.setting('version')||'v26.0',adaptationCountry:db.setting('adaptationCountry')||'BR',businessContext:db.setting('businessContext')||'Ronald desenvolve sites, lojas virtuais e sistemas para empresas. Não inclua preços ou prazos sem condições informadas.'},coverage:{api:['PT','ES'],unavailable:['BR','US']},libraryUrl:libraryUrl(filters)};}
  async function runNext(){
    if(closed||running)return;const job=db.activeJobs().find(item=>item.status==='queued');if(!job)return;
    const controller=new AbortController();active={id:job.id,controller};
    running=(async()=>{let progress={stage:'Preparando',processed:0,added:0,updated:0};
      const update=value=>{progress={...progress,...value};db.progress(job.id,'running',progress);};
      const payload=db.jobPayload(job.id);try{update({});
        if(job.kind==='search'){
          let previewBudget=8;
          const result=await meta.search(payload,{signal:controller.signal,onPage:async(rows,page)=>{
            if(controller.signal.aborted)throw new Error('Pesquisa cancelada.');const saved=db.importMany(rows);update({stage:'Página '+page.page+' recebida',processed:page.received,added:progress.added+saved.added,updated:progress.updated+saved.updated,page:page.page});
            for(const row of rows){if(!previewBudget)break;const ad=db.findExternal(row.externalId);if(!ad||!preview.due(ad))continue;
              previewBudget--;update({stage:'Obtendo prévias disponíveis na fonte'});await preview.collect(ad,{signal:controller.signal});}
          }});
          update({stage:result.hasMore?'Limite desta busca alcançado; podem existir mais anúncios na fonte.':'Pesquisa concluída'});
        }else if(job.kind==='extract'){
          const ad=db.detail(payload.adId);if(!ad)throw new Error('Anúncio não encontrado.');const item=ad.media.find(row=>row.id===payload.mediaId);if(!item)throw new Error('Anexe a mídia antes de extrair.');
          update({stage:'Lendo texto'+(payload.transcribe?' e transcrevendo áudio':''),total:1});
          const result=await media.extract(item.id,{country:ad.country,signal:controller.signal,transcribe:payload.transcribe?(bytes,signal)=>workspace.transcribeCreative(bytes,signal):null});
          update({stage:result.notes.length?result.notes.join(' '):'Texto extraído',processed:1});
        }else if(['site_discover','site_analyze','site_model'].includes(job.kind)){
          const context={signal:controller.signal,onProgress:update,country:payload.targetCountry,businessContext:db.setting('businessContext')||snapshot().settings.businessContext};
          if(job.kind==='site_discover'){const url=await offerSite.discover(payload.adId,context);update({stage:'Site da oferta identificado',processed:1,total:1});}
          else if(job.kind==='site_analyze'){await offerSite.analyze(payload.adId,context);update({stage:'Análise da página concluída',processed:1,total:1});}
          else{await offerSite.model(payload.adId,payload.siteConfig,context);update({stage:'Nova versão do site pronta para revisar',processed:1,total:1});}
        }else if(job.kind==='model'){
          let ad=db.detail(payload.adId);if(!ad)throw new Error('Anúncio não encontrado.');
          if(!ad.media.length&&ad.snapshotUrl){update({stage:'Consultando a mídia disponível na fonte'});await preview.collect(ad,{signal:controller.signal});ad=db.detail(ad.id);}
          const config=production.options(payload),businessContext=db.setting('businessContext')||snapshot().settings.businessContext;
          const fingerprint=ad=>JSON.stringify([ad.body,ad.title,ad.country,ad.media.map(row=>row.id)]),before=fingerprint(ad);
          const evidence=[],images=[],coverage={visualSamples:0,sourceMediaCount:ad.media.length,transcribedSeconds:0,notes:[]};
          if(ad.body)evidence.push({id:'T1',type:'text',detail:ad.body.slice(0,4000)});
          if(ad.site?.source&&ad.site.sourceUrl===ad.offerUrl)evidence.push({id:'T2',type:'text',detail:'Trecho da página de destino: '+ad.site.source.text.slice(0,1200)});
          const primary=ad.media.find(row=>row.mime.startsWith('video/'))||ad.media[0];
          if(config.includeMedia&&primary){
            update({stage:'Preparando imagens para analisar a referência'});
            const prepared=await visualEvidence.prepare(primary.id,{signal:controller.signal,onProgress:update,transcribe:config.transcribe?(bytes,signal)=>workspace.transcribeCreative(bytes,signal):null});
            images.push(prepared.image);coverage.visualSamples=prepared.state.samples.length;coverage.boardUrl=prepared.state.board.url;coverage.samples=prepared.state.samples;coverage.sourceDuration=prepared.state.duration;
            coverage.notes.push(primary.mime.startsWith('video/')?'O vídeo foi analisado por amostras em seis momentos; cortes entre as amostras podem não aparecer.':'Foi analisada a imagem disponível, preparada em resolução reduzida.');
            for(const row of prepared.state.samples)evidence.push({id:row.id,type:'visual',detail:'Quadro '+row.position+' da imagem V1 (ordem: esquerda para direita, linha a linha), em '+row.seconds+' segundos.'});
            if(config.transcribe&&prepared.state.transcript){evidence.push({id:'A1',type:'voice',detail:prepared.state.transcript.slice(0,4000)});coverage.transcribedSeconds=prepared.state.audioSeconds||0;}
            if(config.transcribe&&prepared.state.audioNote)coverage.notes.push(prepared.state.audioNote);
            if(primary.mime.startsWith('video/')&&!config.transcribe)coverage.notes.push('Análise da fala desativada nesta modelagem.');
            if(ad.media.length>1)coverage.notes.push('Foi priorizado um vídeo ou a primeira imagem; os outros anexos não foram interpretados.');
          }else coverage.notes.push(config.includeMedia?'A fonte não liberou mídia: a análise da referência usa o texto.':'O envio de imagem e voz foi desativado nesta modelagem.');
          coverage.summary=images.length?(coverage.transcribedSeconds?'Referência analisada com amostras visuais e transcrição da fala.':'Referência analisada com imagens; áudio não interpretado.'):'Referência analisada apenas pelo texto. As cenas do roteiro são sugestões de criação.';
          if(!ad.body.trim()&&!images.length)throw new Error('Não há texto ou mídia acessível para modelar esta referência.');
          const result=await production.createProduction({call:(input,options)=>workspace.analyzeCreative(input,options),content:ad.body.slice(0,7000),businessContext,config,evidence,images,coverage,signal:controller.signal,onProgress:update});
          if(fingerprint(db.detail(ad.id)||{body:'',title:'',media:[]})!==before||(db.setting('businessContext')||snapshot().settings.businessContext)!==businessContext)throw new Error('A referência ou a oferta mudou durante a modelagem. Gere novamente com os dados atuais.');
          if(controller.signal.aborted)throw new Error('Modelagem cancelada.');db.putAnalysis(ad.id,{...result,targetCountry:config.country,at:db.stamp(),sourceUpdatedAt:ad.updatedAt,basis:coverage.summary});update({stage:'Plano de produção pronto para revisão',processed:3,total:3});
        }else if(job.kind==='render'){
          await renderer.render(payload.adId,payload.renderConfig,{signal:controller.signal,onProgress:update});
          update({stage:'Arquivo exportado: revise antes de publicar',processed:1,total:1});
        }else if(job.kind==='analyze'){
          let ad=db.detail(payload.adId);if(!ad)throw new Error('Anúncio não encontrado.');
          if(!ad.media.length&&ad.snapshotUrl){update({stage:'Consultando prévia oficial do criativo'});await preview.collect(ad,{signal:controller.signal});ad=db.detail(ad.id);}
          const piece=ad.media.find(item=>!item.extracted?.at);let extractionNote='';
          if(piece){update({stage:'Lendo o conteúdo visual disponível'});try{await media.extract(piece.id,{country:ad.country,signal:controller.signal});ad=db.detail(ad.id);}catch(error){if(controller.signal.aborted)throw error;extractionNote='A mídia não pôde ser lida; a análise usa o texto disponível.';}}
          const text=content(ad);if(!text.trim())throw new Error('A fonte não forneceu texto legível para modelar este criativo. Abra o anúncio na fonte para conferir.');
          update({stage:'Analisando estrutura e preparando adaptação',total:1});
          const result=await workspace.analyzeCreative({content:text,businessContext:db.setting('businessContext')||snapshot().settings.businessContext,country:payload.targetCountry||'BR'},{signal:controller.signal});
          if(content(db.detail(ad.id)||{body:'',media:[]})!==text)throw new Error('A referência mudou durante a análise. Analise novamente para usar o conteúdo atual.');
          if(controller.signal.aborted)throw new Error('Análise cancelada.');db.putAnalysis(ad.id,{...result,targetCountry:payload.targetCountry||'BR',basis:ad.media.some(item=>item.extracted?.ocr)?'Texto do anúncio e OCR da mídia disponível; o vídeo completo não foi interpretado.':'Texto fornecido pela fonte; imagem e vídeo não foram interpretados.',extractionNote,at:db.stamp(),sourceUpdatedAt:ad.updatedAt});update({stage:'Análise pronta para revisão',processed:1});
        }
        if(controller.signal.aborted)throw new Error('Operação cancelada.');db.progress(job.id,'done',progress);watcher.finished(payload,'done',progress);
      }catch(error){const status=controller.signal.aborted?'cancelled':'failed',result={...progress,stage:controller.signal.aborted?'Operação cancelada.':String(error.message||'Não foi possível concluir a tarefa.').slice(0,700)};db.progress(job.id,status,result);watcher.finished(payload,status,result,error);}
    })();
    try{await running;}finally{running=null;active=null;if(!closed)setImmediate(()=>void runNext().catch(()=>{}));}
  }
  function enqueue(kind,payload){if(closed)throw new Error('O minerador está encerrando.');if(!['search','extract','analyze','model','render','site_discover','site_analyze','site_model'].includes(kind))throw new Error('Tipo de tarefa inválido.');
    if(db.activeJobs().length>=10)throw new Error('A fila já tem 10 tarefas. Aguarde antes de acrescentar outras.');
    let clean;
    if(kind==='search'){
      if(!['PT','ES'].includes(payload.country))throw new Error('Brasil e EUA ainda não têm uma fonte de coleta comercial conectada. A integração disponível cobre Portugal/Espanha.');
      if(!meta.status().hasToken)throw new Error('Cadastre o token da Meta antes de iniciar a coleta pela API.');
      const query=String(payload.query||'').trim();if(!query||query.length>100)throw new Error('Use uma pesquisa de até 100 caracteres.');
      if(db.activeJobs().some(job=>{const p=db.jobPayload(job.id);return job.kind==='search'&&p.country===payload.country&&p.query.toLocaleLowerCase()===query.toLocaleLowerCase();}))throw new Error('Esta pesquisa já está na fila.');
      clean={query,country:payload.country,niche:String(payload.niche||'Sem nicho').slice(0,90),pages:Math.min(5,Math.max(1,Number(payload.pages)||3)),version:db.setting('version')||'v26.0',...(payload.watchId?{watchId:String(payload.watchId)}:{})};
    }else{if(!db.detail(payload.adId))throw new Error('Anúncio não encontrado.');const targetCountry=payload.targetCountry||db.setting('adaptationCountry')||'BR';if(!['BR','PT','ES','US'].includes(targetCountry))throw new Error('Escolha o país da adaptação.');clean={adId:payload.adId,...(kind==='extract'?{mediaId:String(payload.mediaId||''),transcribe:payload.transcribe===true}:{targetCountry})};
      if(kind==='model'){const config=production.options({...payload,targetCountry});Object.assign(clean,{format:config.format,duration:config.durationSeconds||30,includeMedia:config.includeMedia,transcribe:config.transcribe,objective:config.objective});}
      if(kind==='site_model')clean.siteConfig=require('./creative-site').settings({...payload.siteConfig,country:payload.siteConfig?.country||targetCountry});
      if(kind==='render'){
        if(!db.detail(payload.adId)?.analysis?.production)throw new Error('Gere a modelagem antes de exportar.');
        clean.renderConfig=require('./creative-render').settings(payload.renderConfig);
      }
      if(db.activeJobs().some(job=>db.jobPayload(job.id)?.adId===clean.adId))throw new Error('Esta referência já tem uma tarefa na fila. Aguarde antes de iniciar outra.');
    }
    const job=db.enqueue(kind,clean);setImmediate(()=>void runNext().catch(()=>{}));return job;
  }
  function saveSettings(body){
    if(body.version!==undefined&&!/^v\d{1,2}\.0$/.test(body.version))throw new Error('Versão da Graph API inválida.');
    if(body.adaptationCountry!==undefined&&!['BR','PT','ES','US'].includes(body.adaptationCountry))throw new Error('País de adaptação inválido.');
    const connectionChanged=Boolean(body.token||body.clearToken||body.version!==undefined&&body.version!==(db.setting('version')||'v26.0'));
    meta.setToken(body.token,body.clearToken===true);if(body.version!==undefined)db.setting('version',body.version);
    if(body.adaptationCountry!==undefined)db.setting('adaptationCountry',body.adaptationCountry);
    if(connectionChanged)watcher.connectionChanged();
    if(body.businessContext!==undefined)db.setting('businessContext',String(body.businessContext).slice(0,2000));return snapshot();
  }
  function importData(body){let rows=body.ads;
    if(body.csv!==undefined){const{parse}=require('csv-parse/sync');rows=parse(String(body.csv),{columns:true,skip_empty_lines:true,bom:true,max_record_size:40000,trim:true});}
    return db.importMany(rows);
  }
  function remove(id){const ad=db.detail(id);if(!ad)throw new Error('Anúncio não encontrado.');if(db.activeJobs().some(job=>db.jobPayload(job.id)?.adId===id))throw new Error('Encerre as tarefas desta referência antes de excluir.');
    renderer.remove(id);renderer.materials.clear(id);const files=[...ad.media.map(item=>media.fileFor(item.id)?.path).filter(Boolean),...visualEvidence.artifacts(ad)];db.db.prepare('DELETE FROM ads WHERE id=?').run(id);for(const file of files)try{fs.unlinkSync(file);}catch{}return{removed:true};
  }
  const watcher=createCreativeWatch({db,connection:meta.status,enqueue,now,autoStart});
  return{snapshot,detail,importData,saveSettings,enqueue,upload:media.add,media:media.fileFor,storyboard:visualEvidence.board,siteLink:db.offerLink,editSite:offerSite.edit,siteHtml:offerSite.render,productionText:id=>{const ad=db.detail(id);if(!ad)throw new Error('Anúncio não encontrado.');return production.markdown(ad);},
    rendered:renderer.file,renderPreview:renderer.preview,material:renderer.materials.file,
    saveMaterial:(id,slot,input)=>{if(db.activeJobs().some(job=>db.jobPayload(job.id)?.adId===id))throw new Error('Aguarde a tarefa desta referência antes de alterar os materiais.');return renderer.materials.save(id,slot,input);},
    removeMaterial:(id,slot)=>{if(db.activeJobs().some(job=>db.jobPayload(job.id)?.adId===id))throw new Error('Aguarde a tarefa desta referência antes de alterar os materiais.');return renderer.materials.remove(id,slot);},
    saveWatch:watcher.save,removeWatch:watcher.remove,pauseWatch:watcher.pause,refreshWatch:watcher.refresh,tick:watcher.tick,
    retry:id=>{const previous=db.job(id);if(!previous||!['failed','interrupted','cancelled'].includes(previous.status))throw new Error('Esta tarefa não está disponível para nova tentativa.');return enqueue(previous.kind,db.jobPayload(id));},
    legacySnapshot:()=>{const value=snapshot();return{...value,ads:value.ads.map(ad=>({...ad,scaleScore:ad.research.score,scaleLevel:ad.research.level,activeDays:ad.research.signals.find(signal=>signal.label==='Dias de veiculação informados')?.value||0,placements:ad.placements.length,sightings:ad.observations,hook:ad.analysis?.hook||'',offer:ad.analysis?.offer||'',summary:ad.body})),methodology:'Prioridade de pesquisa calculada pelos sinais registrados, sem comprovar vendas ou investimento.'};},
    favorite:db.favorite,remove,edit:(id,body)=>{const current=db.detail(id);if(!current)throw new Error('Anúncio não encontrado.');db.upsert({...current,title:body.title??current.title,body:body.body??current.body,niche:body.niche??current.niche});return db.detail(id);},
    cancel:id=>{const job=db.job(id);if(!job)throw new Error('Tarefa não encontrada.');if(active?.id===id)active.controller.abort();else if(job.status==='queued'){const result={stage:'Tarefa cancelada antes de iniciar.'};db.progress(id,'cancelled',result);watcher.finished(db.jobPayload(id),'cancelled',result);}return db.job(id);},
    export:()=>({format:'ploa-creatives',version:1,createdAt:db.stamp(),ads:db.db.prepare('SELECT id FROM ads ORDER BY created_at').all().map(row=>db.detail(row.id)),note:'Inclui referências e análises; arquivos de mídia permanecem na pasta local do minerador.'}),
    close:async()=>{closed=true;watcher.close();active?.controller.abort();if(running)await running;db.close();}};
}
module.exports={createCreativeMiner};
