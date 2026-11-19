'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createWorkspaceService}=require('../lib/workspace-service');
const {createRequestHandler}=require('../lib/http-routes');
const {createHttpTools}=require('../lib/http-tools');
const settings=require('../lib/operation-settings');
const {temporaryRoot}=require('./fixture-helpers');
const response=()=>({status:0,body:'',headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status){this.status=status;},end(body=''){this.body=body;}});

test('porta privada não aceita acesso direto, nem alteração em módulo bloqueado',async t=>{
 const root=temporaryRoot(t),token='a'.repeat(64),tools=createHttpTools({HOST:'127.0.0.1',PORT:4310,PUBLIC_ROOT:''});
 const handler=createRequestHandler({HOST:'127.0.0.1',PORT:4310,PROJECT_ROOT:root,bridgeToken:token,...tools,
  getProcessesSnapshot:()=>({}),scriptProcesses:new Map([['whatsapp',{}]]),activeProcessStatuses:new Set(['running']),...settings,
  workspace:{authorizeInternal:()=>false}});
 async function request(url,{method='GET',token:value,body,modules}={}){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:4310',origin:'http://127.0.0.1:4310','content-type':'application/json',...(value?{'x-ploa-local-token':value}:{}),...(modules?{'x-ploa-account-modules':JSON.stringify(modules)}:{})}});
  const result=response();await handler(req,result);return result;
 }
 assert.equal((await request('/api/processes')).status,403);
 assert.equal((await request('/api/processes',{token:'á'.repeat(64)})).status,403);
 assert.equal((await request('/api/processes',{token})).status,200);
 const original=await settings.readOperationSettings(root),changed=structuredClone(original);changed.messages.dailyLimit++;
 assert.equal((await request('/api/settings?section=search',{method:'PUT',token,body:changed,modules:{search:true,messages:false}})).status,403);
 assert.deepEqual(await settings.readOperationSettings(root),original);
 changed.messages=original.messages;changed.search.localities.push({market:'Brasil',city:'Localidade fictícia'});
 assert.equal((await request('/api/settings?section=search',{method:'PUT',token,body:changed,modules:{search:true,messages:false}})).status,200);
 assert.equal((await request('/api/internal/next',{method:'POST',body:{}})).status,403);
});

test('revogação entre preparar e entregar retém a mensagem, sem envio nem consulta à IA',async t=>{
 const root=temporaryRoot(t),contact='5511999999999';let allowed=true,generated=0;
 const denied=()=>Object.assign(new Error('Acesso bloqueado'),{code:'PLOA_ACCOUNT_ACCESS',statusCode:403});
 const workspace=createWorkspaceService(root,{getDashboard:async()=>({leads:[{id:contact,status:'respondeu'}]})},{credentialStore:{available:true,load:()=>({}),save(){}},authorize:async()=>{if(!allowed)throw denied();}});
 t.after(()=>workspace.close());
 await workspace.command(contact,{action:'message',text:'Mensagem fictícia'});allowed=false;
 await assert.rejects(workspace.nextDelivery(),{code:'PLOA_ACCOUNT_ACCESS'});
 assert.equal(workspace.read().jobs[0].status,'review');
 workspace.setProvider({hasKey:()=>true,generate:async()=>{generated++;throw Error('Não deveria consultar');},close(){}});
 await workspace.mutate(data=>{data.settings.enabled=true;data.jobs.push({id:'queued-fixture',contact,kind:'ai',status:'queued',dueAt:0,attempts:0});});
 const deadline=Date.now()+3500;
 while(workspace.read().jobs.at(-1).status==='queued'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(workspace.read().jobs.at(-1).status,'held');assert.equal(generated,0);assert.deepEqual(workspace.read().usage,{});
});
