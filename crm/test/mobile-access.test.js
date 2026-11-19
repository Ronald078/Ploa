'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const{createMobileAccessStatus}=require('../lib/mobile-access-status');
const config={enabled:true,hostname:'ploa.tail-test.ts.net',login:'owner@example.com'};
const state=()=>({BackendState:'Running',Self:{DNSName:config.hostname+'.',UserID:1,TailscaleIPs:['100.100.1.2']},User:{1:{LoginName:config.login,Private:'never-output'}},CurrentTailnet:{MagicDNSEnabled:true},Peer:{a:{OS:'android',HostName:'Meu celular',Online:true,UserID:1,PublicKey:'secret'},b:{OS:'android',HostName:'Outro usuário',Online:true,UserID:2}}});
const serve=()=>({TCP:{443:{HTTPS:true}},Web:{[config.hostname+':443']:{Handlers:{'/':{Proxy:'http://127.0.0.1:4311'}}}}});
function service(options={}){return createMobileAccessStatus({root:'.',loadConfig:()=>config,run:async(_,args)=>args[0]==='status'?state():serve(),lookup:async()=>({address:'100.100.1.2'}),check:async()=>({ok:true,status:200}),...options});}
test('diagnóstico confere notebook mas não declara o DNS do celular validado nem expõe dados da conta',async()=>{
 const result=await service().snapshot();assert.ok(result.checks.every(row=>row.status==='ok'));assert.equal(result.phoneConfirmed,false);assert.equal(result.phones.length,1);assert.equal(result.url,'https://'+config.hostname);assert.equal(JSON.stringify(result).includes('owner@example.com'),false);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('never-output'),false);
});
test('separa DNS incorreto, celular desconectado e HTTPS privado indisponível',async()=>{
 const s=state();s.Peer.a.Online=false;const result=await service({run:async(_,args)=>args[0]==='status'?s:serve(),lookup:async()=>({address:'8.8.8.8'}),check:async url=>({ok:!url.startsWith('https:'),status:url.startsWith('https:')?503:200})}).snapshot();
 assert.equal(result.checks.find(row=>row.id==='phone').status,'warning');assert.equal(result.checks.find(row=>row.id==='dns').status,'warning');assert.equal(result.checks.find(row=>row.id==='https').status,'error');assert.equal(result.checks.find(row=>row.id==='app').status,'ok');
});
test('falha de permissão ou configuração ausente vira diagnóstico recuperável',async()=>{
 const result=await service({run:async()=>{throw new Error('EACCES');},loadConfig:()=>null}).snapshot();assert.equal(result.url,'');assert.ok(result.checks.some(row=>row.status==='error'));assert.equal(result.phones.length,0);
});
test('conta diferente e compartilhamento público não são aceitos como configuração válida',async()=>{
 const s=state();s.User[1].LoginName='different@example.com';const web=serve();web.AllowFunnel={[config.hostname+':443']:true};const result=await service({run:async(_,args)=>args[0]==='status'?s:web}).snapshot();assert.equal(result.checks.find(row=>row.id==='config').status,'error');assert.equal(result.checks.find(row=>row.id==='https').status,'error');
});
test('consultas simultâneas compartilham a coleta e o cache expira sem processo em segundo plano',async()=>{
 let calls=0,clock=100;const controller=service({now:()=>clock,run:async(_,args)=>{calls++;return args[0]==='status'?state():serve();}});const[a,b]=await Promise.all([controller.snapshot(),controller.snapshot()]);assert.equal(a,b);assert.equal(calls,2);await controller.snapshot();assert.equal(calls,2);clock+=30001;await controller.snapshot();assert.equal(calls,4);
});
test('rota real e arquivos do diagnóstico funcionam e recusam origem externa',async()=>{
 const{createRequestHandler}=require('../lib/http-routes'),{createHttpTools}=require('../lib/http-tools');let handler;const server=http.createServer((req,res)=>void handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,base='http://127.0.0.1:'+port;
 handler=createRequestHandler({HOST:'127.0.0.1',PORT:port,getMobileAccess:()=>service().snapshot(),...createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:path.resolve(__dirname,'../public')})});
 try{for(const file of ['/acesso-celular','/mobile-access.js','/styles/mobile-diagnostic.css'])assert.equal((await fetch(base+file)).status,200);const result=await fetch(base+'/api/mobile-access');assert.equal(result.status,200);assert.equal((await result.json()).phoneConfirmed,false);assert.equal((await fetch(base+'/api/mobile-access',{headers:{origin:'https://other.example'}})).status,403);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
