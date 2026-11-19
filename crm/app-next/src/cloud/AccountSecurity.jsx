import React from 'react';
export function AccountSecurity({busy,capabilities,security,setView,toggleEmailSecurity}){
  return <section className="account-section account-security"><h2>Proteção da conta</h2><p>Verificação por e-mail: <strong>{security.email2fa?'ativada':'desativada'}</strong></p>
    <div className="account-actions"><button disabled={busy} onClick={()=>setView('password')}>Trocar senha</button><button disabled={busy||!capabilities.email2fa} aria-describedby={!capabilities.email2fa?'email-security-pending':undefined} onClick={()=>toggleEmailSecurity(!security.email2fa)}>{security.email2fa?'Desativar código por e-mail':'Ativar código por e-mail'}</button></div>
    {!capabilities.email2fa&&<p id="email-security-pending" className="account-hint">O código por e-mail ficará disponível após a configuração do servidor.</p>}
  </section>;
}
