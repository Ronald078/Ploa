'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {createCloudHandler}=require('../cloud/http');
const {CloudError}=require('../cloud/errors');
const {desktopEntry,desktopLoginUrl}=require('../lib/desktop-entry');
const {createRememberedVerification}=require('../cloud/remembered-verification');

async function fixture(t,{remember=false}={}){
 let verified=true,kind='normal',clock=1000,handler;
 const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const identity={id:'fixture-user',email:'fixture@example.invalid'},verifications=createRememberedVerification({now:()=>clock});
 const sessions={clear(){},resolve:async value=>{if(value!=='fixture-session')throw new CloudError(401,'session','Sem sessão');return{identity,accessToken:'fixture-access',kind,remember};}};
 handler=createCloudHandler({origin,now:()=>clock,gateway:{emailAccess:async()=>verified,capabilities:async()=>({google:true})},runtime:{sessions,verifications},localPanel:{registry:{},runtimes:{}},accessControl:{}});
 t.after(async()=>{handler.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const app=new Map(),browser=new Map([['ploa_preview_session','fixture-session']]);
 async function request(route,{jar=app,method='POST',foreign=false,body={}}={}){
  const response=await fetch(origin+route,{method,redirect:'manual',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(method==='POST'?{Origin:foreign?'https://example.test':origin,'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  for(const entry of response.headers.getSetCookie()){const first=entry.split(';')[0],at=first.indexOf('=');jar.set(first.slice(0,at),first.slice(at+1));}
  return response;
 }
 async function start(){const response=await request('/api/cloud/desktop/start');assert.equal(response.status,200);const {url}=await response.json();assert.equal((await request(url,{jar:browser,method:'GET'})).status,303);return url;}
 return{request,start,app,browser,proof:()=>verifications.issue(identity),revoke:()=>verifications.removeUser(identity.id),advance:ms=>{clock+=ms;},setVerified:value=>{verified=value;},setKind:value=>{kind=value;},expire:()=>{clock+=300001;}};
}

test('handoff leva a prova HttpOnly ao app, com prazo restante e revalidação de revogação',async t=>{
 const f=await fixture(t,{remember:true}),proof=await f.proof();f.browser.set('ploa_verified_device',proof.id);
 await f.start();await f.request('/api/cloud/desktop/complete',{jar:f.browser});f.advance(100000);
 const status=await f.request('/api/cloud/desktop/status');assert.equal(status.status,200);
 assert.equal(f.app.get('ploa_verified_device'),proof.id);assert.deepEqual(await status.json(),{completed:true});
 assert.ok(status.headers.getSetCookie().some(value=>value.startsWith('ploa_verified_device=')&&value.includes('HttpOnly')&&value.includes('Max-Age=500')));
 f.app.delete('ploa_verified_device');await f.start();await f.request('/api/cloud/desktop/complete',{jar:f.browser});await f.revoke();
 const revoked=await f.request('/api/cloud/desktop/status');assert.equal(revoked.status,200);assert.ok(!f.app.get('ploa_verified_device'));
});

test('nova entrada Google leva prova do app ao navegador somente pelo ticket privado',async t=>{
 const f=await fixture(t,{remember:true}),proof=await f.proof();f.app.set('ploa_verified_device',proof.id);
 const response=await f.request('/api/cloud/desktop/start',{body:{remember:true}}),data=await response.json();
 assert.equal(JSON.stringify(data).includes(proof.id),false);f.advance(60000);
 const opened=await f.request(data.url,{jar:f.browser,method:'GET'});assert.equal(opened.status,303);
 assert.equal(f.browser.get('ploa_verified_device'),proof.id);
 assert.ok(opened.headers.getSetCookie().some(value=>value.startsWith('ploa_verified_device=')&&value.includes('Max-Age=540')));
 f.browser.delete('ploa_verified_device');
 const recovery=await f.request('/api/cloud/desktop/start',{body:{remember:true,purpose:'recovery'}});
 await f.request((await recovery.json()).url,{jar:f.browser,method:'GET'});assert.ok(!f.browser.get('ploa_verified_device'),'recuperação não recebe atalho de 2FA');
});

test('aplicativo só recebe a sessão depois de entrada verificada e confirmação no navegador',async t=>{
 const f=await fixture(t),url=await f.start();
 assert.equal((await f.request(url,{jar:f.browser,method:'GET'})).status,410,'ticket de navegador é consumido uma vez');
 assert.equal((await (await f.request('/api/cloud/desktop/status')).json()).completed,false);
 assert.equal((await f.request('/api/cloud/desktop/status',{jar:new Map()})).status,410);
 f.setVerified(false);assert.equal((await f.request('/api/cloud/desktop/complete',{jar:f.browser})).status,401);
 f.setVerified(true);f.browser.set('ploa_preview_session','fixture-session');f.setKind('recovery');
 assert.equal((await f.request('/api/cloud/desktop/complete',{jar:f.browser})).status,403);
 f.setKind('normal');assert.equal((await f.request('/api/cloud/desktop/complete',{jar:f.browser})).status,200);
 assert.equal((await f.request('/api/cloud/desktop/complete',{jar:f.browser})).status,410);
 const result=await f.request('/api/cloud/desktop/status');assert.equal(result.status,200);assert.deepEqual(await result.json(),{completed:true});
 assert.equal(f.app.get('ploa_preview_session'),'fixture-session');assert.equal((await f.request('/api/cloud/desktop/status')).status,410);
});

test('revogação antes do retorno, cancelamento e expiração não liberam a conta',async t=>{
 const f=await fixture(t);await f.start();await f.request('/api/cloud/desktop/complete',{jar:f.browser});f.setVerified(false);
 assert.equal((await f.request('/api/cloud/desktop/status')).status,401);assert.notEqual(f.app.get('ploa_preview_session'),'fixture-session');
 f.setVerified(true);f.browser.set('ploa_preview_session','fixture-session');await f.start();await f.request('/api/cloud/desktop/cancel');
 assert.equal((await f.request('/api/cloud/desktop/complete',{jar:f.browser})).status,410);
 await f.start();f.expire();assert.equal((await f.request('/api/cloud/desktop/complete',{jar:f.browser})).status,410);
 assert.equal((await f.request('/api/cloud/desktop/start',{foreign:true})).status,403);
});

test('entrada de piloto preserva a atual e não abre URL externa arbitrária',()=>{
 const root=path.resolve('code'),old=desktopEntry(root),next=desktopEntry(root,{accounts:true});
 assert.equal(old.port,4310);assert.equal(next.port,4313);assert.match(next.server,/local-preview\.js$/);assert.equal(next.url,next.origin+'/?desktop=1');
 const url=next.origin+'/desktop-login?ticket='+'a'.repeat(64);assert.equal(desktopLoginUrl(url,next.origin),url);
 for(const invalid of ['https://example.test/desktop-login?ticket='+'a'.repeat(64),next.origin+'/desktop-login?ticket=wrong',url+'&extra=1',url+'#x','file:///test'])assert.equal(desktopLoginUrl(invalid,next.origin),null);
});

test('recuperação do desktop começa no navegador correto, sem enviar e-mail pela janela',async t=>{
 const f=await fixture(t);
 const start=await f.request('/api/cloud/desktop/start',{body:{purpose:'recovery'}}),value=await start.json();assert.equal(value.expiresIn,900);
 const browser=await f.request(value.url,{jar:f.browser,method:'GET'});assert.match(browser.headers.get('location'),/desktop_recover=1/);
 f.expire();assert.equal((await (await f.request('/api/cloud/desktop/status')).json()).completed,false,'recuperação tem prazo próprio, maior que a entrada comum');
 f.expire();f.expire();assert.equal((await f.request('/api/cloud/desktop/status')).status,410);
 assert.equal((await f.request('/api/cloud/desktop/start',{body:{purpose:'unknown'}})).status,400);
});

test('link de recuperação válido escolhe a tela de senha desde a primeira renderização',async()=>{
 const {initialAccessView}=await import('../app-next/src/cloud/access-route.js');
 assert.equal(initialAccessView('http://127.0.0.1:4313/?notice=recovery'),'reset');
 assert.equal(initialAccessView('http://127.0.0.1:4313/?desktop_recover=1'),'recover');
 assert.equal(initialAccessView('http://127.0.0.1:4313/?notice=recovery_failed'),'recover');
 assert.equal(initialAccessView('http://127.0.0.1:4313/'),'login');
});
