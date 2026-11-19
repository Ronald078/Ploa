'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),http=require('node:http');
const {pairingPhone,createPairingControl}=require('../lib/whatsapp-pairing');
const {attachPairingAgent}=require('../lib/whatsapp-pairing-agent');
const {createProcessManager}=require('../lib/process-manager');
const {createRequestHandler}=require('../lib/http-routes'),{createHttpTools}=require('../lib/http-tools');
const {temporaryRoot}=require('./fixture-helpers');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function control(){
 let clock=1000,starts=0;const commands=[],timers=[];
 const state={status:'idle',connection:'',child:{connected:true,send:(data,cb)=>{commands.push(data);cb?.();}}};
 const value=createPairingControl({getState:()=>state,start:()=>{starts++;state.status='running';},active:new Set(['running']),now:()=>clock,setTimeout:(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;},clearTimeout:t=>{if(t)t.cancelled=true;}});
 return{value,state,commands,timers,starts:()=>starts,advance:ms=>{clock+=ms;}};
}
test('telefone internacional aceita formatação e recusa prefixo 00, texto e números incompletos',()=>{
 assert.equal(pairingPhone('+55 (11) 99999-9999'),'5511999999999');
 for(const input of ['0011999999999','55123','abc','+55 11 <script>','',{phone:'5511999999999'}])assert.throws(()=>pairingPhone(input),{statusCode:400});
});
test('código e telefone ficam no estado temporário para conferência e são limpos ao confirmar/cancelar',()=>{
 const c=control();c.value.request('+55 11 99999-9999');assert.equal(c.starts(),1);assert.equal(c.commands.length,1);
 const id=c.commands[0].requestId;assert.equal(c.commands[0].type,'ploa-pairing-request');
 c.value.receive({type:'ploa-whatsapp-pairing',requestId:'stale',status:'code',code:'ABCD1234'});assert.equal(c.value.snapshot().status,'requesting');
 c.value.receive({type:'ploa-whatsapp-pairing',requestId:id,status:'code',code:'ABCD1234'});
 assert.equal(c.value.snapshot().code,'ABCD1234');assert.equal(c.value.snapshot().phone,'5511999999999');assert.equal(c.value.snapshot().requestId,undefined);
 c.advance(180001);assert.equal(c.value.snapshot().status,'expired');assert.equal(c.value.snapshot().code,'');
 assert.throws(()=>c.value.request('5511999999999'),{statusCode:409});
 c.value.cancel();assert.equal(c.value.snapshot().code,'');
 c.value.receive({type:'ploa-whatsapp-pairing',requestId:id,status:'code',code:'ZZZZ9999'});assert.equal(c.value.snapshot().status,'cancelling');
 c.value.receive({type:'ploa-whatsapp-pairing',requestId:id,status:'qr'});assert.equal(c.value.snapshot(),null);assert.equal(c.state.connection,'qr');
 c.value.request('5511999999999');c.value.receive({type:'ploa-whatsapp-pairing',requestId:c.commands.at(-1).requestId,status:'linked'});assert.equal(c.value.snapshot(),null);assert.equal(c.state.connection,'authenticating');
});
test('conta pronta, operação repetida e geração sem resposta são tratadas sem reiniciar sessão',()=>{
 const c=control();c.state.connection='ready';assert.throws(()=>c.value.request('5511999999999'),{statusCode:409});assert.equal(c.starts(),0);
 c.state.connection='qr';c.value.request('5511999999999');assert.throws(()=>c.value.request('5511999999999'),{statusCode:409});
 c.timers.find(t=>t.ms===55000).fn();assert.equal(c.value.snapshot().status,'error');assert.equal(c.value.snapshot().code,'');
});
test('canal de comunicação encerrado mostra erro e cancela a espera',()=>{
 const c=control();c.state.child.send=(_message,callback)=>callback(Error('Closed channel'));
 const result=c.value.request('5511999999999');assert.equal(result.status,'error');assert.equal(result.code,'');assert.equal(c.timers.at(-1).cancelled,true);
});
function agent(){
 const channel=new EventEmitter(),client=new EventEmitter(),sent=[],calls=[];
 channel.connected=true;channel.send=message=>sent.push(message);
 client.requestPairingCode=async(...args)=>{calls.push(args);client.emit('code','ABCD1234');return 'ABCD1234';};
 client.cancelPairingCode=async()=>{client.emit('qr','fictitious-qr');};
 const service=attachPairingAgent(client,{channel});return{client,channel,sent,calls,service};
}
test('agente aguarda QR, pede código na mesma sessão e oculta no evento authenticated',async t=>{
 const a=agent();t.after(()=>a.service.close());
 a.channel.emit('message',{type:'ploa-pairing-request',requestId:'one',phone:'5511999999999'});assert.equal(a.calls.length,0);
 a.client.emit('qr','fake');await tick();assert.equal(a.calls.length,1);assert.deepEqual(a.calls[0],['5511999999999',true,180000]);assert.equal(a.sent.at(-1).code,'ABCD1234');
 a.client.emit('code','ZZZZ9999');assert.equal(a.sent.at(-1).code,'ZZZZ9999');
 a.client.emit('authenticated');assert.equal(a.sent.at(-1).status,'linked');assert.equal(a.service.usesCode(),false);
 const count=a.sent.length;a.client.emit('code','OLDX0000');assert.equal(a.sent.length,count);
});
test('cancelar antes do QR não solicita código; resposta tardia após cancelamento é ignorada',async t=>{
 const a=agent();t.after(()=>a.service.close());
 a.channel.emit('message',{type:'ploa-pairing-request',requestId:'one',phone:'5511999999999'});
 a.channel.emit('message',{type:'ploa-pairing-cancel',requestId:'one'});await tick();assert.equal(a.calls.length,0);assert.equal(a.sent.at(-1).status,'qr');
 let resolve;a.client.requestPairingCode=()=>new Promise(done=>{resolve=done;});
 a.channel.emit('message',{type:'ploa-pairing-request',requestId:'two',phone:'5511999999999'});await tick();
 a.channel.emit('message',{type:'ploa-pairing-cancel',requestId:'two'});await tick();
 resolve('LATE0000');await tick();assert.ok(!a.sent.some(e=>e.code==='LATE0000'));
});
test('falha da biblioteca não divulga detalhes e permite voltar ao QR',async t=>{
 const a=agent();t.after(()=>a.service.close());a.client.emit('qr','fake');
 a.client.requestPairingCode=async()=>{throw Error('Sensitive browser details');};
 a.channel.emit('message',{type:'ploa-pairing-request',requestId:'one',phone:'5511999999999'});await tick();assert.equal(a.sent.at(-1).status,'error');assert.ok(!JSON.stringify(a.sent).includes('Sensitive'));
 a.channel.emit('message',{type:'ploa-pairing-cancel',requestId:'one'});await tick();assert.equal(a.sent.at(-1).status,'qr');
});
test('eventos de código anteriores à resposta da nova solicitação não são exibidos',async t=>{
 const a=agent();t.after(()=>a.service.close());a.client.emit('qr','fake');let resolve;
 a.client.requestPairingCode=()=>new Promise(done=>{resolve=done;});
 a.channel.emit('message',{type:'ploa-pairing-request',requestId:'one',phone:'5511999999999'});await tick();
 a.client.emit('code','OLDX0000');assert.equal(a.sent.length,0);
 resolve('NEWX1111');await tick();assert.equal(a.sent.at(-1).code,'NEWX1111');
});
test('API → processo → agente simulado gera código sem disparos, rejeita outra origem e limpa ao conectar',async t=>{
 const root=temporaryRoot(t);
 let worker,channel,client,service,started=0;
 const runtime=new EventEmitter();Object.assign(runtime,{env:{},execPath:process.execPath,connected:false});
 const workspace={internalToken:'synthetic',read:()=>({settings:{}}),control(){throw Error('No campaign allowed');}};
 const manager=createProcessManager({workspace,PORT:1234,PROJECT_ROOT:root,process:runtime,getOperationsSnapshot:async()=>({}),spawn(){
  started++;worker=new EventEmitter();Object.assign(worker,{connected:true,pid:9000,stdout:new EventEmitter(),stderr:new EventEmitter()});
  channel=new EventEmitter();channel.connected=true;channel.send=message=>worker.emit('message',message);
  worker.send=(message,cb)=>{channel.emit('message',message);cb?.();};
  client=new EventEmitter();client.requestPairingCode=async()=>{client.emit('code','ABCD1234');return 'ABCD1234';};client.cancelPairingCode=async()=>client.emit('qr','fake');service=attachPairingAgent(client,{channel});return worker;
 }});
 let handler;const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 handler=createRequestHandler({HOST:'127.0.0.1',PORT:port,PROJECT_ROOT:root,...manager,...createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:__dirname})});
 t.after(async()=>{service?.close();manager.cancelAttendanceRetry();await new Promise(resolve=>server.close(resolve));});
 const post=(data,headers={})=>fetch('http://127.0.0.1:'+port+'/api/whatsapp/pairing',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 assert.equal((await post({phone:'5511999999999'},{Origin:'https://outside.invalid'})).status,403);
 assert.equal((await post({phone:'5511999999999'},{'Content-Type':'text/plain'})).status,415);
 assert.equal((await post({phone:'123'})).status,400);assert.equal(started,0);
 const response=await post({phone:'+55 11 99999-9999'});assert.equal(response.status,202);assert.equal((await response.json()).pairing.status,'requesting');assert.equal(started,1);
 worker.emit('spawn');client.emit('qr','fake');await tick();const state=manager.getProcessesSnapshot();assert.equal(state.whatsapp.pairing.code,'ABCD1234');assert.equal(state.messages.status,'idle');
 assert.ok(!JSON.stringify(state.whatsapp.logs).includes('ABCD1234'));assert.ok(!JSON.stringify(state.whatsapp.logs).includes('5511999999999'));
 assert.equal((await post({phone:'5511999999999'})).status,409);assert.equal(started,1);
 client.emit('authenticated');worker.emit('message',{type:'ploa-whatsapp-state',connection:'ready'});assert.equal(manager.getProcessesSnapshot().whatsapp.pairing,null);assert.equal((await post({phone:'5511999999999'})).status,409);
});
