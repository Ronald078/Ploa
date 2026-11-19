'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {randomBytes}=require('node:crypto');
const {createStateCrypto}=require('../cloud/state-crypto');
const {createSharedState}=require('../cloud/shared-state');
const {createSharedRuntime}=require('../cloud/shared-runtime');
const {createSharedSessions}=require('../cloud/shared-sessions');
const {createCloudHandler}=require('../cloud/http');
const {CloudError}=require('../cloud/errors');
const {loadConfig}=require('../cloud/config');
const {withStateKey}=require('../cloud/state-key-settings');
const {createRememberedVerification}=require('../cloud/remembered-verification');
const key=randomBytes(32).toString('base64'),serverKey='sb_secret_'+'synthetic_server_only_'.repeat(2);
const url='https://vucwevapknncmmnumuja.supabase.co';
const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};

function sharedFixture(){
  let clock=10000,refreshes=0;const rows=new Map(),limits=new Map(),calls=[];
  const credentials=()=>({accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:clock+3600000});
  const fetcher=async(target,options)=>{
    assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,serverKey);
    const op=new URL(target).pathname.split('/').pop().replace('ploa_',''),p=JSON.parse(options.body);calls.push({op,p});
    const id=p.p_kind+':'+p.p_key;let row=rows.get(id),out=null;
    const alive=row&&row.until>clock;
    const clone=r=>r?{envelope:structuredClone(r.envelope),version:r.version}:null;
    if(op==='state_read')out=alive?clone(row):null;
    else if(op==='state_put'){out=!alive;if(out)rows.set(id,{envelope:p.p_envelope,version:(row?.version||0)+1,until:clock+p.p_ttl_ms,user:p.p_user,lease:null});}
    else if(op==='state_take'){if(alive&&(!p.p_lease||row.lease===p.p_lease&&row.leasedUntil>clock)){out=clone(row);rows.delete(id);}}
    else if(op==='state_lease'){if(alive&&(!row.lease||row.leasedUntil<=clock)){row.lease=p.p_lease;row.leasedUntil=clock+30000;out=clone(row);}}
    else if(op==='state_write'){out=Boolean(alive&&row.lease===p.p_lease&&row.leasedUntil>clock&&row.version===p.p_version);if(out){row.envelope=p.p_envelope;row.version++;row.lease=null;}}
    else if(op==='state_release'){if(row?.lease===p.p_lease)row.lease=null;}
    else if(op==='state_remove_user'){for(const[k,v]of rows)if(k.startsWith(p.p_kind+':')&&v.user===p.p_user)rows.delete(k);}
    else if(op==='limit_hit'){let item=limits.get(p.p_key);if(!item||item.until<=clock){item={hits:0,until:clock+p.p_window_ms};limits.set(p.p_key,item);}item.hits++;out=item.hits<=p.p_limit;}
    return new Response(JSON.stringify(out));
  };
  const config={url,serverKey,stateKey:key,origin:'https://ploa.example.invalid'};
  const state=()=>createSharedState({...config,fetch:fetcher});
  const gateway={async user(){return user;},async signIn(){return credentials();},async signOut(){},async security(){return{email2fa:false};},async emailAccess(){return true;},async capabilities(){return{google:false,signup:true};},async workspaces(){return[];},async refresh(){refreshes++;await new Promise(r=>setTimeout(r,10));return credentials();}};
  return{rows,calls,config,gateway,state,credentials,now:()=>clock,advance:ms=>{clock+=ms;},get refreshes(){return refreshes;}};
}

test('encryption binds each record to its kind/key, rejects tampering and separates identifier hashing',()=>{
  const cipher=createStateCrypto(key),envelope=cipher.seal('session','id',{refreshToken:'secret-fixture'});
  assert.equal(JSON.stringify(envelope).includes('secret-fixture'),false);
  assert.deepEqual(cipher.open('session','id',envelope),{refreshToken:'secret-fixture'});
  assert.throws(()=>cipher.open('flow','id',envelope),{code:'state_protection'});
  assert.throws(()=>cipher.open('session','other',envelope),{code:'state_protection'});
  assert.throws(()=>cipher.open('session','id',{...envelope,data:'AAAA'}),{code:'state_protection'});
  assert.equal(cipher.hash('ip-fixture').length,64);assert.throws(()=>createStateCrypto('invalid'));
});

test('two instances restore sessions after restart and logout revokes access everywhere',async()=>{
  const f=sharedFixture(),a=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now}),b=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now});
  const login=await a.create(f.credentials(),{remember:true});assert.equal(login.maxAge,2592000);
  assert.equal((await b.resolve(login.id)).identity.id,user.id);a.clear();
  assert.equal((await b.resolve(login.id)).identity.id,user.id);
  assert.equal(JSON.stringify([...f.rows.values()]).includes('fixture-refresh'),false);
  await b.remove(login.id);await assert.rejects(a.resolve(login.id),{status:401});
});

test('confirmação lembrada é cifrada, sobrevive a reinício e expira em dez minutos sem deslizar',async()=>{
 const f=sharedFixture(),a=createRememberedVerification({state:f.state(),now:f.now});
 const proof=await a.issue(user);a.clear();
 const b=createRememberedVerification({state:f.state(),now:f.now});f.advance(599999);
 assert.equal((await b.check(proof.id,user)).until,proof.until);
 assert.equal(await b.check(proof.id,{...user,id:'other'}),null);
 assert.equal(await b.check(proof.id,{...user,email:'changed@example.invalid'}),null);
 assert.equal(await b.check('inventado',user),null);
 assert.ok(!JSON.stringify([...f.rows.values()]).includes(user.email));
 f.advance(1);assert.equal(await b.check(proof.id,user),null);
 const second=await b.issue(user);await a.removeUser(user.id);assert.equal(await b.check(second.id,user),null);
});

test('concurrent instances rotate an expiring refresh token only once',async()=>{
  const f=sharedFixture(),a=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now}),b=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now});
  const login=await a.create({...f.credentials(),expiresAt:f.now()+100});
  await Promise.all([a.resolve(login.id),b.resolve(login.id)]);assert.equal(f.refreshes,1);
});

test('logout during refresh cannot resurrect a removed shared session',async()=>{
  const f=sharedFixture();let begin,finish;
  const started=new Promise(r=>{begin=r;});const wait=new Promise(r=>{finish=r;});
  f.gateway.refresh=async()=>{begin();await wait;return f.credentials();};
  const a=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now}),b=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now});
  const login=await a.create({...f.credentials(),expiresAt:f.now()});
  const pending=a.resolve(login.id);await started;await b.remove(login.id);finish();
  await assert.rejects(pending,{status:401});await assert.rejects(b.resolve(login.id),{status:401});
});

test('normal/recovery lifetimes remain bounded and password changes remove every user session',async()=>{
  const f=sharedFixture(),a=createSharedSessions({state:f.state(),gateway:f.gateway,now:f.now});
  const recovery=await a.create(f.credentials(),{kind:'recovery'});const normal=await a.create(f.credentials());
  f.advance(900001);await assert.rejects(a.resolve(recovery.id),{status:401});assert.equal((await a.resolve(normal.id)).kind,'normal');
  await a.removeUser(user.id);await assert.rejects(a.resolve(normal.id),{status:401});
});

test('shared PKCE survives an instance restart, preserves wrong-browser rejection and prevents replay',async()=>{
  const f=sharedFixture(),a=createSharedRuntime({config:f.config,gateway:f.gateway,mailer:{},state:f.state(),now:f.now}),b=createSharedRuntime({config:f.config,gateway:f.gateway,mailer:{},state:f.state(),now:f.now});
  const flow=await a.flows.create('recovery');a.flows.clear();
  await assert.rejects(b.flows.consume(flow.id,'x'.repeat(43)),{status:400});
  assert.equal((await b.flows.consume(flow.id,flow.id)).kind,'recovery');
  await assert.rejects(a.flows.consume(flow.id,flow.id),{status:400});
  const signup=await a.flows.create('signup');assert.equal((await b.flows.consumeConfirmation(signup.id)).kind,'signup');
});

test('email codes, cooldown and five attempts are enforced across instances and restarts',async()=>{
  const f=sharedFixture();let code;const mailer={async sendCode(_email,value){code=value;}};
  const a=createSharedRuntime({config:f.config,gateway:f.gateway,mailer,state:f.state(),now:f.now}),b=createSharedRuntime({config:f.config,gateway:f.gateway,mailer,state:f.state(),now:f.now});
  const challenge=await a.challenges.issue(user,f.credentials());a.challenges.clear();
  assert.equal((await b.challenges.status(challenge.id)).expiresIn,300);
  await assert.rejects(b.challenges.issue(user,f.credentials()),{status:429});
  const wrong=code==='100000'?'200000':'100000';
  for(let i=0;i<4;i++)await assert.rejects((i%2?a:b).challenges.consume(challenge.id,wrong),{code:'email_code'});
  await assert.rejects(b.challenges.consume(challenge.id,wrong),{code:'email_attempts'});
  await assert.rejects(a.challenges.consume(challenge.id,code),{code:'email_expired'});
  f.advance(61000);const next=await b.challenges.issue(user,f.credentials());
  assert.equal((await a.challenges.consume(next.id,code)).identity.id,user.id);
  await assert.rejects(b.challenges.consume(next.id,code),{code:'email_expired'});
});

test('database/network failures stay closed and never expose a server key or raw error',async()=>{
  const state=createSharedState({url,serverKey,stateKey:key,fetch:async()=>{throw Error('leak '+serverKey);}});
  await assert.rejects(state.get('session','a'.repeat(64)),error=>error.status===503&&!error.message.includes(serverKey));
  assert.throws(()=>createSharedState({url:'https://other.supabase.co',serverKey,stateKey:key}));
});

test('display receipts also survive instance restarts without granting a session',async()=>{
  const f=sharedFixture(),a=createSharedRuntime({config:f.config,gateway:f.gateway,mailer:{},state:f.state(),now:f.now}),b=createSharedRuntime({config:f.config,gateway:f.gateway,mailer:{},state:f.state(),now:f.now});
  const id=await a.confirmations.issue();a.confirmations.clear();assert.equal(await b.confirmations.has(id),true);
  await assert.rejects(b.sessions.resolve(id),{status:401});await b.confirmations.remove(id);assert.equal(await a.confirmations.has(id),false);
});

test('the explicit Windows shared preview saves one encryption key and never falls back in production',()=>{
  let saved={};const store={load:()=>saved,save:value=>{saved=value;}};
  const first=withStateKey({stateMode:'shared',production:false},{store});
  assert.equal(Buffer.from(first.stateKey,'base64').length,32);assert.equal(withStateKey({stateMode:'shared'},{store}).stateKey,first.stateKey);
  assert.throws(()=>withStateKey({stateMode:'shared',production:true},{store:{load(){assert.fail();}}}),{code:'state_configuration'});
});

test('production requires HTTPS/shared secrets and never reads a Windows encryption key',()=>{
  const base={PLOA_SUPABASE_URL:url,PLOA_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
  assert.equal(loadConfig(base).host,'127.0.0.1');assert.equal(loadConfig(base).stateMode,'local');
  const env={...base,PLOA_SERVER_MODE:'production',PLOA_PUBLIC_ORIGIN:'https://ploa.example.invalid',PLOA_SERVER_STATE_KEY:key,PLOA_SUPABASE_SERVER_KEY:serverKey};
  assert.equal(loadConfig(env).host,'0.0.0.0');
  for(const patch of [{PLOA_PUBLIC_ORIGIN:'http://ploa.example.invalid'},{PLOA_STATE_MODE:'local'},{PLOA_SERVER_STATE_KEY:''},{PLOA_SUPABASE_SERVER_KEY:''}])assert.throws(()=>loadConfig({...env,...patch}));
  assert.equal(withStateKey(loadConfig(env),{store:{load(){assert.fail();}}}).stateKey,key);
});

test('two HTTP instances share sessions and rate limits, use Secure cookies and preserve state on close',async t=>{
  const f=sharedFixture(),servers=[],handlers=[];
  for(let i=0;i<2;i++){
    const runtime=createSharedRuntime({config:f.config,gateway:f.gateway,mailer:{},state:f.state(),now:f.now});
    const handler=createCloudHandler({origin:f.config.origin,gateway:f.gateway,runtime,now:f.now});handlers.push(handler);
    const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);
  }
  t.after(async()=>{handlers.forEach(h=>h.dispose());for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}});
  const call=(index,path,body,cookie)=>new Promise((resolve,reject)=>{
    const req=http.request('http://127.0.0.1:'+servers[index].address().port+path,{method:body?'POST':'GET',headers:{Host:'ploa.example.invalid',...(body?{Origin:f.config.origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers=new Headers();for(const [name,value]of Object.entries(res.headers))for(const item of Array.isArray(value)?value:[value])headers.append(name,item);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  const login=await call(0,'/api/cloud/login',{email:user.email,password:'fixture',remember:true});assert.equal(login.status,200);
  const sessionCookie=login.headers.getSetCookie().find(c=>c.startsWith('__Host-ploa_session='));assert.match(sessionCookie,/; Secure/);
  const cookie=sessionCookie.split(';')[0];assert.equal((await call(1,'/api/cloud/session',null,cookie)).status,200);
  // A provider outage must not turn a remembered login into a local logout.
  const availableUser=f.gateway.user,availableCapabilities=f.gateway.capabilities;
  f.gateway.user=f.gateway.capabilities=async()=>{throw new CloudError(503,'provider_unavailable','Serviço indisponível.');};
  for(const route of ['/api/cloud/capabilities','/api/cloud/session']){
    const unavailable=await call(1,route,null,cookie);
    assert.equal(unavailable.status,503);
    assert.ok(!unavailable.headers.getSetCookie().some(value=>value.startsWith('__Host-ploa_session=')&&value.includes('Max-Age=0')));
  }
  f.gateway.user=availableUser;f.gateway.capabilities=availableCapabilities;
  const resumed=await call(1,'/api/cloud/session',null,cookie);
  assert.equal(resumed.status,200);assert.equal((await resumed.json()).remember,true);
  handlers[0].dispose();assert.equal((await call(1,'/api/cloud/workspaces',null,cookie)).status,200);
  for(let i=0;i<9;i++)assert.equal((await call(1,'/api/cloud/login',{email:user.email,password:'fixture'})).status,200);
  assert.equal((await call(1,'/api/cloud/login',{email:user.email,password:'fixture'})).status,429);
  assert.equal((await call(1,'/api/cloud/logout',{},cookie)).status,200);
  assert.equal((await call(1,'/api/cloud/session',null,cookie)).status,401);
  assert.equal(JSON.stringify(f.calls).includes('fixture@example.invalid'),false);
});
