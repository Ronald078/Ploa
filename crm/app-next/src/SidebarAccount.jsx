import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './icons.jsx';
import {ACCOUNT_PAGES} from './account-pages.js';
import './sidebar-account.css';

export function SidebarAccount({context,visible=true,collapsed=false}){
  const [expanded,setExpanded]=useState(false),[position,setPosition]=useState({});
  const trigger=useRef(null),popover=useRef(null);
  const account=context.account,name=account.businessName||account.name||'Minha conta';
  const role=account.administrator?'Administrador':account.role==='owner'?'Responsável':account.role==='editor'?'Editor':'Leitura';
  useEffect(()=>{if(!visible)setExpanded(false);},[visible,collapsed]);
  useLayoutEffect(()=>{
    if(!expanded)return;
    const rect=trigger.current.getBoundingClientRect(),width=Math.min(294,innerWidth-32);
    setPosition({width,left:Math.max(16,Math.min(rect.left,innerWidth-width-16)),bottom:Math.max(16,innerHeight-rect.top+10)});
    popover.current?.querySelector('a')?.focus();
  },[expanded]);
  useEffect(()=>{
    if(!expanded)return;
    const outside=event=>{if(!trigger.current?.contains(event.target)&&!popover.current?.contains(event.target))setExpanded(false);};
    const resize=()=>setExpanded(false);
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);};
  },[expanded]);
  function keyboard(event){if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();setExpanded(false);trigger.current?.focus();}}
  function blur(event){if(!trigger.current?.contains(event.relatedTarget)&&!popover.current?.contains(event.relatedTarget))setExpanded(false);}
  return <div className="sidebar-account" onKeyDown={keyboard} onBlur={blur}>
    <button ref={trigger} type="button" className="sidebar-account-trigger" aria-label={'Conta de '+name} title={'Conta de '+name} aria-haspopup="dialog" aria-expanded={expanded} aria-controls="ploa-account-popover" onClick={()=>setExpanded(value=>!value)}>
      <span className="sidebar-account-brand" aria-hidden="true"><img src="/assets/ploa-logo-transparent.png" alt="" width="32" height="32"/><span className="sidebar-account-brand-copy"><strong>Fluxo local</strong><small>Buscar, conversar e vender</small></span></span>
      <span className="sidebar-account-track" aria-hidden="true"><i/><i/><i/></span>
      <span className="sidebar-account-owner"><span className="sidebar-account-label"><strong>{name}</strong><small>Conta e configurações</small></span><span className="sidebar-account-chevron"><Icon name="chevron"/></span></span>
    </button>
    {expanded&&createPortal(<section ref={popover} id="ploa-account-popover" className="sidebar-account-popover" role="dialog" aria-label="Sua conta" style={position} onKeyDown={keyboard}>
      <div className="sidebar-account-details"><strong>{name}</strong><span>{account.email}</span><small>{role}</small></div>
      <a href={ACCOUNT_PAGES.details.path}><Icon name="account"/>Detalhes da conta</a>
      <a href={ACCOUNT_PAGES.settings.path}><Icon name="settings"/>Configurações</a>
      <a href={ACCOUNT_PAGES.security.path}><Icon name="security"/>Segurança do acesso</a>
    </section>,document.body)}
  </div>;
}
