'use strict';
window.PloaAppModules.ads=function createController(ctx){
 const miner=window.PloaCreativeMiner.mount({host:document.querySelector('#creative-miner-root'),notify:ctx.showToast,isVisible:()=>ctx.state.activeView==='ads'});
 const empty=()=>{};
 return{bindEvents:empty,renderAdsCatalog:()=>void miner.refresh(),openAdDetails:id=>void miner.open(id),scaleTone:empty,filteredAds:()=>[],createAdSignal:empty,createAdCard:empty,createAdCatalogRow:empty,renderAdsNiches:empty,selectedAd:()=>null};
};
