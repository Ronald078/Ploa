'use strict';
function scoreSignals(ad,observations=0,now=Date.now()){
  const signals=[];let score=0;
  const start=Date.parse(ad.deliveryStart||''),end=Math.min(now,Date.parse(ad.deliveryStop||'')||now);
  if(Number.isFinite(start)&&start<=end){const days=Math.min(365,Math.max(0,Math.floor((end-start)/86400000)));score+=Math.min(40,days*1.2);signals.push({label:'Dias de veiculação informados',value:days});}
  if(ad.variants>1){score+=Math.min(25,(ad.variants-1)*5);signals.push({label:'Variações de texto informadas',value:ad.variants});}
  if(ad.placements?.length){score+=Math.min(15,ad.placements.length*3);signals.push({label:'Posicionamentos informados',value:ad.placements.length});}
  if(observations>1){score+=Math.min(20,(observations-1)*4);signals.push({label:'Dias distintos de observação',value:observations});}
  score=Math.min(100,Math.round(score));
  return{score,level:!signals.length?'Sem dados suficientes':score>=70?'Sinais fortes':score>=40?'Vale acompanhar':'Poucos sinais',signals,
    methodology:'Prioridade de pesquisa baseada em evidências registradas. Não comprova investimento, vendas, lucro ou retorno.'};
}
module.exports={scoreSignals};
