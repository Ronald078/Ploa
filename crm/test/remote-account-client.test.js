'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRemoteAccountClient,accountOrigin,remoteCookies}=require('../cloud/remote-account-client');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',USER='11111111-1111-4111-8111-111111111111';
const response=()=>({headers:{},getHeader(name){return this.headers[name];},setHeader(name,value){this.headers[name]=value;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(){}});
const json=(res,status,data)=>{res.status=status;res.data=data;};
const request=(body={},cookie='')=>({method:'POST',headers:{cookie},body});
test('agente encaminha apenas cookies próprios e conserva expiração/HttpOnly sem chave de servidor',async()=>{
 let options;const client=createRemoteAccountClient({remoteOrigin:'https://accounts.example.invalid',readBody:async req=>req.body,fetch:async(url,value)=>{options=value;return new Response(JSON.stringify({user:{id:USER},message:'Acesso realizado.'}),{headers:{'Set-Cookie':'__Host-ploa_session=fixture-session; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000'}});}});
 const req=request({email:'fixture@example.invalid',password:'fixture'},'unrelated=private; ploa_preview_session=legacy; ploa_remote_session=old-fixture'),res=response();
 await client.accounts(req,res,new URL('https://local.invalid/api/cloud/login'),json);
 assert.equal(options.headers.Cookie,'__Host-ploa_session=old-fixture');assert.equal(options.redirect,'error');
 assert.match(res.headers['Set-Cookie'][0],/^ploa_remote_session=fixture-session; Path=\/; HttpOnly; /);assert.match(res.headers['Set-Cookie'][0],/Max-Age=2592000/);assert.doesNotMatch(res.headers['Set-Cookie'][0],/; Secure/);
 assert.doesNotMatch(JSON.stringify(res.data),/fixture-session|password/);assert.equal(remoteCookies({headers:{cookie:'unrelated=private'}}),'');
 for(const value of ['http://accounts.example.invalid','https://user:pass@accounts.example.invalid','https://127.0.0.1','https://accounts.example.invalid/path'])assert.throws(()=>accountOrigin(value));
});
test('entrada externa guarda segredo no backend e transporta sessão só após conclusão',async()=>{
 const secret='c'.repeat(43),ticket='t'.repeat(43),calls=[];
 const client=createRemoteAccountClient({remoteOrigin:'https://accounts.example.invalid',readBody:async req=>req.body,fetch:async(url,options)=>{calls.push({url,options});return url.endsWith('/start')?new Response(JSON.stringify({client:secret,url:'/device-login?ticket='+ticket,expiresIn:300})):new Response(JSON.stringify({completed:true}),{headers:{'Set-Cookie':'__Host-ploa_session=fixture-done; HttpOnly; Secure; SameSite=Strict; Max-Age=60'}});}});
 const res=response();await client.accounts(request({remember:true}),res,new URL('http://127.0.0.1:4313/api/cloud/desktop/start'),json);
 assert.doesNotMatch(JSON.stringify(res.data),new RegExp(secret));assert.match(res.data.url,/^\/desktop-login\?ticket=[a-f0-9]{64}$/);
 const browser=response();await client.accounts({method:'GET',headers:{}},browser,new URL(res.data.url,'http://127.0.0.1:4313'),json);assert.equal(browser.headers.Location,'https://accounts.example.invalid/device-login?ticket='+ticket);
 await assert.rejects(client.accounts({method:'GET',headers:{}},response(),new URL(res.data.url,'http://127.0.0.1:4313'),json),{status:410});
 const cookie=res.headers['Set-Cookie'][0].split(';')[0],done=response();await client.accounts(request({},cookie),done,new URL('http://127.0.0.1:4313/api/cloud/desktop/status'),json);
 assert.equal(calls[1].options.headers['x-ploa-device-client'],secret);assert.deepEqual(done.data,{completed:true});assert.ok(done.headers['Set-Cookie'].some(v=>v.startsWith('ploa_remote_session=fixture-done;')));
});
test('autorização da empresa vem do serviço e falha de rede não inventa acesso',async()=>{
 let allow=true;const client=createRemoteAccountClient({remoteOrigin:'https://accounts.example.invalid',readBody:async req=>req.body,fetch:async()=>{if(!allow)throw Error('private transport detail');return new Response(JSON.stringify({workspace:{id:ID,role:'owner'},session:{identity:{id:USER},kind:'normal'},access:{modules:Object.fromEntries(['dashboard','funnel','leads','search','messages','ai','copies','ads'].map(key=>[key,true]))}}));}});
 assert.equal((await client.resolveScope(request(),ID)).session.identity.id,USER);allow=false;
 await assert.rejects(client.resolveScope(request(),ID),e=>e.status===503&&!e.message.includes('private transport detail'));
 await assert.rejects(client.resolveScope(request(),'../other'),{status:409});
});
