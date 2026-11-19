/* Prévia da configuração realmente salva; não inicia consultas externas. */
(() => {
  'use strict';
  window.PloaSearchPlan = { create({node,details,api,view,getState,onLoaded}) {
    const panel=details('Plano da próxima busca'); panel.classList.add('ploa-search-plan');
    const status=node('p','ploa-note','Carregando a configuração salva…'); status.setAttribute('role','status');
    const list=node('div','ploa-search-plan-list');panel.append(status,list);
    view('search').querySelector('#search-settings-form').closest('.panel').before(panel);
    let plan=null,loading=false;
    function render() {
      if(!plan)return;
      status.textContent=`Configuração salva: ${plan.cityCount} cidades × ${plan.categoryCount} categorias = ${plan.queryCount} consultas. `+
        (getState().settingsDirty?'Há alterações pendentes; salve para atualizar este plano. ': 'Inclui a lista original e os adicionais. ')+
        (plan.missingCount?`${plan.missingCount} combinações de país e categoria não têm copy disponível.`:'Todas as combinações ativas têm copy própria ou genérica no idioma do país.');
      list.replaceChildren();
      for(const market of plan.markets){
        const group=node('details','ploa-plan-market'),title=node('summary',null,`${market.name} · ${market.cities.length} cidades · ${market.queries} consultas`);
        group.append(title);
        if(!market.active){group.append(node('p','ploa-note','Este país não tem cidades ativas na configuração salva.'));list.append(group);continue;}
        const cities=node('ul','ploa-plan-cities');
        for(const city of market.cities)cities.append(node('li',null,city.name+' · '+(city.source==='original'?'Original':'Adicional')));
        const coverage=node('ul','ploa-plan-coverage');
        for(const item of market.categories){
          const row=node('li');row.dataset.coverage=item.coverage;
          row.append(node('strong',null,item.name),node('span',null,item.coverage==='own'?`${item.count} copys próprias`:item.coverage==='generic'?`${item.count} copys genéricas do país`:'Sem copy neste país'));
          coverage.append(row);
        }
        group.append(node('h4',null,'Cidades da busca'),cities,node('h4',null,'Cobertura de mensagens'),coverage);list.append(group);
      }
    }
    async function refresh(){
      if(loading)return;loading=true;
      try{plan=await api('/api/search-plan');onLoaded(plan);render();}
      catch(error){status.textContent='Não foi possível consultar o plano salvo. '+error.message;}
      finally{loading=false;}
    }
    document.addEventListener('ploa-settings-saved',()=>void refresh());
    document.addEventListener('ploa-settings-draft',render);
    return{refresh,render};
  }};
})();
