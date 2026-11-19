import { useRef, useState } from 'react';
import { actionOrigin } from './action-origin.js';

export async function requestJson(url, method = 'GET', body, signal) {
  const response = await fetch(url, {
    method, signal, cache: 'no-store', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.erro || result.error || 'Não foi possível concluir a operação. Tente novamente.');
  return result;
}

export function useCommand(refresh) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(null), lock = useRef(false);
  async function run(url, method, body, message = 'Alterações salvas.') {
    if (lock.current) return { ok: false };
    const source = actionOrigin();
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const value = await requestJson(url, method, body);
      await refresh?.(); setNotice(message ? { text: message, error: false, source } : null);
      return { ok: true, value };
    } catch (error) {
      setNotice({ text: error.message === 'Failed to fetch' ? 'A conexão foi interrompida. Confira o registro antes de tentar novamente. Seu rascunho foi preservado.' : error.message, error: true });
      return { ok: false };
    } finally { lock.current = false; setBusy(false); }
  }
  return { run, busy, notice, setNotice };
}

export const scriptsRunning = processes => Object.entries(processes || {}).some(([id,item]) => id !== 'whatsapp' && item.running);
export const anyRunning = processes => Object.values(processes || {}).some(item => item.running);
