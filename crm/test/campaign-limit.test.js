'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { reachedDailyLimit, createProgressWriter } = require('../lib/campaign-progress');

test('limite desativado e limite atingido são distintos', () => {
  for (const limit of [null, 0, undefined]) assert.equal(reachedDailyLimit(limit, 40), false);
  assert.equal(reachedDailyLimit(40, 39), false);
  assert.equal(reachedDailyLimit(40, 40), true);
  assert.equal(reachedDailyLimit(40, 41), true);
});

test('andamento visual recupera EPERM transitório e não prende a fila se persistir', () => {
  let calls = 0, warnings = 0, clock = 1000;
  const waits = [];
  const writer = createProgressWriter({
    save() { if (++calls <= 2) throw new Error('EPERM'); },
    wait: ms => waits.push(ms), now: () => clock,
  });
  assert.equal(writer({ status: 'em_execucao' }), true);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [40, 80]);
  calls = 0;
  const locked = createProgressWriter({
    save() { calls++; throw new Error('EPERM'); }, wait() {},
    now: () => clock, warn() { warnings++; },
  });
  assert.equal(locked({ status: 'em_execucao' }), false);
  assert.equal(locked({ status: 'em_execucao' }), false);
  assert.equal(calls, 3);
  assert.equal(locked({ status: 'limite_diario' }), false);
  assert.equal(calls, 6);
  assert.equal(warnings, 2);
  clock += 1000;
  locked({ status: 'em_execucao' });
  assert.equal(calls, 9);
});

async function runSender(t, { limit = 2, initial = 0, continuous = true,
  lockedFile = '', pause = false, pauseAfterLast = false, counterFailure = false } = {}) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'ploa-limit-test-'));
  t.after(() => {
    const target = fs.realpathSync(root);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith('ploa-limit-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const source = path.resolve(__dirname, '../../enviar_mensagens_whatsapp.js');
  const result = { sends: [], ipc: [], timers: [], logs: [], destroyed: 0, exits: [] };
  const fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, {
    pid: 987654, env: continuous ? { PLOA_CONTINUOUS_AGENT: '1' } : {},
    connected: continuous, stdout: { write() {} },
    send: message => result.ipc.push(message),
    exit: code => { result.exits.push(code); fakeProcess.emit('exit'); },
    kill() { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); },
  });
  t.after(() => fakeProcess.emit('exit'));
  class Client extends EventEmitter {
    constructor() { super(); this.authStrategy = { destroy: async () => {} }; }
    async initialize() { this.emit('qr', 'fixture-qr'); }
    async inject() {}
    _registerFramenavigatedHandler() {}
    async destroy() { result.destroyed++; }
    async isRegisteredUser() { return true; }
    async sendMessage(to, text) {
      result.sends.push({ to, text });
      if (pauseAfterLast && result.sends.length >= limit - initial) pause = true;
      // A fulfilled SDK call alone is not confirmation. Model server ACK 1.
      return { ack: 1, id: { _serialized: `fake-${result.sends.length}` } };
    }
  }
  const bridge = { enabled: true, control: () => pause ? 'pause' : '',
    event: async () => {}, trackSend: (to, text, send) => send(),
    start() {}, close() {}, isBusy: () => false };
  const settings = { messages: { dailyLimit: limit, delayMinSeconds: 0, delayMaxSeconds: 0 } };
  const fixtureDescriptors = new Set();
  const insideFixture = file => {
    if (typeof file === 'number') { assert.ok(fixtureDescriptors.has(file), 'Descritor fora da fixture'); return; }
    const relative = path.relative(root, path.resolve(file));
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'Teste tentou acessar dados fora da pasta temporária');
  };
  const fakeFs = { ...fs,
    existsSync(file) { insideFixture(file); return fs.existsSync(file); },
    readFileSync(file, ...args) { insideFixture(file); return fs.readFileSync(file, ...args); },
    writeFileSync(file, ...args) { insideFixture(file); return fs.writeFileSync(file, ...args); },
    openSync(file, ...args) { insideFixture(file); const fd = fs.openSync(file, ...args); fixtureDescriptors.add(fd); return fd; },
    closeSync(fd) { insideFixture(fd); try { return fs.closeSync(fd); } finally { fixtureDescriptors.delete(fd); } },
    unlinkSync(file) { insideFixture(file); return fs.unlinkSync(file); },
    renameSync(from, to) {
    insideFixture(from); insideFixture(to);
    if (counterFailure && result.sends.length && path.basename(to) === 'contador_diario.json') throw Object.assign(new Error('EPERM: counter blocked'), { code: 'EPERM' });
    if (path.basename(to) === lockedFile) throw Object.assign(new Error('EPERM: locked test file'), { code: 'EPERM' });
    return fs.renameSync(from, to);
  } };
  const rows = Array.from({ length: 5 }, (_, i) => ({ numero: `551198765430${i}`, nome: `Empresa fictícia ${i}`, pais: 'Brasil' }));
  const context = vm.createContext({
    __dirname: root, process: fakeProcess,
    console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => result.logs.push(args.join(' '))])),
    setInterval() { return { unref() {} }; }, clearInterval() {}, clearTimeout() {},
    setTimeout(fn, ms) {
      if (!ms) { queueMicrotask(fn); return { unref() {} }; }
      const timer = { fn, ms, unref() {} }; result.timers.push(timer); return timer;
    },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name.endsWith('/runtime-paths')) return { dataRoot: () => root };
      if (name === 'whatsapp-web.js') return { Client, LocalAuth: class {}, MessageMedia: {} };
      if (name === 'qrcode-terminal') return { generate() {} };
      if (name === 'csv-parse/sync') return { parse: () => rows };
      if (name === 'xlsx') return { readFile: () => ({ SheetNames: ['Leads'], Sheets: { Leads: {} } }), utils: { sheet_to_json: () => rows } };
      if (name.endsWith('/whatsapp-bridge')) return { createWhatsAppBridge: () => bridge };
      if (name.endsWith('/operation-settings')) return { DEFAULT_OPERATION_SETTINGS: settings, normalizeOperationSettings: value => value };
      if (name.startsWith('./')) return require(path.resolve(path.dirname(source), name));
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  vm.runInContext(`salvarContadorDiario({data:dataDeHoje(),enviados:${initial}});whatsappPronto=true;campanhaPloa='fake-run';`, context);
  await vm.runInContext('executarFilaAoFicarPronto()', context);
  result.progress = vm.runInContext('({...andamentoExecucaoEnvios})', context);
  result.counter = JSON.parse(fs.readFileSync(path.join(root, 'contador_diario.json'), 'utf8'));
  result.sent = fs.existsSync(path.join(root, 'numeros_enviados.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'numeros_enviados.json'), 'utf8')) : [];
  result.resume=async()=>{
    counterFailure=false;lockedFile='';
    await vm.runInContext('executarFilaAoFicarPronto()',context);
    result.progress=vm.runInContext('({...andamentoExecucaoEnvios})',context);
    result.counter=JSON.parse(fs.readFileSync(path.join(root,'contador_diario.json'),'utf8'));
    result.sent=JSON.parse(fs.readFileSync(path.join(root,'numeros_enviados.json'),'utf8'));
    result.pending=JSON.parse(fs.readFileSync(path.join(root,'envios_pendentes.json'),'utf8'));
    result.alert=JSON.parse(fs.readFileSync(path.join(root,'ALERTA_PERSISTENCIA.json'),'utf8'));
  };
  return result;
}

test('limite conclui campanha com andamento bloqueado, preservando atendimento', async t => {
  const result = await runSender(t, { lockedFile: 'andamento_envios.json', pauseAfterLast: true });
  assert.equal(result.sends.length, 2);
  assert.equal(result.counter.enviados, 2);
  assert.equal(result.progress.status, 'limite_diario');
  assert.equal(result.progress.faltantes, 0);
  assert.equal(result.ipc.filter(item => item.type === 'ploa-campaign-finished' && item.status === 'completed').length, 1);
  assert.equal(result.destroyed, 0);
  assert.equal(result.timers.length, 0);
});

test('limite já atingido conclui mesmo com controle pausado', async t => {
  const result = await runSender(t, { initial: 2, pause: true });
  assert.equal(result.sends.length, 0);
  assert.equal(result.progress.status, 'limite_diario');
  assert.equal(result.ipc.at(-1).status, 'completed');
  assert.equal(result.timers.length, 0);
});

test('execução direta encerra seu navegador ao atingir limite', async t => {
  const result = await runSender(t, { continuous: false });
  assert.equal(result.sends.length, 2);
  assert.equal(result.destroyed, 1);
  assert.deepEqual(result.exits, [0]);
});

test('sem limite percorre todos os contatos fictícios', async t => {
  const result = await runSender(t, { limit: 0 });
  assert.equal(result.sends.length, 5);
  assert.equal(result.progress.status, 'concluida');
  assert.equal(result.ipc.at(-1).status, 'completed');
});

test('falha no registro protegido de enviados mantém bloqueio, sem concluir ou repetir', async t => {
  const result = await runSender(t, { lockedFile: 'numeros_enviados.json' });
  assert.equal(result.sends.length, 1);
  assert.equal(result.counter.enviados, 0);
  assert.equal(result.progress.status, 'aguardando_persistencia');
  assert.equal(result.ipc.some(item => item.type === 'ploa-campaign-finished'), false);
  assert.ok(result.timers.some(item => item.ms === 60000));
});

test('log auxiliar bloqueado não impede conclusão após limite registrado', async t => {
  const result = await runSender(t, { lockedFile: 'log_envios.json' });
  assert.equal(result.sends.length, 2);
  assert.equal(result.counter.enviados, 2);
  assert.equal(result.ipc.at(-1).status, 'completed');
  assert.equal(result.timers.length, 0);
});

test('fila retoma após contador bloqueado, recupera envio confirmado e conclui no limite sem duplicar',async t=>{
 const result=await runSender(t,{counterFailure:true});
 assert.equal(result.sends.length,1);assert.equal(result.counter.enviados,0);assert.equal(result.progress.status,'aguardando_persistencia');
 await result.resume();assert.equal(result.sends.length,2);assert.equal(new Set(result.sends.map(row=>row.to)).size,2);assert.equal(result.counter.enviados,2);assert.equal(result.progress.enviadas,2);assert.equal(result.progress.status,'limite_diario');assert.equal(result.alert.status,'resolvido');assert.deepEqual(result.pending,{});
 assert.equal(result.ipc.filter(row=>row.type==='ploa-campaign-finished'&&row.status==='completed').length,1);
});

test('registro de enviados bloqueado recupera a confirmação antes de prosseguir sem reenviar',async t=>{
 const result=await runSender(t,{lockedFile:'numeros_enviados.json'});assert.equal(result.sends.length,1);
 await result.resume();assert.equal(result.sends.length,2);assert.equal(new Set(result.sends.map(row=>row.to)).size,2);assert.equal(result.counter.enviados,2);assert.equal(result.sent.length,2);assert.equal(result.progress.status,'limite_diario');assert.equal(result.alert.status,'resolvido');
});
