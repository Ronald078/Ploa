// Compatibility for the last run from the previous worker, which used exit 1
// for a successfully saved partial result. Never relabel a fatal error after it.
export function searchProcessState(process = {}, progress = {}) {
  if (process.status === 'partial') return process;
  if (process.running || process.status !== 'error' || progress.status !== 'parcial') return process;
  const logs = process.logs || [];
  if (![1,2].includes(process.exitCode)) return process;
  const partial = logs.findLastIndex(entry => entry.stream === 'stdout' && (process.exitCode === 2
    ? entry.text.trim() === '[[PLOA_SEARCH_PARTIAL]]'
    : entry.text.includes('A busca terminou parcialmente. Na próxima execução,')));
  if (partial < 0) return process;
  const fatalAfterPartial = logs.slice(partial + 1).some(entry =>
    entry.stream === 'stderr' && entry.text.trim() !== 'O processo terminou com código '+process.exitCode+'.'
    || /Erro durante a execução|Traceback/.test(entry.text));
  return fatalAfterPartial ? process : {...process,status:'partial',lastError:'',logs:logs.map(entry =>
    entry.stream === 'stderr' && entry.text.trim() === 'O processo terminou com código '+process.exitCode+'.'
      ? {...entry,stream:'system',text:'Busca finalizada com pendências. O próximo início retoma somente as consultas que faltam.'}
      : entry)};
}

export function searchRunLabel(run) {
  if (run.stopped) return 'Interrompida';
  if (run.outcome === 'partial' || (!run.outcome && [1,2].includes(run.exitCode) && run.metrics?.status === 'parcial')) return 'Finalizada com pendências';
  return run.exitCode === 0 ? 'Finalizada' : 'Com erro';
}
