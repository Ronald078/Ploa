import {useOperatorName} from './operator-context.jsx';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { pageLink } from './navigation.js';
import {SidebarAccount} from './SidebarAccount.jsx';

const groups = [
  ['Análise', [['overview', 'Dashboard', 'Resultado e prioridades'], ['funnel', 'Funil', 'Etapas e conversão'], ['leads', 'Leads', 'Fila e acompanhamento']]],
  ['Operação', [['search', 'Buscar leads', 'Coleta no OpenStreetMap'], ['messages', 'Mensagens', 'Progresso dos envios'], ['ai', 'IA', 'Atendimento e orientações'], ['copies', 'Copys', 'Mensagens por país e categoria']]],
  ['Laboratório', [['ads', 'Anúncios', 'Mineração de criativos']]],
];
const readCollapsed = () => { try { return localStorage.getItem('ploa-collapsed') === 'true'; } catch { return false; } };
const titles = Object.fromEntries(groups.flatMap(([,items]) => items.map(([id,title,description]) => [id,{title,description}])));

export function Shell({ children, busy, syncLabel, refresh, view = 'overview',account }) {
  const operator=useOperatorName();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 860px)').matches);
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null), sidebar = useRef(null);
  useLayoutEffect(() => {
    document.body.classList.toggle('ploa-collapsed', collapsed);
    document.body.classList.toggle('ploa-mobile-menu-open', mobile && open);
  }, [collapsed, mobile, open]);
  useEffect(() => {
    const query = matchMedia('(max-width: 860px)');
    const change = () => { setMobile(query.matches); setOpen(false); };
    query.addEventListener('change', change);
    const frame = requestAnimationFrame(() => document.body.classList.add('ploa-sidebar-ready'));
    return () => { query.removeEventListener('change', change); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    if (mobile && open) sidebar.current?.querySelector('[aria-current="page"]')?.focus();
  }, [mobile, open]);
  useEffect(() => { setOpen(false); document.body.dataset.view = view; document.title = (titles[view]?.title || 'Ploa') + ' · Ploa'; }, [view]);
  function closeMenu() { setOpen(false); menuButton.current?.focus(); }
  function keyboard(event) {
    if (!mobile || !open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    if (event.key === 'Tab') {
      const controls = [...sidebar.current.querySelectorAll('a[href],button'),...document.querySelectorAll('#ploa-account-popover a[href]')].filter(item => item.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  function toggleCollapsed() {
    const next = !collapsed; setCollapsed(next);
    try { localStorage.setItem('ploa-collapsed', String(next)); } catch { /* Optional preference. */ }
  }
  return <>
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <div className="app-frame">
      <button type="button" className="button ploa-mobile-backdrop" aria-label="Fechar menu" tabIndex={-1} onClick={closeMenu} />
      <aside className="sidebar" ref={sidebar} aria-label="Navegação principal" aria-hidden={mobile ? !open : undefined} inert={mobile && !open} onKeyDown={keyboard}>
        <button type="button" className="button ploa-mobile-menu-close" aria-label="Fechar menu" onClick={closeMenu}>×</button>
        <div className="ploa-sidebar-header">
          <div className="sidebar-brand">
            <img className="brand-logo" src="/assets/ploa-logo-transparent.png" alt="" width="46" height="46" />
            <div><p className="product-name">Ploa</p><p className="product-context">Operação e vendas</p></div>
          </div>
          <div className="ploa-sidebar-tools">
            <button className="button ploa-collapse" type="button" aria-controls="ploa-side-nav" aria-expanded={!collapsed} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={collapsed ? 'Expandir menu' : 'Recolher menu'} onClick={toggleCollapsed}>
              <span className="ploa-collapse-icon"><Icon name="chevron" /></span><span className="ploa-collapse-label">{collapsed ? 'Expandir menu' : 'Recolher menu'}</span>
            </button>
          </div>
        </div>
        <div className="sidebar-welcome"><span>Bem-vindo de volta</span><strong>{account?.account?.name||operator}</strong><p>Sua prospecção em um só lugar.</p></div>
        <nav className="side-nav" id="ploa-side-nav" aria-label="Módulos do painel">
          {groups.map(([group, items]) => [group,items.filter(([id])=>!account||account.account.modules[id==='overview'?'dashboard':id])]).filter(([,items])=>items.length).map(([group, items]) => <React.Fragment key={group}>
            <p className="nav-heading">{group}</p>
            {items.map(([id, name, description]) => <a className="nav-item" key={id} href={pageLink(id)} onClick={() => setOpen(false)} aria-current={id === view ? 'page' : undefined} aria-label={name} title={name}>
              <span className="nav-icon"><Icon name={id} /></span><span><strong>{name}</strong><small>{description}</small></span>
            </a>)}
          </React.Fragment>)}
        </nav>
        {account?<SidebarAccount context={account} visible={!mobile||open} collapsed={collapsed}/>:<div className="sidebar-flow" aria-hidden="true"><div className="sidebar-flow-brand"><img src="/assets/ploa-logo-transparent.png" alt="" width="26" height="26" /><span><strong>Fluxo local</strong><small>Buscar, conversar e vender</small></span></div><div className="sidebar-flow-track"><i/><i/><i/></div></div>}
      </aside>
      <div className="app-shell" inert={mobile && open}>
        <header className={'topbar'+(account?' next-account-topbar':'')}>
          <button type="button" ref={menuButton} className="button ploa-mobile-menu-button" aria-label="Abrir menu" aria-controls="ploa-side-nav" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="view-heading"><div className="breadcrumb"><span>Operação</span><i>/</i><p>{titles[view]?.description}</p></div><h1>{titles[view]?.title}</h1></div>
          <div className="topbar-actions"><p className="sync-status" role="status">{syncLabel}</p><button type="button" className="button button-secondary" disabled={busy} aria-busy={busy} onClick={refresh}>{busy ? 'Atualizando…' : 'Atualizar dados'}</button></div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  </>;
}
