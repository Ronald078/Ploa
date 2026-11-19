'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readOperationSettings } = require('./operation-settings');
const { readCopySettings } = require('./copy-settings');
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

function buildSearchPlan(catalog, operation, copies) {
  const firstContact=copies.firstContact || copies;
  const categories=new Map(Object.entries(catalog.categories).map(([name,filters])=>[name,{name,filters,source:'original'}]));
  for(const item of operation.search?.categories || []) {
    if(categories.has(item.name))categories.get(item.name).source='original+additional';
    else categories.set(item.name,{name:item.name,source:'additional'});
  }
  const markets=Object.entries(catalog.markets).map(([name,base])=>{
    const library=firstContact[name] || {}, generic=(library.genericas || []).length;
    const anyCopies=generic || Object.values(library.porCategoria || {}).some(items=>items.length);
    const active=base.ativo || (base.ativar_quando_houver_copys && Boolean(anyCopies));
    const cities=new Map((active?base.cidades:[]).map(city=>[city,{name:city,source:'original'}]));
    for(const item of operation.search?.localities || [])if(item.market===name&&!cities.has(item.city))cities.set(item.city,{name:item.city,source:'additional'});
    const coverage=[...categories.values()].map(category=>{
      const key=Object.keys(library.porCategoria || {}).find(key=>normalize(key)===normalize(category.name));
      const own=(library.porCategoria?.[key] || []).length;
      return{name:category.name,source:category.source,count:own || generic,coverage:own?'own':generic?'generic':'missing'};
    });
    return{name,locale:base.idioma,active:cities.size>0,cities:[...cities.values()],categories:coverage,
      queries:cities.size*categories.size,missing:coverage.filter(item=>item.coverage==='missing').map(item=>item.name)};
  });
  return{markets,categories:[...categories.values()].map(({name,source})=>({name,source})),
    cityCount:markets.reduce((sum,item)=>sum+item.cities.length,0),categoryCount:categories.size,
    queryCount:markets.reduce((sum,item)=>sum+item.queries,0),
    missingCount:markets.filter(item=>item.active).reduce((sum,item)=>sum+item.missing.length,0),updatedAt:new Date().toISOString()};
}

async function loadSearchPlan(root,{codeRoot=root}={}) {
  const catalog=JSON.parse(await fs.promises.readFile(path.join(codeRoot,'crm/search-catalog.json'),'utf8'));
  const [operation,copies]=await Promise.all([readOperationSettings(root),readCopySettings(root)]);
  return buildSearchPlan(catalog,operation,copies);
}
module.exports={buildSearchPlan,loadSearchPlan};
