'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  automaticRepliesPath,
  firstContactPath,
  readCopySettings,
  writeCopySettings,
} = require('../lib/copy-settings');

const fixtureRoot = path.resolve(__dirname, '..', '..');

async function createFixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-copys-'));
  await Promise.all([
    fs.promises.copyFile(path.join(fixtureRoot, 'copys_internacionais.json'), firstContactPath(root)),
    fs.promises.copyFile(path.join(fixtureRoot, 'copys_respostas_automaticas.json'), automaticRepliesPath(root)),
  ]);
  return root;
}

test('carrega primeiro contato por país e respostas automáticas por idioma', async (context) => {
  const root = await createFixture();
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const settings = await readCopySettings(root);

  assert.equal(settings.firstContact.Brasil.genericas.length, 4);
  assert.equal(settings.firstContact.Portugal.porCategoria.restaurante.length, 5);
  assert.equal(settings.firstContact['Estados Unidos'].porCategoria.barbearia.length, 5);
  assert.equal(settings.automaticReplies.categorias['bot-atendimento'].porIdioma['es-ES'].length, 5);
});

test('salva edição, inclusão e exclusão com backup dos dois arquivos', async (context) => {
  const root = await createFixture();
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const settings = await readCopySettings(root);

  settings.firstContact.Brasil.porCategoria.restaurante[0] = 'Copy revisada com {nome}.';
  settings.firstContact.Brasil.porCategoria.restaurante.push('Nova variação.');
  settings.firstContact.Brasil.porCategoria.restaurante.splice(1, 1);
  const saved = await writeCopySettings(root, settings);

  assert.equal(saved.firstContact.Brasil.porCategoria.restaurante[0], 'Copy revisada com {nome}.');
  assert.equal(saved.firstContact.Brasil.porCategoria.restaurante.at(-1), 'Nova variação.');
  assert.equal(fs.existsSync(`${firstContactPath(root)}.bak`), true);
  assert.equal(fs.existsSync(`${automaticRepliesPath(root)}.bak`), true);
});

test('não permite apagar a última resposta automática de um idioma', async (context) => {
  const root = await createFixture();
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const settings = await readCopySettings(root);
  settings.automaticReplies.categorias['bot-atendimento'].porIdioma['pt-BR'] = [];

  await assert.rejects(
    () => writeCopySettings(root, settings),
    /precisa manter pelo menos uma copy/,
  );
});

test('rejeita texto vazio e preserva quebras de linha válidas', async (context) => {
  const root = await createFixture();
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const settings = await readCopySettings(root);
  settings.firstContact.Brasil.genericas[0] = 'Primeira linha.\r\nSegunda linha.';
  const saved = await writeCopySettings(root, settings);
  assert.equal(saved.firstContact.Brasil.genericas[0], 'Primeira linha.\nSegunda linha.');

  saved.firstContact.Brasil.genericas.push('   ');
  await assert.rejects(() => writeCopySettings(root, saved), /não pode ficar vazia/);
});
