'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createCloudHandler,readBody}=require('../cloud/http');
const {createRemoteAccountClient}=require('../cloud/remote-account-client');

test('HTTP distribuído preserva sessão após reinícios e falha de rede; logout invalida cookie antigo',async t=>{
 const publicOrigin='https://accounts.example.invalid',identity={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};
 let persisted={},outage=false,publicHandler,agentHandler;
 const persistence={available:true,load:()=>structuredClone(persisted),save:value=>{persisted=structuredClone(value);}};
 const gateway={
  async user(token){assert.equal(token,'fixture-access');return identity;},
  async signIn(){return{accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000};},
  async signOut(){},async security(){return{email2fa:false};},async emailAccess(){return true;},
  async capabilities(){return{google:false,signup:true};}
 };
 const upstream=http.createServer((req,res)=>{req.headers.host='accounts.example.invalid';publicHandler(req,res);});
 const agent=http.createServer((req,res)=>agentHandler(req,res));
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 await new Promise(resolve=>agent.listen(0,'127.0.0.1',resolve));
 const upstreamAddress='http://127.0.0.1:'+upstream.address().port,agentAddress='http://127.0.0.1:'+agent.address().port;
 function startPublic(){publicHandler=createCloudHandler({origin:publicOrigin,gateway,persistence});}
 function startAgent(){
  const remote=createRemoteAccountClient({remoteOrigin:publicOrigin,readBody,fetch:async(url,options)=>{
   assert.ok(url.startsWith(publicOrigin+'/api/cloud/'));
   if(outage)throw new Error('fixture network outage');
   return fetch(upstreamAddress+url.slice(publicOrigin.length),options);
  }});
  agentHandler=createCloudHandler({origin:agentAddress,gateway:{},remote});
 }
 startPublic();startAgent();
 t.after(async()=>{publicHandler.dispose();agentHandler.dispose();for(const server of [agent,upstream]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
 const jar=new Map();
 async function call(route,body){
  const response=await fetch(agentAddress+'/api/cloud/'+route,{method:body?'POST':'GET',headers:{Origin:agentAddress,...(body?{'Content-Type':'application/json'}:{}),Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{})});
  for(const line of response.headers.getSetCookie()){const pair=line.split(';')[0],at=pair.indexOf('=');if(pair.slice(at+1))jar.set(pair.slice(0,at),pair.slice(at+1));else jar.delete(pair.slice(0,at));}
  return response;
 }
 const login=await call('login',{email:identity.email,password:'fixture-password',remember:true});
 assert.equal(login.status,200);assert.deepEqual((await login.json()).user,identity);
 const sessionCookie=jar.get('ploa_remote_session');assert.ok(sessionCookie);
 assert.equal(jar.has('__Host-ploa_session'),false);
 assert.ok(login.headers.getSetCookie().some(value=>value.startsWith('ploa_remote_session=')&&value.includes('HttpOnly')&&value.includes('Max-Age=2592000')));
 assert.equal((await call('session')).status,200);
 agentHandler.dispose();startAgent();assert.equal((await call('session')).status,200,'reinício do agente não depende do mapa de vínculos temporários');
 publicHandler.dispose();startPublic();assert.equal((await call('session')).status,200,'sessão lembrada recuperada do armazenamento persistente');
 outage=true;const unavailable=await call('session');assert.equal(unavailable.status,503);assert.equal(jar.get('ploa_remote_session'),sessionCookie);outage=false;
 assert.equal((await call('session')).status,200,'mesmo cookie retoma após recuperação de rede');
 assert.equal((await call('logout',{})).status,200);assert.equal(jar.has('ploa_remote_session'),false);assert.equal((await call('session')).status,401);
 jar.set('ploa_remote_session',sessionCookie);const stale=await call('session');assert.equal(stale.status,401);assert.equal(jar.has('ploa_remote_session'),false,'resposta 401 limpa cookie antigo do agente');
 assert.deepEqual(persisted,{});
});
