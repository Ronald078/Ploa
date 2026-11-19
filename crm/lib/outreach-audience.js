'use strict';
const fs = require('node:fs'), path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { MARKETS, outreachScope, selectContacts, resumeIndex, countryOf, textKey } = require('./outreach-scope');
const progressFiles = ['', ...Object.keys(MARKETS)].map(country => outreachScope(country).progressFile);
const INPUT_FILES = ['contatos.xlsx', 'numeros_enviados.json', 'bloqueados.json', 'envios_pendentes.json', 'copys_internacionais.json', ...progressFiles];
function readJson(root, file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function readContacts(root) {
  const { extrairNumerosDaCelula, limparNumero, FIRST_PHONE_ONLY } = require('./contact-phone');
  const file = path.join(root, 'contatos.xlsx');
  if (!fs.existsSync(file)) return [];
  const rows = await require('./contact-sheet-rows').readContactRows(file);
  const seen = new Set(), contacts = [], ddis = { Brasil: '55', Portugal: '351', 'Estados Unidos': '1', Espanha: '34' };
  const { SSF } = require('xlsx'); // Format numeric cells like the existing sender; no workbook allocation.
  for (const [rawPhone, country, countryDdi, category, numberFormat] of rows) {
    const phoneCell = numberFormat == null ? rawPhone : SSF.format(numberFormat, Number(rawPhone));
    const pais = countryOf({ pais:country }), ddi = countryDdi || ddis[pais] || '';
    const phones = extrairNumerosDaCelula(phoneCell || '');
    for (const raw of FIRST_PHONE_ONLY ? phones.slice(0, 1) : phones) {
      const phone = limparNumero(raw, ddi);
      if (!phone.valido || seen.has(phone.numero)) continue;
      seen.add(phone.numero); contacts.push({ numero: phone.numero, pais, categoria: category || '' });
    }
  }
  return contacts;
}
function summarizeAudience({ contacts, sent = [], blocked = [], pending = {}, copies = {}, progress = {} }) {
  if (!Array.isArray(sent) || !Array.isArray(blocked) || !pending || typeof pending !== 'object' || Array.isArray(pending)) throw Error('Histórico indisponível.');
  const sentSet = new Set(sent), blockedSet = new Set(blocked), library = new Map(Object.entries(copies).map(([country, value]) => [textKey(country), value]));
  const hasCopy = contact => {
    const country = library.get(textKey(countryOf(contact))), category = textKey(contact.categoria);
    const byCategory = Object.entries(country?.porCategoria || {}).find(([key]) => textKey(key) === category)?.[1];
    const options = Array.isArray(byCategory) && byCategory.length ? byCategory : country?.genericas;
    return Array.isArray(options) && options.some(item => typeof item === 'string' && item.trim());
  };
  return Object.fromEntries(['', ...Object.keys(MARKETS)].map(country => {
    const scope = outreachScope(country), selected = selectContacts(contacts, scope), checkpoint = progress[scope.key];
    const index = resumeIndex(selected, checkpoint, scope);
    let available = 0;
    for (let i = index; i < selected.length; i++) {
      const contact = selected[i], number = String(contact.numero || '').replace(/\D/g, '');
      if (number && !sentSet.has(number) && !blockedSet.has(number) && !pending[number] && hasCopy(contact)) available++;
    }
    return [scope.key, { targetCountry: country, label: scope.label, total: selected.length, processed: index, available,
      updatedAt: checkpoint?.atualizadoEm || null }];
  }));
}
async function calculate(root) {
  const progress = Object.fromEntries(['', ...Object.keys(MARKETS)].map(country => { const scope = outreachScope(country); return [scope.key, readJson(root, scope.progressFile, null)]; }));
  return summarizeAudience({ contacts: await readContacts(root), progress, sent: readJson(root, 'numeros_enviados.json', []),
    blocked: readJson(root, 'bloqueados.json', []), pending: readJson(root, 'envios_pendentes.json', {}), copies: readJson(root, 'copys_internacionais.json', {}) });
}
function runWorker(root) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { root }, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    let received = false;
    const timer = setTimeout(() => { void worker.terminate(); reject(Error('Audience timeout')); }, 60000);
    worker.once('message', result => { received = true; result.ok ? resolve(result.audiences) : reject(Error('Audience unavailable')); });
    worker.once('error', reject);
    worker.once('exit', code => { clearTimeout(timer); if (code || !received) reject(Error('Audience worker failed')); });
    worker.unref();
  });
}
function createAudiencePreview(root, { compute = runWorker } = {}) {
  let cache, signature, inFlight;
  async function currentSignature() {
    return (await Promise.all(INPUT_FILES.map(async file => { try { const stat = await fs.promises.stat(path.join(root, file), { bigint: true }); return `${file}:${stat.size}:${stat.mtimeNs}`; } catch (error) { if (error.code !== 'ENOENT') throw error; return file + ':missing'; } }))).join('|');
  }
  return async country => {
    const scope = outreachScope(country), key = await currentSignature();
    if (signature !== key || !cache) {
      if (!inFlight) inFlight = (async () => { const result = await compute(root); if (await currentSignature() !== key) throw Error('Audience changed'); cache = result; signature = key; })().finally(() => { inFlight = null; });
      await inFlight;
      if (signature !== key) throw Object.assign(Error('A base mudou durante a contagem. Atualize a seleção.'), { statusCode: 409 });
    }
    return { audience: cache[scope.key] };
  };
}
if (!isMainThread && workerData?.root) {
  calculate(workerData.root).then(audiences => parentPort.postMessage({ ok:true, audiences }),
    () => parentPort.postMessage({ ok:false }));
}
module.exports = { createAudiencePreview, summarizeAudience, calculate };
