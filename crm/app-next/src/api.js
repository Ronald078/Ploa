import { useEffect, useRef, useState } from 'react';

async function readJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  if(response.status===401){location.assign('/');throw new Error('Entre novamente para continuar.');}
  if (!response.ok) throw new Error('Não foi possível atualizar os dados. Tente novamente.');
  return response.json();
}

export function useDashboard(view = 'overview',enabled=true,scope='') {
  const [state, setState] = useState({ data: null, busy: true, error: '' });
  const refresh = useRef(() => {});
  useEffect(() => {
    if(!enabled)return;
    let active = true, controller;
    const cache = new Map(), loadedAt = new Map();
    async function load(force = false) {
      if (controller && !controller.signal.aborted) return;
      const request = new AbortController(); controller = request;
      setState(previous => ({ ...previous, busy: true }));
      try {
        const resources = view === 'copies' ? ['copies','settings','processes','workspace','report','searchPlan'] : view === 'messages' ? ['processes','operations','settings','workspace'] : view === 'search' ? ['processes','operations','settings','searchPlan','report'] : view === 'ai' ? ['workspace','processes','aiTests','triage','dashboard','searchPlan'] : ['dashboard','report','operations',...(view === 'funnel' ? ['copies'] : view === 'leads' ? ['workspace'] : [])];
        const endpoints = {report:'reports',searchPlan:'search-plan',aiTests:'ai-tests'};
        const frequent = view === 'ai' ? ['workspace','aiTests','processes','triage'] : ['processes','operations'];
        const requested = resources.filter(name => force || !cache.has(name) || (view === 'leads') || frequent.includes(name) || Date.now() - loadedAt.get(name) >= 30000);
        const values = await Promise.all(requested.map(name => readJson('/api/' + (endpoints[name] || name),request.signal)));
        if (active && !request.signal.aborted) {
          requested.forEach((name,index) => {cache.set(name,values[index]);loadedAt.set(name,Date.now());});
          setState({ data: Object.fromEntries(resources.map(name => [name,cache.get(name)])), view, scope, busy: false, error: '' });
        }
      } catch (error) {
        if (active && !request.signal.aborted) setState(previous => ({ ...previous, busy: false, error: error.message }));
      } finally {
        if (controller === request) controller = null;
      }
    }
    refresh.current = () => { controller?.abort(); return load(true); };
    const visibility = () => { if (document.hidden) controller?.abort(); else void load(true); };
    document.addEventListener('visibilitychange', visibility);
    if (!document.hidden) void load(true);
    const timer = setInterval(() => { if (!document.hidden) void load(); }, ['leads','messages','search','ai','copies'].includes(view) ? 5000 : 30000);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); refresh.current = () => {}; };
  }, [view,enabled,scope]);
  return { ...state, data: enabled&&state.view === view&&state.scope===scope ? state.data : null, refresh: () => refresh.current() };
}
