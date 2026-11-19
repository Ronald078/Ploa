'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createWorkerSmtpTransport}=require('../cloud/worker-smtp');
test('Worker supplies a verified hostname TLS socket once without changing SMTP auth',async()=>{
 let options,tlsOptions,ready;const socket=new EventEmitter();socket.destroy=()=>{};
 const auth={user:'fixture@example.invalid',pass:'not-a-real-secret'};
 createWorkerSmtpTransport(value=>{options=value;return value;},(value,callback)=>{tlsOptions=value;ready=callback;return socket;})({auth,secure:true});
 let calls=0;options.getSocket({},(error,result)=>{assert.ifError(error);calls++;assert.equal(result.connection,socket);assert.equal(result.secured,true);});
 assert.equal(calls,0);assert.equal(options.auth,auth);assert.deepEqual(tlsOptions,{host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',minVersion:'TLSv1.2',rejectUnauthorized:true});
 ready();socket.emit('error',new Error('late'));assert.equal(calls,1);
});
test('Worker TLS failure destroys socket and never reports a secured connection',()=>{
 let options,destroyed=false;const socket=new EventEmitter();socket.destroy=()=>{destroyed=true;};
 createWorkerSmtpTransport(value=>(options=value),()=>socket)({});
 const failure=new Error('fixture');let calls=0;options.getSocket({},(error,result)=>{assert.equal(error,failure);assert.equal(result,undefined);calls++;});
 socket.emit('error',failure);assert.equal(destroyed,true);assert.equal(calls,1);
});
