const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCrmStore, localDateKey } = require('../lib/store');

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-prospeccao-'));
  const leads = {
    '5511999999999': {
      numero: '5511999999999',
      nome: 'Padaria Horizonte',
      status: 'frio',
      primeiro_contato: '2026-09-18T12:00:00.000Z',
      ultimo_contato: '2026-09-18T12:00:00.000Z',
      mensagens_enviadas: 1,
      respostas_recebidas: 0,
    },
    '5511888888888': {
      numero: '5511888888888',
      nome: 'Studio Norte',
      status: 'frio',
      primeiro_contato: '2026-09-18T13:00:00.000Z',
      ultimo_contato: '2026-09-18T13:00:00.000Z',
      mensagens_enviadas: 1,
      respostas_recebidas: 1,
    },
  };
  const responses = [
    { numero: '5511888888888', texto: 'Quero entender os valores.', data: '2026-09-19T13:00:00.000Z' },
  ];

  await Promise.all([
    fs.promises.writeFile(path.join(root, 'leads.json'), JSON.stringify(leads)),
    fs.promises.writeFile(path.join(root, 'respostas_recebidas.json'), JSON.stringify(responses)),
    fs.promises.writeFile(path.join(root, 'contador_diario.json'), JSON.stringify({ data: localDateKey(), enviados: 7 })),
  ]);
  return { root, leads };
}

test('deriva resposta do histórico sem alterar o arquivo do disparador', async (context) => {
  const { root, leads } = await fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCrmStore(root);

  const dashboard = await store.getDashboard();
  assert.equal(dashboard.resumo.total, 2);
  assert.equal(dashboard.resumo.com_resposta, 1);
  assert.equal(dashboard.resumo.enviados_hoje, 7);
  assert.equal(dashboard.resumo.por_status.respondeu, 1);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(root, 'leads.json'), 'utf8')), leads);
});

test('salva acompanhamento em arquivo separado e preserva a atividade original', async (context) => {
  const { root, leads } = await fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCrmStore(root);

  const updated = await store.updateLead('5511888888888', {
    status: 'proposta',
    proxima_acao: 'Enviar proposta comercial',
    proximo_contato: '2026-09-22',
    valor_estimado: 1450,
    nota: 'Cliente pediu uma landing page.',
  });

  assert.equal(updated.status, 'proposta');
  assert.equal(updated.proxima_acao, 'Enviar proposta comercial');
  assert.equal(updated.notas.length, 1);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(root, 'leads.json'), 'utf8')), leads);

  const crmData = JSON.parse(await fs.promises.readFile(path.join(root, 'crm_dados.json'), 'utf8'));
  assert.equal(crmData.leads['5511888888888'].valor_estimado, 1450);
});

test('rejeita etapa e campos desconhecidos', async (context) => {
  const { root } = await fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCrmStore(root);

  await assert.rejects(
    store.updateLead('5511888888888', { status: 'qualquer-coisa' }),
    /Etapa do funil inválida/
  );
  await assert.rejects(
    store.updateLead('5511888888888', { apagar: true }),
    /Campo não permitido/
  );
});

test('une identificador LID ao número de telefone quando há mapeamento', async (context) => {
  const { root, leads } = await fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  leads['900000000000@lid'] = {
    numero: '900000000000@lid',
    nome: '',
    status: 'frio',
    primeiro_contato: '2026-09-19T14:00:00.000Z',
    ultimo_contato: '2026-09-19T14:00:00.000Z',
    mensagens_enviadas: 0,
    respostas_recebidas: 1,
    ultima_resposta: '2026-09-19T14:00:00.000Z',
  };
  await fs.promises.writeFile(path.join(root, 'leads.json'), JSON.stringify(leads));
  await fs.promises.writeFile(
    path.join(root, 'respostas_recebidas.json'),
    JSON.stringify([{ numero: '900000000000@lid', texto: 'Tenho interesse.', data: '2026-09-19T14:00:00.000Z' }])
  );
  await fs.promises.writeFile(
    path.join(root, 'mapeamento_contatos.json'),
    JSON.stringify({ '900000000000@lid': { numero: '5511999999999', nome: 'Padaria Horizonte' } })
  );

  const dashboard = await createCrmStore(root).getDashboard();
  const merged = dashboard.leads.find((lead) => lead.id === '5511999999999');
  assert.equal(dashboard.resumo.total, 2);
  assert.equal(merged.nome, 'Padaria Horizonte');
  assert.equal(merged.respostas_recebidas, 1);
  assert.equal(merged.status, 'qualificado');
});

test('separa conversa LID não resolvida das métricas de leads', async (context) => {
  const { root, leads } = await fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  leads['800000000000@lid'] = {
    numero: '800000000000@lid',
    nome: '',
    status: 'frio',
    primeiro_contato: '2026-09-19T14:00:00.000Z',
    ultimo_contato: '2026-09-19T14:00:00.000Z',
    mensagens_enviadas: 0,
    respostas_recebidas: 1,
  };
  await fs.promises.writeFile(path.join(root, 'leads.json'), JSON.stringify(leads));
  await fs.promises.writeFile(
    path.join(root, 'respostas_recebidas.json'),
    JSON.stringify([{ numero: '800000000000@lid', texto: 'Mensagem não vinculada.', data: '2026-09-19T14:00:00.000Z' }])
  );

  const dashboard = await createCrmStore(root).getDashboard();
  const unresolved = dashboard.leads.find((lead) => lead.id === '800000000000@lid');
  assert.equal(dashboard.resumo.total, 2);
  assert.equal(dashboard.resumo.total_registros, 3);
  assert.equal(dashboard.resumo.conversas_sem_vinculo, 1);
  assert.equal(dashboard.resumo.por_status.vinculo_pendente, 1);
  assert.equal(unresolved.status, 'vinculo_pendente');
});
