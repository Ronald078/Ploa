'use strict';
const path=require('node:path');
function desktopEntry(root,{accounts=false}={}){
 const port=accounts?4313:4310,origin='http://127.0.0.1:'+port;
 return{port,origin,url:origin+(accounts?'/?desktop=1':''),server:path.join(root,'crm',accounts?'cloud/local-preview.js':'server.js'),
  ...(accounts?{readyScript:"document.documentElement.dataset.ploaAccountReady === 'true' && !!document.querySelector('.account-panel')"}:{})};
}
function desktopLoginUrl(value,origin){
 try{const url=new URL(value);return url.origin===origin&&url.pathname==='/desktop-login'&&!url.hash&&[...url.searchParams.keys()].length===1&&/^[a-f0-9]{64}$/.test(url.searchParams.get('ticket')||'')?url.href:null;}catch{return null;}
}
module.exports={desktopEntry,desktopLoginUrl};
