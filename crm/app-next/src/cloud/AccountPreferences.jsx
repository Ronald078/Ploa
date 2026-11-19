import React from 'react';
export function AccountPreferences({motion,busy,saveMotion,preferenceNotice}){
  return <section className="account-section account-preferences"><h2>Aparência e movimento</h2><label>Animações da área de acesso<select value={motion} disabled={busy} onChange={event=>saveMotion(event.target.value)}><option value="system">Seguir o dispositivo</option><option value="reduced">Reduzir animações</option></select></label><p className="account-hint">Esta escolha vale apenas neste navegador e não altera o painel comercial.</p>{preferenceNotice&&<p className="account-hint" role="status">{preferenceNotice}</p>}</section>;
}
