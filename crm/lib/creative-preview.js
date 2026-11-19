'use strict';
const {offerCandidates}=require('./creative-offer-url');
// Read only the public media exposed by the official snapshot. No cookies, scripts,
// private endpoints, login automation or alternative-account fallback are used.
function cdnUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&!url.hostname.startsWith('static.')&&!url.pathname.includes('/rsrc.php')&&['fbcdn.net','fbsbx.com'].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain))?url.href:'';}catch{return'';}}
function decode(value){return value.replace(/&amp;/g,'&').replace(/&#(?:0*38|x0*26);/gi,'&').replace(/&quot;/g,'"').replace(/\\u0026/gi,'&').replace(/\\\//g,'/');}
function candidates(html){const found=[];
  if(/<form\b[^>]*action=["'][^"']*(?:login|checkpoint)|id=["'](?:login_form|loginbutton)["']/i.test(html))return found;
  for(const tag of html.match(/<meta\b[^>]{0,12000}>/gi)||[]){const attrs={};for(const match of tag.matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/gs))attrs[match[1].toLowerCase()]=decode(match[3]);
    const kind=attrs.property||attrs.name||'';if(['og:image','og:video','og:video:url','og:video:secure_url'].includes(kind)){const url=cdnUrl(attrs.content);if(url)found.push({url,video:kind.startsWith('og:video')});}}
  for(const match of html.matchAll(/"(video_hd_url|video_sd_url|browser_native_hd_url|browser_native_sd_url)"\s*:\s*"((?:\\.|[^"\\]){1,12000})"/g)){
    let value='';try{value=JSON.parse('"'+match[2]+'"');}catch{}const url=cdnUrl(value);if(url)found.push({url,video:true});}
  return [...new Map(found.sort((a,b)=>Number(b.video)-Number(a.video)).map(row=>[row.url,row])).values()].slice(0,4);
}
function createCreativePreview({db,media,meta,fetchImpl=fetch,now=Date.now}){
  function due(ad){const state=db.setting('preview:'+ad.id);return !ad.media.length&&Boolean(ad.snapshotUrl)&&(!state||now()-Date.parse(state.at)>=86400000);}
  async function collect(ad,{signal}={}){
    const state=db.setting('preview:'+ad.id);
    if(!due(ad))return{state:ad.media.length?'ready':state?.state||'not_provided'};
    const finish=(state,note)=>{const result={state,note,at:new Date(now()).toISOString()};db.setting('preview:'+ad.id,result);return result;};
    try{
      const html=await meta.snapshotHtml(ad.externalId,{signal}),urls=candidates(html),offers=offerCandidates(html);
      if(offers.length===1&&!ad.offerUrl)db.offerLink(ad.id,offers[0],'snapshot');
      for(const candidate of urls){
        if(signal?.aborted)throw new Error('Cancelado.');
        try{const response=await fetchImpl(candidate.url,{signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]),redirect:'error',headers:{Accept:'image/*,video/*'}});
          if(!response.ok||Number(response.headers?.get('content-length'))>20*1024*1024)continue;
          const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024)throw new Error('Mídia maior que 20 MB.');chunks.push(chunk);}
          const bytes=Buffer.concat(chunks),item=media.add(ad.id,bytes.toString('base64'));return{...finish('ready','Mídia obtida da prévia oficial.'),mediaId:item.id};
        }catch(error){if(signal?.aborted)throw error;}
      }
      return finish('unavailable','A fonte não forneceu imagem ou vídeo acessível. Use Ver na Meta para assistir ao anúncio.');
    }catch(error){if(signal?.aborted)throw error;return finish('unavailable','A fonte não liberou a prévia visual nesta consulta. Use Ver na Meta.');}
  }
  return{collect,due,status:id=>db.setting('preview:'+id)};
}
module.exports={createCreativePreview,cdnUrl,candidates};
