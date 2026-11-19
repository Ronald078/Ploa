'use strict';

// Conta o resultado final de cada contato na execução, sem alterar a fila.
function createOutreachResults() {
  const contacts = new Map();
  const counts = { sent: 0, skipped: 0, failed: 0, uncertain: 0 };
  function record(item) {
    if (!item.numero) return;
    const status = String(item.status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (status.includes('limite diario')) return;
    const result = status === 'enviado' ? 'sent'
      : status.includes('pendente de confirmacao') ? 'uncertain'
      : status.startsWith('erro') || status.includes('falha') ? 'failed'
      : status.includes('ja enviado') || status.includes('nao encontrado') || status.includes('bloqueado') || status.includes('sem copy') || status.includes('nao reenviado automaticamente') ? 'skipped' : null;
    if (!result) return;
    const id=String(item.numero), previous=contacts.get(id);
    if(previous) counts[previous]--;
    contacts.set(id,result); counts[result]++;
  }
  return { record, snapshot: () => ({ ...counts }) };
}

function summarizeOutreachResults(log) {
  const tracker=createOutreachResults();for(const item of log||[])tracker.record(item);return tracker.snapshot();
}
module.exports = { summarizeOutreachResults, createOutreachResults };
