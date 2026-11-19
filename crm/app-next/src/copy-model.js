import { normalize } from './lead-model.js';
export const genericCategory = '__generic__';
export const clone = value => structuredClone(value);
export function categoryTitle(id, plan) {
  if (id === genericCategory) return 'Genéricas';
  return plan?.categories?.find(item => normalize(item.name) === normalize(id))?.name || String(id).replace(/(^|\s)\S/g, letter => letter.toLocaleUpperCase('pt-BR'));
}
export function copyCategories(settings, type, market, metadata, plan) {
  if (type === 'automaticReplies') return metadata.automaticCategories.map(item => [item.id,item.label]);
  return [[genericCategory,'Genéricas'],...Object.entries(settings.firstContact[market]?.porCategoria || {})
    .filter(([,list]) => list.length).map(([id]) => [id,categoryTitle(id,plan)]).sort((a,b) => a[1].localeCompare(b[1],'pt-BR'))];
}
export function currentCopies(settings, type, market, category, metadata) {
  if (type === 'firstContact') return category === genericCategory ? settings.firstContact[market]?.genericas || [] : settings.firstContact[market]?.porCategoria?.[category] || [];
  const locale = metadata.supportedMarkets.find(item => item.id === market)?.locale;
  return settings.automaticReplies.categorias[category]?.porIdioma?.[locale] || [];
}
export function changeCopies(settings, type, market, category, metadata, change) {
  const next = clone(settings);
  if (type === 'firstContact') {
    const library = next.firstContact[market];
    if (category === genericCategory) library.genericas = change(library.genericas || []);
    else library.porCategoria[category] = change(library.porCategoria[category] || []);
  } else {
    const locale = metadata.supportedMarkets.find(item => item.id === market)?.locale;
    next.automaticReplies.categorias[category].porIdioma[locale] = change(currentCopies(next,type,market,category,metadata));
  }
  return next;
}
export function categoriesWithoutCopies(settings, market, plan) {
  const populated = new Set(Object.entries(settings.firstContact[market]?.porCategoria || {}).filter(([,list]) => list.length).map(([id]) => normalize(id)));
  return (plan?.categories || []).filter(item => !populated.has(normalize(item.name))).map(item => [normalize(item.name),item.name]).sort((a,b) => a[1].localeCompare(b[1],'pt-BR'));
}
export function copyPreview(text, name, category) {
  return String(text || '').replaceAll('{nome}',name.trim() || 'Empresa Exemplo').replaceAll('{categoria}',category);
}
