import React from 'react';
import {ACCOUNT_PAGES} from '../account-pages.js';
import {AccountWorkspaces} from './AccountWorkspaces.jsx';
import {AccountSecurity} from './AccountSecurity.jsx';
import {AccountPreferences} from './AccountPreferences.jsx';
import {AccountPermissions} from './AccountPermissions.jsx';
export function AccountPages(props){
  const {page,user,busy,spaces,selected,spacesFailed,capabilities,openPanel,logout}=props;
  const destination=selected||spaces.find(space=>space.role==='owner')||spaces[0];
  return <>
    <div className="account-page-toolbar"><nav className="account-page-nav" aria-label="Páginas da conta">{Object.entries(ACCOUNT_PAGES).map(([key,item])=><a key={key} href={item.path} aria-current={page===key?'page':undefined}>{key==='details'?'Minha conta':key==='settings'?'Configurações':'Segurança'}</a>)}</nav>
      {capabilities.localPanel&&destination?<button disabled={busy||spacesFailed} onClick={()=>openPanel(destination.id)}>Voltar ao painel</button>:<a className="account-page-return" href="/">Escolher empresa</a>}
    </div>
    <div className={'account-page-content account-page-content--'+page}>
      {page==='details'?<><section className="account-section account-details"><h2>Dados do acesso</h2><dl><dt>E-mail da conta</dt><dd>{user.email}</dd><dt>Empresas vinculadas</dt><dd>{spacesFailed?'Não foi possível conferir':spaces.length}</dd></dl><p className="account-hint">Os dados e as configurações de cada empresa ficam separados.</p></section><AccountWorkspaces {...props}/></>:null}
      {page==='settings'?<><AccountPreferences {...props}/><AccountPermissions key={user.id}/></>:null}
      {page==='security'?<><AccountSecurity {...props}/><section className="account-section account-security-help"><h2>Entradas lembradas</h2><p>Com Lembrar de mim, fechar o Ploa mantém sua sessão. Ao sair da conta, você tem dez minutos para entrar novamente no mesmo dispositivo sem repetir o código por e-mail.</p><p className="account-hint">Senha ou Google continuam necessários. Alterar a senha ou a verificação por e-mail invalida essa confirmação temporária.</p></section></>:null}
    </div>
    <footer><button disabled={busy} onClick={logout}>Sair da conta</button></footer>
  </>;
}
