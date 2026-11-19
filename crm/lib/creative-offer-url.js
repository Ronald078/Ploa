'use strict';
const {isIP}=require('node:net');
function publicIp(address){
 if(isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2))||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 return isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!/^2002:|^2001:(?:db8|0{1,4}:|10:|20:)/i.test(address);
}
function normalizeOfferUrl(value){
 try{let url=new URL(String(value||'').trim());if(['l.facebook.com','lm.facebook.com','www.facebook.com'].includes(url.hostname)&&url.pathname==='/l.php')url=new URL(url.searchParams.get('u'));
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port)||host==='localhost'||!host.includes('.')&&!isIP(host)||/\.(?:localhost|local|internal|test|invalid)$/.test(host)||isIP(host)&&!publicIp(host))return'';
  if(['facebook.com','instagram.com','fbcdn.net','fbsbx.com','wa.me','whatsapp.com','tiktok.com'].some(domain=>host===domain||host.endsWith('.'+domain)))return'';
  for(const key of [...url.searchParams.keys()])if(/token|secret|password|api.?key|signature|^utm_|^fbclid$|^gclid$/i.test(key))url.searchParams.delete(key);
  url.hash='';return url.href.length<=2000?url.href:'';
 }catch{return'';}
}
function decode(value){try{return JSON.parse('"'+value.replace(/"/g,'\\"')+'"').replace(/&amp;/g,'&');}catch{return value.replace(/\\\//g,'/').replace(/\\u0026/gi,'&').replace(/&amp;/g,'&');}}
function offerCandidates(html){const values=[];
 for(const match of String(html).matchAll(/"(?:link_url|website_url|destination_url|landing_page_url|external_url)"\s*:\s*"((?:\\.|[^"\\]){1,6000})"/g)){let raw;try{raw=JSON.parse('"'+match[1]+'"');}catch{raw=decode(match[1]);}values.push(raw);}
 for(const match of String(html).matchAll(/href\s*=\s*(["'])(https?:[^"']{1,6000})\1/gi))if(/https?:\/\/(?:l|lm|www)\.facebook\.com\/l\.php\?/i.test(match[2]))values.push(decode(match[2]));
 return [...new Set(values.map(normalizeOfferUrl).filter(Boolean))].slice(0,5);
}
function offerFromText(value){const found=[...String(value||'').matchAll(/https?:\/\/[^\s<>"']+/gi)].map(row=>normalizeOfferUrl(row[0].replace(/[),.;!?]+$/,''))).filter(Boolean);return [...new Set(found)].length===1?found[0]:'';}
module.exports={publicIp,normalizeOfferUrl,offerCandidates,offerFromText};
