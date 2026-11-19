'use strict';
const MARKETS = Object.freeze({ Brasil: 'br', Portugal: 'pt', 'Estados Unidos': 'us', Espanha: 'es' });
const textKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const COUNTRY_NAMES = new Map([...Object.keys(MARKETS).map(country => [textKey(country), country]),
  ['brazil', 'Brasil'], ['united states', 'Estados Unidos'], ['usa', 'Estados Unidos'], ['spain', 'Espanha'], ['espana', 'Espanha']]);
function targetCountry(value = '') {
  if (value === '') return '';
  if (typeof value !== 'string' || !Object.hasOwn(MARKETS, value)) {
    throw Object.assign(Error('Selecione envio geral ou um país disponível.'), { statusCode: 400, code: 'PLOA_AUDIENCE_INVALID' });
  }
  return value;
}
function outreachScope(value = '') {
  const country = targetCountry(value);
  return { targetCountry: country, key: country ? MARKETS[country] : 'all', label: country || 'Envio geral',
    progressFile: country ? `progresso_envios_${MARKETS[country]}.json` : 'progresso_envios.json' };
}
function countryOf(contact) {
  const key = textKey(contact.pais || contact['país'] || 'Brasil');
  return COUNTRY_NAMES.get(key) || String(contact.pais || contact['país'] || 'Brasil').trim();
}
function selectContacts(contacts, scope) {
  return scope.targetCountry ? contacts.filter(contact => countryOf(contact) === scope.targetCountry) : contacts;
}
function resumeIndex(contacts, progress, scope, source = 'contatos.xlsx') {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return 0;
  if (progress.audience ? progress.audience.key !== scope.key : scope.key !== 'all') return 0;
  const number = String(progress.numero || '').replace(/\D/g, '');
  if (number) { const index = contacts.findIndex(contact => String(contact.numero || '').replace(/\D/g, '') === number); if (index >= 0) return index; }
  if (progress.arquivoContatos === source && progress.totalContatos === contacts.length && Number.isInteger(progress.indice) && progress.indice >= 0 && progress.indice < contacts.length) return progress.indice;
  return 0;
}
module.exports = { MARKETS, textKey, targetCountry, outreachScope, countryOf, selectContacts, resumeIndex };
