'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIRST_CONTACT_FILE = 'copys_internacionais.json';
const AUTOMATIC_REPLIES_FILE = 'copys_respostas_automaticas.json';
const SUPPORTED_MARKETS = Object.freeze([
  { id: 'Brasil', label: 'Brasil', locale: 'pt-BR' },
  { id: 'Portugal', label: 'Portugal', locale: 'pt-PT' },
  { id: 'Estados Unidos', label: 'Estados Unidos', locale: 'en-US' },
  { id: 'Espanha', label: 'Espanha', locale: 'es-ES' },
]);
const AUTOMATIC_CATEGORY_META = Object.freeze([
  {
    id: 'agradecimento',
    label: 'Recusa e não contatar',
    description: 'Usada quando o contato recusa a abordagem ou pede para não receber novas mensagens.',
  },
  {
    id: 'bot-atendimento',
    label: 'Atendimento automático',
    description: 'Usada quando a resposta recebida parece ser um menu, saudação ou robô de atendimento.',
  },
]);

function settingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeMessage(value, label = 'A copy') {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw settingsError(`${label} não pode ficar vazia.`);
  if (text.length > 2500) throw settingsError(`${label} ultrapassa o máximo de 2500 caracteres.`);
  return text;
}

function normalizeMessageList(value, label, { requireOne = false } = {}) {
  if (!Array.isArray(value)) throw settingsError(`${label} deve ser uma lista.`);
  if (value.length > 40) throw settingsError(`${label} aceita no máximo 40 copys.`);
  const messages = value.map((message, index) => normalizeMessage(message, `${label}, item ${index + 1}`));
  if (requireOne && messages.length === 0) throw settingsError(`${label} precisa manter pelo menos uma copy.`);
  return [...new Set(messages)];
}

function normalizeCategoryName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw settingsError('O nome da categoria de copy é obrigatório.');
  if (name.length > 90) throw settingsError('O nome da categoria de copy ultrapassa 90 caracteres.');
  return name;
}

function normalizeFirstContact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw settingsError('As copys de primeiro contato devem formar um objeto válido.');
  }

  return Object.fromEntries(SUPPORTED_MARKETS.map((market) => {
    const marketSettings = raw[market.id];
    if (!marketSettings || typeof marketSettings !== 'object' || Array.isArray(marketSettings)) {
      throw settingsError(`As copys de ${market.label} não foram informadas.`);
    }
    const categories = marketSettings.porCategoria;
    if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
      throw settingsError(`As categorias de ${market.label} devem formar um objeto válido.`);
    }
    const entries = Object.entries(categories);
    if (entries.length > 80) throw settingsError(`${market.label} aceita no máximo 80 categorias de copy.`);

    return [market.id, {
      genericas: normalizeMessageList(marketSettings.genericas || [], `Copys genéricas de ${market.label}`),
      porCategoria: Object.fromEntries(entries.map(([category, messages]) => {
        const name = normalizeCategoryName(category);
        return [name, normalizeMessageList(messages, `Copys de ${name} em ${market.label}`)];
      })),
    }];
  }));
}

function normalizeAutomaticReplies(raw,{allowEmpty=false}={}) {
  const categories = raw?.categorias;
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
    throw settingsError('As respostas automáticas devem informar as categorias configuradas.');
  }

  const normalizedCategories = {};
  for (const metadata of AUTOMATIC_CATEGORY_META) {
    const category = categories[metadata.id];
    const byLocale = category?.porIdioma;
    if (!byLocale || typeof byLocale !== 'object' || Array.isArray(byLocale)) {
      throw settingsError(`A categoria automática "${metadata.label}" não possui idiomas configurados.`);
    }
    normalizedCategories[metadata.id] = {
      porIdioma: Object.fromEntries(SUPPORTED_MARKETS.map((market) => [
        market.locale,
        normalizeMessageList(
          byLocale[market.locale],
          `${metadata.label} em ${market.label}`,
          { requireOne: !allowEmpty },
        ),
      ])),
    };
  }

  return { version: 1, categorias: normalizedCategories };
}

function firstContactPath(projectRoot) {
  return path.join(projectRoot, FIRST_CONTACT_FILE);
}

function automaticRepliesPath(projectRoot) {
  return path.join(projectRoot, AUTOMATIC_REPLIES_FILE);
}

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw settingsError(`${label} contém um JSON inválido.`);
    throw error;
  }
}

async function readCopySettings(projectRoot) {
  const [firstContactRaw, automaticRepliesRaw] = await Promise.all([
    readJson(firstContactPath(projectRoot), FIRST_CONTACT_FILE),
    readJson(automaticRepliesPath(projectRoot), AUTOMATIC_REPLIES_FILE),
  ]);
  return {
    firstContact: normalizeFirstContact(firstContactRaw),
    automaticReplies: normalizeAutomaticReplies(automaticRepliesRaw,{allowEmpty:fs.existsSync(path.join(projectRoot,'.ploa-account.json'))}),
  };
}

async function writeJsonAtomically(destination, value) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${destination}.bak`;
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await fs.promises.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.promises.copyFile(destination, backup).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.promises.rename(temporary, destination).catch(async (error) => {
      if (!['EPERM', 'EBUSY', 'EXDEV', 'EACCES'].includes(error.code)) throw error;
      await fs.promises.copyFile(temporary, destination);
    });
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
}

async function writeCopySettings(projectRoot, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw settingsError('A configuração de copys deve ser um objeto válido.');
  }
  const firstContact = normalizeFirstContact(raw.firstContact);
  const individual=fs.existsSync(path.join(projectRoot,'.ploa-account.json'));
  const automaticReplies = normalizeAutomaticReplies(raw.automaticReplies,{allowEmpty:individual});
  if(individual){
    const previous=await readCopySettings(projectRoot);
    for(const category of AUTOMATIC_CATEGORY_META)for(const market of SUPPORTED_MARKETS){
      if(previous.automaticReplies.categorias[category.id].porIdioma[market.locale].length&&!automaticReplies.categorias[category.id].porIdioma[market.locale].length)throw settingsError(`${category.label} em ${market.label} precisa manter pelo menos uma copy.`);
    }
  }
  await Promise.all([
    writeJsonAtomically(firstContactPath(projectRoot), firstContact),
    writeJsonAtomically(automaticRepliesPath(projectRoot), automaticReplies),
  ]);
  return { firstContact, automaticReplies };
}

function copySettingsSnapshot(settings) {
  return {
    settings,
    supportedMarkets: SUPPORTED_MARKETS,
    automaticCategories: AUTOMATIC_CATEGORY_META,
    files: {
      firstContact: FIRST_CONTACT_FILE,
      automaticReplies: AUTOMATIC_REPLIES_FILE,
    },
  };
}

module.exports = {
  AUTOMATIC_CATEGORY_META,
  AUTOMATIC_REPLIES_FILE,
  FIRST_CONTACT_FILE,
  SUPPORTED_MARKETS,
  automaticRepliesPath,
  copySettingsSnapshot,
  firstContactPath,
  normalizeAutomaticReplies,
  normalizeFirstContact,
  readCopySettings,
  writeCopySettings,
};
