import { useEffect, useState } from 'react';
import { legacyLink } from './model.js';

const paths = { overview: '/app-next/dashboard', funnel: '/app-next/funnel', leads: '/app-next/leads', copies:'/app-next/copies',messages:'/app-next/messages',search:'/app-next/search',ai:'/app-next/ai' };
export function pageLink(view = 'overview', attention, status) {
  if (!paths[view]) return legacyLink(view, attention, status) + '&from=next';
  const query = new URLSearchParams();
  if (attention) query.set('attention', attention);
  if (status) query.set('status', status);
  return paths[view] + (query.size ? '?' + query : '');
}
function readRoute() {
  return { view: Object.keys(paths).find(key => paths[key] === location.pathname.replace(/\/$/, '')) || 'overview', search: location.search };
}
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const changed = () => setRoute(readRoute());
    const click = event => {
      const link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !Object.values(paths).includes(url.pathname.replace(/\/$/, ''))) return;
      event.preventDefault(); history.pushState(null, '', url.pathname + url.search); changed();
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    document.addEventListener('click', click); window.addEventListener('popstate', changed);
    return () => { document.removeEventListener('click', click); window.removeEventListener('popstate', changed); };
  }, []);
  return route;
}
