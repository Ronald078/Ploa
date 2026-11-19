'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createLocalRuntimes}=require('../cloud/local-runtimes');
const {temporaryRoot}=require('./fixture-helpers');

test('uma execução por empresa usa código comum, dados próprios e autorização privada',async t=>{
 const root=temporaryRoot(t),calls=[];
 const pool=createLocalRuntimes({codeRoot:root,origin:'http://127.0.0.1:4313',getPort:async()=>41234,probe:async()=>true,
  spawn(exe,args,options){
   const child=new EventEmitter();Object.assign(child,{connected:true,exitCode:null,stdout:new EventEmitter(),stderr:new EventEmitter()});
   child.send=(message,callback)=>{assert.equal(message.type,'ploa-shutdown');child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));callback?.();};
   child.kill=()=>{child.exitCode=1;queueMicrotask(()=>child.emit('exit',1));};calls.push({exe,args,options,child});return child;
  }});
 t.after(()=>pool.close());
 const data={root:path.join(root,'tenant'),workspaceId:'workspace-a',accountId:'account-a',legacy:false};
 const [a,b]=await Promise.all([pool.get(data,{cookie:'first'}),pool.get(data,{cookie:'first'})]);
 assert.equal(a,b);assert.equal(calls.length,1);
 assert.equal(calls[0].args[0],path.join(root,'crm/server.js'));
 assert.equal(calls[0].options.env.PLOA_DATA_ROOT,data.root);assert.equal(calls[0].options.env.PLOA_ACCOUNT_WORKER,'1');
 assert.equal(calls[0].options.windowsHide,true);assert.match(a.token,/^[a-f0-9]{64}$/);assert.notEqual(a.lease,a.token);
 assert.equal(pool.findLease(a.lease),a);assert.equal(pool.findLease(a.token),null);
 await pool.get(data,{cookie:'renewed'});assert.equal(a.context.cookie,'renewed');
 await assert.rejects(pool.get({...data,accountId:'another'},{}),{status:403});
 await pool.close();assert.equal(calls[0].child.exitCode,0);assert.equal(pool.findLease(a.lease),null);
});

test('operação antiga aberta impede duplicar a sessão do dono',async()=>{
 let calls=0;const pool=createLocalRuntimes({codeRoot:process.cwd(),origin:'http://127.0.0.1:4313',probe:async()=>true,spawn(){calls++;}});
 await assert.rejects(pool.get({legacy:true,workspaceId:'owner'},{}),error=>error.code==='legacy_running');assert.equal(calls,0);await pool.close();
});

test('outra conta não recebe o worker nem substitui sua autorização durante a inicialização',async t=>{
 let release,started;const waiting=new Promise(resolve=>{release=resolve;}),created=new Promise(resolve=>{started=resolve;});
 const pool=createLocalRuntimes({codeRoot:temporaryRoot(t),origin:'http://127.0.0.1:4313',getPort:async()=>41235,
  probe:async()=>{started();await waiting;return true;},spawn(){
   const child=new EventEmitter();Object.assign(child,{connected:true,exitCode:null,stdout:new EventEmitter(),stderr:new EventEmitter()});
   child.send=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};return child;
  }});
 t.after(()=>pool.close());
 const data={root:'fixture-root',workspaceId:'shared-startup-fixture',accountId:'first-account',legacy:false};
 const first=pool.get(data,{cookie:'first-session'});await created;
 const other=assert.rejects(pool.get({...data,accountId:'other-account'},{cookie:'other-session'}),{status:403});
 release();const worker=await first;await other;
 assert.equal(worker.accountId,'first-account');assert.equal(worker.context.cookie,'first-session');assert.equal(pool.findLease(worker.lease),worker);
});
