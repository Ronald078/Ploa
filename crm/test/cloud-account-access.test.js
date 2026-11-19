'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {MODULES,createAccountAccess}=require('../cloud/account-access');
const {createCloudHandler}=require('../cloud/http');
const {CloudError}=require('../cloud/errors');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',W='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function accessFixture(){
 const blocks=new Map(),calls=[],all=()=>Object.fromEntries(MODULES.map(m=>[m.key,true]));
 const provider=createAccountAccess({url:'https://vucwevapknncmmnumuja.supabase.co',serverKey:'sb_secret_'+'fake_secret_'.repeat(3),fetch:async(url,options)=>{
  assert.equal(options.redirect,'error');const body=JSON.parse(options.body);calls.push(body);const name=url.split('/').pop();
  let result;
  if(name==='ploa_account_access')result={administrator:body.p_user===A,modules:{...all(),...blocks.get(body.p_user)}};
  else if(name==='ploa_admin_accounts'){assert.equal(body.p_actor,A);result={accounts:[{id:B,email:'member@example.invalid',confirmed:true,modules:blocks.get(B)||{}}]};}
  else if(name==='ploa_admin_set_feature'){assert.equal(body.p_actor,A);blocks.set(body.p_user,{...blocks.get(body.p_user),[body.p_module]:body.p_enabled});result={changed:true};}
  return new Response(JSON.stringify(result));
 }});
 return{provider,calls,blocks};
}
test('novas contas recebem todas as funções e permissões não dependem de metadados',async()=>{
 const f=accessFixture();const result=await f.provider.access({id:B,user_metadata:{administrator:true}});
 assert.equal(result.administrator,false);assert.equal(Object.values(result.modules).every(Boolean),true);assert.equal(Object.keys(result.modules).length,8);
 assert.deepEqual(f.calls[0],{p_user:B});
});
test('usuário comum não consulta contas nem altera a própria liberação',async()=>{
 const f=accessFixture();await assert.rejects(f.provider.accounts({id:B}),{status:403});
 await assert.rejects(f.provider.setFeature({id:B},{accountId:B,module:'ai',enabled:true}),{status:403});
 assert.equal(f.calls.some(c=>Object.hasOwn(c,'p_actor')),false);
});
test('bloqueio/reliberação são frescos, por conta, e o ator não vem do corpo enviado',async()=>{
 const f=accessFixture();await f.provider.setFeature({id:A},{accountId:B,module:'copies',enabled:false});
 await assert.rejects(f.provider.requireModule({id:B},'copies'),{status:403,code:'module_blocked'});
 await f.provider.requireModule({id:A},'copies');
 await assert.rejects(f.provider.setFeature({id:A},{accountId:B,module:'ai',enabled:false,p_actor:B}),{status:400});
 await f.provider.setFeature({id:A},{accountId:B,module:'copies',enabled:true});await f.provider.requireModule({id:B},'copies');
 await assert.rejects(f.provider.requireModule({id:A},'unknown'),{status:404});
});
test('falha de rede ou matriz incompleta não libera uma função por omissão',async()=>{
 for(const fetcher of [async()=>{throw Error('secret fixture');},async()=>new Response(JSON.stringify({administrator:false,modules:{ai:true}}))]){
  const f=createAccountAccess({url:'https://vucwevapknncmmnumuja.supabase.co',serverKey:'sb_secret_'+'x'.repeat(30),fetch:fetcher});
  await assert.rejects(f.requireModule({id:B},'ai'),error=>error.status===503&&!error.message.includes('secret fixture'));
 }
});
test('HTTP exige sessão, rejeita administração comum e bloqueia antes de executar o módulo',async t=>{
 const f=accessFixture();let executions=0,handler,role='owner';
 const gateway={user:async token=>({id:token,email:token===A?'admin@example.invalid':'member@example.invalid'}),signIn:async email=>({accessToken:email.startsWith('admin')?A:B,refreshToken:'fixture',expiresAt:Date.now()+3600000}),signOut:async()=>{},
  requireWorkspace:async(_token,_identity,id)=>{if(id!==W)throw new CloudError(404,'workspace','Empresa não encontrada.');return{id:W,role};}};
 const server=http.createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 handler=createCloudHandler({origin:base,gateway,accessControl:f.provider,moduleHandlers:{copies:async({json,res})=>{executions++;json(res,200,{ok:true});}}});
 t.after(async()=>{handler.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));});
 async function call(route,body,cookie){return fetch(base+'/api/cloud/'+route,{method:body?'POST':'GET',headers:{...(body?{Origin:base,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});}
 async function login(email){const res=await call('login',{email,password:'fixture-password'});assert.equal(res.status,200);return res.headers.getSetCookie().find(c=>c.startsWith('ploa_preview_session=')).split(';')[0];}
 assert.equal((await call('access')).status,401);const admin=await login('admin@example.invalid'),member=await login('member@example.invalid');
 assert.equal((await call('admin/accounts',null,member)).status,403);
 assert.equal((await call('admin/features',{accountId:B,module:'copies',enabled:false},member)).status,403);
 assert.equal((await call('admin/features',{accountId:B,module:'copies',enabled:false},admin)).status,200);
 const resource='workspaces/'+W+'/modules/copies';assert.equal((await call(resource,null,member)).status,403);assert.equal(executions,0);
 assert.equal((await call('admin/features',{accountId:B,module:'copies',enabled:true},admin)).status,200);
 assert.equal((await call(resource,null,member)).status,200);assert.equal(executions,1);
 assert.equal((await call('workspaces/'+A+'/modules/copies',null,member)).status,404);
 const scope=await call('desktop/workspace',{workspaceId:W},member);assert.equal(scope.status,200);
 const safe=await scope.json();assert.equal(safe.session.identity.id,B);assert.equal(safe.workspace.role,'owner');assert.equal(safe.session.accessToken,undefined);assert.equal(safe.session.refreshToken,undefined);
 role='viewer';assert.equal((await call('desktop/workspace',{workspaceId:W},member)).status,403);role='owner';
 assert.equal((await call('desktop/workspace',{workspaceId:A},member)).status,404);
});
