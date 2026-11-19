'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const production=require('../lib/creative-production'),{createCreativeMiner}=require('../lib/creative-miner'),{createCreativeDb}=require('../lib/creative-db'),{createMediaService,findTools,runTool}=require('../lib/creative-media'),{createCreativeEvidence}=require('../lib/creative-evidence'),{createAiProvider}=require('../lib/ai-provider');
const {workspaceFixture}=require('./fixture-helpers'),{answer}=require('./fixtures/creative-production');
const credentials={load:()=>({}),save(){}},png=path.join(__dirname,'fixtures/creative-text.png');
function fixture(t){const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-production-test-')),resources=[];
 t.after(async()=>{for(const item of resources.reverse())await item.close();const real=fs.realpathSync(root);assert.equal(path.dirname(real),parent);assert.ok(path.basename(real).startsWith('ploa-production-test-'));fs.rmSync(real,{recursive:true,force:true});});return{root,track:item=>(resources.push(item),item)};
}
async function until(fn){const deadline=Date.now()+12000;while(!fn()){assert.ok(Date.now()<deadline,'A tarefa deve terminar');await new Promise(resolve=>setTimeout(resolve,10));}}
test('roteiro tem tempos contínuos e formato estático não recebe duração de vídeo',()=>{
 const slots=production.slotsFor(production.options({format:'video',duration:30}));assert.deepEqual(slots.map(row=>[row.start,row.end]),[[0,7],[7,15],[15,22],[22,30]]);
 assert.equal(production.slotsFor(production.options({format:'image'})).length,1);assert.equal(production.options({format:'carousel'}).durationSeconds,0);assert.throws(()=>production.options({duration:999}),/válidos/);
});
test('observações não podem inventar evidências visuais ou comprovar ritmo por amostragem',()=>{
 const context={evidence:[{id:'T1',type:'text',detail:'Produtos'}]},value=answer('reference',context);assert.doesNotThrow(()=>production.validate('reference',value,context));
 assert.throws(()=>production.validate('reference',{...value,observations:[{aspect:'visual',kind:'observed',detail:'Um vídeo',evidenceIds:['T1']}]},context),/não corresponde/);
 assert.throws(()=>production.validate('reference',{...value,observations:[{aspect:'visual',kind:'observed',detail:'Um vídeo',evidenceIds:['F99']}]},context),/não foi fornecida/);
 assert.throws(()=>production.validate('reference',{...value,observations:[{aspect:'editing',kind:'observed',detail:'Cortes rápidos',evidenceIds:['F1']}]},{evidence:[{id:'F1',type:'visual'}]}),/ritmo completo/);
});
test('plano rejeita cenas extras, narração estática e variações incompletas',()=>{
 const config=production.options({format:'image'}),slots=production.slotsFor(config),plan=answer('plan',{config,slots});assert.doesNotThrow(()=>production.validate('plan',plan,{config,slots}));
 assert.throws(()=>production.validate('plan',{...plan,scenes:[...plan.scenes,...plan.scenes]},{config,slots}),/cenas planejadas/);plan.scenes[0].voiceover='Não deve narrar.';assert.throws(()=>production.validate('plan',plan,{config,slots}),/narração/);
 assert.throws(()=>production.validate('copy',{...answer('copy'),hooks:[]}),/variações/);
});
test('pipeline entrega referência, roteiro, direção, materiais e testes em três chamadas',async()=>{
 const stages=[],evidence=[{id:'T1',type:'text',detail:'Organize a loja.'}],config=production.options({targetCountry:'PT'});
 const result=await production.createProduction({content:'Organize a loja.',businessContext:'Sites para lojas',config,evidence,coverage:{summary:'Somente texto'},call:async context=>{stages.push(context);return{...answer(context.stage,context),model:'fixture',usage:{input:10,output:5}};}});
 assert.deepEqual(stages.map(row=>row.stage),['reference','plan','copy']);assert.equal(stages[0].content,'');assert.equal(stages[1].images,undefined);assert.equal(result.production.scenes.length,4);assert.equal(result.production.copy.hooks.length,3);assert.equal(result.usage.output,15);
 const text=production.markdown({title:'Referência sintética',analysis:result});for(const phrase of ['Roteiro','Texto na tela','Materiais necessários','Testes sugeridos'])assert.ok(text.includes(phrase));
});
test('falha de uma etapa não substitui uma adaptação anterior',async t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials,autoStart:false,workspace:{analyzeCreative:async input=>{if(input.stage==='plan')throw Error('Cota simulada');return input.mode==='production'?answer(input.stage,input):{adaptation:'Adaptação anterior',hook:'Gancho anterior'};}}}));
 miner.importData({ads:[{title:'Teste',body:'Loja organizada'}]});const id=miner.snapshot().ads[0].id;miner.enqueue('analyze',{adId:id});await until(()=>miner.detail(id).analysis);miner.enqueue('model',{adId:id,includeMedia:false});await until(()=>miner.snapshot().jobs[0].status==='failed');assert.equal(miner.detail(id).analysis.adaptation,'Adaptação anterior');
});
test('cancelamento entre etapas não grava plano incompleto',async t=>{
 const f=fixture(t);let entered=false;const miner=f.track(createCreativeMiner({root:f.root,credentials,autoStart:false,workspace:{analyzeCreative:async(input,{signal})=>{entered=true;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Cancelado')),{once:true}));}}}));
 miner.importData({ads:[{title:'Teste',body:'Loja organizada'}]});const id=miner.snapshot().ads[0].id,job=miner.enqueue('model',{adId:id,includeMedia:false});await until(()=>entered);miner.cancel(job.id);await until(()=>miner.snapshot().jobs[0].status==='cancelled');assert.equal(miner.detail(id).analysis,null);
});
test('imagem real é reduzida para visão e seu cache não apaga uma análise anterior',async t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),ad=db.upsert({title:'Referência'}),media=createMediaService(db),item=media.add(ad.id,fs.readFileSync(png).toString('base64')),evidence=createCreativeEvidence({db,media});db.putAnalysis(ad.id,{adaptation:'Preservada'});
 const first=await evidence.prepare(item.id);assert.equal(first.state.samples.length,1);assert.ok(first.image.dataUrl.startsWith('data:image/jpeg;base64,'));assert.equal(db.detail(ad.id).analysis.adaptation,'Preservada');assert.ok(db.mediaBytes()>fs.statSync(png).size);
 const second=await evidence.prepare(item.id);assert.equal(second.state.at,first.state.at);assert.ok(evidence.board(item.id));
});
test('vídeo real gera seis quadros e transcreve a fala somente quando solicitado',async t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),ad=db.upsert({title:'Referência'}),media=createMediaService(db),tools=findTools(),video=path.join(f.root,'synthetic.mp4');
 await runTool(tools.ffmpeg,['-nostdin','-loglevel','error','-threads','1','-loop','1','-i',png,'-f','lavfi','-i','sine=frequency=440:duration=2','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',video]);
 const item=media.add(ad.id,fs.readFileSync(video).toString('base64')),evidence=createCreativeEvidence({db,media});let calls=0;const first=await evidence.prepare(item.id);assert.equal(first.state.samples.length,6);assert.equal(first.state.audioAvailable,true);assert.ok(first.state.samples.every(row=>row.seconds<2));
 const second=await evidence.prepare(item.id,{transcribe:async bytes=>{calls++;assert.ok(bytes.length>100);return{text:'Áudio sintético.'};}});assert.equal(calls,1);assert.equal(second.state.transcript,'Áudio sintético.');assert.ok(!fs.existsSync(path.join(db.folder,'midias',item.id+'-model-audio.mp3')));
 await evidence.prepare(item.id,{transcribe:async()=>{calls++;return{text:'Outra transcrição'};}});assert.equal(calls,1);
});
test('Qwen recebe imagem como conteúdo multimodal; modelos de texto não recebem pixels',async()=>{
 const requests=[],provider=createAiProvider({credentialStore:{load:()=>({groq:'fixture-groq-key-for-production'}),save(){},available:true},waitImpl:async()=>{},fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);const user=body.messages[1].content,context=JSON.parse(Array.isArray(user)?user[0].text:user);return{ok:true,headers:new Headers(),json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer(context.stage,context))}}],usage:{prompt_tokens:20,completion_tokens:15}})};}});
 try{await provider.analyzeCreative({provider:'groq',dataConsent:true,freeAccountConfirmed:true},{mode:'production',stage:'reference',evidence:[{id:'F1',type:'visual'}],images:[{id:'V1',dataUrl:'data:image/jpeg;base64,/9j/AA=='}]});assert.equal(requests[0].model,'qwen/qwen3.8-27b');assert.equal(requests[0].messages[1].content[1].type,'image_url');assert.equal(requests[0].response_format.json_schema.name,'ploa_creative_reference');assert.equal(requests[0].max_completion_tokens,1000);}finally{provider.close();}
});
test('cota visual não cai silenciosamente em modelo sem visão',async()=>{
 let calls=0;const provider=createAiProvider({credentialStore:{load:()=>({groq:'fixture-groq-key-for-production'}),save(){},available:true},fetchImpl:async()=>{calls++;return{ok:false,status:429,headers:new Headers({'retry-after':'60'}),json:async()=>({})};}});
 try{await assert.rejects(provider.analyzeCreative({provider:'groq',dataConsent:true,freeAccountConfirmed:true},{mode:'production',stage:'reference',images:[{dataUrl:'data:image/jpeg;base64,/9j/AA=='}]}));assert.equal(calls,1);}finally{provider.close();}
});
test('workspace preserva imagens da referência e filtra identificadores dos textos',async t=>{
 const f=workspaceFixture(t);await f.workspace.saveSettings({provider:'groq',apiKey:'fixture-groq-key-for-production',enabled:false,dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:5});let seen;
 f.workspace.setProvider({hasKey:()=>true,analyzeCreative:async(settings,context)=>{seen=context;return{...answer('reference',context),usage:{input:10,output:5}};},close(){}});
 await f.workspace.analyzeCreative({mode:'production',stage:'reference',content:'Contato user@example.com',businessContext:'Sites',country:'BR',evidence:[{id:'T1',type:'text',detail:'user@example.com'}],images:[{id:'V1',dataUrl:'data:image/jpeg;base64,/9j/AA=='}]});assert.ok(!seen.content.includes('user@example.com'));assert.ok(!seen.evidence[0].detail.includes('user@example.com'));assert.equal(seen.images[0].dataUrl,'data:image/jpeg;base64,/9j/AA==');assert.equal(f.workspace.read().jobs.length,0);
});
