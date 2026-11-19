'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {probeServer,waitForServer,createWindowLoader,failedPanelNavigation}=require('../lib/desktop-startup');
const {createRequestHandler}=require('../lib/http-routes');
test('resposta HTTP de erro na janela local deve recuperar o painel, sem aceitar outra origem',()=>{
 const base='http://127.0.0.1:4310';assert.ok(failedPanelNavigation(base,base+'/acesso-celular',404));assert.ok(failedPanelNavigation(base,base+'/api/mobile-access',503));assert.equal(failedPanelNavigation(base,base+'/acesso-celular',200),false);assert.equal(failedPanelNavigation(base,'http://127.0.0.1:4311/acesso-celular',404),false);assert.equal(failedPanelNavigation(base,'https://example.com/',404),false);
});
function fakeWindow({failures=0,ready=true,hung=false}={}){
 const state={files:[],urls:[],visible:false,destroyed:false,stops:0};
 const window={isDestroyed:()=>state.destroyed,isVisible:()=>state.visible,show:()=>{state.visible=true;},
  loadFile:async(file,options)=>{state.files.push({file,hash:options.hash});},
  loadURL:async url=>{state.urls.push(url);if(hung)return new Promise(()=>{});if(state.urls.length<=failures)throw Error('ERR_CONNECTION_REFUSED');},
  webContents:{stop:()=>state.stops++,executeJavaScript:async()=>ready}};
 return{window,state};
}
function setup(options={}){
 const fake=fakeWindow(options);let clock=0,ensures=0;
 const loader=createWindowLoader(fake.window,{url:'http://127.0.0.1:4310',loadingFile:'startup.html',
  ensureServer:async()=>{ensures++;},now:()=>clock,pause:async ms=>{clock+=ms;},readyTimeoutMs:500,loadTimeoutMs:15});
 return{...fake,loader,ensures:()=>ensures};
}
test('abertura mostra preparação e só considera o painel pronto após iniciar a interface',async()=>{
 const f=setup();assert.equal(await f.loader.start(),true);assert.equal(f.state.files[0].hash,'loading');assert.equal(f.state.urls.length,1);assert.equal(f.state.visible,true);assert.equal(f.ensures(),1);assert.equal(f.loader.fallback,false);
});
test('falha transitória na navegação é recuperada automaticamente',async()=>{
 const f=setup({failures:1});assert.equal(await f.loader.start(),true);assert.equal(f.state.urls.length,2);assert.equal(f.state.stops,1);assert.equal(f.ensures(),2);
});
test('interface que não inicializa tem tentativas limitadas e opção visível de tentar novamente',async()=>{
 const f=setup({ready:false});assert.equal(await f.loader.start(),false);assert.equal(f.state.urls.length,3);assert.equal(f.state.files.at(-1).hash,'unavailable');assert.equal(f.loader.fallback,true);assert.equal(f.state.visible,true);
});
test('navegação travada tem prazo e não deixa uma janela preta indefinidamente',async()=>{
 const f=setup({hung:true});assert.equal(await f.loader.start(),false);assert.equal(f.state.urls.length,3);assert.equal(f.state.files.at(-1).hash,'unavailable');assert.equal(f.state.visible,true);
});
test('chamadas simultâneas não abrem duas interfaces nem iniciam duas verificações',async()=>{
 const f=setup();const a=f.loader.start(),b=f.loader.start();assert.equal(a,b);await a;assert.equal(f.ensures(),1);
});
test('fechar a janela cancela a abertura sem novas tentativas',async()=>{
 const f=setup();const opening=f.loader.start();f.state.destroyed=true;f.loader.dispose();assert.equal(await opening,false);assert.equal(f.state.urls.length,0);assert.equal(f.state.files.length,1);
});
test('recuperação de renderer tem limite e pode ser reiniciada pelo usuário',async()=>{
 const f=setup();await f.loader.start();assert.equal(await f.loader.recover(),true);assert.equal(await f.loader.recover(),true);assert.equal(await f.loader.recover(),false);assert.equal(f.state.urls.length,3);assert.equal(f.state.files.at(-1).hash,'unavailable');assert.equal(await f.loader.retry(),true);assert.equal(f.state.urls.length,4);
});
test('reabertura aguarda servidor encerrando antes de criar outro processo',async()=>{
 let clock=0,running=false,index=0;const starts=[],statuses=['stopping','stopping','offline','ready'];
 await waitForServer({probe:async()=>statuses[index++],isRunning:()=>running,start:()=>{starts.push(index);running=true;},now:()=>clock,pause:async ms=>{clock+=ms;}});
 assert.deepEqual(starts,[3]);assert.equal(index,4);
});
test('servidor existente pronto é reutilizado sem duplicar atendimento',async()=>{
 let starts=0;await waitForServer({probe:async()=> 'ready',start:()=>starts++,isRunning:()=>true});assert.equal(starts,0);
});
test('cancelamento não inicia servidor e processo que encerrou gera erro explícito',async()=>{
 const controller=new AbortController();controller.abort();let starts=0;
 await assert.rejects(waitForServer({signal:controller.signal,probe:async()=> 'offline',start:()=>starts++,isRunning:()=>false}),/cancelada/);assert.equal(starts,0);
 let clock=0;await assert.rejects(waitForServer({probe:async()=> 'offline',start:()=>starts++,isRunning:()=>false,now:()=>clock,pause:async ms=>{clock+=ms;}}),/encerrou/);assert.equal(starts,1);
});
test('consulta de saúde diferencia pronto, encerrando e resposta travada',async()=>{
 for(const [statusCode,expected] of [[200,'ready'],[503,'stopping'],[500,'offline']]){
  const value=await probeServer('http://localhost',{get:(url,callback)=>{callback({statusCode,resume(){}});return new EventEmitter();}});assert.equal(value,expected);
 }
 let destroyed=false;assert.equal(await probeServer('http://localhost',{timeoutMs:5,get:()=>Object.assign(new EventEmitter(),{destroy(){destroyed=true;}})}),'offline');assert.equal(destroyed,true);
});
test('healthz deixa de sinalizar pronto assim que o encerramento começa',async()=>{
 let stopping=false;const handler=createRequestHandler({HOST:'127.0.0.1',PORT:4310,isShuttingDown:()=>stopping,sendJson:(response,status,body)=>Object.assign(response,{status,body}),requestIsLocalAndSameOrigin:()=>true});
 const request={method:'GET',url:'/healthz',headers:{host:'127.0.0.1:4310'}};
 const ready={};await handler(request,ready);assert.equal(ready.status,200);assert.equal(ready.body.status,'ok');
 stopping=true;const closing={};await handler(request,closing);assert.equal(closing.status,503);assert.equal(closing.body.status,'stopping');
});
