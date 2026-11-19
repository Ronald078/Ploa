'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {findTools,runTool}=require('./creative-media');
const {createCreativeMaterials}=require('./creative-materials');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=production=>createHash('sha256').update(JSON.stringify(production)).digest('hex');
function settings(input={}){
 const brand=String(input.brand||'').trim();
 if(!brand||brand.length>50||/[\x00-\x1f]/.test(brand))throw new Error('Informe sua marca, com até 50 caracteres.');
 if(input.theme!==undefined&&!['blue','silver'].includes(input.theme))throw new Error('Escolha uma das identidades disponíveis.');
 return{brand,theme:input.theme||'blue'};
}
function slideHtml(production,config,index,width,height,material=null){
 const scene=production.scenes[index],title=scene.onScreen||production.copy.headline;
 const supporting=production.config.format==='image'?production.copy.description:'';
 const light=config.theme==='silver',background=light?'#edf1f5':'#06121e',ink=light?'#101e2c':'#f0f6fc',muted=light?'#425870':'#b1c8db',accent=light?'#135a9a':'#8bcaff';
 return `<!doctype html><html lang="${({BR:'pt-BR',PT:'pt-PT',US:'en-US',ES:'es-ES'})[production.config.country]||'pt-BR'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
 *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}body{font-family:'Segoe UI',Arial,sans-serif;background:${background};color:${ink};padding:${Math.round(width*.075)}px;display:flex;flex-direction:column;position:relative}body:before{content:'';position:absolute;width:${width*.9}px;height:${width*.9}px;border:1px solid ${accent}35;border-radius:50%;right:-${width*.42}px;top:${height*.21}px;box-shadow:0 0 0 ${width*.075}px ${accent}08;pointer-events:none}.brand{position:relative;font-weight:650;letter-spacing:-.02em;font-size:${width*.046}px;line-height:1.3;padding-block:.08em;flex-shrink:0;max-height:${height*.12}px;overflow:hidden;color:${accent};white-space:pre-wrap;overflow-wrap:anywhere}.content{position:relative;display:flex;flex-direction:column;justify-content:center;flex:1;min-height:0;gap:${width*.04}px}.caption:empty{display:none}.caption{margin:0;flex-shrink:0;font-size:${width*.035}px;color:${muted};line-height:1.5;max-width:90%}.title{margin:0;flex-shrink:0;padding-block:.08em;font-size:${width*.103}px;font-weight:750;letter-spacing:-.055em;line-height:1.25;overflow-wrap:anywhere;max-height:${height*.53}px;overflow:hidden}.cta{position:relative;flex-shrink:0;font-size:${width*.042}px;line-height:1.35;font-weight:650;max-height:${height*.16}px;overflow:hidden;padding:${width*.03}px ${width*.04}px;background:${accent};color:${background};border-radius:${width*.025}px;align-self:flex-start;max-width:100%;overflow-wrap:anywhere}.count{position:relative;font-size:${width*.026}px;margin-top:${width*.026}px;color:${muted}}
 ${material?`.visual{position:relative;flex-shrink:0;width:100%;height:${height*.34}px;margin-top:${width*.045}px;border-radius:${width*.025}px;overflow:hidden;background:${light?'#dbe5ed':'#0c2539'}}.visual img{width:100%;height:100%;object-fit:${material.fit};object-position:center ${material.position};display:block}.title{font-size:${width*.077}px;max-height:${height*.29}px}.content{gap:${width*.02}px}.caption{font-size:${width*.028}px}`:''}
 </style></head><body><div class="brand">${escape(config.brand)}</div>${material?`<div class="visual"><img src="${escape(material.src)}" alt=""></div>`:''}<main class="content"><p class="caption">${escape(supporting)}</p><h1 class="title">${escape(title)}</h1></main><div class="cta">${escape(production.copy.cta)}</div>${production.config.format==='carousel'?`<div class="count">${index+1} / ${production.scenes.length}</div>`:''}</body></html>`;
}
function zipStored(files){
 const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 const locals=[],directory=[];let offset=0;
 for(const {name,data} of files){const filename=Buffer.from(name),header=Buffer.alloc(30),central=Buffer.alloc(46);let crc=0xffffffff;for(const value of data)crc=table[(crc^value)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  locals.push(header,filename,data);directory.push(central,filename);offset+=header.length+filename.length+data.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,end]);
}
function createCreativeRenderer({db,tools=findTools(),launch,run=runTool}){
 const folder=path.join(db.folder,'exportacoes');fs.mkdirSync(folder,{recursive:true});
 const exportBytes=()=>fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isFile()).reduce((sum,e)=>sum+fs.statSync(path.join(folder,e.name)).size,0);
 const materials=createCreativeMaterials({db,tools,run,extraBytes:exportBytes});
 const versionFor=id=>materials.signature(id)==='[]'?hash(db.detail(id)?.analysis?.production):hash({production:db.detail(id)?.analysis?.production,materials:materials.signature(id)});
 const record=id=>db.setting('render:'+id);
 function file(id){const ad=db.detail(id),saved=record(id);if(!ad?.analysis?.production||!saved||saved.hash!==versionFor(id)||!/^[-a-f0-9]{36}\.(png|mp4|zip)$/.test(saved.file))return null;
  const target=path.join(folder,saved.file);if(!fs.existsSync(target))return null;return{...saved,path:target,size:fs.statSync(target).size};}
 function info(id){const saved=file(id);return saved?{mime:saved.mime,size:saved.size,format:saved.format,at:saved.at,width:saved.width,height:saved.height,duration:saved.duration,silent:true,url:'/api/creative-miner/ads/'+id+'/rendered'}:null;}
 function bytes(){return exportBytes()+materials.usedBytes();}
 function remove(id){const saved=record(id);if(saved?.file&&/^[-a-f0-9]{36}\.(png|mp4|zip)$/.test(saved.file))try{fs.unlinkSync(path.join(folder,saved.file));}catch{}db.setting('render:'+id,null);}
 async function render(id,input,{signal,onProgress=()=>{}}={}){
  const config=settings(input),ad=db.detail(id),p=ad?.analysis?.production;
  if(!p||!['image','carousel','video'].includes(p.config?.format)||!p.scenes?.length||!p.copy)throw new Error('Gere e revise a modelagem antes de exportar o criativo.');
  if(p.scenes.length>4||p.config.format==='video'&&![15,30,45,60].includes(p.config.durationSeconds))throw new Error('O plano não tem um formato de exportação válido.');
  if(p.config.format==='video'&&!tools.ffmpeg)throw new Error('Instale o FFmpeg para exportar o vídeo.');
  if(bytes()+db.mediaBytes()>230*1024*1024)throw new Error('Remova mídias ou exportações antigas antes de gerar outro arquivo.');
  const version=versionFor(id),temp=fs.mkdtempSync(path.join(folder,'trabalho-'));let browser,output;
  const check=()=>{if(signal?.aborted)throw new Error('Exportação cancelada.');};
  const abort=()=>{void browser?.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
   check();const width=p.config.format==='video'?720:1080,height=p.config.format==='video'?1280:1350;
   const executable=process.env.PUPPETEER_EXECUTABLE_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f=>fs.existsSync(f));
   if(!executable&&!launch)throw new Error('Nenhum navegador compatível foi localizado para montar a arte.');
   browser=await(launch||require('puppeteer').launch)({headless:true,executablePath:executable,userDataDir:path.join(temp,'browser')});
   const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:1});await page.setRequestInterception(true);page.on('request',request=>void (request.url().startsWith('data:image/')?request.continue():request.abort()).catch(()=>{}));
   const frames=[];
   for(let index=0;index<p.scenes.length;index++){
    check();onProgress({stage:'Montando arte '+(index+1)+' de '+p.scenes.length,processed:index,total:p.scenes.length});
    await page.setContent(slideHtml(p,config,index,width,height,materials.image(id,index)),{waitUntil:'domcontentloaded'});
    await page.evaluate(async()=>{
     await Promise.all(Array.from(document.images,image=>image.decode()));
     for(const selector of ['.brand','.title','.cta']){
      const el=document.querySelector(selector);
      let size=parseFloat(getComputedStyle(el).fontSize);
      while((el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)&&size>24){size-=2;el.style.fontSize=size+'px';}
      if(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)throw new Error('Texto longo demais para a arte. Encurte a mensagem da modelagem.');
     }
     const content=document.querySelector('.content'),title=document.querySelector('.title');
     let size=parseFloat(getComputedStyle(title).fontSize);
     const fits=()=>Array.from(content.children).filter(el=>el.textContent).reduce((sum,el)=>sum+el.getBoundingClientRect().height,0)+(content.querySelector('.caption').textContent?parseFloat(getComputedStyle(content).gap):0)<=content.clientHeight;
     while(!fits()&&size>24){size-=2;title.style.fontSize=size+'px';}
     if(!fits())throw new Error('Texto longo demais para a arte. Encurte a mensagem da modelagem.');
    });
    const filename=path.join(temp,'frame'+index+'.png');await page.screenshot({path:filename,type:'png'});frames.push(filename);
   }
   await browser.close();browser=null;check();
   const format=p.config.format,extension=format==='video'?'mp4':format==='carousel'?'zip':'png',name=randomUUID()+'.'+extension;
   output=path.join(folder,name);
   if(format==='image')fs.copyFileSync(frames[0],output);
   else if(format==='carousel')fs.writeFileSync(output,zipStored(frames.map((file,index)=>({name:'slide-'+(index+1)+'.png',data:fs.readFileSync(file)}))));
   else{
    onProgress({stage:'Renderizando cenas com textos e materiais próprios, sem narração',processed:frames.length,total:frames.length});
    const args=['-nostdin','-hide_banner','-loglevel','error','-y','-filter_complex_threads','1'];
    for(let index=0;index<frames.length;index++)args.push('-loop','1','-framerate','24','-t',String(p.scenes[index].end-p.scenes[index].start),'-i',frames[index]);
    const filters=frames.map((_,index)=>{const seconds=p.scenes[index].end-p.scenes[index].start;if(seconds<=0)throw new Error('Duração das cenas inválida.');return`[${index}:v]format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0,seconds-.25)}:d=0.25,setpts=PTS-STARTPTS[v${index}]`;});
    filters.push(frames.map((_,index)=>'[v'+index+']').join('')+'concat=n='+frames.length+':v=1:a=0[out]');
    args.push('-filter_complex',filters.join(';'),'-map','[out]','-an','-c:v','libx264','-preset','veryfast','-crf','23','-threads','1','-movflags','+faststart',output);
    await run(tools.ffmpeg,args,{signal,timeout:180000});
   }
   check();if(versionFor(id)!==version)throw new Error('A modelagem ou os materiais mudaram durante a exportação. Gere novamente.');
   if(fs.statSync(output).size>40*1024*1024||bytes()+db.mediaBytes()>250*1024*1024)throw new Error('O arquivo excedeu o limite de armazenamento.');
   const old=record(id);db.setting('render:'+id,{file:name,hash:version,mime:format==='video'?'video/mp4':format==='carousel'?'application/zip':'image/png',format,at:db.stamp(),width,height,duration:p.config.durationSeconds||0});
   if(old?.file&&/^[-a-f0-9]{36}\.(png|mp4|zip)$/.test(old.file))try{fs.unlinkSync(path.join(folder,old.file));}catch{}
   output=null;return info(id);
  }finally{
   signal?.removeEventListener('abort',abort);await browser?.close().catch(()=>{});
   if(output)try{fs.unlinkSync(output);}catch{}
   const resolved=fs.realpathSync(temp);if(path.dirname(resolved)===fs.realpathSync(folder)&&path.basename(resolved).startsWith('trabalho-'))fs.rmSync(resolved,{recursive:true,force:true});
  }
 }
 function preview(id,input,index){const p=db.detail(id)?.analysis?.production;if(!p||!Number.isInteger(index)||!p.scenes[index])throw new Error('Cena não encontrada.');const config=settings(input),width=p.config.format==='video'?720:1080,height=p.config.format==='video'?1280:1350;return slideHtml(p,config,index,width,height,materials.image(id,index));}
 return{render,info,file,remove,usedBytes:bytes,materials,preview};
}
module.exports={createCreativeRenderer,settings,slideHtml,zipStored};
