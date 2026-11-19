'use strict';
const COUNTRIES={BR:'Brasil',PT:'Portugal',ES:'Espanha',US:'Estados Unidos'};
function libraryUrl({query='',country='BR'}={}){const url=new URL('https://www.facebook.com/ads/library/');url.search=new URLSearchParams({active_status:'active',ad_type:'all',country:COUNTRIES[country]?country:'BR',q:String(query).slice(0,100),search_type:'keyword_unordered',media_type:'all'});return url.href;}
function createMetaSource({credentials,fetchImpl=fetch}){
  let token='',keyError='';try{token=credentials.load().meta||'';}catch{keyError='Não foi possível recuperar o token protegido. Salve-o novamente.';}
  function setToken(value,clear=false){if(!value&&!clear)return;const next=clear?'':String(value).trim();if(next&&(next.length<20||next.length>2000||/\s/.test(next)))throw new Error('O token da Meta parece incompleto.');credentials.save(next?{meta:next}:{});token=next;keyError='';}
  async function search({query,country,niche='',pages=3,version='v26.0'}, {signal,onPage=async()=>{}}={}){
    if(!['PT','ES'].includes(country))throw new Error('A busca comercial por esta API está disponível aqui para Portugal e Espanha. Para Brasil/EUA, abra a Biblioteca e importe as referências.');
    if(!token)throw new Error('Cadastre um token com acesso à API da Biblioteca de Anúncios em Conexão da Meta.');
    if(!/^v\d{1,2}\.0$/.test(version))throw new Error('Informe uma versão válida da Graph API, como v26.0.');
    query=String(query||'').trim();if(!query||query.length>100)throw new Error('Use uma pesquisa com 1 a 100 caracteres.');
    const seen=new Set();let cursor='',count=0,hasMore=false;
    for(let index=0;index<Math.min(5,Math.max(1,Number(pages)||3));index++){
      if(signal?.aborted)throw Object.assign(new Error('Pesquisa cancelada.'),{name:'AbortError'});
      const url=new URL('https://graph.facebook.com/'+version+'/ads_archive');
      url.search=new URLSearchParams({ad_type:'ALL',ad_active_status:'ACTIVE',ad_reached_countries:JSON.stringify([country]),search_terms:query,limit:'50',
        fields:'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,ad_snapshot_url,eu_total_reach'});
      if(cursor)url.searchParams.set('after',cursor);
      const response=await fetchImpl(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(25000)]),redirect:'error'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.error){const code=data.error?.code;throw Object.assign(new Error(code===190?'Token da Meta inválido ou expirado. Salve um token válido.':[10,200].includes(code)?'O aplicativo/token ainda não tem acesso à API da Biblioteca de Anúncios.':response.status===429||[4,17].includes(code)?'A Meta limitou as consultas. Aguarde antes de pesquisar novamente.':'A Meta não concluiu a pesquisa. Confira acesso e versão da API.'),{metaAccessBlocked:[190,10,200].includes(code)||[401,403].includes(response.status)});}
      if(!Array.isArray(data.data))throw new Error('A Meta devolveu uma resposta sem uma lista de anúncios.');
      const rows=data.data.slice(0,50).map(ad=>({source:'meta',externalId:String(ad.id),advertiser:ad.page_name,country,niche,
        title:ad.ad_creative_link_titles?.[0]||ad.ad_creative_bodies?.[0]?.slice(0,95)||'Anúncio da Meta',body:(ad.ad_creative_bodies||[]).join('\n\n'),
        variants:(ad.ad_creative_bodies||[]).length,placements:ad.publisher_platforms||[],status:'active',
        snapshotUrl:ad.ad_snapshot_url,euReach:ad.eu_total_reach,offerUrl:require('./creative-offer-url').offerFromText([...(ad.ad_creative_link_captions||[]),...(ad.ad_creative_bodies||[])].join(' ')),
        deliveryStart:ad.ad_delivery_start_time,deliveryStop:ad.ad_delivery_stop_time,referenceUrl:'https://www.facebook.com/ads/library/?id='+encodeURIComponent(ad.id)}));
      count+=rows.length;hasMore=Boolean(data.paging?.next);await onPage(rows,{page:index+1,received:count,hasMore});
      const after=String(data.paging?.cursors?.after||'');if(!hasMore||!after||after.length>3000||seen.has(after))break;seen.add(after);cursor=after;
    }
    return{received:count,hasMore};
  }
  async function snapshotHtml(id,{signal}={}){
    if(!token||!/^\d{1,40}$/.test(String(id)))throw new Error('Prévia da Meta indisponível.');
    const response=await fetchImpl('https://www.facebook.com/ads/archive/render_ad/?id='+id,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]),redirect:'error'});
    if(!response.ok||!String(response.headers?.get('content-type')||'').includes('text/html'))throw new Error('A Meta não disponibilizou a prévia visual.');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024){await response.body.cancel?.().catch(()=>{});throw new Error('Prévia maior que o limite de leitura.');}chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
  }
  return{search,snapshotHtml,setToken,status:()=>({hasToken:Boolean(token),error:keyError,coverage:['PT','ES'],documentation:'https://pt-br.facebook.com/ads/library/api'})};
}
module.exports={createMetaSource,libraryUrl,COUNTRIES};
