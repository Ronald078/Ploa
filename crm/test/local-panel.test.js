'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createCloudHandler}=require('../cloud/http');
const {CloudError}=require('../cloud/errors');
const {createAccountData}=require('../lib/account-data');
const {temporaryRoot}=require('./fixture-helpers');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const X='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',Y='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});
async function fixture(t){
 const root=temporaryRoot(t),code=path.join(root,'code');fs.mkdirSync(code);fs.writeFileSync(path.join(code,'leads.json'),'{"exclusivo":true}');
 const registry=createAccountData({directory:path.join(root,'local'),codeRoot:code,legacyBinding:{userId:A,workspaceId:X}}),resolved=[];
 const users={a:{id:A,email:'a@example.test'},b:{id:B,email:'b@example.test'}};
 const all=Object.fromEntries(['dashboard','funnel','leads','search','messages','ai','copies','ads'].map(k=>[k,true]));
 const flags={a:{...all},b:{...all}},gateway={emailAccess:async()=>true,requireWorkspace:async(token,identity,id)=>{
  if(id!==(identity.id===A?X:Y))throw new CloudError(404,'workspace','Empresa não encontrada.');
  return{id,name:identity.id===A?'Empresa A':'Empresa B',role:'owner'};
 }};
 const upstream=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({workspace:req.headers['x-ploa-local-token']}));});await listen(upstream);
 const runtimes={get:async data=>{resolved.push(data);return{port:upstream.address().port,token:data.workspaceId};},findLease:()=>null};
 const runtime={sessions:{resolve:async raw=>{if(!users[raw])throw new CloudError(401,'session','Entre novamente.');return{identity:users[raw],kind:'normal',accessToken:raw};},clear(){}}};
 const accessControl={access:async identity=>({administrator:identity.id===A,modules:{...flags[identity.id===A?'a':'b']}})};
 let handler;const app=http.createServer((req,res)=>handler(req,res));const origin=await listen(app);
 handler=createCloudHandler({origin,gateway,runtime,accessControl,localPanel:{registry,runtimes}});
 t.after(async()=>{handler.dispose();await close(app);await close(upstream);});
 const request=(route,{user='a',workspace=user==='a'?X:Y,method='GET',body,originHeader=origin}={})=>fetch(origin+route,{method,redirect:'manual',headers:{Cookie:(user?'ploa_preview_session='+user+'; ':'')+'ploa_active_workspace='+workspace,...(method!=='GET'?{Origin:originHeader,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return{request,registry,flags,resolved,code};
}
test('login/segundo fator e empresa autorizam o mesmo painel sem leitura cruzada',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/dashboard',{user:''})).status,401);assert.equal(f.resolved.length,0);
 assert.equal((await f.request('/app-next/dashboard',{user:''})).status,302);
 assert.equal((await f.request('/assets/ploa-logo-transparent.png',{user:''})).status,200);
 const a=await f.request('/api/dashboard');assert.equal((await a.json()).workspace,X);assert.equal(f.resolved[0].root,fs.realpathSync(f.code));
 const b=await f.request('/api/dashboard',{user:'b'});assert.equal((await b.json()).workspace,Y);assert.notEqual(f.resolved[1].root,f.code);
 const before=f.resolved.length;assert.equal((await f.request('/api/dashboard',{user:'b',workspace:X})).status,404);assert.equal(f.resolved.length,before);
 assert.equal((await f.request('/api/internal/next',{method:'POST',body:{}})).status,403);
});
test('bloqueio administrativo vale antes de iniciar processo e origem estrangeira não grava',async t=>{
 const f=await fixture(t);f.flags.b.messages=false;
 assert.equal((await f.request('/api/processes/messages/start',{user:'b',method:'POST',body:{}})).status,403);assert.equal(f.resolved.length,0);
 assert.equal((await f.request('/api/settings',{user:'b',method:'PUT',body:{},originHeader:'https://outro.example'})).status,403);
 assert.equal((await f.request('/app-next/messages',{user:'b'})).status,403);
 assert.equal((await f.request('/api/dashboard',{user:'b'})).status,200);
});
test('seleção e contexto não aceitam caminhos e não revelam diretório nem chave',async t=>{
 const f=await fixture(t);
 const selected=await f.request('/api/cloud/panel/open',{user:'b',method:'POST',body:{workspaceId:Y,root:f.code}});
 assert.equal(selected.status,200);assert.match(selected.headers.get('set-cookie'),/HttpOnly/);
 const response=await f.request('/api/account-context',{user:'b'}),value=await response.json();
 assert.equal(value.account.businessName,'Empresa B');assert.equal(value.setup.required,true);assert.equal(value.account.legacy,false);
 assert.equal(value.accountUrl,'/conta','Minha conta abre explicitamente o perfil sem redirecionar de volta');
 assert.doesNotMatch(JSON.stringify(value),/\.credentials|local-token|workspace\/|credenciais-ia/);
 const saved=await f.request('/api/account-setup',{user:'b',method:'PUT',body:{name:'Pessoa B',businessName:'Negócio B'}});assert.equal(saved.status,200);
 assert.equal((await f.request('/api/account-context',{user:'b'})).status,200);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.code,'leads.json'))),{exclusivo:true});
});
