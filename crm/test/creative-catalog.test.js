'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createCreativeMiner}=require('../lib/creative-miner'),{createCreativeDb}=require('../lib/creative-db');
const {cdnUrl,candidates}=require('../lib/creative-preview');
const {createRequestHandler}=require('../lib/http-routes'),{createHttpTools}=require('../lib/http-tools');
const fixtureImage=path.join(__dirname,'fixtures/creative-text.png');
function fixture(t){const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-catalog-test-'));let resources=[];
 t.after(async()=>{for(const close of resources.reverse())await close();const real=fs.realpathSync(root);assert.equal(path.dirname(real),parent);assert.ok(path.basename(real).startsWith('ploa-catalog-test-'));fs.rmSync(real,{recursive:true,force:true});});
 return{root,track:resource=>{resources.push(()=>resource.close());return resource;}};
}
function credentials(token='fixture-meta-token-for-tests'){return{load:()=>({meta:token}),save(){}};}
const listing=(id='123456',extra={})=>({ok:true,json:async()=>({data:[{id,page_name:'Empresa sintética',ad_creative_bodies:['Conheça uma loja organizada.'],ad_delivery_start_time:'2026-09-01',publisher_platforms:['facebook','instagram'],...extra}]})});
async function until(fn){const deadline=Date.now()+5000;while(!fn()){assert.ok(Date.now()<deadline,'A tarefa deve terminar');await new Promise(resolve=>setTimeout(resolve,10));}}
test('pesquisa salva aguarda token; ao conectar abastece catálogo sem cadastro manual nem IA',async t=>{
 const f=fixture(t);let calls=0;const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(''),autoStart:false,workspace:{analyzeCreative(){throw Error('Não deve chamar IA');}},fetchImpl:async()=>{calls++;return listing();}}));
 miner.saveWatch({query:'sites',country:'PT',niche:'Sites'});await miner.tick();assert.equal(calls,0);assert.equal(miner.snapshot().watches[0].status,'waiting_token');
 miner.saveSettings({token:'fictional-meta-token-for-test'});await miner.tick();await until(()=>miner.snapshot().jobs[0]?.status==='done');assert.equal(calls,1);assert.equal(miner.snapshot().summary.total,1);assert.equal(miner.snapshot().watches[0].lastAdded,1);assert.ok(miner.snapshot().watches[0].lastSuccessAt);
});
test('agendamento respeita intervalo, deduplica anúncios e preserva análise quando só as métricas mudam',async t=>{
 const f=fixture(t);let clock=Date.parse('2026-10-27T12:00:00Z'),calls=0;const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,now:()=>clock,workspace:{analyzeCreative:async()=>({adaptation:'Exemplo',model:'fixture'})},fetchImpl:async()=>listing('123456',{eu_total_reach:++calls*100})}));
 miner.saveWatch({query:'lojas',country:'PT',intervalHours:6});await miner.tick();await until(()=>miner.snapshot().jobs[0]?.status==='done');
 const id=miner.snapshot().ads[0].id;miner.enqueue('analyze',{adId:id,targetCountry:'US'});await until(()=>miner.detail(id).analysis);assert.equal(miner.detail(id).analysis.targetCountry,'US');
 await miner.tick();assert.equal(calls,1);clock+=6*3600000;await miner.tick();await until(()=>calls===2&&miner.snapshot().jobs.every(job=>job.status==='done'));
 assert.equal(miner.snapshot().summary.total,1);assert.equal(miner.snapshot().watches[0].lastUpdated,1);assert.equal(miner.detail(id).euReach,200);assert.ok(miner.detail(id).analysis);
});
test('pausar pesquisa suspende coletas futuras e retomar permite atualizar',async t=>{
 const f=fixture(t);let calls=0;const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,workspace:{},fetchImpl:async()=>{calls++;return listing();}}));
 const row=miner.saveWatch({query:'site',country:'ES'});miner.pauseWatch(row.id,true);await miner.tick();assert.equal(calls,0);assert.equal(miner.snapshot().watches[0].status,'paused');
 miner.pauseWatch(row.id,false);await miner.tick();await until(()=>calls===1&&miner.snapshot().jobs[0].status==='done');miner.removeWatch(row.id);assert.equal(miner.snapshot().watches.length,0);
});
test('acesso negado não gera repetição automática até atualizar conexão',async t=>{
 const f=fixture(t);let clock=Date.now(),calls=0;const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,now:()=>clock,workspace:{},fetchImpl:async()=>{calls++;return{ok:false,status:400,json:async()=>({error:{code:190,message:'NEVER-EXPOSE'}})};}}));
 miner.saveWatch({query:'sites',country:'PT'});await miner.tick();await until(()=>miner.snapshot().jobs[0]?.status==='failed');assert.equal(miner.snapshot().watches[0].status,'access_blocked');
 clock+=24*3600000;await miner.tick();assert.equal(calls,1);assert.ok(!JSON.stringify(miner.snapshot()).includes('NEVER-EXPOSE'));
 miner.saveSettings({token:'fictional-new-meta-token-for-test'});await miner.tick();await until(()=>calls===2&&miner.snapshot().jobs.every(job=>job.status==='failed'));
});
test('429 agenda nova tentativa depois de uma hora sem laço de chamadas',async t=>{
 const f=fixture(t);let clock=Date.now(),calls=0;const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,now:()=>clock,workspace:{},fetchImpl:async()=>{calls++;return{ok:false,status:429,json:async()=>({})};}}));
 miner.saveWatch({query:'sites',country:'PT'});await miner.tick();await until(()=>miner.snapshot().jobs[0]?.status==='failed');await miner.tick();assert.equal(calls,1);clock+=3600000;await miner.tick();await until(()=>calls===2&&miner.snapshot().jobs.every(job=>job.status==='failed'));
});
test('países sem fonte não são apresentados como coleta automática conectada; pesquisas repetidas não duplicam',t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,workspace:{}}));
 assert.throws(()=>miner.saveWatch({query:'sites',country:'BR'}),/fonte conectada/);assert.throws(()=>miner.saveWatch({query:'sites',country:'US'}),/fonte conectada/);
 miner.saveWatch({query:'Sites',country:'PT'});miner.saveWatch({query:'sites',country:'PT'});assert.equal(miner.snapshot().watches.length,1);assert.throws(()=>miner.saveWatch({query:'site',country:'PT',intervalHours:0.01}),/6, 12 ou 24/);
});
test('reinício preserva pesquisas e catálogo sem retomar imediatamente tarefa interrompida',async t=>{
 const f=fixture(t),db=createCreativeDb(f.root),watchId='synthetic-watch-id',job=db.enqueue('search',{watchId,query:'sites',country:'PT'});
 db.setting('catalogWatches',[{id:watchId,enabled:true,country:'PT',query:'sites',intervalHours:6,lastJobId:job.id,nextAt:new Date(0).toISOString()}]);db.close();let calls=0;
 const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,workspace:{},fetchImpl:async()=>{calls++;return listing();}}));await miner.tick();assert.equal(calls,0);assert.match(miner.snapshot().watches[0].lastError,/interrompida/);assert.ok(Date.parse(miner.snapshot().watches[0].nextAt)>Date.now());
});
test('ordenação usa evidências distintas; alcance ausente não vira zero informado',t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root));const a=db.upsert({title:'Sem alcance',referenceUrl:'https://example.com/a',country:'PT',deliveryStart:'2026-01-01'}),b=db.upsert({title:'Com alcance',referenceUrl:'https://example.com/b',country:'ES',euReach:1000,deliveryStart:'2026-10-25'});
 assert.equal(db.detail(a.id).euReach,null);assert.equal(db.list({sort:'reach'}).ads[0].id,b.id);assert.equal(db.list({sort:'duration'}).ads[0].id,a.id);assert.equal(db.list({sort:'toString'}).ads.length,2);
});
test('coleta tenta prévia oficial automaticamente e baixa mídia validada sem enviar token ao CDN',async t=>{
 const f=fixture(t),requests=[],png=fs.readFileSync(fixtureImage),token='fixture-meta-token-for-tests';const miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(token),autoStart:false,workspace:{},fetchImpl:async(url,options)=>{
   requests.push({url:String(url),auth:options.headers.Authorization});
   if(String(url).includes('graph.facebook.com'))return listing('123456',{ad_snapshot_url:'https://www.facebook.com/ads/archive/render_ad/?id=123456&access_token=NEVER-PERSIST'});
   if(String(url).includes('www.facebook.com'))return new Response('<meta property="og:image" content="https://scontent.test.fbcdn.net/image.png">',{headers:{'content-type':'text/html'}});
   return new Response(png,{headers:{'content-type':'image/png'}});
 }}));miner.saveWatch({query:'sites',country:'PT'});await miner.tick();await until(()=>miner.snapshot().jobs[0]?.status==='done');
 const ad=miner.snapshot().ads[0];assert.equal(ad.media.length,1);assert.equal(requests.length,3);assert.ok(requests.every(row=>!row.url.includes(token)));assert.equal(requests[1].auth,'Bearer '+token);assert.equal(requests[2].auth,undefined);assert.ok(!JSON.stringify(miner.export()).includes('NEVER-PERSIST'));
});
test('prévia bloqueada preserva o anúncio sem quebrar a coleta',async t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(),autoStart:false,workspace:{},fetchImpl:async url=>String(url).includes('graph.facebook.com')?listing('123456',{ad_snapshot_url:'https://www.facebook.com/ads/archive/render_ad/?id=123456'}):new Response('Forbidden',{status:403})}));
 miner.saveWatch({query:'sites',country:'PT'});await miner.tick();await until(()=>miner.snapshot().jobs[0]?.status==='done');const ad=miner.snapshot().ads[0];assert.equal(ad.media.length,0);assert.equal(miner.detail(ad.id).preview.state,'unavailable');
});
test('extração de prévias rejeita hosts arbitrários, login e recursos de interface da Meta',()=>{
 for(const url of ['http://127.0.0.1/a','https://fbcdn.net.evil.test/a','https://user:pass@scontent.fbcdn.net/a','https://static.xx.fbcdn.net/rsrc.php/logo.png'])assert.equal(cdnUrl(url),'');
 assert.equal(candidates('<form id="login_form"><meta property="og:image" content="https://scontent.fbcdn.net/a.png">').length,0);
 assert.equal(candidates('<meta content="https://scontent.fbcdn.net/a.png?x=1&amp;y=2" property="og:image">')[0].url,'https://scontent.fbcdn.net/a.png?x=1&y=2');
});
test('rotas de pesquisas exigem origem local e mídia admite intervalos de bytes',async t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials:credentials(''),autoStart:false,workspace:{}}));miner.importData({ads:[{title:'Anúncio sintético'}]});const ad=miner.snapshot().ads[0],media=miner.upload(ad.id,fs.readFileSync(fixtureImage).toString('base64'));
 let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port,base='http://127.0.0.1:'+port;
 const tools=createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:path.resolve(__dirname,'../public')});handler=createRequestHandler({HOST:'127.0.0.1',PORT:port,getCreativeMiner:()=>miner,...tools});
 let response=await fetch(base+'/api/creative-miner/watches',{method:'POST',headers:{origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({query:'sites',country:'PT'})});assert.equal(response.status,403);
 response=await fetch(base+'/api/creative-miner/watches',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({query:'sites',country:'PT'})});assert.equal(response.status,201);
 response=await fetch(base+'/api/creative-miner/media/'+media.id,{headers:{Range:'bytes=0-7'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(fixtureImage).subarray(0,8));
 response=await fetch(base+'/api/creative-miner/media/'+media.id,{headers:{Range:'bytes=999999999-'}});assert.equal(response.status,416);
});
