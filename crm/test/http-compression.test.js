'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {gunzipSync}=require('node:zlib');
const {createHttpTools}=require('../lib/http-tools');
const {acceptsGzip}=require('../lib/http-compression');

test('negocia gzip sem ignorar uma recusa explícita',()=>{
  for(const header of ['gzip','br, gzip;q=0.7','*;q=1'])assert.equal(acceptsGzip(header),true);
  for(const header of ['', 'br', 'gzip;q=0', 'gzip;q=0, *;q=1','gzip;q=invalid'])assert.equal(acceptsGzip(header),false);
});

test('HTTP comprime JSON grande sem perder dados, com compatibilidade sem gzip',async t=>{
  const payload={text:'Informação em português: ação, solução, € e 💬. '.repeat(3000),nested:{stage:'proposta',count:21}};
  const tools=createHttpTools({HOST:'127.0.0.1',PORT:4310,PUBLIC_ROOT:''});
  const server=http.createServer((req,res)=>tools.sendJson(res,req.url==='/error'?400:200,req.url==='/small'?{ok:true}:payload));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=(pathname,encoding)=>new Promise((resolve,reject)=>{
    http.get({host:'127.0.0.1',port:server.address().port,path:pathname,headers:{'Accept-Encoding':encoding}},res=>{
      const parts=[];res.on('data',data=>parts.push(data));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));
    }).on('error',reject);
  });
  const compressed=await request('/','gzip');
  assert.equal(compressed.headers['content-encoding'],'gzip');
  assert.equal(compressed.headers['cache-control'],'no-store');
  assert.equal(compressed.headers.vary,'Accept-Encoding');
  assert.equal(Number(compressed.headers['content-length']),compressed.body.length);
  assert.deepEqual(JSON.parse(gunzipSync(compressed.body)),payload);
  assert.ok(compressed.body.length<Buffer.byteLength(JSON.stringify(payload))/2);
  for(const encoding of ['identity','gzip;q=0']){
    const plain=await request('/',encoding);assert.equal(plain.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(plain.body),payload);
  }
  const small=await request('/small','gzip');assert.equal(small.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(small.body),{ok:true});
  const failure=await request('/error','gzip');assert.equal(failure.status,400);assert.equal(failure.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(failure.body),payload);
});
