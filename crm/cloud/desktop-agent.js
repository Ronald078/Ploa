'use strict';
const http=require('node:http'),path=require('node:path'),fs=require('node:fs');
const {createCloudHandler,readBody}=require('./http');
const {createRemoteAccountClient}=require('./remote-account-client');
const {createAccountData}=require('../lib/account-data');
const {createLocalRuntimes}=require('./local-runtimes');

function startDesktopAgent({accountsOrigin,dataDirectory,codeRoot=path.resolve(__dirname,'../..'),port=4313}={}){
 if(!path.isAbsolute(dataDirectory||''))throw Error('Configure a pasta de dados desta instalação.');
 const origin='http://127.0.0.1:'+port,remote=createRemoteAccountClient({remoteOrigin:accountsOrigin,readBody});
 fs.mkdirSync(dataDirectory,{recursive:true});
 // No owner binding or private server key is loaded by the distributed agent.
 const runtimes=createLocalRuntimes({codeRoot,origin}),registry=createAccountData({directory:dataDirectory,codeRoot});
 const handler=createCloudHandler({origin,gateway:{},accessControl:{},remote,localPanel:{runtimes,registry}});
 const server=http.createServer(handler);server.requestTimeout=25000;server.headersTimeout=10000;
 server.once('close',()=>{handler.dispose();void runtimes.close();});
 server.listen(port,'127.0.0.1',()=>console.log('Ploa instalado: acesso local disponível.'));
 const close=()=>{server.close();server.closeIdleConnections();};
 for(const event of ['SIGINT','SIGTERM','disconnect'])process.once(event,close);
 process.on('message',message=>{if(message?.type==='ploa-shutdown')close();});
 return server;
}
if(require.main===module){try{startDesktopAgent({accountsOrigin:process.env.PLOA_ACCOUNTS_ORIGIN,dataDirectory:process.env.PLOA_LOCAL_ROOT});}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={startDesktopAgent};
