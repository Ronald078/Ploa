import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {actionOrigin} from './action-origin.js';

export const SUCCESS_NOTICE_MS = 3000;

function InlineSuccess({notice}) {
  const [expired,setExpired]=useState(null),caption=useRef(null);
  const source=useMemo(()=>notice.source||actionOrigin(),[notice]);
  const visible=expired!==notice&&source?.isConnected&&!source.closest('[hidden]');
  useEffect(()=>{const timer=setTimeout(()=>setExpired(notice),SUCCESS_NOTICE_MS);return()=>clearTimeout(timer);},[notice]);
  useLayoutEffect(()=>{
    if(!visible||!caption.current)return;
    const oldMargin=source.style.marginBottom,oldLabel=source.getAttribute('aria-label');
    const minimum=parseFloat(getComputedStyle(source).marginBottom)||0;
    if(oldLabel===null)source.setAttribute('aria-label',[...source.childNodes].filter(node=>node!==caption.current).map(node=>node.textContent).join('').trim());
    source.classList.add('ploa-has-feedback');
    const reserve=()=>{source.style.marginBottom=Math.max(minimum,caption.current?.getBoundingClientRect().height+8||0)+'px';};
    reserve();const observer=new ResizeObserver(reserve);observer.observe(caption.current);
    return()=>{observer.disconnect();source.classList.remove('ploa-has-feedback');source.style.marginBottom=oldMargin;if(oldLabel===null)source.removeAttribute('aria-label');};
  },[source,visible,notice]);
  if(!visible)return null;
  const text=/salv|registrad|cadastrad|adicionad|atualizad/i.test(notice.text||'')?'Salvo com sucesso.':'Concluído com sucesso.';
  return createPortal(<span ref={caption} className="ploa-action-success" role="status" aria-live="polite">{text}</span>,source);
}

export function OperationNotice({ notice }) {
  if(!notice)return null;
  return notice.error?<div className="next-notice next-error" role="alert">{notice.text}</div>:<InlineSuccess notice={notice}/>;
}
