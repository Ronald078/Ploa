'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { temporaryRoot } = require('./fixture-helpers');
const { outreachScope, selectContacts, resumeIndex, targetCountry } = require('../lib/outreach-scope');
const { normalizeOperationSettings, writeOperationSettings, readOperationSettings } = require('../lib/operation-settings');
const { summarizeAudience, createAudiencePreview, calculate } = require('../lib/outreach-audience');
const contacts = [
  { numero: '5511999999991', pais: 'Brasil', categoria: 'Loja' },
  { numero: '351911111111', pais: 'Portugal', categoria: 'Loja' },
  { numero: '5511999999992', pais: 'Brasil', categoria: 'Loja' },
  { numero: '12025550123', pais: 'Estados Unidos', categoria: 'Loja' },
  { numero: '34611111111', pais: 'Espanha', categoria: 'Loja' },
  { numero: '351922222222', pais: 'Portugal', categoria: 'Loja' },
];
const copies = Object.fromEntries(['Brasil', 'Portugal', 'Estados Unidos', 'Espanha'].map(country => [country, { genericas: ['Copy fictícia'], porCategoria: {} }]));
test('normalização compartilhada preserva DDI e separa números da mesma célula', () => {
  const { limparNumero, extrairNumerosDaCelula } = require('../lib/contact-phone');
  assert.equal(limparNumero('11999999991','55').numero,'5511999999991');
  assert.equal(limparNumero('911111111','351').numero,'351911111111');
  assert.equal(limparNumero('2025550123','1').numero,'12025550123');
  assert.equal(limparNumero('+34611111111','55').numero,'34611111111');
  assert.equal(limparNumero('123','55').valido,false);
  assert.equal(extrairNumerosDaCelula('+351911111111; +351922222222').length,2);
});
test('configuração antiga continua geral; seleção de país persiste sem alterar atrasos e limite', async t => {
  assert.equal(normalizeOperationSettings({ messages: { dailyLimit: 18 } }).messages.targetCountry, '');
  const root = temporaryRoot(t), messages = { delayMinSeconds: 40, delayMaxSeconds: 120, dailyLimit: 18, targetCountry: 'Portugal' };
  await writeOperationSettings(root, { messages }); assert.deepEqual((await readOperationSettings(root)).messages, messages);
  for (const value of ['Outro país', '../../file', null, 123, {}, 'Todos']) assert.throws(() => targetCountry(value), { code: 'PLOA_AUDIENCE_INVALID' });
});
test('fila geral e por país selecionam apenas o público solicitado, incluindo nomes normalizados', () => {
  assert.equal(selectContacts(contacts, outreachScope()).length, 6);
  for (const country of ['Brasil', 'Portugal', 'Estados Unidos', 'Espanha']) {
    const selected = selectContacts(contacts, outreachScope(country)); assert.ok(selected.length); assert.ok(selected.every(contact => contact.pais === country));
  }
  assert.equal(selectContacts([{ numero: 'x', pais: 'espanha' }, { numero: 'y', pais: 'United States' }], outreachScope('Espanha')).length, 1);
});
test('checkpoint de outro público nunca pula contatos; geral antigo é preservado e números resistem à reordenação', () => {
  const all = outreachScope(), brazil = outreachScope('Brasil'), portugal = outreachScope('Portugal');
  const legacy = { arquivoContatos: 'contatos.xlsx', totalContatos: 6, indice: 4, numero: contacts[4].numero };
  assert.equal(resumeIndex(contacts, legacy, all), 4);
  const br = selectContacts(contacts, brazil); assert.equal(resumeIndex(br, legacy, brazil), 0);
  const checkpoint = { audience: { key: 'br' }, numero: br[1].numero };
  assert.equal(resumeIndex(br, checkpoint, brazil), 1);
  assert.equal(resumeIndex([...br].reverse(), checkpoint, brazil), 0);
  assert.equal(resumeIndex(contacts, checkpoint, all), 0);
  assert.notEqual(brazil.progressFile, portugal.progressFile); assert.notEqual(brazil.progressFile, all.progressFile);
});
test('contagem respeita enviados, bloqueados, pendentes, copy e retomada; trocar país mantém a exclusão global', () => {
  const input = { contacts, copies, sent: [contacts[0].numero], blocked: [contacts[3].numero], pending: { [contacts[4].numero]: { ack: -1 } } };
  const first = summarizeAudience(input); assert.equal(first.all.available, 3); assert.equal(first.br.available, 1); assert.equal(first.pt.available, 2); assert.equal(first.es.available, 0);
  const second = summarizeAudience({ ...input, sent: [...input.sent, contacts[1].numero], progress: { pt: { audience: { key: 'pt' }, numero: contacts[5].numero } } });
  assert.equal(second.pt.available, 1); assert.equal(second.all.available, 2); assert.equal(second.br.available, 1);
  assert.equal(summarizeAudience({ ...input, copies: {} }).all.available, 0);
  assert.throws(() => summarizeAudience({ ...input, sent: {} }), /Histórico/);
});
test('worker lê somente planilha fictícia, usa regras do remetente e não modifica arquivos', async t => {
  const root = temporaryRoot(t), XLSX = require('xlsx'), book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(contacts.map(contact => ({ numero: '+' + contact.numero, pais: contact.pais, categoria: contact.categoria }))), 'Contatos');
  const file = path.join(root, 'contatos.xlsx'); XLSX.writeFile(book, file);
  fs.writeFileSync(path.join(root, 'copys_internacionais.json'), JSON.stringify(copies));
  const before = fs.readFileSync(file), preview = createAudiencePreview(root);
  assert.equal((await preview('Portugal')).audience.available, 2);
  assert.equal((await preview('')).audience.total, 6);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.readdirSync(root).length, 2);
});
test('cache compartilha leitura entre países, invalida com histórico e não transforma falha em público geral', async t => {
  const root = temporaryRoot(t); let calls = 0;
  const preview = createAudiencePreview(root, { compute: async () => { calls++; return summarizeAudience({ contacts, copies }); } });
  await Promise.all([preview('Brasil'), preview('Portugal')]); assert.equal(calls, 1);
  await preview('Espanha'); assert.equal(calls, 1);
  fs.writeFileSync(path.join(root, 'envios_pendentes.json'), '{}'); await preview('Brasil'); assert.equal(calls, 2);
  await assert.rejects(preview('País inválido'), { code: 'PLOA_AUDIENCE_INVALID' });
  const broken = createAudiencePreview(root, { compute: async () => { throw Error('fixture failure'); } });
  await assert.rejects(broken('Portugal'), /fixture failure/);
});
test('leitor em fluxo preserva números formatados sem carregar workbook pelo SheetJS', async t => {
  const root=temporaryRoot(t),XLSX=require('xlsx'),book=XLSX.utils.book_new();
  const sheet=XLSX.utils.json_to_sheet([{numero:5511999999991,pais:'Brasil'},{numero:5511999999992,pais:'Brasil'},{numero:'+351911111111',pais:'Portugal'},{numero:'+351922222222; +351933333333',pais:'Portugal'}]);
  sheet.A3.z='0';
  XLSX.utils.book_append_sheet(book,sheet,'Contatos');const file=path.join(root,'contatos.xlsx');XLSX.writeFile(book,file);
  fs.writeFileSync(path.join(root,'copys_internacionais.json'),JSON.stringify(copies));
  const {readContactRows}=require('../lib/contact-sheet-rows'),rows=await readContactRows(file);
  const expected=XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets.Contatos,{raw:false}).map(row=>row.numero);
  assert.deepEqual(rows.map(([raw,,,,format])=>format==null?raw:XLSX.SSF.format(format,Number(raw))),expected);
  const original=XLSX.readFile;XLSX.readFile=()=>{throw Error('Full workbook must not load');};
  try{const result=await calculate(root);assert.equal(result.pt.total,2);assert.ok(result.br.total>=1);}finally{XLSX.readFile=original;}
});
