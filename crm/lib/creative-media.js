'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const MAX_FILE=20*1024*1024,MAX_STORAGE=250*1024*1024;
function findTools(){
  const packages=path.join(os.homedir(),'AppData','Local','Microsoft','WinGet','Packages');let ffmpeg='';
  try{for(const item of fs.readdirSync(packages).filter(name=>name.startsWith('Gyan.FFmpeg_'))){const dir=path.join(packages,item);for(const child of fs.readdirSync(dir)){const file=path.join(dir,child,'bin','ffmpeg.exe');if(fs.existsSync(file))ffmpeg=file;}}}catch{}
  const tesseract=path.join(process.env.ProgramFiles||'C:\\Program Files','Tesseract-OCR','tesseract.exe');
  const tessdata=path.resolve(__dirname,'../tools/tessdata');
  const probe=ffmpeg?path.join(path.dirname(ffmpeg),'ffprobe.exe'):'';
  return{ffmpeg,ffprobe:probe&&fs.existsSync(probe)?probe:'',tesseract:fs.existsSync(tesseract)?tesseract:'',tessdata,ocrLanguages:['por','eng','spa'].filter(lang=>fs.existsSync(path.join(tessdata,lang+'.traineddata')))};
}
function mediaType(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{ext:'png',mime:'image/png'};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return{ext:'jpg',mime:'image/jpeg'};
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return{ext:'webp',mime:'image/webp'};
  if(bytes.subarray(4,8).toString()==='ftyp')return{ext:'mp4',mime:'video/mp4'};
  if(bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])))return{ext:'webm',mime:'video/webm'};
  throw new Error('Use PNG, JPEG, WebP, MP4 ou WebM.');
}
function runTool(executable,args,{signal,timeout=60000}={}){
  return new Promise((resolve,reject)=>{if(signal?.aborted){reject(Object.assign(new Error('Extração cancelada.'),{name:'AbortError'}));return;}
    const child=spawn(executable,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,OMP_THREAD_LIMIT:'1'}});let text='',ended=false;
    const finish=(error)=>{if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(text);};
    const abort=()=>{child.kill();finish(Object.assign(new Error('Extração cancelada.'),{name:'AbortError'}));};signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{child.kill();finish(new Error('A extração excedeu o tempo esperado. Use uma peça menor.'));},timeout);
    child.stdout.on('data',chunk=>{text+=String(chunk);if(text.length>500000){child.kill();finish(new Error('Texto extraído excedeu o limite.'));}});child.stderr.resume();
    child.once('error',()=>finish(new Error('Não foi possível executar a ferramenta de extração.')));child.once('exit',code=>finish(code===0?null:new Error('A ferramenta não conseguiu processar esta mídia.')));
  });
}
function createMediaService(db,{tools=findTools(),run=runTool,extraBytes=()=>0}={}){
  const folder=path.join(db.folder,'midias');fs.mkdirSync(folder,{recursive:true});
  function add(adId,base64){if(!db.detail(adId))throw new Error('Anúncio não encontrado.');if(typeof base64!=='string'||base64.length>MAX_FILE*1.38||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('Arquivo inválido ou maior que 20 MB.');
    const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>MAX_FILE)throw new Error('Use um arquivo de até 20 MB.');const type=mediaType(bytes),hash=createHash('sha256').update(bytes).digest('hex');
    const existing=db.db.prepare('SELECT id FROM media WHERE ad_id=? AND hash=?').get(adId,hash);if(existing)return{id:existing.id,duplicate:true};
    if(db.mediaBytes()+extraBytes()+bytes.length>MAX_STORAGE)throw new Error('O armazenamento de mídia atingiu 250 MB. Remova referências antigas antes de anexar outras.');
    const id=randomUUID(),file=id+'.'+type.ext,target=path.join(folder,file);fs.writeFileSync(target,bytes,{flag:'wx'});
    try{db.addMedia({id,adId,hash,file,mime:type.mime,size:bytes.length});}catch(error){fs.unlinkSync(target);throw error;}
    return{id,duplicate:false};
  }
  const fileFor=id=>{const row=db.media(id);if(!row||path.basename(row.file)!==row.file)return null;return{...row,path:path.join(folder,row.file)};};
  async function extract(id,{country='BR',transcribe,signal}={}){
    const media=fileFor(id);if(!media)throw new Error('Mídia não encontrada.');const video=media.mime.startsWith('video/'),notes=[],artifacts=[];let image=media.path,transcript='';
    try{
      if(video){
        if(!tools.ffmpeg)throw new Error('FFmpeg não localizado. Instale-o ou utilize uma imagem.');
        image=path.join(folder,id+'-quadro.png');artifacts.push(image);
        await run(tools.ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-protocol_whitelist','file,pipe','-threads','1','-i',media.path,'-vf','scale=1280:720:force_original_aspect_ratio=decrease','-frames:v','1',image],{signal});
        notes.push('OCR do primeiro quadro; não representa todos os textos do vídeo.');
        if(transcribe){const audio=path.join(folder,id+'-audio.mp3');artifacts.push(audio);
          try{await run(tools.ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y','-protocol_whitelist','file,pipe','-threads','1','-i',media.path,'-t','180','-vn','-ac','1','-ar','16000','-b:a','48k',audio],{signal});
            transcript=(await transcribe(fs.readFileSync(audio),signal)).text;notes.push('Transcrição de até 3 minutos do áudio; usa a cota de áudio da Groq.');
          }catch(error){if(signal?.aborted)throw error;notes.push(error.message);}
        }
      }
      let ocr='';if(tools.tesseract){let lang=country==='ES'?'spa':country==='US'?'eng':'por';
        if(!tools.ocrLanguages.includes(lang)){lang='eng';notes.push('Idioma de OCR indisponível; foi usado o reconhecimento em inglês.');}
        const dataArgs=tools.ocrLanguages.includes(lang)?['--tessdata-dir',tools.tessdata]:[];
        ocr=await run(tools.tesseract,[image,'stdout',...dataArgs,'-l',lang,'--psm','11'],{signal});
      }else notes.push('Tesseract não localizado. O texto pode ser informado manualmente.');
      const result={ocr:ocr.trim().slice(0,16000),transcript:transcript.slice(0,24000),notes,at:new Date().toISOString()};let previous;try{previous=JSON.parse(media.extracted);}catch{}if(previous?.modeling)result.modeling=previous.modeling;db.extracted(id,result);return result;
    }finally{for(const artifact of artifacts)try{fs.unlinkSync(artifact);}catch{}}
  }
  return{add,fileFor,extract,status:()=>({ffmpeg:Boolean(tools.ffmpeg),tesseract:Boolean(tools.tesseract),ocrLanguages:tools.ocrLanguages,usedBytes:db.mediaBytes()+extraBytes(),maxBytes:MAX_STORAGE,maxFileBytes:MAX_FILE})};
}
module.exports={createMediaService,mediaType,findTools,runTool};
