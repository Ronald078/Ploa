'use strict';
const dns=require('node:dns/promises'),http=require('node:http'),https=require('node:https'),zlib=require('node:zlib');
const {publicIp,normalizeOfferUrl}=require('./creative-offer-url');
const LIMIT=1024*1024;
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function plain(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(_,key)=>{if(key[0]==='#'){const n=parseInt(key.slice(key[1].toLowerCase()==='x'?2:1),key[1].toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}return entities[key.toLowerCase()]||' ';}).replace(/\s+/g,' ').trim();}
function parsePage(html,url){
 const source=String(html).slice(0,LIMIT).replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
 if(/cf-chl-|challenge-platform|<title[^>]*>\s*(?:Just a moment|Access denied|Attention Required)/i.test(source))throw new Error('O site apresentou uma verificação de acesso. Não foi possível analisar a página pública.');
 const title=plain(source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]).slice(0,220),headings=[];
 for(const row of source.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)){const text=plain(row[2]);if(text)headings.push({level:Number(row[1]),text:text.slice(0,180)});if(headings.length>=12)break;}
 const actions=[];for(const row of source.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)){const text=plain(row[2]);if(text&&text.length<100&&!actions.includes(text))actions.push(text);if(actions.length>=10)break;}
 const text=plain(source.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i,' ')).slice(0,5000);
 if(text.length<100)throw new Error('A página não forneceu texto suficiente. Ela pode depender de JavaScript, login ou estar indisponível.');
 return{url,title,headings,actions,text,coverage:'Leitura do HTML público. Layout renderizado, navegação dinâmica e áreas com login não foram inspecionados.',at:new Date().toISOString()};
}
async function requestPage(url,addresses,{signal}={}){
 return new Promise((resolve,reject)=>{
  const transport=url.protocol==='https:'?https:http;let ended=false;
  const finish=(error,result)=>{if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const request=transport.request(url,{method:'GET',agent:false,signal,lookup:(_host,options,callback)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family),headers:{'User-Agent':'Ploa-Offer-Research/1.0','Accept':'text/html','Accept-Encoding':'identity'}},async response=>{
   if([301,302,303,307,308].includes(response.statusCode)){response.resume();finish(null,{status:response.statusCode,location:response.headers.location});return;}
   if(response.statusCode!==200){response.resume();finish(new Error('O site não liberou a leitura pública (HTTP '+response.statusCode+').'));return;}
   if(!/text\/html|application\/xhtml\+xml/i.test(response.headers['content-type']||'')){response.resume();finish(new Error('O endereço não retornou uma página HTML.'));return;}
   let wire=0;response.on('data',chunk=>{wire+=chunk.length;if(wire>LIMIT)request.destroy(new Error('A página excedeu o limite de leitura.'));});
   const encoding=String(response.headers['content-encoding']||'').toLowerCase();let stream=response;
   if(encoding==='gzip'||encoding==='deflate')stream=response.pipe(zlib.createUnzip());else if(encoding==='br')stream=response.pipe(zlib.createBrotliDecompress());else if(encoding&&encoding!=='identity'){response.resume();finish(new Error('A codificação da página não é suportada.'));return;}
   try{const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>LIMIT){request.destroy();throw new Error('O conteúdo da página excedeu 1 MB.');}chunks.push(chunk);}finish(null,{status:200,html:Buffer.concat(chunks).toString('utf8')});}catch{finish(new Error('Não foi possível ler o conteúdo completo da página.'));}
  });
  const timer=setTimeout(()=>request.destroy(new Error('O site demorou para responder.')),20000);request.once('error',error=>finish(error.name==='AbortError'?new Error('Leitura cancelada.'):new Error(error.message.includes('limite')?error.message:'Não foi possível acessar o site da oferta.')));request.end();
 });
}
function createSiteReader({resolve=dns.lookup,transport=requestPage}={}){
 return{read:async(value,{signal}={})=>{
  let current=normalizeOfferUrl(value);if(!current)throw new Error('Informe um site público válido para a oferta.');
  for(let i=0;i<5;i++){
   if(signal?.aborted)throw new Error('Leitura cancelada.');const url=new URL(current),host=url.hostname.replace(/^\[|\]$/g,'');
   let addresses;try{addresses=await resolve(host,{all:true,verbatim:true});}catch{throw new Error('O domínio do site não pôde ser encontrado.');}
   if(!addresses.length||addresses.some(row=>!publicIp(row.address)))throw new Error('O endereço aponta para uma rede privada ou reservada e não pode ser consultado.');
   // The validated DNS answers are pinned to this request, including after redirects.
   const result=await transport(url,addresses,{signal});if(result.status===200)return parsePage(result.html,current);
   if(!result.location)throw new Error('O redirecionamento não informou o destino.');current=normalizeOfferUrl(new URL(result.location,current).href);if(!current)throw new Error('O site redirecionou para um endereço não permitido.');
  }throw new Error('O site excedeu o limite de redirecionamentos.');
 }};
}
module.exports={createSiteReader,parsePage,plain,requestPage};
