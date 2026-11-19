import React from 'react';
const paths = {
  account:<><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
  settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
  security:<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zm-4 9 3 3 5-6"/>,
  overview: <path d="M4 5h6v6H4zM14 5h6v10h-6zM4 15h6v4H4zM14 19h6" />,
  funnel: <path d="M3 5h18l-4 5H7L3 5zm5 8h8l-3 6h-2l-3-6z" />,
  leads: <><circle cx="8" cy="8" r="3" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="17" r="2.5" /><path d="m11 8 5-1m-5 3 5 5M3 20v-3a5 5 0 0 1 9-3" /></>,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M10 7v6m-3-3h6" /></>,
  messages: <path d="M4 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V5zm3 4h10M7 13h6" />,
  ai: <><rect x="5" y="6" width="14" height="13" rx="4" /><path d="M12 3v3M2 11h3m14 0h3M9 15h6m-6-4h1m4 0h1" /></>,
  copies: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V4H4v11h4" /></>,
  ads: <path d="m4 9 12-5v16L4 15V9zm4 7 1 5h3l-1-4m8-10 2 5-2 5" />,
  trend: <path d="m3 18 6-6 4 3 8-10m-6 0h6v6" />,
  pulse: <path d="M2 12h5l3-7 4 14 3-7h5" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m14 7-5 5 5 5" />,
  play:<path d="m8 5 11 7-11 7V5z"/>,
  pause:<path d="M8 5v14M16 5v14"/>,
  stop:<rect x="6" y="6" width="12" height="12" rx="1"/>,
  terminal:<path d="m4 6 6 6-6 6m9 0h7"/>,
};
export function Icon({ name }) { return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.overview}</svg>; }
