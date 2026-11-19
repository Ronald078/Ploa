'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{createCreativeDb}=require('../lib/creative-db'),{createCreativeRenderer,settings,slideHtml,zipStored}=require('../lib/creative-render');
const production=require('../lib/creative-production'),{answer}=require('./fixtures/creative-production'),{findTools,runTool}=require('../lib/creative-media');
function fixture(t){const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-render-test-')),db=createCreativeDb(root);t.after(()=>{db.close();assert.equal(path.dirname(fs.realpathSync(root)),parent);assert.ok(path.basename(root).startsWith('ploa-render-test-'));fs.rmSync(root,{recursive:true,force:true});});db.importMany([{title:'Referência fictícia',body:'Um catálogo organizado',country:'BR',referenceUrl:'https://www.facebook.com/ads/library/?id=11111111'}]);return{root,db,id:db.list().ads[0].id};}
async function plan(db,id,format){const config=production.options({format,duration:15,targetCountry:'BR',includeMedia:false});const value=await production.createProduction({config,content:'Uma referência fictícia de catálogo.',businessContext:'Sites e sistemas para empresas.',evidence:[{id:'T1',type:'text',detail:'Catálogo organizado.'}],images:[],coverage:{summary:'Texto fictício',notes:[]},call:async input=>answer(input.stage,input)});db.putAnalysis(id,value);return value.production;}
test('marca obrigatória, identidade limitada e texto escapado no HTML',()=>{assert.throws(()=>settings({brand:''}),/marca/);assert.throws(()=>settings({brand:'Ronald',theme:'arbitrary'}));const p={config:{format:'image',country:'BR'},scenes:[{onScreen:'<script>ruim</script>',role:'Mensagem'}],copy:{headline:'Título',description:'Explicação',cta:'Conversar'}};const html=slideHtml(p,settings({brand:'Marca <teste>'}),0,1080,1350);assert.ok(html.includes('&lt;script&gt;'));assert.equal(html.includes('<script>'),false);assert.ok(html.includes('Marca &lt;teste&gt;'));});
test('ZIP usa nomes determinados e mantém bytes íntegros',()=>{const zip=zipStored([{name:'slide-1.png',data:Buffer.from('conteudo')}]);assert.equal(zip.readUInt32LE(),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);assert.equal(zip.readUInt16LE(zip.length-14),1);assert.ok(zip.includes(Buffer.from('conteudo')));});

test('arte internacional não incorpora os nomes internos das etapas em português',()=>{
 const p={config:{format:'video',country:'US'},scenes:[{onScreen:'Find your next product',role:'Necessidade'}],copy:{headline:'A simple choice',description:'Your products together.',cta:'Talk to us'}};
 const html=slideHtml(p,settings({brand:'Sample'}),0,720,1280);
 assert.equal(html.includes('Necessidade'),false);assert.ok(html.includes('lang="en-US"'));
});

test('exportações entram no limite total antes de anexar outras mídias',t=>{
 const {db,id}=fixture(t),{createMediaService}=require('../lib/creative-media');
 const media=createMediaService(db,{extraBytes:()=>250*1024*1024});
 assert.equal(media.status().usedBytes,250*1024*1024);
 assert.throws(()=>media.add(id,fs.readFileSync(path.join(__dirname,'fixtures/creative-text.png')).toString('base64')),/250 MB/);
 assert.equal(db.detail(id).media.length,0);
});
test('exportação de imagem real preserva o plano, invalida ao mudar e mantém anterior se falhar',async t=>{const{db,id}=fixture(t);await plan(db,id,'image');const renderer=createCreativeRenderer({db});const before=JSON.stringify(db.detail(id).analysis);const info=await renderer.render(id,{brand:'Marca de demonstração'});assert.equal(info.mime,'image/png');assert.equal(info.width,1080);assert.equal(info.height,1350);const file=renderer.file(id);const bytes=fs.readFileSync(file.path);assert.equal(bytes.readUInt32BE(),0x89504e47);assert.equal(bytes.readUInt32BE(16),1080);assert.equal(bytes.readUInt32BE(20),1350);assert.equal(JSON.stringify(db.detail(id).analysis),before);
 const failing=createCreativeRenderer({db,launch:async()=>{throw new Error('Falha simulada');}});await assert.rejects(failing.render(id,{brand:'Outra marca'}),/Falha simulada/);assert.equal(renderer.file(id).path,file.path);
 const value=db.detail(id).analysis;value.production.copy.cta='Nova ação';db.putAnalysis(id,value);assert.equal(renderer.info(id),null);renderer.remove(id);assert.equal(fs.existsSync(file.path),false);
});
test('carrossel real contém quatro artes PNG em ZIP',async t=>{const{db,id}=fixture(t);await plan(db,id,'carousel');const renderer=createCreativeRenderer({db});const info=await renderer.render(id,{brand:'Demonstração',theme:'silver'});assert.equal(info.mime,'application/zip');const zip=fs.readFileSync(renderer.file(id).path);assert.equal(zip.readUInt16LE(zip.length-14),4);for(let i=1;i<=4;i++)assert.ok(zip.includes(Buffer.from('slide-'+i+'.png')));});
test('vídeo real respeita duração e não inclui áudio nem conteúdo do concorrente',async t=>{const{db,id}=fixture(t);await plan(db,id,'video');const renderer=createCreativeRenderer({db});await renderer.materials.save(id,0,{base64:fs.readFileSync(path.join(__dirname,'fixtures/creative-text.png')).toString('base64'),authorized:true,fit:'contain'});const info=await renderer.render(id,{brand:'Demonstração'});assert.equal(info.mime,'video/mp4');assert.equal(info.silent,true);const tools=findTools();assert.ok(tools.ffprobe);const details=JSON.parse(await runTool(tools.ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',renderer.file(id).path]));assert.ok(Math.abs(Number(details.format.duration)-15)<.2);assert.equal(details.streams.filter(s=>s.codec_type==='audio').length,0);assert.equal(details.streams[0].width,720);assert.equal(details.streams[0].height,1280);});
test('cancelamento antes de iniciar não deixa arquivo ou registro de exportação',async t=>{const{db,id}=fixture(t);await plan(db,id,'image');const renderer=createCreativeRenderer({db}),controller=new AbortController();controller.abort();await assert.rejects(renderer.render(id,{brand:'Demonstração'},{signal:controller.signal}),/cancelada/);assert.equal(renderer.info(id),null);assert.deepEqual(fs.readdirSync(path.join(db.folder,'exportacoes')),[]);});

test('fila e rota real exportam PNG sem IA, recusam outra origem e invalidam arquivo antigo',async()=>{
 const http=require('node:http'),{createCreativeMiner}=require('../lib/creative-miner'),{createRequestHandler}=require('../lib/http-routes'),{createHttpTools}=require('../lib/http-tools');
 const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-render-route-'));
 let db,miner,server;
 try{
  db=createCreativeDb(root);const ad=db.upsert({title:'Referência de teste',body:'Catálogo',country:'BR',referenceUrl:'https://www.facebook.com/ads/library/?id=22222222'});await plan(db,ad.id,'image');db.close();db=null;
  miner=createCreativeMiner({root,credentials:{available:true,load:()=>({}),save(){}},workspace:{analyzeCreative:()=>{throw new Error('Exportação não deve chamar IA');}},autoStart:false});
  let handler;server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,base='http://127.0.0.1:'+port;
  handler=createRequestHandler({HOST:'127.0.0.1',PORT:port,getCreativeMiner:()=>miner,...createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:path.resolve(__dirname,'../public')})});
  assert.equal((await fetch(base+'/creative-render.js')).status,200);
  const materialsUrl=base+'/api/creative-miner/ads/'+ad.id+'/materials/0',materialBody={base64:fs.readFileSync(path.join(__dirname,'fixtures/creative-text.png')).toString('base64'),authorized:true,fit:'contain',position:'top'};
  assert.equal((await fetch(materialsUrl,{method:'PUT',headers:{origin:'https://other.example','content-type':'application/json'},body:JSON.stringify(materialBody)})).status,403);
  const added=await fetch(materialsUrl,{method:'PUT',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(materialBody)});assert.equal(added.status,200,await added.text());assert.equal(miner.detail(ad.id).materials.length,1);assert.equal(miner.detail(ad.id).media.length,0);
  assert.equal((await fetch(materialsUrl)).headers.get('content-type'),'image/png');
  const preview=await fetch(base+'/api/creative-miner/ads/'+ad.id+'/render-preview?brand=Minha%20marca&scene=0');assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/default-src 'none'/);assert.ok((await preview.text()).includes('data:image/png;base64,'));
  const request=await fetch(base+'/api/creative-miner/jobs',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({kind:'render',adId:ad.id,renderConfig:{brand:'Teste de integração'}})});assert.equal(request.status,202);const job=await request.json();
  const deadline=Date.now()+20000;let status;
  do{status=miner.snapshot().jobs.find(row=>row.id===job.id);if(['done','failed'].includes(status.status))break;if(Date.now()>deadline)throw new Error('Exportação excedeu tempo do teste');await new Promise(resolve=>setTimeout(resolve,30));}while(true);
  assert.equal(status.status,'done',JSON.stringify(status.progress));const url=base+miner.detail(ad.id).rendered.url;
  const denied=await fetch(url,{headers:{origin:'https://other.example'}});assert.equal(denied.status,403);
  const response=await fetch(url);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await response.arrayBuffer()).readUInt32BE(),0x89504e47);
  const updated=await fetch(materialsUrl,{method:'PUT',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({fit:'cover',position:'bottom'})});assert.equal(updated.status,200);assert.equal((await fetch(url)).status,404);
  miner.edit(ad.id,{body:'Referência mudou'});assert.equal((await fetch(url)).status,404);miner.remove(ad.id);assert.deepEqual(fs.readdirSync(path.join(root,'crm','minerador','exportacoes')),[]);
  assert.deepEqual(fs.readdirSync(path.join(root,'crm','minerador','materiais')),[]);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));await miner?.close();db?.close();assert.equal(path.dirname(fs.realpathSync(root)),parent);assert.ok(path.basename(root).startsWith('ploa-render-route-'));fs.rmSync(root,{recursive:true,force:true});
 }
});
