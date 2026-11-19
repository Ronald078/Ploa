'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {whatsappBrowserOptions}=require('../lib/whatsapp-browser-options');
const {initializeWithDeadline}=require('../lib/whatsapp-startup');
test('Opera do atendimento fica headless e suprime splash sem alterar ambiente global',()=>{
 const env={EXAMPLE:'value'},options=whatsappBrowserOptions({env,executablePath:'C:\\Opera GX\\opera.exe'});
 assert.equal(options.headless,true);assert.ok(options.args.includes('--disable-splash-screen'));assert.equal(options.env.OPERA_DISABLE_SPLASH_SCREEN,'1');assert.equal(env.OPERA_DISABLE_SPLASH_SCREEN,undefined);
 const other=whatsappBrowserOptions({env,executablePath:'C:\\Edge\\msedge.exe'});assert.equal(other.env,undefined);assert.ok(!other.args.includes('--disable-splash-screen'));
});
test('aba sem sinal de pronto ou QR expira; initialize resolvido não significa conectado',async()=>{
 const client=Object.assign(new EventEmitter(),{initialize:async()=>{}});
 await assert.rejects(initializeWithDeadline(client,{timeoutMs:15}),/prazo/);
 assert.equal(client.listenerCount('ready'),0);assert.equal(client.listenerCount('qr'),0);
});
test('pronto e QR encerram a espera; QR permite aguardar o pareamento humano sem prazo de carregamento',async()=>{
 for(const event of ['ready','qr']){
  const client=new EventEmitter();client.initialize=async()=>{client.emit(event);};
  await initializeWithDeadline(client,{timeoutMs:50});assert.equal(client.listenerCount('ready'),0);assert.equal(client.listenerCount('qr'),0);
 }
});
test('falha de initialize é propagada e timeout não deixa listeners ou rejeição pendente',async()=>{
 const client=Object.assign(new EventEmitter(),{initialize:async()=>{throw Error('Falha fictícia');}});
 await assert.rejects(initializeWithDeadline(client,{timeoutMs:50}),/fictícia/);assert.equal(client.listenerCount('ready'),0);
});
