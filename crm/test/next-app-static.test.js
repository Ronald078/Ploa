'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createHttpTools}=require('../lib/http-tools');
const {temporaryRoot}=require('./fixture-helpers');

test('dashboard React usa entrada própria; assets permitidos não expõem o projeto',async t=>{
 const root=temporaryRoot(t);fs.mkdirSync(path.join(root,'app-next/assets'),{recursive:true});
 fs.writeFileSync(path.join(root,'index.html'),'painel atual');fs.writeFileSync(path.join(root,'app-next/index.html'),'dashboard novo');
 fs.writeFileSync(path.join(root,'app-next/assets/index-test.js'),'compiled');
 let tools;const server=http.createServer(async(req,res)=>{if(!await tools.serveStatic(res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 tools=createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:root});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const get=route=>fetch('http://127.0.0.1:'+port+route);
 assert.equal(await(await get('/')).text(),'dashboard novo');
 assert.equal(await(await get('/operacao')).text(),'painel atual');
 for(const route of ['/app-next','/app-next/',...['dashboard','funnel','leads','copies','messages','search','ai'].flatMap(name=>['/app-next/'+name,'/app-next/'+name+'/'])]){
  const response=await get(route);assert.equal(response.status,200);assert.equal(await response.text(),'dashboard novo');
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
 }
 assert.match((await get('/app-next/assets/index-test.js')).headers.get('content-type'),/javascript/);
 for(const route of ['/app-next/missing','/app-next/assets/missing.js','/app-next/.vite/manifest.json','/app-next/src/main.jsx','/app-next/assets/index-test.js.map','/app-next/assets/../../leads.json','/api/missing'])assert.equal((await get(route)).status,404,route);
});
