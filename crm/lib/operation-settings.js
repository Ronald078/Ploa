'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { targetCountry } = require('./outreach-scope');

const SETTINGS_FILE = 'configuracoes_operacao.json';
const SUPPORTED_MARKETS = Object.freeze([
  { id: 'Brasil', label: 'Brasil' },
  { id: 'Portugal', label: 'Portugal' },
  { id: 'Estados Unidos', label: 'Estados Unidos' },
  { id: 'Espanha', label: 'Espanha' },
]);

const DEFAULT_OPERATION_SETTINGS = Object.freeze({
  version: 1,
  messages: Object.freeze({
    delayMinSeconds: 40,
    delayMaxSeconds: 120,
    dailyLimit: 35,
    targetCountry: '',
  }),
  search: Object.freeze({
    localities: Object.freeze([]),
    categories: Object.freeze([]),
  }),
});

function cloneDefaults() {
  return {
    version: DEFAULT_OPERATION_SETTINGS.version,
    messages: { ...DEFAULT_OPERATION_SETTINGS.messages },
    search: { localities: [], categories: [] },
  };
}

function settingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeInteger(value, fallback, label, minimum, maximum) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw settingsError(`${label} deve ser um número inteiro entre ${minimum} e ${maximum}.`);
  }
  return number;
}

function normalizeText(value, label, maximumLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw settingsError(`${label} é obrigatório.`);
  if (text.length > maximumLength) throw settingsError(`${label} ultrapassa o máximo de ${maximumLength} caracteres.`);
  return text;
}

function uniqueBy(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFor(item).toLocaleLowerCase('pt-BR');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeLocalities(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw settingsError('A lista de localidades deve ser uma lista válida.');
  if (value.length > 100) throw settingsError('É possível adicionar no máximo 100 localidades pelo painel.');

  const allowedMarkets = new Set(SUPPORTED_MARKETS.map((market) => market.id));
  return uniqueBy(value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw settingsError('Cada localidade deve informar cidade e país.');
    }
    const city = normalizeText(entry.city, 'Cidade ou localidade', 140);
    const market = normalizeText(entry.market, 'País da localidade', 40);
    if (!allowedMarkets.has(market)) throw settingsError(`O país "${market}" não é suportado pela configuração atual.`);
    return { city, market };
  }), (entry) => `${entry.market}|${entry.city}`);
}

function normalizeCategories(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw settingsError('A lista de categorias deve ser uma lista válida.');
  if (value.length > 30) throw settingsError('É possível adicionar no máximo 30 categorias pelo painel.');

  return uniqueBy(value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw settingsError('Cada categoria deve informar nome, chave e valor do OpenStreetMap.');
    }
    const name = normalizeText(entry.name, 'Nome da categoria', 70);
    const key = normalizeText(entry.key, 'Chave do OpenStreetMap', 70);
    const tagValue = normalizeText(entry.value, 'Valor do OpenStreetMap', 90);
    const osmToken = /^[a-zA-Z0-9_.:-]+$/;
    if (!osmToken.test(key) || !osmToken.test(tagValue)) {
      throw settingsError('Chave e valor do OpenStreetMap aceitam apenas letras, números, ponto, dois-pontos, hífen e sublinhado.');
    }
    return { name, key, value: tagValue };
  }), (entry) => `${entry.name}|${entry.key}|${entry.value}`);
}

function normalizeOperationSettings(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw settingsError('As configurações da operação devem ser um objeto válido.');
  }

  const messages = raw.messages && typeof raw.messages === 'object' ? raw.messages : {};
  const search = raw.search && typeof raw.search === 'object' ? raw.search : {};
  const delayMinSeconds = normalizeInteger(
    messages.delayMinSeconds,
    DEFAULT_OPERATION_SETTINGS.messages.delayMinSeconds,
    'O atraso mínimo',
    20,
    3600,
  );
  const delayMaxSeconds = normalizeInteger(
    messages.delayMaxSeconds,
    DEFAULT_OPERATION_SETTINGS.messages.delayMaxSeconds,
    'O atraso máximo',
    20,
    3600,
  );
  if (delayMaxSeconds < delayMinSeconds) {
    throw settingsError('O atraso máximo não pode ser menor que o atraso mínimo.');
  }

  return {
    version: 1,
    messages: {
      delayMinSeconds,
      delayMaxSeconds,
      targetCountry: targetCountry(messages.targetCountry),
      dailyLimit: normalizeInteger(
        messages.dailyLimit,
        DEFAULT_OPERATION_SETTINGS.messages.dailyLimit,
        'O limite diário',
        1,
        100,
      ),
    },
    search: {
      localities: normalizeLocalities(search.localities),
      categories: normalizeCategories(search.categories),
    },
  };
}

function settingsPath(projectRoot) {
  return path.join(projectRoot, SETTINGS_FILE);
}

async function readOperationSettings(projectRoot) {
  const file = settingsPath(projectRoot);
  try {
    const raw = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    return normalizeOperationSettings(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return cloneDefaults();
    if (error instanceof SyntaxError) throw settingsError('O arquivo de configurações da operação contém um JSON inválido.');
    throw error;
  }
}

async function writeOperationSettings(projectRoot, raw) {
  const settings = normalizeOperationSettings(raw);
  const destination = settingsPath(projectRoot);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${destination}.bak`;
  const content = `${JSON.stringify(settings, null, 2)}\n`;

  try {
    await fs.promises.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.promises.copyFile(destination, backup).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.promises.rename(temporary, destination).catch(async (error) => {
      // Alguns ambientes Windows/OneDrive bloqueiam a troca atômica por rename.
      // O arquivo temporário já está completo; nesses casos, copiá-lo evita
      // uma configuração parcialmente escrita e preserva o backup anterior.
      if (!['EPERM', 'EBUSY', 'EXDEV', 'EACCES'].includes(error.code)) throw error;
      await fs.promises.copyFile(temporary, destination);
    });
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }

  return settings;
}

function operationSettingsSnapshot(settings) {
  return {
    settings,
    supportedMarkets: SUPPORTED_MARKETS,
    file: SETTINGS_FILE,
  };
}

module.exports = {
  DEFAULT_OPERATION_SETTINGS,
  SUPPORTED_MARKETS,
  normalizeOperationSettings,
  operationSettingsSnapshot,
  readOperationSettings,
  settingsPath,
  writeOperationSettings,
};
