'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {createAccountData}=require('../lib/account-data');
const {createLocalRuntimes}=require('../cloud/local-runtimes');
const {temporaryRoot}=require('./fixture-helpers');

test('servidor comercial real abre uma empresa vazia sem executar automações',async t=>{
 const directory=temporaryRoot(t),codeRoot=path.resolve(__dirname,'../..');
 const data=createAccountData({directory,codeRoot}).resolve({id:'11111111-1111-4111-8111-111111111111'},{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Empresa fictícia',role:'owner'});
 const pool=createLocalRuntimes({codeRoot,origin:'http://127.0.0.1:4313'});
 try{
 const runtime=await pool.get(data,{cookie:'session-fixture'}),origin='http://127.0.0.1:'+runtime.port;
 const direct=await fetch(origin+'/api/workspace');assert.equal(direct.status,403);
 const request=route=>fetch(origin+route,{headers:{'x-ploa-local-token':runtime.token}});
 const processes=await (await request('/api/processes')).json();
 for(const state of Object.values(processes))assert.equal(state.running,false);
 const workspace=await (await request('/api/workspace')).json();
 assert.equal(workspace.hasKey,false);assert.equal(workspace.settings.enabled,false);assert.deepEqual(workspace.records,{});assert.equal(workspace.playbook.voice,null);
 assert.doesNotMatch(JSON.stringify(workspace.settings),/Ronald/);
 const copies=await (await request('/api/copies')).json();assert.doesNotMatch(JSON.stringify(copies),/Ronald/);
 const health=await fetch(origin+'/healthz');assert.equal(health.status,200);
 }finally{await pool.close();}
});
