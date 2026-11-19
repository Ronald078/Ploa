'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { spawn } = require('node:child_process');
const { createProcessManager } = require('../lib/process-manager');
const { temporaryRoot } = require('./fixture-helpers');
const xlsx = require('xlsx');
const project = path.resolve(__dirname, '../..');
const python = process.env.CRM_TEST_PYTHON;
function readSearchProgress(root){
  const progress=JSON.parse(fs.readFileSync(path.join(root,'progresso_busca.json'),'utf8'));
  if(progress.versao!==2)return progress;
  const part=reference=>JSON.parse(fs.readFileSync(path.join(root,'progresso_busca.json.partes',reference+'.json'),'utf8'));
  return {...progress,leads_pendentes:progress.pendentes_ref?part(progress.pendentes_ref):[],
    fontes_por_cidade:Object.fromEntries(Object.entries(progress.fontes_ref).map(([city,refs])=>[city,Object.fromEntries(Object.entries(refs).map(([source,reference])=>[source,part(reference)]))]))};
}

test('parada ou pausa antes de spawn não é revertida pelo evento atrasado', () => {
  const children = [], controls = [];
  const manager = createProcessManager({ PROJECT_ROOT: project, PORT: 0,
    workspace: { control: (...command) => controls.push(command) },
    getOperationsSnapshot: async () => ({}),
    spawn(_command, _args, options) {
      assert.equal(options.env.PYTHONUNBUFFERED, '1');
      const child = Object.assign(new EventEmitter(), {pid: 100, stdout: new EventEmitter(), stderr: new EventEmitter()});
      children.push(child); return child;
    } });
  manager.startManagedScript('search');
  manager.stopManagedScript('search');
  children[0].emit('spawn');
  assert.equal(manager.getProcessesSnapshot().search.status, 'stopping');
  assert.throws(() => manager.startManagedScript('search'), {statusCode: 409});
  children[0].emit('close', 0);
  manager.startManagedScript('search');
  manager.pauseManagedScript('search', 'pause');
  children[1].emit('spawn');
  assert.equal(manager.getProcessesSnapshot().search.status, 'paused');
  assert.deepEqual(controls, [['search','resume'],['search','stop'],['search','resume'],['search','pause']]);
});

for (const scenario of ['stop-nominatim', 'stop-overture', 'stop-overpass', 'stop-wait']) {
  test(`parada rápida durante ${scenario} preserva checkpoint sem exportar a planilha`, {skip: !python, timeout: 20000}, async t => {
    const root = temporaryRoot(t);
    fs.copyFileSync(path.join(__dirname, 'fixtures/search-runtime.py'), path.join(root, 'buscar_leads.py'));
    const control = action => fs.writeFileSync(path.join(root, 'ploa_controle.json'), JSON.stringify({search:{action}}));
    control('resume');
    const child = spawn(python, ['-u', 'buscar_leads.py'], {cwd: root, windowsHide: true,
      env: {...process.env, PYTHONDONTWRITEBYTECODE:'1', PLOA_PANEL_OUTPUT:'1', PLOA_SEARCH_TEST_PROJECT:project, PLOA_SEARCH_TEST_CASE:scenario}});
    const closed = once(child, 'close');
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = '';
    child.stdout.on('data', chunk => {output += chunk.toString();});
    child.stderr.on('data', chunk => {output += chunk.toString();});
    const deadline = Date.now() + 14000;
    while (!fs.existsSync(path.join(root, 'waiting-for-source'))) {
      if (child.exitCode !== null || Date.now() > deadline) assert.fail('Fixture não chegou à consulta: ' + output);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.match(output, /Preparando a busca/); // Output visible before the simulated request ends.
    const started = Date.now(); control('stop');
    const [code] = await closed;
    assert.equal(code, 0, output);
    assert.ok(Date.now() - started < 3000, output);
    const progress = readSearchProgress(root);
    const telemetry = JSON.parse(fs.readFileSync(path.join(root, 'andamento_busca.json')));
    assert.equal(telemetry.status, 'interrompida');
    assert.equal(progress.cidades_concluidas.length, 0);
    assert.equal(fs.existsSync(path.join(root, 'contatos.xlsx')), false);
    if (['stop-overpass','stop-wait'].includes(scenario)) {
      const sources = Object.values(progress.fontes_por_cidade)[0];
      assert.equal(sources.overture.concluida, true);
      assert.deepEqual(sources.osm.categorias_concluidas, ['Restaurante']);
      assert.equal(sources.osm.leads.length, 1);
    }
    t.diagnostic(`Parada em ${Date.now() - started} ms, fonte fictícia bloqueada por 60 s.`);
  });
}

for (const scenario of ['partial', 'persistent-partial', 'export-failure']) {
  test(`busca gerenciada retoma ${scenario}, preserva fontes e exporta XLSX compatível`, { skip: !python }, async t => {
    const root = temporaryRoot(t), savedRuns = [];
    fs.copyFileSync(path.join(__dirname, 'fixtures/search-runtime.py'), path.join(root, 'buscar_leads.py'));
    const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const fakeProcess = Object.assign(new EventEmitter(), { execPath: process.execPath, connected: false,
      env: { ...process.env, CRM_PYTHON_COMMAND: python, PYTHONDONTWRITEBYTECODE: '1',
        PLOA_SEARCH_TEST_PROJECT: project, PLOA_SEARCH_TEST_CASE: scenario } });
    const manager = createProcessManager({ PROJECT_ROOT: root, PORT: 0, process: fakeProcess, spawn,
      workspace: { internalToken: 'fixture', read: () => ({ settings: {} }),
        control: (id, action) => fs.writeFileSync(path.join(root, 'ploa_controle.json'), JSON.stringify({ [id]: { action } })),
        saveRun: async run => savedRuns.push(run) },
      getOperationsSnapshot: async () => ({ search: read('andamento_busca.json') }) });
    async function run() {
      manager.startManagedScript('search');
      const child = manager.scriptProcesses.get('search').child;
      const [code] = await once(child, 'close');
      await new Promise(resolve => setImmediate(resolve));
      return code;
    }
    const persistent = scenario === 'persistent-partial', recovered = scenario === 'partial';
    assert.equal(await run(), recovered ? 0 : persistent ? 2 : 1);
    assert.equal(manager.getProcessesSnapshot().search.status, recovered ? 'completed' : persistent ? 'partial' : 'error');
    const first = read('andamento_busca.json');
    assert.equal(first.status, recovered ? 'concluida' : persistent ? 'parcial' : 'erro');
    assert.equal(fs.existsSync(path.join(root, 'progresso_busca.json')), !recovered);
    if (persistent) {
      assert.equal(first.consultas_processadas, 1);
      assert.equal(first.cidades_faltantes, 1);
      assert.equal(first.total_leads, 2);
    } else if (!recovered) assert.equal(readSearchProgress(root).leads_pendentes.length, 3);
    if (!recovered) assert.equal(await run(), 0);
    const second = read('andamento_busca.json');
    assert.equal(second.status, 'concluida');
    assert.equal(second.cidades_faltantes, 0);
    assert.equal(second.consultas_processadas, 2);
    assert.equal(second.total_leads, 3);
    assert.equal(fs.existsSync(path.join(root, 'progresso_busca.json')), false);
    assert.deepEqual(read('source-calls.json'), { overture: 1, restaurant: 1, pet: persistent ? 4 : recovered ? 2 : 1 });
    assert.equal(second.encontrados, scenario === 'export-failure' ? 0 : 3,
      'retomadas não inflam encontrados; recuperar só a exportação não é uma nova consulta');
    const book = xlsx.readFile(path.join(root, 'contatos.xlsx'));
    assert.equal(book.SheetNames[0], 'Contatos');
    const rows = xlsx.utils.sheet_to_json(book.Sheets.Contatos, { defval: '', raw: false });
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map(row => row.Telefone)).size, 3);
    for (const row of rows) {
      assert.ok(row.Nome && row.Categoria);
      assert.match(row.Telefone, /^\+?55\d{11}$/);
      assert.equal(row['País'], 'Brasil');
      assert.equal(row.DDI, '55');
      assert.equal(row.Idioma, 'pt-BR');
    }
    assert.equal(savedRuns.length, recovered ? 1 : 2);
    assert.equal(savedRuns[0].outcome, recovered ? 'completed' : persistent ? 'partial' : 'error');
    if (!recovered) assert.equal(savedRuns[1].outcome, 'completed');
    assert.equal(manager.getProcessesSnapshot().messages.running, false);
  });
}
