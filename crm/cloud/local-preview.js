'use strict';
const fs=require('node:fs'),path=require('node:path');
const envFile=path.join(__dirname,'.env');
if(fs.existsSync(envFile))process.loadEnvFile(envFile);
// Opt-in integration preview. Never changes the running commercial application.
const {startCloudPreview}=require('./server');
try{
 const server=startCloudPreview({...process.env,PLOA_LOCAL_PANEL:'1'});
 const close=()=>{server.close();server.closeIdleConnections();};
 for(const signal of ['SIGINT','SIGTERM','disconnect'])process.once(signal,close);
 process.on('message',message=>{if(message?.type==='ploa-shutdown')close();});
}catch(error){console.error(error.message);process.exitCode=1;}
