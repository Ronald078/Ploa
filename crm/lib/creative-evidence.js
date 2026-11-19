'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {findTools,runTool}=require('./creative-media');
function createCreativeEvidence({db,media,tools=findTools(),run=runTool,extraBytes=()=>0}){
 const folder=path.join(db.folder,'midias');
 const boardFile=state=>state?.board?.file&&path.basename(state.board.file)===state.board.file?path.join(folder,state.board.file):null;
 const board=id=>{const row=db.media(id);if(!row)return null;let state;try{state=JSON.parse(row.extracted).modeling;}catch{}const file=boardFile(state);return file&&fs.existsSync(file)?{path:file,size:fs.statSync(file).size,mime:'image/jpeg'}:null;};
 async function prepare(id,{signal,transcribe,onProgress=()=>{}}={}){
  const source=media.fileFor(id);if(!source)throw new Error('A mídia da referência não foi encontrada.');
  const video=source.mime.startsWith('video/'),temporary=[];let cached;try{cached=JSON.parse(source.extracted).modeling;}catch{}
  let state=cached&&board(id)?cached:null;
  try{
   if(!state){
    if(!tools.ffmpeg)throw new Error('FFmpeg não localizado para preparar a análise visual.');
    let duration=null,audioAvailable=false;
    if(video){if(!tools.ffprobe)throw new Error('FFprobe não localizado para ler os tempos do vídeo.');
     const info=JSON.parse(await run(tools.ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type','-of','json',source.path],{signal}));
     duration=Number(info.format?.duration);if(!Number.isFinite(duration)||duration<=0||duration>3600)throw new Error('Não foi possível ler uma duração válida para o vídeo.');
     audioAvailable=info.streams?.some(row=>row.codec_type==='audio')||false;
    }
    const times=video?[0,.15,.35,.55,.75,.95].map(fraction=>Math.round(Math.min(duration-.04,Math.max(0,duration*fraction))*100)/100):[0];
    const stem=source.id+'-model-'+randomUUID(),parts=[];
    for(let i=0;i<times.length;i++){
     const file=path.join(folder,stem+'-'+i+'.jpg');temporary.push(file);parts.push(file);onProgress({stage:'Preparando amostra visual '+(i+1)+' de '+times.length});
     await run(tools.ffmpeg,['-nostdin','-loglevel','error','-y','-protocol_whitelist','file,pipe','-threads','1',...(video?['-ss',String(times[i])]:[]),'-i',source.path,'-an','-vf',video?'scale=512:288:force_original_aspect_ratio=decrease,pad=512:288:(ow-iw)/2:(oh-ih)/2':'scale=1280:1280:force_original_aspect_ratio=decrease','-frames:v','1','-q:v','4',file],{signal});
    }
    const file=path.join(folder,source.id+'-storyboard.jpg');temporary.push(file);
    if(video)await run(tools.ffmpeg,['-nostdin','-loglevel','error','-y','-protocol_whitelist','file,pipe','-threads','1','-framerate','1','-i',path.join(folder,stem+'-%d.jpg'),'-vf','tile=3x2','-frames:v','1','-q:v','4',file],{signal});
    else fs.copyFileSync(parts[0],file);
    const size=fs.statSync(file).size;if(size>3*1024*1024||db.mediaBytes()+extraBytes()+size>250*1024*1024)throw new Error('Não há espaço no limite de mídias para preparar o storyboard.');
    state={version:1,board:{file:path.basename(file),size,url:'/api/creative-miner/media/'+id+'/storyboard'},samples:times.map((seconds,index)=>({id:'F'+(index+1),seconds,position:index+1})),duration,audioAvailable,transcript:'',notes:[],at:new Date().toISOString()};
    db.modeling(id,state);temporary.splice(temporary.indexOf(file),1);
   }
   if(video&&state.audioAvailable&&transcribe&&!state.transcript){
    const audio=path.join(folder,source.id+'-model-audio.mp3');temporary.push(audio);onProgress({stage:'Transcrevendo a fala da referência (até 180 segundos)'});
    try{await run(tools.ffmpeg,['-nostdin','-loglevel','error','-y','-protocol_whitelist','file,pipe','-threads','1','-i',source.path,'-t','180','-vn','-ac','1','-ar','16000','-b:a','48k',audio],{signal});
     state.transcript=String((await transcribe(fs.readFileSync(audio),signal)).text||'').slice(0,12000);state.audioSeconds=Math.min(180,state.duration);
     state.audioNote=state.transcript?'Fala transcrita; música e efeitos não foram identificados.':'A transcrição não retornou fala legível.';
    }catch(error){if(signal?.aborted)throw error;state.audioNote='A transcrição não foi concluída: '+String(error.message).slice(0,260);}
    db.modeling(id,state);
   }
   const file=board(id);if(!file)throw new Error('O storyboard não está disponível.');
   return{state,image:{id:'V1',dataUrl:'data:image/jpeg;base64,'+fs.readFileSync(file.path).toString('base64')}};
  }finally{for(const file of temporary)try{fs.unlinkSync(file);}catch{}}
 }
 return{prepare,board,artifacts:ad=>ad.media.map(row=>board(row.id)?.path).filter(Boolean)};
}
module.exports={createCreativeEvidence};
