'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createCloudHandler}=require('../cloud/http');
test('três destinos próprios, links antigos compatíveis e recuperação preservada',async()=>{
 const {ACCOUNT_PAGES,accountPageFromUrl}=await import('../app-next/src/account-pages.js');
 const {initialAccessView}=await import('../app-next/src/cloud/access-route.js');
 assert.equal(new Set(Object.values(ACCOUNT_PAGES).map(page=>page.path)).size,3);
 for(const[key,page]of Object.entries(ACCOUNT_PAGES))assert.equal(accountPageFromUrl('http://localhost'+page.path),key);
 assert.equal(accountPageFromUrl('http://localhost/'),null);
 assert.equal(accountPageFromUrl('http://localhost/?account=1#account-preferences'),'settings');
 assert.equal(accountPageFromUrl('http://localhost/?account=1#account-security'),'security');
 assert.equal(initialAccessView('http://localhost/seguranca?notice=recovery'),'reset');
 assert.equal(initialAccessView('http://localhost/configuracoes?notice=recovery_failed'),'recover');
});
test('recarregar páginas entrega a interface, sem dar acesso a dados ou operações sem sessão',async t=>{
 let handler;const server=http.createServer((req,res)=>handler(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 handler=createCloudHandler({origin,gateway:{}});
 t.after(async()=>{handler.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 for(const route of ['/conta','/configuracoes','/seguranca']){
   const response=await fetch(origin+route);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);
   assert.ok(!(await response.text()).includes('ronaldtoledo2008@gmail.com'));
 }
 for(const route of ['/api/cloud/session','/api/cloud/workspaces','/api/cloud/access'])assert.equal((await fetch(origin+route)).status,401);
 const change=await fetch(origin+'/api/cloud/email-security',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});assert.equal(change.status,401);
});
