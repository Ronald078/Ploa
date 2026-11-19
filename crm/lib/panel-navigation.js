'use strict';
const migrated={overview:'/app-next/dashboard',funnel:'/app-next/funnel',leads:'/app-next/leads',copies:'/app-next/copies',messages:'/app-next/messages',search:'/app-next/search',ai:'/app-next/ai'};
const operational=new Set(['ads']);
function panelRedirect(url){
 if(!['/','/index.html','/operacao'].includes(url.pathname))return null;
 const view=url.searchParams.get('view');
 if(!view && url.pathname!=='/operacao')return null;
 const query=new URLSearchParams(url.searchParams);query.delete('view');
 if(Object.hasOwn(migrated,view)){const suffix=query.toString();return migrated[view]+(suffix?'?'+suffix:'');}
 if(operational.has(view))return url.pathname==='/operacao'?null:'/operacao?'+url.searchParams;
 return url.pathname==='/operacao'?'/app-next/messages':'/app-next/dashboard';
}
module.exports={panelRedirect};
