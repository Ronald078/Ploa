const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  readOperationSettings,
  settingsPath,
  writeOperationSettings,
} = require('../lib/operation-settings');

async function temporaryRoot(context) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-settings-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('usa os valores atuais quando ainda não existe configuração salva', async (context) => {
  const root = await temporaryRoot(context);
  const settings = await readOperationSettings(root);

  assert.deepEqual(settings.messages, {
    delayMinSeconds: 40,
    delayMaxSeconds: 120,
    dailyLimit: 35,
    targetCountry: '',
  });
  assert.deepEqual(settings.search, { localities: [], categories: [] });
});

test('salva e relê atraso, limite, localidades e categorias adicionais', async (context) => {
  const root = await temporaryRoot(context);
  const payload = {
    messages: { delayMinSeconds: 60, delayMaxSeconds: 180, dailyLimit: 40 },
    search: {
      localities: [{ city: 'Braga, Distrito de Braga, Portugal', market: 'Portugal' }],
      categories: [{ name: 'Hotel', key: 'tourism', value: 'hotel' }],
    },
  };

  await writeOperationSettings(root, payload);
  await writeOperationSettings(root, payload);
  assert.deepEqual(await readOperationSettings(root), { version: 1, ...payload, messages: { ...payload.messages, targetCountry: '' } });
  assert.equal(fs.existsSync(settingsPath(root)), true);
  assert.equal(fs.existsSync(`${settingsPath(root)}.bak`), true);
});

test('rejeita configurações que poderiam quebrar a execução', async (context) => {
  const root = await temporaryRoot(context);

  await assert.rejects(
    writeOperationSettings(root, {
      messages: { delayMinSeconds: 180, delayMaxSeconds: 60, dailyLimit: 35 },
      search: { localities: [], categories: [] },
    }),
    /atraso máximo não pode ser menor/
  );

  await assert.rejects(
    writeOperationSettings(root, {
      messages: { delayMinSeconds: 40, delayMaxSeconds: 120, dailyLimit: 35 },
      search: { localities: [{ city: 'Local qualquer', market: 'País inexistente' }], categories: [] },
    }),
    /não é suportado/
  );

  await assert.rejects(
    writeOperationSettings(root, {
      messages: { delayMinSeconds: 40, delayMaxSeconds: 120, dailyLimit: 35 },
      search: { localities: [], categories: [{ name: 'Hotel', key: 'tourism[]', value: 'hotel' }] },
    }),
    /Chave e valor/
  );
});
