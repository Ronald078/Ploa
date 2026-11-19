'use strict';
// Controlador de suggestions: mantém eventos e renderização na mesma área.
window.PloaAppModules.suggestions = function createController(ctx) {
let localitySuggestionIndex = -1;

function normalizedLocalityQuery(value) {
  return ctx.normalizeSearch(value).replace(/[^a-z0-9\s]/g, '');
}

function localitySuggestionsForInput() {
  const query = ctx.normalizedLocalityQuery(ctx.elements.searchLocality.value);
  if (query.length < 2) return [];

  const saved=ctx.state.searchPlan?.markets.find(market=>market.name===ctx.elements.searchMarket.value);
  const options=new Map((ctx.LOCALITY_CATALOG[ctx.elements.searchMarket.value]||[]).map(item=>[ctx.normalizeSearch(item.value),{...item,included:saved?saved.cities.some(city=>city.source==='original'&&ctx.normalizeSearch(city.name)===ctx.normalizeSearch(item.value)):item.included}]));
  for(const city of saved?.cities||[])options.set(ctx.normalizeSearch(city.name),{value:city.name,included:city.source==='original'});
  return [...options.values()]
    .filter((item) => ctx.normalizedLocalityQuery(item.value).includes(query))
    .sort((first, second) => {
      const firstStarts = ctx.normalizedLocalityQuery(first.value).startsWith(query);
      const secondStarts = ctx.normalizedLocalityQuery(second.value).startsWith(query);
      if (firstStarts !== secondStarts) return firstStarts ? -1 : 1;
      return first.value.localeCompare(second.value, 'pt-BR');
    })
    .slice(0, 6);
}

function closeLocalitySuggestions() {
  localitySuggestionIndex = -1;
  ctx.elements.searchLocalitySuggestions.hidden = true;
  ctx.elements.searchLocalitySuggestions.replaceChildren();
  ctx.elements.searchLocality.setAttribute('aria-expanded', 'false');
  ctx.elements.searchLocality.removeAttribute('aria-activedescendant');
}

function updateLocalitySuggestionSelection() {
  const options = [...ctx.elements.searchLocalitySuggestions.querySelectorAll('[role="option"]')];
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === localitySuggestionIndex)));
  const active = options[localitySuggestionIndex];
  if (active) {
    ctx.elements.searchLocality.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  } else {
    ctx.elements.searchLocality.removeAttribute('aria-activedescendant');
  }
}

function renderLocalitySuggestions() {
  localitySuggestionIndex = -1;
  const query = ctx.normalizedLocalityQuery(ctx.elements.searchLocality.value);
  if (query.length < 2) {
    ctx.closeLocalitySuggestions();
    return;
  }

  const suggestions = ctx.localitySuggestionsForInput();
  if (!suggestions.length) {
    ctx.closeLocalitySuggestions();return;
  } else {
    ctx.elements.searchLocalitySuggestions.replaceChildren(...suggestions.map((item, index) => {
      const option = ctx.createElement('button', 'locality-suggestion');
      option.type = 'button';
      option.id = `locality-suggestion-${index}`;
      option.role = 'option';
      option.dataset.value = item.value;
      option.dataset.included = String(Boolean(item.included));
      option.setAttribute('aria-selected', 'false');
      const [city, ...region] = item.value.split(',').map((part) => part.trim());
      const copy = ctx.createElement('span', 'locality-suggestion-copy');
      copy.append(
        ctx.createElement('strong', null, city),
        ctx.createElement('small', null, region.join(', ')),
      );
      option.append(
        copy,
        ctx.createElement('span', item.included ? 'locality-suggestion-state included' : 'locality-suggestion-state', item.included ? 'Já na busca' : 'Adicionar'),
      );
      return option;
    }));
  }

  ctx.elements.searchLocalitySuggestions.hidden = false;
  ctx.elements.searchLocality.setAttribute('aria-expanded', 'true');
}

function chooseLocalitySuggestion(option) {
  ctx.elements.searchLocality.value = option.dataset.value;
  ctx.closeLocalitySuggestions();
  if (option.dataset.included === 'true') {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Essa cidade já faz parte da busca original.');
  } else {
    ctx.setText(ctx.elements.searchSettingsStatus, 'Sugestão preenchida. Clique em Adicionar para incluí-la.');
  }
  ctx.elements.searchLocality.focus();
}

function localityIsInBaseSearch(market, city) {
  const normalizedCity = ctx.normalizeSearch(city);
  if(ctx.state.searchPlan)return ctx.state.searchPlan.markets.find(item=>item.name===market)?.cities.some(item=>item.source==='original'&&ctx.normalizeSearch(item.name)===normalizedCity)||false;
  return (ctx.LOCALITY_CATALOG[market] || []).some((item) => item.included && ctx.normalizeSearch(item.value) === normalizedCity);
}

let categorySuggestionIndex = -1;

function categorySuggestionsForInput() {
  const query = ctx.normalizedLocalityQuery(ctx.elements.searchCategoryName.value);
  if (query.length < 2) return [];
  return ctx.CATEGORY_CATALOG
    .filter((item) => ctx.normalizedLocalityQuery(`${item.name} ${item.key} ${item.value}`).includes(query))
    .sort((first, second) => {
      const firstStarts = ctx.normalizedLocalityQuery(first.name).startsWith(query);
      const secondStarts = ctx.normalizedLocalityQuery(second.name).startsWith(query);
      if (firstStarts !== secondStarts) return firstStarts ? -1 : 1;
      return first.name.localeCompare(second.name, 'pt-BR');
    })
    .slice(0, 6);
}

function closeCategorySuggestions() {
  categorySuggestionIndex = -1;
  ctx.elements.searchCategorySuggestions.hidden = true;
  ctx.elements.searchCategorySuggestions.replaceChildren();
  ctx.elements.searchCategoryName.setAttribute('aria-expanded', 'false');
  ctx.elements.searchCategoryName.removeAttribute('aria-activedescendant');
}

function updateCategorySuggestionSelection() {
  const options = [...ctx.elements.searchCategorySuggestions.querySelectorAll('[role="option"]')];
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === categorySuggestionIndex)));
  const active = options[categorySuggestionIndex];
  if (active) {
    ctx.elements.searchCategoryName.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  } else {
    ctx.elements.searchCategoryName.removeAttribute('aria-activedescendant');
  }
}

function renderCategorySuggestions() {
  categorySuggestionIndex = -1;
  if (ctx.normalizedLocalityQuery(ctx.elements.searchCategoryName.value).length < 2) {
    ctx.closeCategorySuggestions();
    return;
  }
  const suggestions = ctx.categorySuggestionsForInput();
  if (!suggestions.length) {
    ctx.closeCategorySuggestions();return;
  } else {
    ctx.elements.searchCategorySuggestions.replaceChildren(...suggestions.map((item, index) => {
      const option = ctx.createElement('button', 'category-suggestion');
      option.type = 'button';
      option.id = `category-suggestion-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.name = item.name;
      option.dataset.key = item.key;
      option.dataset.value = item.value;
      option.dataset.included = String(Boolean(item.included));
      const copy = ctx.createElement('span', 'category-suggestion-copy');
      copy.append(ctx.createElement('strong', null, item.name), ctx.createElement('small', null, `${item.key} = ${item.value}`));
      option.append(
        copy,
        ctx.createElement('span', item.included ? 'category-suggestion-state included' : 'category-suggestion-state', item.included ? 'Já na busca' : 'Preencher'),
      );
      return option;
    }));
  }
  ctx.elements.searchCategorySuggestions.hidden = false;
  ctx.elements.searchCategoryName.setAttribute('aria-expanded', 'true');
}

function chooseCategorySuggestion(option) {
  ctx.elements.searchCategoryName.value = option.dataset.name;
  ctx.elements.searchCategoryKey.value = option.dataset.key;
  ctx.elements.searchCategoryValue.value = option.dataset.value;
  ctx.closeCategorySuggestions();
  ctx.setText(
    ctx.elements.searchSettingsStatus,
    option.dataset.included === 'true'
      ? 'Essa categoria já faz parte da busca original.'
      : 'Sugestão preenchida. Revise as tags e clique em Adicionar.',
  );
  ctx.elements.searchCategoryName.focus();
}

function categoryIsInBaseSearch(name) {
  const normalizedName = ctx.normalizeSearch(name);
  if(ctx.state.searchPlan)return ctx.state.searchPlan.categories.some(item=>item.source!=='additional'&&ctx.normalizeSearch(item.name)===normalizedName);
  return ctx.CATEGORY_CATALOG.some((item) => item.included && ctx.normalizeSearch(item.name) === normalizedName);
}

  function bindEvents() {
ctx.elements.searchLocality.addEventListener('input', ctx.renderLocalitySuggestions);

ctx.elements.searchLocality.addEventListener('focus', ctx.renderLocalitySuggestions);

ctx.elements.searchMarket.addEventListener('change', ctx.renderLocalitySuggestions);

ctx.elements.searchCategoryName.addEventListener('input', ctx.renderCategorySuggestions);

ctx.elements.searchCategoryName.addEventListener('focus', ctx.renderCategorySuggestions);

ctx.elements.searchLocality.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    ctx.closeLocalitySuggestions();
    return;
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
  if (ctx.elements.searchLocalitySuggestions.hidden) ctx.renderLocalitySuggestions();
  const options = [...ctx.elements.searchLocalitySuggestions.querySelectorAll('[role="option"]')];
  if (!options.length) return;

  event.preventDefault();
  if (event.key === 'Enter') {
    ctx.chooseLocalitySuggestion(options[localitySuggestionIndex < 0 ? 0 : localitySuggestionIndex]);
    return;
  }

  const direction = event.key === 'ArrowDown' ? 1 : -1;
  localitySuggestionIndex = (localitySuggestionIndex + direction + options.length) % options.length;
  ctx.updateLocalitySuggestionSelection();
});

ctx.elements.searchLocalitySuggestions.addEventListener('click', (event) => {
  const option = event.target.closest('[role="option"]');
  if (option) ctx.chooseLocalitySuggestion(option);
});

ctx.elements.searchCategoryName.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    ctx.closeCategorySuggestions();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
  if (ctx.elements.searchCategorySuggestions.hidden) ctx.renderCategorySuggestions();
  const options = [...ctx.elements.searchCategorySuggestions.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  event.preventDefault();
  if (event.key === 'Enter') {
    ctx.chooseCategorySuggestion(options[categorySuggestionIndex < 0 ? 0 : categorySuggestionIndex]);
    return;
  }
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  categorySuggestionIndex = (categorySuggestionIndex + direction + options.length) % options.length;
  ctx.updateCategorySuggestionSelection();
});

ctx.elements.searchCategorySuggestions.addEventListener('click', (event) => {
  const option = event.target.closest('[role="option"]');
  if (option) ctx.chooseCategorySuggestion(option);
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('.locality-field')) ctx.closeLocalitySuggestions();
  if (!target?.closest('.category-search-field')) ctx.closeCategorySuggestions();
});
  }
  return { normalizedLocalityQuery, localitySuggestionsForInput, closeLocalitySuggestions, updateLocalitySuggestionSelection, renderLocalitySuggestions, chooseLocalitySuggestion, localityIsInBaseSearch, categorySuggestionsForInput, closeCategorySuggestions, updateCategorySuggestionSelection, renderCategorySuggestions, chooseCategorySuggestion, categoryIsInBaseSearch, bindEvents };
};
