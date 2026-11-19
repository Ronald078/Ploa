import React from 'react';
import {AccountWorkspaces} from './AccountWorkspaces.jsx';
export function AccountProfile(props){
  const {user,busy,capabilities,completeDesktop,logout}=props;
  return <><section className="account-section account-identity"><p>Seu acesso está vinculado ao e-mail <strong>{user.email}</strong>.</p>{capabilities.desktopPending?<div className="account-actions"><button disabled={busy} onClick={completeDesktop}>Concluir entrada no aplicativo</button></div>:null}</section>
    <AccountWorkspaces {...props} initial/>
    <footer><button disabled={busy} onClick={logout}>Sair da conta</button></footer>
  </>;
}
