'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createCloudHandler}=require('../cloud/http');
const {APPROVED}=require('../cloud/public-information');
test('informações públicas exigem ativação explícita e texto aprovado; APIs continuam protegidas',async t=>{
 let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,gateway={};
 t.after(async()=>{handler.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 for(const mode of [undefined,'published','draft']){
  handler=createCloudHandler({origin,gateway,informationPages:mode});
  for(const route of ['/sobre','/privacidade','/termos']){
   const enabled=mode==='draft'||mode==='published'&&APPROVED;
   const response=await fetch(origin+route);assert.equal(response.status,enabled?200:404);
   if(enabled){const text=await response.text();assert.match(text,/Ronald Toledo Santiago/);assert.doesNotMatch(text,/<script\b/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    if(mode==='draft'){assert.match(text,/Prévia para revisão/);assert.match(text,/noindex, nofollow/);}
    else{assert.doesNotMatch(text,/Prévia para revisão|Decisão pendente|class="review-note"/);assert.match(text,/index, follow/);}
   }
  }
  assert.equal((await fetch(origin+'/api/cloud/workspaces')).status,401,'páginas informativas não liberam APIs de contas');handler.dispose();
 }
});
