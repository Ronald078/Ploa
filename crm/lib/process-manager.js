'use strict';
const { spawn: spawnProcess } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const {createPairingControl}=require('./whatsapp-pairing');

function createProcessManager({ workspace, PORT, PROJECT_ROOT, codeRoot=PROJECT_ROOT, getOperationsSnapshot,
  process = global.process, spawn = spawnProcess, setTimeout = global.setTimeout, clearTimeout = global.clearTimeout }) {
const scriptDefinitions = Object.freeze({
  whatsapp: {
    label: 'Atendimento contínuo do WhatsApp',command:process.execPath,args:['crm/attendance-agent.js'],
  },
  search: {
    label: 'Busca de leads',
    command: process.env.CRM_PYTHON_COMMAND || 'python',
    args: ['buscar_leads.py'],
  },
  messages: {
    label: 'Envio de mensagens',
    command: process.execPath,
    args: ['enviar_mensagens_whatsapp.js'],
  },
});
if(codeRoot!==PROJECT_ROOT)for(const definition of Object.values(scriptDefinitions))definition.args=definition.args.map(arg=>require('node:path').resolve(codeRoot,arg));

const activeProcessStatuses = new Set(['starting', 'running', 'paused', 'stopping']);

const scriptProcesses = new Map(
  Object.keys(scriptDefinitions).map((id) => [id, createScriptProcessState(id)]),
);
const pairing=createPairingControl({getState:()=>scriptProcesses.get('whatsapp'),start:()=>startManagedScript('whatsapp'),active:activeProcessStatuses,setTimeout,clearTimeout});

let attendanceRetry=null;

let attendanceFailures=0;

let shuttingDown=false;

function notifyAttendancePower(){
  const state=scriptProcesses.get('whatsapp');
  if(process.connected)process.send?.({type:'ploa-attendance',active:Boolean(state?.child&&activeProcessStatuses.has(state.status)),keepAwake:workspace.read().settings.preventSleep===true});
}

function attendanceWanted(){const settings=workspace.read().settings;return settings.keepConnected===true||(settings.keepConnected!==false&&settings.enabled===true);}

function finishOutreach(status,error=''){
  const state=scriptProcesses.get('messages');if(!activeProcessStatuses.has(state.status))return;
  flushProcessOutput(state);state.status=status;state.lastError=error;state.endedAt=new Date().toISOString();state.exitCode=status==='error'?1:0;state.pid=null;
  appendProcessLog(state,status==='error'?'stderr':'system',error||'Fila de disparos encerrada. O atendimento do WhatsApp continua independente.');
  void getOperationsSnapshot().then(snapshot=>workspace.saveRun({script:'messages',startedAt:state.startedAt,endedAt:state.endedAt,exitCode:state.exitCode,stopped:status==='stopped',metrics:snapshot.messages})).catch(()=>{});
}

function startOutreach(){
  const state=scriptProcesses.get('messages');
  if(activeProcessStatuses.has(state.status))throw processError('Os disparos já estão em execução.',409);
  clearTimeout(attendanceRetry);attendanceRetry=null;
  let agent=scriptProcesses.get('whatsapp');
  if(!activeProcessStatuses.has(agent.status))startManagedScript('whatsapp');
  agent=scriptProcesses.get('whatsapp');
  if(!agent.child?.connected)throw processError('O atendimento do WhatsApp ainda está iniciando. Tente novamente em instantes.',409);
  state.generation++;state.status=agent.connection==='ready'?'running':'starting';state.startedAt=new Date().toISOString();state.endedAt=null;state.lastError='';state.exitCode=null;state.pid=agent.pid;
  state.stopRequested=false;state.logs=[];state.fragments={stdout:'',stderr:''};state.decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
  state.runId='outreach-'+Date.now()+'-'+state.generation;
  workspace.control('messages','resume');
  appendProcessLog(state,'system','Fila solicitada. A conexão contínua do WhatsApp será utilizada.');
  agent.child.send({type:'ploa-campaign-start',runId:state.runId},error=>{if(error)finishOutreach('error','Não foi possível iniciar a fila no atendimento do WhatsApp.');});
  return publicProcessState(state);
}

function createScriptProcessState(id) {
  return {
    id,
    status: 'idle',
    pid: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: '',
    stopRequested: false,
    searchPartial: false,
    logs: [],
    child: null,
    generation: 0,
    decoders: null,
    fragments: { stdout: '', stderr: '' },
  };
}

function stripTerminalCodes(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function appendProcessLog(state, stream, text) {
  const cleanText = stripTerminalCodes(text).replace(/\u0000/g, '').slice(0, 2400);
  if (!cleanText.trim()) return;
  if (state.id === 'search' && stream === 'stdout' && cleanText.trim() === '[[PLOA_SEARCH_PARTIAL]]') {
    state.searchPartial = true;
    return;
  }
  state.logs.push({ at: new Date().toISOString(), stream, text: cleanText });
  if (state.logs.length > 280) state.logs.splice(0, state.logs.length - 280);
}

function consumeProcessOutput(state, stream, chunk) {
  const decoded = state.decoders[stream].write(chunk).replace(/\r(?!\n)/g, '\n');
  const combined = state.fragments[stream] + decoded;
  const lines = combined.split('\n');
  state.fragments[stream] = lines.pop() || '';
  for (const line of lines) appendProcessLog(state, stream, line);
}

function flushProcessOutput(state) {
  for (const stream of ['stdout', 'stderr']) {
    const tail = `${state.fragments[stream]}${state.decoders?.[stream]?.end() || ''}`;
    if (tail) appendProcessLog(state, stream, tail);
    state.fragments[stream] = '';
  }
}

function publicProcessState(state) {
  return {
    id: state.id,
    label: scriptDefinitions[state.id].label,
    status: state.status,
    running: activeProcessStatuses.has(state.status),
    connection:state.connection||'',
    ...(state.id==='whatsapp'?{pairing:pairing.snapshot()}:{}),
    pid: state.pid,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    exitCode: state.exitCode,
    lastError: state.lastError,
    logs: state.logs,
  };
}

function getProcessesSnapshot() {
  return Object.fromEntries(
    [...scriptProcesses.entries()].map(([id, state]) => [id, publicProcessState(state)]),
  );
}

function processError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function startManagedScript(id) {
  if(id==='messages')return startOutreach();
  const definition = scriptDefinitions[id];
  const state = scriptProcesses.get(id);
  if (!definition || !state) throw processError('Script não permitido.', 404);
  if (activeProcessStatuses.has(state.status)) {
    throw processError(`${definition.label} já está em execução.`, 409);
  }

  state.generation += 1;
  const generation = state.generation;
  state.status = 'starting';
  state.pid = null;
  state.startedAt = new Date().toISOString();
  state.endedAt = null;
  state.exitCode = null;
  state.lastError = '';
  state.stopRequested = false;
  state.searchPartial = false;
  state.logs = [];
  state.fragments = { stdout: '', stderr: '' };
  state.decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  if(id!=='whatsapp')workspace.control(id, 'resume');
  else {clearTimeout(attendanceRetry);attendanceRetry=null;pairing.clear();state.connection='starting';}
  appendProcessLog(state, 'system', `Iniciando ${definition.label} no diretório do projeto.`);

  let child;
  try {
    child = spawn(definition.command, definition.args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      shell: false,
      stdio: id==='whatsapp'?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
        PLOA_PANEL_OUTPUT: '1',
        PLOA_AGENT_TOKEN: workspace.internalToken,
        PLOA_PANEL_PORT: String(PORT),
        PLOA_DATA_ROOT: PROJECT_ROOT,
      },
    });
  } catch (error) {
    state.status = 'error';
    state.endedAt = new Date().toISOString();
    state.lastError = error.message;
    appendProcessLog(state, 'stderr', error.message);
    throw processError(`Não foi possível iniciar ${definition.label}: ${error.message}`, 500);
  }

  state.child = child;
  state.pid = child.pid || null;
  for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{
    consumeProcessOutput(state,stream,chunk);
    const campaign=scriptProcesses.get('messages');
    if(id==='whatsapp'&&activeProcessStatuses.has(campaign.status))consumeProcessOutput(campaign,stream,chunk);
  });
  if(id==='whatsapp')child.on('message',message=>{
    if(state.generation!==generation)return;
    pairing.receive(message);
    if(message?.type==='ploa-whatsapp-state'){
      if(message.connection==='authenticating'&&state.connection==='ready')return;
      state.connection=['ready','qr','authenticating','reconnecting','auth_failure'].includes(message.connection)?message.connection:'starting';
      if(['ready','reconnecting','auth_failure'].includes(state.connection))pairing.clear();
      if(state.connection==='ready'){
        attendanceFailures=0;const campaign=scriptProcesses.get('messages');
        if(campaign.status==='starting')campaign.status='running';
      }
      notifyAttendancePower();
    }
    if(message?.type==='ploa-campaign-finished'&&message.runId===scriptProcesses.get('messages').runId){
      finishOutreach(['completed','stopped','error'].includes(message.status)?message.status:'error',String(message.error||'').slice(0,500));
    }
  });

  child.once('spawn', () => {
    if (state.generation !== generation) return;
    state.pid = child.pid;
    if (!state.stopRequested && state.status !== 'paused') state.status = 'running';
    if(id==='whatsapp')notifyAttendancePower();
    appendProcessLog(state, 'system', `${definition.label} iniciado com PID ${child.pid}.`);
  });

  child.once('error', (error) => {
    if (state.generation !== generation) return;
    state.status = 'error';
    state.lastError = error.message;
    appendProcessLog(state, 'stderr', `Falha ao iniciar o processo: ${error.message}`);
  });

  child.once('close', (code, signal) => {
    if (state.generation !== generation) return;
    flushProcessOutput(state);
    state.child = null;
    state.pid = null;
    state.endedAt = new Date().toISOString();
    state.exitCode = Number.isInteger(code) ? code : null;
    if(id==='whatsapp'){
      pairing.clear();
      state.connection='disconnected';
      finishOutreach(state.stopRequested?'stopped':'error','A conexão do WhatsApp foi encerrada. A fila não será reiniciada automaticamente.');
      notifyAttendancePower();
      if(!state.stopRequested&&!shuttingDown&&attendanceWanted()){
        const delay=Math.min(120000,10000*2**Math.min(attendanceFailures++,4));
        attendanceRetry=setTimeout(()=>{attendanceRetry=null;if(!shuttingDown&&attendanceWanted())try{startManagedScript('whatsapp');}catch(error){appendProcessLog(state,'stderr',error.message);}},delay);
        attendanceRetry.unref?.();
      }
    }
    if (state.stopRequested) {
      state.status = 'stopped';
      appendProcessLog(state, 'system', 'Execução encerrada pelo painel. O próximo início usará o progresso salvo pelo script.');
    } else if (id === 'search' && code === 2 && state.searchPartial && !state.lastError) {
      state.status = 'partial';
      state.lastError = '';
      appendProcessLog(state, 'system', 'Busca finalizada com pendências. O próximo início retoma somente as consultas que faltam.');
    } else if (code === 0) {
      state.status = 'completed';
      appendProcessLog(state, 'system', 'Execução concluída normalmente.');
    } else {
      state.status = 'error';
      const detail = signal ? `sinal ${signal}` : `código ${code}`;
      state.lastError = state.lastError || `O processo terminou com ${detail}.`;
      appendProcessLog(state, 'stderr', state.lastError);
    }
    if(id!=='whatsapp'){
      // Capture this run before a new start can reset the mutable process state.
      const run = {script:id, startedAt:state.startedAt, endedAt:state.endedAt,
        exitCode:state.exitCode, stopped:state.stopRequested, outcome:state.status};
      void getOperationsSnapshot().then(snapshot=>workspace.saveRun({...run,metrics:snapshot[id]}))
        .catch(error=>appendProcessLog(state,'stderr','Não foi possível salvar o histórico da execução: '+error.message));
    }
  });

  return publicProcessState(state);
}

function stopManagedScript(id) {
  const definition = scriptDefinitions[id];
  const state = scriptProcesses.get(id);
  if (!definition || !state) throw processError('Script não permitido.', 404);
  if (!activeProcessStatuses.has(state.status) || (id!=='messages'&&!state.child)) {
    throw processError(`${definition.label} não está em execução.`, 409);
  }

  state.stopRequested = true;
  state.status = 'stopping';
  if(id==='whatsapp'){
    pairing.clear();
    clearTimeout(attendanceRetry);attendanceRetry=null;
    if(state.child.connected)state.child.send({type:'ploa-attendance-stop'},()=>{});
  }else{
    workspace.control(id, 'stop');
    if(id==='messages')scriptProcesses.get('whatsapp').child?.send({type:'ploa-campaign-stop',runId:state.runId},()=>{});
  }
  appendProcessLog(state, 'system', 'Parada solicitada. A operação atual será concluída antes de encerrar, preservando o progresso.');
  return publicProcessState(state);
}

function pauseManagedScript(id, action) {
  const state = scriptProcesses.get(id);
  if ((!state?.child&&id!=='messages') || !activeProcessStatuses.has(state.status) || state.status === 'stopping') {
    throw processError('O script precisa estar em execução.', 409);
  }
  workspace.control(id, action);
  state.status = action === 'pause' ? 'paused' : 'running';
  appendProcessLog(state, 'system', action === 'pause'
    ? 'Pausa solicitada. Será aplicada após a operação em andamento.'
    : 'Continuação solicitada.');
  return publicProcessState(state);
}

async function stopManagedScriptsOnExit() {
  pairing.clear();
  shuttingDown=true;clearTimeout(attendanceRetry);attendanceRetry=null;

  const waiting=[];
  for (const state of scriptProcesses.values()) {
    if (state.child && activeProcessStatuses.has(state.status)) {
      state.stopRequested = true;
      const child=state.child;
      waiting.push(new Promise(resolve=>child.once('close',resolve)));
      if(state.id==='whatsapp'&&child.connected)child.send({type:'ploa-attendance-stop'},()=>{});
      else child.kill('SIGTERM');
    }
  }
  let deadline;
  await Promise.race([Promise.all(waiting),new Promise(resolve=>{deadline=setTimeout(resolve,8000);})]);clearTimeout(deadline);
  for(const state of scriptProcesses.values())if(state.child&&!state.child.killed)state.child.kill('SIGTERM');
}
  function cancelAttendanceRetry() { clearTimeout(attendanceRetry); attendanceRetry = null; }
  return { startManagedScript, stopManagedScript, pauseManagedScript, getProcessesSnapshot,
    publicProcessState, processError, cancelAttendanceRetry, attendanceWanted, notifyAttendancePower,
    stopManagedScriptsOnExit, activeProcessStatuses, scriptProcesses,
    requestWhatsappPairing:phone=>{if(shuttingDown)throw processError('O Ploa está encerrando.',409);return pairing.request(phone);},
    cancelWhatsappPairing:()=>pairing.cancel(),
    get shuttingDown() { return shuttingDown; } };
}
module.exports = { createProcessManager };
