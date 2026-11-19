'use strict';
// Controlador de processes: mantém eventos e renderização na mesma área.
window.PloaAppModules.processes = function createController(ctx) {
const PROCESS_STATUS_COPY = {
  idle: 'Pronto para iniciar',
  starting: 'Iniciando',
  running: 'Em execução',
  paused: 'Pausa solicitada',
  stopping: 'Encerrando',
  stopped: 'Interrompido',
  completed: 'Concluído',
  error: 'Falha na execução',
};

function getProcessElements(id) {
  if (id === 'search') {
    return {
      badge: ctx.elements.searchRunState,
      status: ctx.elements.searchProcessStatus,
      started: ctx.elements.searchProcessStarted,
      pid: ctx.elements.searchProcessPid,
      log: ctx.elements.searchProcessLog,
    };
  }
  return {
    status: ctx.elements.messagesProcessStatus,
    started: ctx.elements.messagesProcessStarted,
    pid: ctx.elements.messagesProcessPid,
    log: ctx.elements.messagesProcessLog,
  };
}

const QR_LOG_START = '[[PLOA_QR_START]]';

const QR_LOG_END = '[[PLOA_QR_END]]';

const QR_LOG_CLEAR = '[[PLOA_QR_CLEAR]]';

function separateQrFromProcessLogs(logs = []) {
  let collectingQr = false;
  let qrLines = [];
  let qrCode = '';
  const visibleLogs = [];

  for (const entry of logs) {
    if (entry.text === QR_LOG_START) {
      collectingQr = true;
      qrLines = [];
      continue;
    }
    if (entry.text === QR_LOG_END) {
      if (collectingQr && qrLines.length) qrCode = qrLines.join('\n');
      collectingQr = false;
      qrLines = [];
      continue;
    }
    if (entry.text === QR_LOG_CLEAR) {
      collectingQr = false;
      qrLines = [];
      qrCode = '';
      visibleLogs.push({ ...entry, stream: 'system', text: 'WhatsApp conectado. O QR Code foi ocultado.' });
      continue;
    }
    if (collectingQr) {
      qrLines.push(entry.text);
      continue;
    }
    visibleLogs.push(entry);
  }

  return { qrCode, visibleLogs };
}

function formatProcessLogs(processState, logs = processState.logs || []) {
  if (!logs.length) return 'A execução ainda não foi iniciada nesta sessão do painel.';
  return logs.map((entry) => {
    if (entry.stream === 'system') return `◆ ${entry.text}`;
    if (entry.stream === 'stderr') return `! ${entry.text}`;
    return entry.text;
  }).join('\n');
}

function fitMessagesQrCode() {
  const qrCode = ctx.elements.messagesQrCode;
  if (!qrCode || ctx.elements.messagesQrPanel.hidden || !qrCode.textContent) return;

  qrCode.style.fontSize = '10px';
  const availableWidth = Math.max(1, qrCode.clientWidth - 2);
  const fittedSize = Math.max(5, Math.min(10, 10 * availableWidth / Math.max(1, qrCode.scrollWidth)));
  qrCode.style.fontSize = `${fittedSize}px`;
}

function renderProcess(id) {
  const processState = ctx.state.processes?.[id];
  if (!processState) return;
  const processElements = ctx.getProcessElements(id);
  const statusCopy = PROCESS_STATUS_COPY[processState.status] || 'Estado desconhecido';
  const running = Boolean(processState.running);

  if (processElements.badge) {
    processElements.badge.dataset.processStatus = processState.status;
    processElements.badge.lastChild.textContent = statusCopy;
  }
  ctx.setText(processElements.status, statusCopy);
  ctx.setText(processElements.started, processState.startedAt ? ctx.formatDate(processState.startedAt, true) : '—');
  ctx.setText(processElements.pid, processState.pid || '—');

  const separatedLogs = id === 'messages'
    ? ctx.separateQrFromProcessLogs(processState.logs)
    : { qrCode: '', visibleLogs: processState.logs || [] };
  if (id === 'messages') {
    const worker=ctx.state.processes?.whatsapp;
    const hideQr=worker?.pairing&&worker.pairing.status!=='error'||['ready','authenticating','pairing'].includes(worker?.connection);
    const qr=hideQr?'':worker?ctx.separateQrFromProcessLogs(worker.logs).qrCode:separatedLogs.qrCode;
    ctx.elements.messagesQrPanel.hidden = !qr;
    if (ctx.elements.messagesQrCode.textContent !== qr) {
      ctx.elements.messagesQrCode.textContent = qr;
      if (qr) requestAnimationFrame(ctx.fitMessagesQrCode);
    }
  }
  const logText = ctx.formatProcessLogs(processState, separatedLogs.visibleLogs);
  if (processElements.log.textContent !== logText) {
    processElements.log.textContent = logText;
    processElements.log.scrollTop = processElements.log.scrollHeight;
  }
  processElements.log.closest('.process-console').dataset.running = String(running);
  if (id === 'search') {
    ctx.elements.searchLiveTracker.dataset.running = String(running);
  } else {
    ctx.elements.messagesLiveTracker.dataset.running = String(running);
  }

  for (const button of ctx.elements.processStartButtons) {
    if (button.dataset.processStart === id) button.disabled = running;
  }
  for (const button of ctx.elements.processStopButtons) {
    if (button.dataset.processStop === id) button.disabled = !running || processState.status === 'stopping';
  }
  ctx.renderSettingsAvailability();
  if (ctx.state.copySettings) ctx.renderCopyEditor();
}

function renderProcesses() {
  ctx.renderProcess('search');
  ctx.renderProcess('messages');
  if (ctx.state.copySettings) ctx.renderCopyEditor();
}

  function bindEvents() {
for (const button of ctx.elements.processStartButtons) {
  button.addEventListener('click', () => {
    const id = button.dataset.processStart;
    if (id === 'messages') {
      ctx.elements.messagesConfirmDialog.showModal();
      return;
    }
    ctx.triggerProcessAction(id, 'start');
  });
}

for (const button of ctx.elements.processStopButtons) {
  button.addEventListener('click', () => ctx.triggerProcessAction(button.dataset.processStop, 'stop'));
}

ctx.elements.messagesConfirmDialog.addEventListener('close', () => {
  if (ctx.elements.messagesConfirmDialog.returnValue === 'confirm') {
    ctx.triggerProcessAction('messages', 'start');
  }
});

for (const input of [ctx.elements.messageDelayMin, ctx.elements.messageDelayMax, ctx.elements.messageDailyLimit]) {
  input.addEventListener('input', () => {
    ctx.markSettingsDirty(ctx.elements.messageSettingsStatus, 'Há alterações de mensagens ainda não salvas.');
  });
}
  }
  return { getProcessElements, separateQrFromProcessLogs, formatProcessLogs, fitMessagesQrCode, renderProcess, renderProcesses, bindEvents };
};
