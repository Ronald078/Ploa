'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {scoreSignals}=require('./creative-signals');
const {normalizeOfferUrl,offerFromText}=require('./creative-offer-url');
const clean=(value,max=500)=>String(value??'').replace(/\u0000/g,'').trim().slice(0,max);
const json=value=>JSON.stringify(value);
const read=value=>{try{return JSON.parse(value);}catch{return null;}};
function publicUrl(value){try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return'';for(const key of [...url.searchParams.keys()])if(/token|secret|password|api.?key|signature/i.test(key))url.searchParams.delete(key);return url.href.slice(0,2000);}catch{return'';}}
function normalizedAd(raw){
  const body=clean(raw.body??raw.text??raw.summary,16000),title=clean(raw.title||body.slice(0,95)||'Referência sem título',180),advertiser=clean(raw.advertiser||raw.page_name||'Não informado',180);
  const referenceUrl=publicUrl(raw.referenceUrl||raw.ad_snapshot_url||''),source=raw.source==='meta'?'meta':'import';
  const externalId=clean(raw.externalId|| (source==='meta'?raw.id:'') || (()=>{try{const url=new URL(referenceUrl);return ['facebook.com','www.facebook.com','pt-br.facebook.com'].includes(url.hostname)&&url.pathname.startsWith('/ads/library')?url.searchParams.get('id')||'':'';}catch{return'';}})(),160);
  const country=['BR','PT','ES','US'].includes(raw.country)?raw.country:'BR';
  const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
  const countries=[...new Set([country,...(Array.isArray(raw.countries)?raw.countries:[])].filter(value=>['BR','PT','ES','US'].includes(value)))];
  const reachValue=raw.euReach??raw.eu_total_reach,reach=Number(reachValue),euReach=reachValue!==null&&reachValue!==undefined&&String(reachValue).trim()!==''&&Number.isSafeInteger(reach)&&reach>=0?reach:null;
  let snapshotUrl='';try{const url=new URL(raw.snapshotUrl||'');if(url.protocol==='https:'&&['www.facebook.com','facebook.com','pt-br.facebook.com'].includes(url.hostname)&&url.pathname==='/ads/archive/render_ad/'&&/^\d+$/.test(url.searchParams.get('id')||''))snapshotUrl='https://www.facebook.com/ads/archive/render_ad/?id='+url.searchParams.get('id');}catch{}
  const ad={source,externalId,title,advertiser,body,country,countries,niche:clean(raw.niche||'Sem nicho',90),referenceUrl,status:['active','inactive'].includes(raw.status)?raw.status:'unknown',
    snapshotUrl,euReach,offerUrl:normalizeOfferUrl(raw.offerUrl||raw.landingUrl||raw.destinationUrl)||offerFromText(body),offerSource:['manual','snapshot','text','source'].includes(raw.offerSource)?raw.offerSource:'source',
    deliveryStart:date(raw.deliveryStart||raw.ad_delivery_start_time),deliveryStop:date(raw.deliveryStop||raw.ad_delivery_stop_time),
    placements:[...new Set((Array.isArray(raw.placements)?raw.placements:[]).map(v=>clean(v,30)))].slice(0,12),variants:Math.min(100,Math.max(0,Number(raw.variants)||0))};
  if(!body&&!referenceUrl&&!raw.title)throw new Error('Informe texto, título ou link do anúncio.');
  let isMeta=source==='meta';try{const url=new URL(referenceUrl);isMeta||=['facebook.com','www.facebook.com','pt-br.facebook.com'].includes(url.hostname)&&url.pathname.startsWith('/ads/library');}catch{}
  const canonical=externalId?(isMeta?'meta':source)+':'+externalId:referenceUrl?referenceUrl:json([title,advertiser,body,country]);
  return{...ad,dedupe:createHash('sha256').update(canonical).digest('hex')};
}
function createCreativeDb(root,{now=Date.now}={}){
  const {DatabaseSync}=require('node:sqlite');
  const folder=path.join(root,'crm','minerador');fs.mkdirSync(folder,{recursive:true});
  const db=new DatabaseSync(path.join(folder,'criativos.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ads(id TEXT PRIMARY KEY,dedupe TEXT UNIQUE NOT NULL,country TEXT NOT NULL,niche TEXT NOT NULL,advertiser TEXT NOT NULL,body TEXT NOT NULL,payload TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,score INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ads_filters ON ads(country,niche,updated_at);
    CREATE TABLE IF NOT EXISTS observations(ad_id TEXT NOT NULL REFERENCES ads(id) ON DELETE CASCADE,day TEXT NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(ad_id,day));
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,ad_id TEXT NOT NULL REFERENCES ads(id) ON DELETE CASCADE,hash TEXT NOT NULL,file TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,extracted TEXT NOT NULL DEFAULT '{}',UNIQUE(ad_id,hash));
    CREATE TABLE IF NOT EXISTS analyses(ad_id TEXT PRIMARY KEY REFERENCES ads(id) ON DELETE CASCADE,result TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offer_sites(ad_id TEXT PRIMARY KEY REFERENCES ads(id) ON DELETE CASCADE,result TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,progress TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT);
    PRAGMA user_version=2;`);
  db.prepare("UPDATE jobs SET status='interrupted',progress=? WHERE status IN ('running','queued')").run(json({stage:'Tarefa interrompida ao fechar o aplicativo. Use Tentar novamente para continuar.'}));
  if(!db.prepare('PRAGMA table_info(ads)').all().some(column=>column.name==='score'))db.exec('ALTER TABLE ads ADD COLUMN score INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS ads_priority ON ads(score DESC,updated_at DESC)');
  const stamp=()=>new Date(now()).toISOString();
  const setting=(key,value)=>{if(value!==undefined){db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json(value));return value;}return read(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value);};
  function upsert(raw){const ad=normalizedAd(raw),existing=db.prepare('SELECT id,body,payload FROM ads WHERE dedupe=?').get(ad.dedupe),id=existing?.id||randomUUID(),at=stamp();
    if(existing)ad.countries=[...new Set([...(read(existing.payload)?.countries||[read(existing.payload)?.country]),...ad.countries].filter(Boolean))];
    if(existing){const before=read(existing.payload);if(before?.offerUrl&&(!ad.offerUrl||before.offerSource==='manual')){ad.offerUrl=before.offerUrl;ad.offerSource=before.offerSource||'source';}}
    db.prepare(`INSERT INTO ads(id,dedupe,country,niche,advertiser,body,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(dedupe) DO UPDATE SET country=excluded.country,niche=excluded.niche,advertiser=excluded.advertiser,body=excluded.body,payload=excluded.payload,updated_at=excluded.updated_at`).run(id,ad.dedupe,ad.country,ad.niche,ad.advertiser,ad.body,json(ad),at,at);
    db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?)').run(id,at.slice(0,10),at);
    const observations=Number(db.prepare('SELECT count(*) n FROM observations WHERE ad_id=?').get(id).n);
    db.prepare('UPDATE ads SET score=? WHERE id=?').run(scoreSignals(ad,observations,now()).score,id);
    // Delivery metrics change during collection without invalidating an approved adaptation.
    const previous=read(existing?.payload);if(existing&&['body','title','country'].some(key=>previous?.[key]!==ad[key]))db.prepare('DELETE FROM analyses WHERE ad_id=?').run(id);
    return{id,added:!existing};
  }
  function importMany(rows){if(!Array.isArray(rows)||rows.length>500)throw new Error('Importe até 500 anúncios por vez.');
    const normalized=rows.map(normalizedAd);let added=0,updated=0;db.exec('BEGIN');
    try{for(const row of normalized){if(upsert(row).added)added++;else updated++;}db.exec('COMMIT');return{added,updated};}catch(error){db.exec('ROLLBACK');throw error;}
  }
  function detail(id,{fullSite=true}={}){const row=db.prepare('SELECT * FROM ads WHERE id=?').get(id);if(!row)return null;
    const ad={...read(row.payload),id:row.id,favorite:Boolean(row.favorite),createdAt:row.created_at,updatedAt:row.updated_at};
    ad.observations=Number(db.prepare('SELECT count(*) n FROM observations WHERE ad_id=?').get(id).n);ad.research=scoreSignals(ad,ad.observations,now());
    ad.media=db.prepare('SELECT * FROM media WHERE ad_id=?').all(id).map(m=>({id:m.id,mime:m.mime,size:m.size,extracted:read(m.extracted),url:'/api/creative-miner/media/'+m.id}));
    ad.analysis=read(db.prepare('SELECT result FROM analyses WHERE ad_id=?').get(id)?.result);const site=read(db.prepare('SELECT result FROM offer_sites WHERE ad_id=?').get(id)?.result);ad.site=fullSite?site:site?{hasPage:Boolean(site.page),sourceUrl:site.sourceUrl,pageAt:site.pageAt}:null;return ad;
  }
  function list({query='',country='',niche='',favorite=false,withSite=false,minScore=0,offset=0,limit=36,sort='signals'}={}){
    const args=[],where=[];if(query){where.push('(body LIKE ? ESCAPE \'!\' OR advertiser LIKE ? ESCAPE \'!\' OR payload LIKE ? ESCAPE \'!\')');const q='%'+clean(query,160).replace(/[!%_]/g,'!$&')+'%';args.push(q,q,q);}
    if(country){where.push('(country=? OR EXISTS(SELECT 1 FROM json_each(ads.payload,\'$.countries\') WHERE value=?))');args.push(country,country);}if(niche){where.push('niche=?');args.push(niche);}if(favorite===true||favorite==='true')where.push('favorite=1');
    where.push('score>=?');args.push(Math.max(0,Number(minScore)||0));
    if(withSite===true||withSite==='true')where.push("coalesce(json_extract(payload,'$.offerUrl'),'')<>''");
    const sql=' FROM ads WHERE '+where.join(' AND ');
    const start=Math.max(0,Number(offset)||0),size=Math.min(100,Math.max(1,Number(limit)||36));
    const ordering={signals:'score DESC,updated_at DESC,id',recent:'updated_at DESC,id',reach:"coalesce(json_extract(payload,'$.euReach'),-1) DESC,updated_at DESC,id",duration:"coalesce(json_extract(payload,'$.deliveryStart'),'9999') ASC,updated_at DESC,id"};
    const total=Number(db.prepare('SELECT count(*) n'+sql).get(...args).n),ads=db.prepare('SELECT id'+sql+' ORDER BY '+(Object.hasOwn(ordering,sort)?ordering[sort]:ordering.signals)+' LIMIT ? OFFSET ?').all(...args,size,start).map(row=>detail(row.id,{fullSite:false}));
    return{ads,total,offset:start,limit:size,hasMore:start+size<total,
      summary:{total:Number(db.prepare('SELECT count(*) n FROM ads').get().n),favorites:Number(db.prepare('SELECT count(*) n FROM ads WHERE favorite=1').get().n),
        niches:Number(db.prepare('SELECT count(DISTINCT niche) n FROM ads').get().n),highScale:Number(db.prepare('SELECT count(*) n FROM ads WHERE score>=70').get().n),active:Number(db.prepare("SELECT count(*) n FROM ads WHERE json_extract(payload,'$.status')='active'").get().n)},
      niches:db.prepare('SELECT DISTINCT niche FROM ads ORDER BY niche').all().map(r=>r.niche)};
  }
  const job=id=>{const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return row?{id:row.id,kind:row.kind,status:row.status,adId:read(row.payload)?.adId||null,progress:read(row.progress),createdAt:row.created_at,finishedAt:row.finished_at}:null;};
  return{folder,db,setting,stamp,upsert,importMany,detail,list,
    offerLink:(id,value,source='manual')=>{const row=db.prepare('SELECT payload FROM ads WHERE id=?').get(id);if(!row)throw new Error('Anúncio não encontrado.');const url=normalizeOfferUrl(value);if(!url)throw new Error('Informe um site público válido para a oferta.');const payload=read(row.payload);if(payload.offerSource==='manual'&&source!=='manual')return payload.offerUrl;db.prepare('UPDATE ads SET payload=? WHERE id=?').run(json({...payload,offerUrl:url,offerSource:source}),id);return url;},
    putSite:(id,value)=>db.prepare('INSERT INTO offer_sites VALUES(?,?,?) ON CONFLICT(ad_id) DO UPDATE SET result=excluded.result,updated_at=excluded.updated_at').run(id,json(value),stamp()),
    favorite:(id,value)=>{db.prepare('UPDATE ads SET favorite=? WHERE id=?').run(value?1:0,id);return detail(id);},
    putAnalysis:(id,value)=>db.prepare('INSERT INTO analyses VALUES(?,?,?) ON CONFLICT(ad_id) DO UPDATE SET result=excluded.result,created_at=excluded.created_at').run(id,json(value),stamp()),
    job,jobPayload:id=>read(db.prepare('SELECT payload FROM jobs WHERE id=?').get(id)?.payload),
    jobs:()=>db.prepare('SELECT id FROM jobs ORDER BY created_at DESC,rowid DESC LIMIT 20').all().map(r=>job(r.id)),
    activeJobs:()=>db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') ORDER BY created_at,rowid").all().map(row=>job(row.id)),
    findExternal:id=>{const rows=db.prepare("SELECT id FROM ads WHERE json_extract(payload,'$.externalId')=? ORDER BY updated_at DESC LIMIT 1").get(String(id));return rows?detail(rows.id):null;},
    enqueue:(kind,payload)=>{const id=randomUUID();db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,NULL)').run(id,kind,'queued',json(payload),json({stage:'Na fila',processed:0,added:0,updated:0}),stamp());return job(id);},
    progress:(id,status,value)=>db.prepare('UPDATE jobs SET status=?,progress=?,finished_at=? WHERE id=?').run(status,json(value),['done','failed','cancelled'].includes(status)?stamp():null,id),
    media:id=>db.prepare('SELECT * FROM media WHERE id=?').get(id),
    addMedia:value=>db.prepare('INSERT INTO media(id,ad_id,hash,file,mime,size) VALUES(?,?,?,?,?,?)').run(value.id,value.adId,value.hash,value.file,value.mime,value.size),
    extracted:(id,value)=>{db.prepare('UPDATE media SET extracted=? WHERE id=?').run(json(value),id);db.prepare('DELETE FROM analyses WHERE ad_id=(SELECT ad_id FROM media WHERE id=?)').run(id);},
    modeling:(id,value)=>{const row=db.prepare('SELECT extracted FROM media WHERE id=?').get(id);if(!row)throw new Error('Mídia não encontrada.');db.prepare('UPDATE media SET extracted=? WHERE id=?').run(json({...read(row.extracted),modeling:value}),id);},
    mediaBytes:()=>Number(db.prepare("SELECT coalesce(sum(size+coalesce(json_extract(extracted,'$.modeling.board.size'),0)),0) n FROM media").get().n),
    close:()=>db.close()};
}
module.exports={createCreativeDb,normalizedAd,publicUrl};
