'use strict';
// Área de filters; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.filters = function mountArea(ctx) {
const filterBar = ctx.node('div','ploa-toolbar');

const countryFilter=ctx.field('País','select'), categoryFilter=ctx.field('Categoria','select'), modeFilter=ctx.field('Atendimento','select');

const savedFilter=ctx.field('Filtro salvo','select');

filterBar.append(countryFilter.wrap,categoryFilter.wrap,modeFilter.wrap,savedFilter.wrap);

ctx.$('.ledger-toolbar').after(filterBar);

ctx.options(modeFilter.input,[['','Todos'],['human','Com Ronald'],['automatic','Liberado para IA']]);

for(const [name,item] of [['country',countryFilter],['category',categoryFilter],['mode',modeFilter]]){
    item.input.addEventListener('change',()=>{ctx.extra[name]=item.input.value;ctx.refreshList();});
  }

filterBar.append(ctx.button('Salvar filtro',async()=>{
    const name=window.prompt('Nome deste filtro:');if(!name?.trim())return;
    await ctx.api('/api/workspace/filters','POST',{name,country:ctx.extra.country,category:ctx.extra.category,
      mode:ctx.extra.mode,attention:state.attentionFilter,search:state.search});
    await ctx.loadWorkspace();showToast('Filtro salvo.');
  }));

savedFilter.input.addEventListener('change',()=>{
    const filter=ctx.snapshot?.savedFilters.find(item=>item.id===savedFilter.input.value);if(!filter)return;
    ctx.extra.country=filter.country;ctx.extra.category=filter.category;ctx.extra.mode=filter.mode||'';
    countryFilter.input.value=filter.country;categoryFilter.input.value=filter.category;
    modeFilter.input.value=ctx.extra.mode;
    state.attentionFilter=filter.attention||'todos';elements.attentionFilter.value=state.attentionFilter;
    state.search=filter.search||'';elements.searchInput.value=state.search;
    state.statusFilter=null;ctx.refreshList();
  });

const oldMatches=leadMatchesFilters;

leadMatchesFilters=(lead)=>oldMatches(lead)&&(!ctx.extra.country||lead.pais===ctx.extra.country)
    &&(!ctx.extra.category||lead.categoria===ctx.extra.category)&&(!ctx.extra.mode||lead.atendimento_modo===ctx.extra.mode);

elements.clearFiltersButton.addEventListener('click',()=>{
    for(const name of Object.keys(ctx.extra))ctx.extra[name]='';
    for(const item of [countryFilter,categoryFilter,modeFilter,savedFilter])item.input.value='';
    ctx.refreshList();
  });

function renderSavedFilters(){
    const countries=[...new Set((state.dashboard?.leads||[]).map(l=>l.pais).filter(Boolean))].sort();
    const categories=[...new Set((state.dashboard?.leads||[]).map(l=>l.categoria).filter(Boolean))].sort();
    ctx.options(countryFilter.input,[['','Todos os países'],...countries.map(v=>[v,v])],ctx.extra.country);
    ctx.options(categoryFilter.input,[['','Todas as categorias'],...categories.map(v=>[v,v])],ctx.extra.category);
    ctx.options(savedFilter.input,[['','Escolher filtro'],...(ctx.snapshot?.savedFilters||[]).map(f=>[f.id,f.name])]);
  }
  return Object.defineProperties({}, {
    filterBar: { enumerable: true, get: () => filterBar },
    countryFilter: { enumerable: true, get: () => countryFilter },
    categoryFilter: { enumerable: true, get: () => categoryFilter },
    modeFilter: { enumerable: true, get: () => modeFilter },
    savedFilter: { enumerable: true, get: () => savedFilter },
    oldMatches: { enumerable: true, get: () => oldMatches },
    renderSavedFilters: { enumerable: true, get: () => renderSavedFilters }
  });
};
