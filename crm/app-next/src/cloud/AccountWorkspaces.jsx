import React from 'react';
export function AccountWorkspaces({busy,capabilities,spaces,spacesFailed,reloadSpaces,selected,selectWorkspace,createWorkspace,openPanel,initial=false}){
  const destination=selected||spaces.find(space=>space.role==='owner')||spaces[0];
  return <section className="account-section account-workspaces"><h2>Suas empresas</h2>
    <p className="account-hint account-workspace-guide">Cada empresa reúne seus próprios contatos, copys e configurações. Escolha qual deseja abrir.</p>
    {spacesFailed?<div className="account-inline-error"><p>Não foi possível atualizar suas empresas.</p><button disabled={busy} onClick={reloadSpaces}>Tentar carregar empresas</button></div>:spaces.length?<ul>{spaces.map(space=><li key={space.id}><button disabled={busy} aria-pressed={selected?.id===space.id} onClick={()=>selectWorkspace(space.id)}><span>{space.name}</span><small>{space.role==='owner'?'Responsável':space.role==='editor'?'Editor':'Leitura'}</small></button></li>)}</ul>:<p>Cadastre sua empresa para começar.</p>}
    {destination&&capabilities.localPanel&&!capabilities.desktopPending&&<div className="account-entry"><button className="primary" disabled={busy||spacesFailed} onClick={()=>openPanel(destination.id)}>Entrar no painel</button>{initial&&<small>Nas próximas aberturas, entraremos direto nesta empresa.</small>}</div>}
    <details className="account-add-workspace" open={spaces.length===0}><summary>{spaces.length?'Adicionar outra empresa':'Cadastrar empresa'}</summary><form onSubmit={createWorkspace}><label>Nome da empresa<input name="name" autoComplete="organization" maxLength="80" required disabled={busy}/></label><button disabled={busy}>Adicionar empresa</button></form></details>
  </section>;
}
