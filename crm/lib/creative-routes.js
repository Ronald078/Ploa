'use strict';
const fs=require('node:fs');
async function handleCreativeRoute({request,response,pathname,url,getMiner,sendJson,readJsonBody,requestIsLocalAndSameOrigin,applySecurityHeaders}){
  if(!pathname.startsWith('/api/creative-miner'))return false;
  if(!requestIsLocalAndSameOrigin(request)){sendJson(response,403,{erro:'Origem não permitida.'});return true;}
  const miner=getMiner(),method=request.method,base='/api/creative-miner';
  if(method==='GET'&&pathname===base){sendJson(response,200,miner.snapshot(Object.fromEntries(url.searchParams)));return true;}
  if(method==='GET'&&pathname===base+'/export'){sendJson(response,200,miner.export());return true;}
  const material=pathname.match(/^\/api\/creative-miner\/ads\/([a-f0-9-]{36})\/materials\/([0-3])$/i);
  if(material&&method==='DELETE'){sendJson(response,200,{materials:miner.removeMaterial(material[1],Number(material[2]))});return true;}
  if(material&&method==='GET'){
    const file=miner.material(material[1],Number(material[2]));if(!file){sendJson(response,404,{erro:'Material não encontrado.'});return true;}
    applySecurityHeaders(response);response.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.size,'Cache-Control':'no-store'});const stream=fs.createReadStream(file.path);stream.on('error',()=>response.destroy());response.once('close',()=>stream.destroy());stream.pipe(response);return true;
  }
  const renderPreview=pathname.match(/^\/api\/creative-miner\/ads\/([a-f0-9-]{36})\/render-preview$/i);
  if(renderPreview&&method==='GET'){
    const html=miner.renderPreview(renderPreview[1],{brand:url.searchParams.get('brand'),theme:url.searchParams.get('theme')||'blue'},Number(url.searchParams.get('scene')||0));
    applySecurityHeaders(response);response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");response.setHeader('X-Frame-Options','SAMEORIGIN');response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(html);return true;
  }
  const rendered=pathname.match(/^\/api\/creative-miner\/ads\/([a-f0-9-]{36})\/rendered$/i);
  if(method==='GET'&&rendered){
    const file=miner.rendered(rendered[1]);if(!file){sendJson(response,404,{erro:'Gere novamente o arquivo com a modelagem atual.'});return true;}
    applySecurityHeaders(response);response.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.size,'Content-Disposition':'attachment; filename="ploa-criativo-'+rendered[1]+'.'+file.file.split('.').pop()+'"','Cache-Control':'no-store'});fs.createReadStream(file.path).on('error',()=>response.destroy()).pipe(response);return true;
  }
  const media=pathname.match(/^\/api\/creative-miner\/media\/([a-f0-9-]{36})(\/storyboard)?$/i);
  if(method==='GET'&&media){const file=media[2]?miner.storyboard(media[1]):miner.media(media[1]);if(!file||!fs.existsSync(file.path)){sendJson(response,404,{erro:'Mídia não encontrada.'});return true;}
    const range=request.headers.range;let start=0,end=file.size-1;
    if(range){const match=String(range).match(/^bytes=(\d*)-(\d*)$/);if(!match||!match[1]&&!match[2]){response.writeHead(416,{'Content-Range':'bytes */'+file.size});response.end();return true;}
      if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}else start=Math.max(0,file.size-Number(match[2]));
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.size||!match[1]&&Number(match[2])===0){response.writeHead(416,{'Content-Range':'bytes */'+file.size});response.end();return true;}}
    applySecurityHeaders(response);response.writeHead(range?206:200,{'Content-Type':file.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${file.size}`} : {}),'Content-Disposition':'inline','Cache-Control':'private, max-age=600'});const stream=fs.createReadStream(file.path,{start,end});stream.on('error',()=>response.destroy());response.once('close',()=>stream.destroy());stream.pipe(response);return true;
  }
  const ad=pathname.match(/^\/api\/creative-miner\/ads\/([a-f0-9-]{36})$/i);
  const site=pathname.match(/^\/api\/creative-miner\/ads\/([a-f0-9-]{36})\/site(?:\/(preview|export|link))?$/i);
  if(method==='GET'&&site&&['preview','export'].includes(site[2])){const html=miner.siteHtml(site[1]);applySecurityHeaders(response);response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");response.setHeader('X-Frame-Options','SAMEORIGIN');response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',...(site[2]==='export'?{'Content-Disposition':'attachment; filename="ploa-site-'+site[1]+'.html"'}:{})});response.end(html);return true;}
  const brief=pathname.match(/^\/api\/creative-miner\/ads\/([a-f0-9-]{36})\/brief$/i);
  if(method==='GET'&&brief){const text=miner.productionText(brief[1]);applySecurityHeaders(response);response.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="ploa-modelagem-'+brief[1]+'.md"','Cache-Control':'no-store'});response.end(text);return true;}
  const watch=pathname.match(/^\/api\/creative-miner\/watches\/([a-f0-9-]{36})(?:\/(refresh|pause))?$/i);
  if(watch&&method==='DELETE'&&!watch[2]){sendJson(response,200,miner.removeWatch(watch[1]));return true;}
  if(ad&&method==='GET'){const detail=miner.detail(ad[1]);sendJson(response,detail?200:404,detail||{erro:'Anúncio não encontrado.'});return true;}
  if(ad&&method==='DELETE'){sendJson(response,200,miner.remove(ad[1]));return true;}
  if(!['POST','PUT'].includes(method)){sendJson(response,404,{erro:'Rota não encontrada.'});return true;}
  if(!String(request.headers['content-type']||'').startsWith('application/json')){sendJson(response,415,{erro:'Envie JSON.'});return true;}
  const body=await readJsonBody(request,pathname===base+'/upload'?30*1024*1024:material?12*1024*1024:8*1024*1024);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Envie um objeto JSON válido.');
  if(material&&method==='PUT'){sendJson(response,200,{materials:await miner.saveMaterial(material[1],Number(material[2]),body)});return true;}
  if(ad&&method==='PUT'){sendJson(response,200,body.favorite!==undefined?miner.favorite(ad[1],body.favorite===true):miner.edit(ad[1],body));return true;}
  if(site&&method==='PUT'){sendJson(response,200,site[2]==='link'?{offerUrl:miner.siteLink(site[1],body.url,'manual')}:miner.editSite(site[1],body));return true;}
  if(method==='PUT'&&pathname===base+'/settings'){sendJson(response,200,miner.saveSettings(body));return true;}
  if(method==='POST'&&pathname===base+'/import'){sendJson(response,200,miner.importData(body));return true;}
  if(method==='POST'&&pathname===base+'/upload'){sendJson(response,201,miner.upload(body.adId,body.base64));return true;}
  if(method==='POST'&&pathname===base+'/jobs'){sendJson(response,202,miner.enqueue(body.kind,body));return true;}
  if(method==='POST'&&pathname===base+'/watches'){sendJson(response,201,miner.saveWatch(body));return true;}
  if(watch&&method==='POST'&&watch[2]){sendJson(response,200,watch[2]==='refresh'?miner.refreshWatch(watch[1]):miner.pauseWatch(watch[1],body.paused===true));return true;}
  const cancel=pathname.match(/^\/api\/creative-miner\/jobs\/([a-f0-9-]{36})\/cancel$/i);
  if(method==='POST'&&cancel){sendJson(response,200,miner.cancel(cancel[1]));return true;}
  const retry=pathname.match(/^\/api\/creative-miner\/jobs\/([a-f0-9-]{36})\/retry$/i);
  if(method==='POST'&&retry){sendJson(response,202,miner.retry(retry[1]));return true;}
  sendJson(response,404,{erro:'Rota não encontrada.'});return true;
}
module.exports={handleCreativeRoute};
