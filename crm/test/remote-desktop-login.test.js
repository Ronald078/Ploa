'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRemoteDesktopLogin}=require('../cloud/remote-desktop-login');
const {CloudError}=require('../cloud/errors');
const {createHash}=require('node:crypto');
function fixture(){
 let clock=10000,verified=true;const rows=new Map(),headers={};
 const state={hash:v=>createHash('sha256').update(v).digest('hex'),
  async get(kind,key){const r=rows.get(key);return r&&r.until>clock?{value:structuredClone(r.value),version:r.version}:null;},
  async put(kind,key,value,ttl){if(await this.get(kind,key))return false;rows.set(key,{value:structuredClone(value),until:clock+ttl,version:1});return true;},
  async take(kind,key){const r=await this.get(kind,key);if(r)rows.delete(key);return r;},
  async lease(kind,key,lease){const r=await this.get(kind,key);if(!r||rows.get(key).lease)return null;rows.get(key).lease=lease;return r;},
  async write(kind,key,lease,version,value){const r=rows.get(key);if(!r||r.lease!==lease||r.version!==version)return false;r.value=structuredClone(value);r.version++;return true;},
  async release(kind,key,lease){const r=rows.get(key);if(r?.lease===lease)delete r.lease;}};
 const identity={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};
 const accounts={normalSession:async req=>{if(!verified||!req.headers.cookie?.includes('__Host-ploa_session=fixture-session'))throw new CloudError(401,'session','Sem sessão.');return{identity,remember:true,kind:'normal',deadline:clock+86400000};},verificationFor:async()=>null,restoreVerification:async()=>{}};
 const create=()=>createRemoteDesktopLogin({state,accounts,now:()=>clock,cookie:(req,name)=>req.cookies?.[name]|| (name==='__Host-ploa_session'?'fixture-session':undefined),setCookie:(res,value,maxAge,name='__Host-ploa_session')=>{res.cookies[name]={value,maxAge};},readBody:async req=>req.body||{},checkLoginRate:async()=>{}});
 const a=create(),b=create();
 async function call(handler,path,{body={},cookies={},secret}={}){const req={method:path.startsWith('/device-login')?'GET':'POST',headers:{...(secret?{'x-ploa-device-client':secret}:{}),cookie:'__Host-ploa_session=fixture-session'},body,cookies};const res={cookies:{},writeHead(status,h){this.status=status;this.headers=h;},end(){}};
  await handler.handle(req,res,new URL(path,'https://accounts.example.invalid'),(r,status,data)=>{r.status=status;r.data=data;});return res;}
 return{a,b,call,rows,create,setVerified:v=>{verified=v;},advance:ms=>{clock+=ms;}};
}
test('entrada remota sobrevive a outra instância e entrega só cookie HttpOnly após confirmação',async()=>{
 const f=fixture(),start=await f.call(f.a,'/api/cloud/device/start',{body:{remember:true}});
 assert.equal((await f.call(f.b,'/api/cloud/device/status',{secret:start.data.client})).data.completed,false);
 const opened=await f.call(f.b,start.data.url),browser=opened.cookies.ploa_desktop_browser.value;
 assert.equal(await f.create().pending({cookies:{ploa_desktop_browser:browser}}),true);
 await assert.rejects(f.call(f.a,start.data.url),{status:410});
 await f.call(f.a,'/api/cloud/desktop/complete',{cookies:{ploa_desktop_browser:browser}});
 const done=await f.call(f.create(),'/api/cloud/device/status',{secret:start.data.client});
 assert.deepEqual(done.data,{completed:true});
 assert.equal(done.cookies['__Host-ploa_session'].value,'fixture-session');assert.equal(done.cookies['__Host-ploa_session'].maxAge,86400);
 assert.doesNotMatch(JSON.stringify(done.data),/fixture-session|fixture@example/);
 await assert.rejects(f.call(f.b,'/api/cloud/device/status',{secret:start.data.client}),{status:410});
});
test('revogação, segredo incorreto, cancelamento e expiração não liberam a entrada remota',async()=>{
 const f=fixture(),start=await f.call(f.a,'/api/cloud/device/start');
 await assert.rejects(f.call(f.b,'/api/cloud/device/status',{secret:'inventado'}),{status:410});
 const opened=await f.call(f.a,start.data.url),cookies={ploa_desktop_browser:opened.cookies.ploa_desktop_browser.value};
 f.setVerified(false);await assert.rejects(f.call(f.b,'/api/cloud/desktop/complete',{cookies}),{status:401});
 f.setVerified(true);await f.call(f.a,'/api/cloud/desktop/complete',{cookies});f.setVerified(false);
 await assert.rejects(f.call(f.b,'/api/cloud/device/status',{secret:start.data.client}),{status:401});
 const cancelled=await f.call(f.a,'/api/cloud/device/start');await f.call(f.b,'/api/cloud/device/cancel',{secret:cancelled.data.client});await assert.rejects(f.call(f.a,cancelled.data.url),{status:410});
 const expired=await f.call(f.a,'/api/cloud/device/start');f.advance(300001);await assert.rejects(f.call(f.b,expired.data.url),{status:410});
});
