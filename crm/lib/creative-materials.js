'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {mediaType,findTools,runTool}=require('./creative-media');
const MAX_FILE=8*1024*1024,MAX_STORAGE=250*1024*1024;
function placement(input={}){
 const fit=input.fit||'cover',position=input.position||'center';
 if(!['cover','contain'].includes(fit)||!['top','center','bottom'].includes(position))throw new Error('Escolha um enquadramento válido.');
 return{fit,position};
}
function createCreativeMaterials({db,extraBytes=()=>0,tools=findTools(),run=runTool}){
 const folder=path.join(db.folder,'materiais');fs.mkdirSync(folder,{recursive:true});
 const rows=id=>db.setting('materials:'+id)||[];
 const target=row=>row&&/^[-a-f0-9]{36}\.(png|jpg|webp)$/.test(row.file)?path.join(folder,row.file):null;
 function file(id,slot){const row=rows(id).find(row=>row.slot===slot),name=target(row);return name&&fs.existsSync(name)?{...row,path:name,size:fs.statSync(name).size}:null;}
 const list=id=>rows(id).filter(row=>file(id,row.slot)).map(({file,...row})=>({...row,url:'/api/creative-miner/ads/'+id+'/materials/'+row.slot+'?v='+row.hash}));
 const bytes=()=>fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isFile()).reduce((sum,e)=>sum+fs.statSync(path.join(folder,e.name)).size,0);
 const signature=id=>JSON.stringify(rows(id).map(({slot,hash,fit,position})=>({slot,hash,fit,position})).sort((a,b)=>a.slot-b.slot));
 function validate(id,slot){if(!db.detail(id))throw new Error('Anúncio não encontrado.');if(!Number.isInteger(slot)||slot<0||slot>3)throw new Error('Escolha uma cena de 1 a 4.');}
 function remove(id,slot){validate(id,slot);const previous=rows(id),next=previous.filter(row=>row.slot!==slot);db.setting('materials:'+id,next);for(const row of previous.filter(row=>!next.includes(row))){const name=target(row);if(name)try{fs.unlinkSync(name);}catch{}}return list(id);}
 function clear(id){for(const row of rows(id)){const name=target(row);if(name)try{fs.unlinkSync(name);}catch{}}db.setting('materials:'+id,null);}
 async function save(id,slot,input){
  validate(id,slot);const config=placement(input),previous=rows(id),old=previous.find(row=>row.slot===slot);
  if(input.base64===undefined){if(!old)throw new Error('Adicione uma imagem a esta cena.');db.setting('materials:'+id,previous.map(row=>row===old?{...row,...config}:row));return list(id);}
  if(input.authorized!==true)throw new Error('Confirme que pode usar a imagem no seu anúncio.');
  if(typeof input.base64!=='string'||input.base64.length>Math.ceil(MAX_FILE/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw new Error('Use uma imagem PNG, JPEG ou WebP de até 8 MB.');
  const data=Buffer.from(input.base64,'base64');if(!data.length||data.length>MAX_FILE)throw new Error('Use uma imagem de até 8 MB.');
  const type=mediaType(data);if(!type.mime.startsWith('image/'))throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  if(!tools.ffprobe)throw new Error('FFprobe não localizado para conferir a imagem.');
  if(bytes()+extraBytes()+db.mediaBytes()+data.length>MAX_STORAGE)throw new Error('O armazenamento atingiu 250 MB. Remova materiais antigos.');
  const name=randomUUID()+'.'+type.ext,destination=path.join(folder,name);fs.writeFileSync(destination,data,{flag:'wx'});let committed=false;
  try{
   const probe=JSON.parse(await run(tools.ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=width,height,codec_type','-of','json',destination],{timeout:15000}));
   const image=probe.streams?.find(row=>row.codec_type==='video');
   if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width>8192||image.height>8192||image.width*image.height>16000000)throw new Error('Imagem inválida ou muito grande. Use até 16 megapixels e 8192 px por lado.');
   // A exclusão/alteração durante a leitura não deve recriar uma referência ou perder outra edição.
   validate(id,slot);if(JSON.stringify(rows(id))!==JSON.stringify(previous))throw new Error('Os materiais mudaram. Atualize e tente novamente.');
   if(bytes()+extraBytes()+db.mediaBytes()>MAX_STORAGE)throw new Error('O armazenamento atingiu 250 MB.');
   const row={slot,file:name,mime:type.mime,size:data.length,width:image.width,height:image.height,hash:createHash('sha256').update(data).digest('hex'),...config};
   db.setting('materials:'+id,[...previous.filter(row=>row.slot!==slot),row].sort((a,b)=>a.slot-b.slot));committed=true;
   const oldFile=target(old);if(oldFile)try{fs.unlinkSync(oldFile);}catch{}return list(id);
  }finally{if(!committed)try{fs.unlinkSync(destination);}catch{}}
 }
 function image(id,slot){const row=file(id,slot);return row?{...row,src:'data:'+row.mime+';base64,'+fs.readFileSync(row.path).toString('base64')}:null;}
 return{list,file,save,remove,clear,image,signature,usedBytes:bytes};
}
module.exports={createCreativeMaterials,placement};
