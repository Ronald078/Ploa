'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const{normalizeOfferUrl,offerCandidates,offerFromText,publicIp}=require('../lib/creative-offer-url'),{createSiteReader,parsePage}=require('../lib/creative-site-reader'),{createCreativeDb}=require('../lib/creative-db'),{createCreativeMiner}=require('../lib/creative-miner'),{createCreativeSite,renderSite}=require('../lib/creative-site'),{createRequestHandler}=require('../lib/http-routes'),{createHttpTools}=require('../lib/http-tools');
const{answer,html}=require('./fixtures/creative-site');
function fixture(t){const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-site-test-')),resources=[];t.after(async()=>{for(const resource of resources.reverse())await resource.close();const real=fs.realpathSync(root);assert.equal(path.dirname(real),parent);assert.ok(path.basename(real).startsWith('ploa-site-test-'));fs.rmSync(real,{recursive:true,force:true});});return{root,track:r=>(resources.push(r),r)};}
const credentials={load:()=>({}),save(){}},reader={read:async url=>parsePage(html,url)};
async function until(check){const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end);await new Promise(resolve=>setTimeout(resolve,10));}}
test('destino é extraído somente quando explícito e tokens de URL não são preservados',()=>{
 assert.equal(offerFromText('Conheça https://example.com/oferta?utm_source=meta&token=PRIVATE'),'https://example.com/oferta');
 assert.deepEqual(offerCandidates('"link_url":"https:\\/\\/example.com\\/oferta"'),['https://example.com/oferta']);
 assert.deepEqual(offerCandidates('<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Foferta&amp;h=123">Ver</a>'),['https://example.com/oferta']);
 assert.equal(offerFromText('example.com'), '');assert.equal(offerFromText('https://one.com https://two.com'),'');assert.equal(normalizeOfferUrl('https://www.facebook.com/ads/library/?id=1'),'');
});
test('endereços locais, credenciais embutidas e redes reservadas são rejeitados',()=>{
 for(const url of ['http://127.0.0.1:4310','http://10.0.0.1','http://[::1]','https://localhost/a','https://user:pass@example.com','https://example.com:4310','file:///C:/secret','javascript:alert(1)'])assert.equal(normalizeOfferUrl(url),'');
 for(const ip of ['127.0.0.1','169.254.169.254','100.64.0.1','192.168.1.2','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicIp(ip),false);assert.equal(publicIp('93.184.216.34'),true);
});
test('leitor fixa DNS validado e não segue redirecionamento para rede privada',async()=>{
 let calls=0;const service=createSiteReader({resolve:async()=>[{address:'93.184.216.34',family:4}],transport:async(url,addresses)=>{calls++;assert.equal(addresses[0].address,'93.184.216.34');return{status:302,location:'http://127.0.0.1/secret'};}});
 await assert.rejects(service.read('https://example.com'),/não permitido/);assert.equal(calls,1);
 const blocked=createSiteReader({resolve:async()=>[{address:'127.0.0.1',family:4}],transport:async()=>{throw Error('Não pode chamar');}});await assert.rejects(blocked.read('https://example.com'),/privada/);
});
test('redirecionamento público é validado novamente e texto não contém scripts',async()=>{
 const hosts=[];let count=0;const service=createSiteReader({resolve:async host=>{hosts.push(host);return[{address:'93.184.216.34',family:4}];},transport:async()=>++count===1?{status:302,location:'https://example.org/oferta'}:{status:200,html}});const value=await service.read('https://example.com');assert.deepEqual(hosts,['example.com','example.org']);assert.equal(value.headings[0].level,1);assert.ok(!JSON.stringify(value).includes('DO_NOT_INCLUDE'));assert.equal(value.url,'https://example.org/oferta');
});
test('página vazia ou com verificação de acesso não é tratada como referência completa',()=>{
 assert.throws(()=>parsePage('<title>Just a moment</title><p>'+ 'x'.repeat(200)+'</p>','https://example.com'),/verificação/);assert.throws(()=>parsePage('<div id="app"></div>','https://example.com'),/JavaScript/);
});
test('destino manual sobrevive à atualização e catálogo filtra sites sem carregar conteúdo pesado',t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),row=db.upsert({title:'Anúncio',referenceUrl:'https://www.facebook.com/ads/library/?id=123'});db.offerLink(row.id,'https://example.com/oferta','manual');db.upsert({source:'meta',externalId:'123',title:'Anúncio atualizado',referenceUrl:'https://www.facebook.com/ads/library/?id=123'});
 assert.equal(db.detail(row.id).offerUrl,'https://example.com/oferta');db.putSite(row.id,{source:{text:'x'.repeat(5000)},page:answer('site_plan'),sourceUrl:'https://example.com/oferta'});assert.equal(db.list({withSite:'true'}).total,1);assert.equal(db.list().ads[0].site.hasPage,true);assert.equal(db.list().ads[0].site.source,undefined);
});
test('análise e modelagem geram página própria sem copiar HTML da referência',async t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),row=db.upsert({title:'Anúncio',body:'Conheça https://example.com/oferta'});let calls=0;const service=createCreativeSite({db,meta:{},reader,workspace:{analyzeCreative:async input=>{calls++;return answer(input.stage);}}});
 await service.model(row.id,{brand:'Minha marca',contactUrl:'https://wa.me/5511999999999'},{businessContext:'Ronald cria sites para empresas'});assert.equal(calls,2);const output=service.render(row.id);assert.ok(output.includes('Minha marca'));assert.ok(output.includes('wa.me'));assert.ok(!output.includes('<script'));assert.ok(!output.includes('DO_NOT_INCLUDE'));
 await service.model(row.id,{brand:'Minha marca'},{businessContext:'Ronald cria sites para empresas'});assert.equal(calls,3);
});
test('falha da IA não apaga página anterior e destino desconhecido não consome IA',async t=>{
 const f=fixture(t),db=f.track(createCreativeDb(f.root)),row=db.upsert({title:'Anúncio',offerUrl:'https://example.com'});db.putSite(row.id,{sourceUrl:'https://example.com/',source:parsePage(html,'https://example.com/'),analysis:answer('site_reference'),page:answer('site_plan'),config:{brand:'Anterior'}});
 const service=createCreativeSite({db,meta:{},reader,workspace:{analyzeCreative:async()=>{throw Error('Cota simulada');}}});await assert.rejects(service.model(row.id,{brand:'Nova'},{businessContext:'Sites'}),/Cota/);assert.equal(db.detail(row.id).site.config.brand,'Anterior');const other=db.upsert({title:'Sem destino'});await assert.rejects(service.model(other.id,{}, {businessContext:'Sites'}),/não foi identificado/);
});
test('conteúdo editado é escapado e links executáveis são recusados',()=>{
 const page=answer('site_plan');page.hero.title='<script>alert("x")</script>';const output=renderSite({page,config:{brand:'Minha marca'}});assert.ok(output.includes('&lt;script&gt;'));assert.ok(!output.includes('<script>'));assert.throws(()=>renderSite({page,config:{contactUrl:'javascript:alert(1)'}}),/contato/);assert.ok(output.includes('noindex,nofollow'));
});
test('rotas reais de site protegem origem e exportam prévia isolada e HTML editável',async t=>{
 const f=fixture(t),miner=f.track(createCreativeMiner({root:f.root,credentials,autoStart:false,siteReader:reader,workspace:{analyzeCreative:async input=>answer(input.stage)}}));miner.importData({ads:[{title:'Referência',offerUrl:'https://example.com/'}]});const id=miner.snapshot().ads[0].id;miner.enqueue('site_model',{adId:id,siteConfig:{brand:'Minha marca'}});await until(()=>['done','failed'].includes(miner.snapshot().jobs[0].status));assert.equal(miner.snapshot().jobs[0].status,'done');
 let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port,base='http://127.0.0.1:'+port;handler=createRequestHandler({HOST:'127.0.0.1',PORT:port,getCreativeMiner:()=>miner,...createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:path.resolve(__dirname,'../public')})});
 let response=await fetch(base+'/api/creative-miner/ads/'+id+'/site/preview');assert.equal(response.status,200);assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');assert.ok(response.headers.get('content-security-policy').includes("default-src 'none'"));assert.ok((await response.text()).includes('Minha marca'));
 response=await fetch(base+'/api/creative-miner/ads/'+id+'/site/export');assert.match(response.headers.get('content-disposition'),/attachment/);
 response=await fetch(base+'/api/creative-miner/ads/'+id+'/site/link',{method:'PUT',headers:{origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({url:'https://example.org'})});assert.equal(response.status,403);
});
