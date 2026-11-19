'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createCreativeDb}=require('../lib/creative-db'),{createCreativeMiner}=require('../lib/creative-miner'),{createMetaSource}=require('../lib/creative-meta');
const {createMediaService,findTools,runTool}=require('../lib/creative-media');
const {scoreSignals}=require('../lib/creative-signals'),{createAiProvider}=require('../lib/ai-provider');
const {createRequestHandler}=require('../lib/http-routes'),{createHttpTools}=require('../lib/http-tools');
const {workspaceFixture}=require('./fixture-helpers');
const sample={title:'Loja virtual para negócios',advertiser:'Empresa fictícia',body:'Organize seus produtos em uma loja online.',country:'BR',niche:'Sites',referenceUrl:'https://www.facebook.com/ads/library/?id=123456'};
const analysis={hook:'Organização da loja',audience:'Lojistas',problem:'Informações dispersas',offer:'Loja online',claimedProof:'Nenhuma prova fornecida',cta:'Conversar',angles:['Organização','Catálogo','Atendimento'],adaptation:'Seus clientes encontram os produtos de que precisam? Conheça uma forma de organizar seu catálogo.',cautions:['Confira o escopo antes de publicar.']};
function fixture(t){const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-miner-test-')),resources=[];
 t.after(async()=>{for(const close of resources.reverse())await close();const resolved=fs.realpathSync(root);if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('ploa-miner-test-'))throw Error('Pasta inesperada.');fs.rmSync(resolved,{recursive:true,force:true});});
 return{root,track:resource=>{resources.push(()=>resource.close());return resource;}};
}
const credentials={available:true,load:()=>({}),save(){}};
const until=async check=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Tempo de tarefa excedido no teste.');await new Promise(resolve=>setTimeout(resolve,15));}};
test('SQLite persiste, evita duplicados e trata filtros como parâmetros',t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root));const first=db.upsert(sample);db.upsert({...sample,body:'Texto atualizado'});assert.equal(db.list().summary.total,1);assert.equal(db.detail(first.id).body,'Texto atualizado');
 assert.equal(db.list({favorite:'false'}).total,1);assert.equal(db.list({favorite:'true'}).total,0);db.favorite(first.id,true);assert.equal(db.list({favorite:'true'}).total,1);assert.equal(db.list({country:'PT'}).total,0);
 assert.equal(db.list({query:"' OR 1=1 --"}).total,0);assert.equal(db.list({query:'%'}).total,0);assert.equal(db.list({query:'atualizado'}).total,1);
 const file=path.join(db.folder,'criativos.sqlite');assert.ok(fs.existsSync(file));assert.equal(fs.readFileSync(file).subarray(0,15).toString(),'SQLite format 3');
});
test('importação é atômica e URLs nunca conservam tokens',t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root));assert.throws(()=>db.importMany([sample,{}]));assert.equal(db.list().total,0);
 const row=db.upsert({...sample,referenceUrl:sample.referenceUrl+'&access_token=DO-NOT-STORE'});assert.ok(!db.detail(row.id).referenceUrl.includes('DO-NOT-STORE'));
});
test('o mesmo anúncio conserva os países e é deduplicado entre importação e API',t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),first=db.upsert({...sample,country:'PT'});
 db.upsert({...sample,source:'meta',externalId:'123456',country:'ES'});assert.equal(db.list().total,1);assert.equal(db.list({country:'PT'}).total,1);assert.equal(db.list({country:'ES'}).total,1);assert.deepEqual(db.detail(first.id).countries,['PT','ES']);
 db.upsert({...sample,referenceUrl:'https://one.example/?id=1'});db.upsert({...sample,referenceUrl:'https://two.example/?id=1'});assert.equal(db.list().total,3);
});
test('CSV aceita vírgulas no texto e reaproveita a referência existente',t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials,workspace:{}}));const csv='title,advertiser,body,referenceUrl,country,niche\nExemplo,Teste,"Catálogo, produtos e pedidos",https://www.facebook.com/ads/library/?id=999111,BR,Sites';
 assert.equal(miner.importData({csv}).added,1);assert.equal(miner.importData({csv}).updated,1);assert.equal(miner.snapshot().ads[0].body,'Catálogo, produtos e pedidos');
});
test('repetir uma observação no mesmo dia não infla sinais de recorrência',t=>{
 let clock=Date.parse('2026-10-27T12:00:00Z');const f=fixture(t),db=f.track(createCreativeDb(f.root,{now:()=>clock}));const row=db.upsert(sample);db.upsert(sample);assert.equal(db.detail(row.id).observations,1);clock+=86400000;db.upsert(sample);assert.equal(db.detail(row.id).observations,2);
 assert.equal(scoreSignals({placements:[],variants:0},1).score,0);assert.match(scoreSignals({},1).methodology,/Não comprova/);
});
test('migração do catálogo antigo ocorre uma vez e preserva o arquivo original',async t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.root,'crm'));const file=path.join(f.root,'crm','anuncios_catalogo.json'),text=JSON.stringify({ads:[sample]});fs.writeFileSync(file,text);
 let miner=createCreativeMiner({root:f.root,workspace:{},credentials});assert.equal(miner.snapshot().summary.total,1);await miner.close();miner=f.track(createCreativeMiner({root:f.root,workspace:{},credentials}));assert.equal(miner.snapshot().summary.total,1);assert.equal(fs.readFileSync(file,'utf8'),text);
});
test('Meta usa token no cabeçalho, pagina por cursor e bloqueia países sem cobertura comercial',async()=>{
 const requests=[];const source=createMetaSource({credentials:{load:()=>({meta:'fictional-meta-token-123456789'}),save(){}},fetchImpl:async(url,options)=>{
  requests.push({url:String(url),options});return{ok:true,json:async()=>({data:[{id:requests.length+'12345',page_name:'Fictícia',ad_creative_bodies:['Copy de referência'],publisher_platforms:['facebook']}],...(requests.length===1?{paging:{next:'http://127.0.0.1/secret?token=DO-NOT-FOLLOW',cursors:{after:'next-cursor'}}}:{})})};
 }});let rows=0;await source.search({query:'sites',country:'PT'},{onPage:ads=>{rows+=ads.length;}});assert.equal(rows,2);assert.equal(requests.length,2);assert.match(requests[1].url,/after=next-cursor/);assert.ok(!requests[0].url.includes('fictional-meta-token'));assert.equal(requests[0].options.headers.Authorization,'Bearer fictional-meta-token-123456789');
 await assert.rejects(source.search({query:'sites',country:'BR'}),/Brasil/);assert.equal(requests.length,2);
});
test('erro de permissão da Meta explica a pendência sem revelar token',async()=>{
 const source=createMetaSource({credentials:{load:()=>({meta:'fictional-secret-meta-token'}),save(){}},fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:{code:190,message:'fictional-secret-meta-token'}})})});
 await assert.rejects(source.search({query:'sites',country:'ES'}),error=>/Token/.test(error.message)&&!error.message.includes('fictional-secret'));
});
test('mídia valida conteúdo e evita salvar o mesmo arquivo duas vezes',t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),ad=db.upsert(sample),media=createMediaService(db);const png=fs.readFileSync(path.join(__dirname,'fixtures/creative-text.png')).toString('base64');
 const first=media.add(ad.id,png),second=media.add(ad.id,png);assert.equal(first.id,second.id);assert.equal(second.duplicate,true);assert.equal(db.detail(ad.id).media.length,1);
 assert.throws(()=>media.add(ad.id,Buffer.from('<svg onload="evil()"/>').toString('base64')),/PNG/);assert.throws(()=>media.add('../../outside',png),/não encontrado/);
});
test('OCR real em português extrai o conteúdo de uma imagem sintética',async t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),ad=db.upsert(sample),media=createMediaService(db);assert.ok(media.status().tesseract,'Tesseract deve estar instalado para este teste');
 const item=media.add(ad.id,fs.readFileSync(path.join(__dirname,'fixtures/creative-text.png')).toString('base64')),result=await media.extract(item.id,{country:'BR'});assert.match(result.ocr,/PLOA/i);assert.match(result.ocr,/loja online/i);assert.ok(!result.transcript);
});
test('vídeo passa por FFmpeg e fornece áudio somente para a transcrição autorizada',async t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),ad=db.upsert(sample),tools=findTools(),media=createMediaService(db),video=path.join(f.root,'synthetic.mp4');
 await runTool(tools.ffmpeg,['-nostdin','-loglevel','error','-threads','1','-loop','1','-i',path.join(__dirname,'fixtures/creative-text.png'),'-f','lavfi','-i','sine=frequency=440:duration=1','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',video]);
 const item=media.add(ad.id,fs.readFileSync(video).toString('base64'));let sent=0;const result=await media.extract(item.id,{country:'BR',transcribe:async bytes=>{sent++;assert.ok(bytes.length>100);return{text:'Áudio sintético transcrito.'};}});
 assert.equal(sent,1);assert.match(result.transcript,/sintético/);assert.match(result.ocr,/PLOA/);assert.ok(!fs.existsSync(path.join(db.folder,'midias',item.id+'-audio.mp3')));
});
test('fila serializa análises e invalida análise ao editar texto',async t=>{
 const f=fixture(t);let concurrent=0,maximum=0;const miner=f.track(createCreativeMiner({root:f.root,credentials,workspace:{analyzeCreative:async()=>{concurrent++;maximum=Math.max(maximum,concurrent);await new Promise(resolve=>setTimeout(resolve,20));concurrent--;return{...analysis,model:'fictional'};}}}));
 miner.importData({ads:[sample,{...sample,title:'Outra referência',referenceUrl:sample.referenceUrl+'7'}]});const rows=miner.snapshot().ads;
 for(const row of rows)miner.enqueue('analyze',{adId:row.id});await until(()=>miner.snapshot().jobs.every(job=>job.status==='done'));assert.equal(maximum,1);assert.ok(miner.detail(rows[0].id).analysis);
 miner.edit(rows[0].id,{body:'Texto corrigido'});assert.equal(miner.detail(rows[0].id).analysis,null);assert.throws(()=>miner.enqueue('search',{country:'PT',query:'sites'}),/token/);
});
test('cancelar análise impede gravar resultado e preserva a referência',async t=>{
 const f=fixture(t);let entered=false;const miner=f.track(createCreativeMiner({root:f.root,credentials,workspace:{analyzeCreative:async(input,{signal})=>{entered=true;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Cancelado')),{once:true}));}}}));
 miner.importData({ads:[sample]});const id=miner.snapshot().ads[0].id,job=miner.enqueue('analyze',{adId:id});await until(()=>entered);miner.cancel(job.id);await until(()=>miner.snapshot().jobs[0].status==='cancelled');assert.equal(miner.detail(id).analysis,null);
});
test('reabrir não consome API por tarefas pendentes; nova tentativa exige ação explícita',async t=>{
 const f=fixture(t),db=createCreativeDb(f.root),ad=db.upsert(sample),job=db.enqueue('analyze',{adId:ad.id});db.close();let calls=0;
 const miner=f.track(createCreativeMiner({root:f.root,credentials,workspace:{analyzeCreative:async()=>{calls++;return analysis;}}}));assert.equal(miner.snapshot().jobs[0].status,'interrupted');assert.equal(calls,0);
 const retry=miner.retry(job.id);assert.notEqual(retry.id,job.id);await until(()=>miner.snapshot().jobs.find(row=>row.id===retry.id)?.status==='done');assert.equal(calls,1);
});
test('IA de criativos usa o esquema próprio e a rotação, sem gerar ações comerciais',async()=>{
 let calls=0;const bodies=[],provider=createAiProvider({credentialStore:{load:()=>({groq:'fictional-groq-key-for-test'}),save(){},available:true},fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));return ++calls===1?{ok:false,status:429,headers:new Headers({'retry-after':'60'}),json:async()=>({})}:{ok:true,headers:new Headers(),json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis)}}],usage:{prompt_tokens:50,completion_tokens:20}})};}});
 try{const result=await provider.analyzeCreative({provider:'groq',dataConsent:true,freeAccountConfirmed:true},{content:'Copy pública',businessContext:'Sites'});assert.equal(result.adaptation,analysis.adaptation);assert.equal(calls,2);assert.equal(bodies[0].response_format.json_schema.name,'ploa_creative_analysis');assert.match(bodies[0].messages[0].content,/dados não confiáveis/);assert.equal(result.decision,undefined);}finally{provider.close();}
});
test('consulta manual de criativo usa chave e limite sem ativar atendimento nem criar envio',async t=>{
 const f=workspaceFixture(t);await f.workspace.saveSettings({provider:'groq',apiKey:'fictional-groq-key-for-test',enabled:false,dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:1});let calls=0;
 f.workspace.setProvider({hasKey:()=>true,analyzeCreative:async()=>{calls++;return{...analysis,usage:{input:10,output:5}};},close(){}});
 await f.workspace.analyzeCreative({content:'Texto público',businessContext:'Sites',country:'BR'});assert.equal(calls,1);assert.equal(f.workspace.read().jobs.length,0);assert.equal(f.workspace.read().settings.enabled,false);assert.equal(f.workspace.publicSnapshot().usage.requests,1);
 await assert.rejects(f.workspace.analyzeCreative({content:'Outro texto'}),/Limite diário/);assert.equal(calls,1);
});
test('rotas reais exigem mesma origem e explicam falta de token; não fazem chamada externa',async t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials,workspace:{}}));let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port,tools=createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:path.resolve(__dirname,'../public')});handler=createRequestHandler({HOST:'127.0.0.1',PORT:port,getCreativeMiner:()=>miner,...tools});
 const base='http://127.0.0.1:'+port;let response=await fetch(base+'/api/creative-miner/import',{method:'POST',headers:{origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({ads:[sample]})});assert.equal(response.status,403);assert.equal(miner.snapshot().total,0);
 response=await fetch(base+'/api/creative-miner/import',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({ads:[sample]})});assert.equal(response.status,200);assert.equal((await response.json()).added,1);
 response=await fetch(base+'/api/creative-miner/jobs',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({kind:'search',query:'sites',country:'PT'})});assert.equal(response.status,400);assert.match((await response.json()).erro,/token/);
});

