import React,{useEffect,useRef,useState} from 'react';
import {accountApi as api} from './account-api';
import {OperationNotice} from '../OperationNotice.jsx';
import {actionOrigin} from '../action-origin.js';
export function AccountPermissions(){
 const [access,setAccess]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');api('access',null,controller.signal).then(setAccess).catch(f=>{if(!controller.signal.aborted)setError(f.message);});return()=>controller.abort();},[retry]);
 return <section className="account-section account-permissions"><h2>Funções da conta</h2>
  {error&&<><p className="account-error" role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}>Conferir permissões novamente</button></>}
  {access&&<><ul className="account-module-list">{access.catalog.map(item=><li key={item.key}><span>{item.label}</span><strong className={access.modules[item.key]?'':'is-blocked'}>{access.modules[item.key]?'Liberada':'Bloqueada'}</strong></li>)}</ul>
   <p className="account-hint">As funções liberadas ficam disponíveis nas suas empresas.</p>
   {access.administrator&&<AccountAdministration catalog={access.catalog} refreshAccess={()=>setRetry(n=>n+1)}/>}</>}
 </section>;
}
function AccountAdministration({catalog,refreshAccess}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[page,setPage]=useState(0),[hasMore,setHasMore]=useState(false);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState(''),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState(0);const pending=useRef(false);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setBusy(true);
  api('admin/accounts?'+new URLSearchParams({search:filter,page:String(page)}),null,controller.signal).then(data=>{setRows(data.accounts);setHasMore(data.hasMore);setSelected(current=>current?data.accounts.find(a=>a.id===current.id)||null:null);})
   .catch(f=>{if(!controller.signal.aborted)setError(f.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();
 },[open,filter,page,attempt]);
 async function toggle(account,module){
  const source=actionOrigin();
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');
  try{await api('admin/features',{accountId:account.id,module,enabled:!account.modules[module]});setNotice({text:'Alteração salva.',source});}
  catch(f){setError(f.message);}
  finally{pending.current=false;setAttempt(n=>n+1);refreshAccess();}
 }
 return <details className="account-administration" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Administração · funções por conta</summary>
  <p className="account-hint">Novas contas começam com todas as funções liberadas. Alterações não apagam dados nem mudam configurações comerciais.</p>
  <form onSubmit={e=>{e.preventDefault();setError('');setFilter(query.trim());setPage(0);setAttempt(n=>n+1);setSelected(null);}}>
   <label>Pesquisar conta por e-mail<input type="search" value={query} maxLength={150} disabled={busy} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy}>Pesquisar contas</button>
  </form>
  {error&&<p className="account-error" role="alert">{error}</p>}<OperationNotice notice={notice}/>
  <ul className="account-managed-list">{rows.map(account=><li key={account.id}><button disabled={busy} aria-pressed={selected?.id===account.id} onClick={()=>setSelected(account)}><span>{account.email}</span><small>{account.administrator?'Administração':account.confirmed?'E-mail confirmado':'E-mail pendente'}</small></button></li>)}</ul>
  {!busy&&!rows.length&&<p>Nenhuma conta encontrada.</p>}
  <div className="account-actions"><button disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>Anterior</button><button disabled={busy||!hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</button></div>
  {selected&&<section className="account-managed-detail" aria-label={'Funções de '+selected.email}><h3>{selected.email}</h3><ul className="account-module-list">{catalog.map(item=><li key={item.key}><div><span>{item.label}</span><small>{selected.modules[item.key]?'Liberada':'Bloqueada'}</small></div><button disabled={busy} aria-label={(selected.modules[item.key]?'Bloquear ':'Liberar ')+item.label+' para '+selected.email} onClick={()=>toggle(selected,item.key)}>{selected.modules[item.key]?'Bloquear':'Liberar'}</button></li>)}</ul></section>}
 </details>;
}
