export function createAccountApi({ fetcher = fetch, timeout = 20000 } = {}) {
  return async function request(path, body, signal) {
    const deadline = AbortSignal.timeout(timeout);
    try {
      const response = await fetcher('/api/cloud/' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      let result;
      try { result = await response.json(); } catch (failure) {
        if (deadline.aborted || signal?.aborted) throw failure;
        throw new Error('Não foi possível confirmar esta ação. Atualize a página antes de repetir.');
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Não foi possível confirmar os dados recebidos. Atualize a página.');
      if (!response.ok) throw Object.assign(new Error(result.error || 'Tente novamente.'), { status: response.status, code: result.code });
      return result;
    } catch (failure) {
      if (signal?.aborted) throw failure;
      if (deadline.aborted) throw new Error('A conexão demorou mais que o esperado. Atualize a página para conferir o resultado antes de repetir.');
      if (failure instanceof TypeError) throw new Error('Não foi possível conectar. Confira sua internet e atualize a página antes de repetir.');
      throw failure;
    }
  };
}
export const accountApi = createAccountApi();
