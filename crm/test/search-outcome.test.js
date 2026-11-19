'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createProcessManager}=require('../lib/process-manager');

test('painel diferencia resultado parcial legado, novo e erro fatal', async()=>{
 const {searchProcessState,searchRunLabel}=await import('../app-next/src/search-outcome.js');
 const before={status:'error',running:false,exitCode:1,logs:[
   {stream:'stdout',text:'⚠️  A busca terminou parcialmente. Na próxima execução, somente estas cidades serão retomadas:'},
   {stream:'stdout',text:'   - Cidade fictícia'},
   {stream:'stderr',text:'O processo terminou com código 1.'},
 ]};
 const displayed=searchProcessState(before,{status:'parcial'});
 assert.equal(displayed.status,'partial');
 assert.equal(displayed.logs.at(-1).stream,'system');
 assert.match(displayed.logs.at(-1).text,/finalizada com pendências/);
 assert.equal(before.logs.at(-1).stream,'stderr','histórico original não é alterado');
 assert.equal(searchProcessState(before,{status:'erro'}).status,'error');
 assert.equal(searchProcessState({...before,logs:[]},{status:'parcial'}).status,'error');
 assert.equal(searchProcessState({...before,logs:[...before.logs,{stream:'stderr',text:'Traceback: PermissionError'}]},{status:'parcial'}).status,'error');
 assert.equal(searchProcessState({...before,exitCode:2,logs:[{stream:'stdout',text:'[[PLOA_SEARCH_PARTIAL]]'},{stream:'stderr',text:'O processo terminou com código 2.'}]},{status:'parcial'}).status,'partial');
 assert.equal(searchRunLabel({exitCode:1,metrics:{status:'parcial'}}),'Finalizada com pendências');
 assert.equal(searchRunLabel({exitCode:2,metrics:{status:'parcial'}}),'Finalizada com pendências');
 assert.equal(searchRunLabel({exitCode:2,outcome:'error',metrics:{status:'parcial'}}),'Com erro');
 assert.equal(searchRunLabel({exitCode:0,outcome:'completed'}),'Finalizada');
});

test('código 2 exige marcador, outros erros e parada não viram parcial', async()=>{
 for(const scenario of [
   {code:2,marker:true,expected:'partial'},
   {code:2,marker:false,expected:'error'},
   {code:1,marker:true,expected:'error'},
   {code:2,marker:true,stop:true,expected:'stopped'},
 ]){
  const runs=[];
  const child=Object.assign(new EventEmitter(),{pid:99,stdout:new EventEmitter(),stderr:new EventEmitter()});
  const manager=createProcessManager({PROJECT_ROOT:__dirname,PORT:0,spawn:()=>child,
   workspace:{control(){},saveRun:run=>runs.push(run)},getOperationsSnapshot:async()=>({search:{status:'parcial'}})});
  manager.startManagedScript('search');child.emit('spawn');
  if(scenario.marker){child.stdout.emit('data',Buffer.from('[[PLOA_SEARCH_PAR'));child.stdout.emit('data',Buffer.from('TIAL]]\r\n'));}
  if(scenario.stop)manager.stopManagedScript('search');
  child.emit('close',scenario.code,null);
  await new Promise(resolve=>setImmediate(resolve));
  const state=manager.getProcessesSnapshot().search;
  assert.equal(state.status,scenario.expected);
  assert.equal(state.running,false);
  assert.equal(runs[0].outcome,scenario.expected);
  assert.ok(!state.logs.some(log=>log.text.includes('[[PLOA_SEARCH_PARTIAL]]')));
  if(scenario.expected==='partial')assert.equal(state.lastError,'');
 }
});
