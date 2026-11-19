import React, { useState } from 'react';
import {PASSWORD_RULE,PASSWORD_PATTERN} from '../../../lib/password-policy.mjs';
export function PasswordField({ name = 'password', label = 'Senha', fresh = false, busy }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="account-password"><input name={name} aria-label={label} type={visible ? 'text' : 'password'} autoComplete={fresh ? 'new-password' : 'current-password'} minLength={fresh ? 8 : undefined} pattern={fresh?PASSWORD_PATTERN:undefined} title={fresh?PASSWORD_RULE:undefined} maxLength="1024" onInput={event => event.currentTarget.setCustomValidity('')} required disabled={busy} />
    <button type="button" onClick={() => setVisible(value => !value)} aria-pressed={visible} aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`} disabled={busy}>{visible ? 'Ocultar' : 'Mostrar'}</button></span></label>;
}
export function AccessForms({ view, busy, remember, setRemember, capabilities, setView, submit, google, challenge, pendingEmail, resendSeconds = 0, signupPending, signupComplete, openSignupConfirmation, editSignup }) {
  if (view === 'signup' && signupComplete) return <section className="account-section">
    <h2>E-mail confirmado</h2><p>Seu cadastro está confirmado. Entre com o e-mail e a senha que você escolheu para acessar sua conta.</p>
    <button type="button" className="primary" disabled={busy} onClick={() => setView('login')}>Entrar na minha conta</button>
  </section>;
  if (view === 'challenge') return <form onSubmit={event => submit(event, 'verify-email')}>
    <p>{challenge?.expired ? 'Entre novamente para solicitar um novo código.' : <>Digite o código de seis números enviado para <strong>{challenge?.email}</strong>. Ele vale por cinco minutos.</>}</p>
    <label>Código de acesso<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength="6" maxLength="6" required disabled={busy || challenge?.expired} /></label>
    {!challenge?.expired && <button className="primary" disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar código'}</button>}
    <button type="button" className={challenge?.expired ? 'primary' : 'account-link'} disabled={busy} onClick={() => setView('login', true)}>{challenge?.expired ? 'Reiniciar acesso' : 'Voltar ao acesso'}</button></form>;
  if (view === 'signup' && signupPending) return <>
    <form onSubmit={event => submit(event, 'resend')}>
      <p className="account-hint">Confirme o cadastro pelo link enviado ao seu e-mail. Se precisar de outro link, solicite abaixo. Depois da confirmação, entre com sua senha.</p>
      <label>E-mail do cadastro<input name="email" defaultValue={pendingEmail} type="email" autoComplete="username" maxLength="254" required disabled={busy} /></label>
      <button className="primary" disabled={busy || resendSeconds > 0}>{busy ? 'Solicitando…' : resendSeconds > 0 ? `Reenviar em ${resendSeconds}s` : 'Reenviar confirmação'}</button>
      <p className="account-hint">Confira também o spam e use o e-mail mais recente. Se você já confirmou, não é necessário reenviar: escolha “Já confirmei, entrar”.</p>
    </form>
    <div className="account-actions account-back"><button type="button" className="account-link" disabled={busy} onClick={editSignup}>Voltar aos dados do cadastro</button><button type="button" className="account-link" disabled={busy} onClick={() => setView('login')}>Já confirmei, entrar</button></div>
  </>;
  if (view === 'password' || view === 'reset') return <form onSubmit={event => submit(event, 'password')}>
    {view === 'password' && <PasswordField name="currentPassword" label="Senha atual" busy={busy} />}
    <PasswordField label="Nova senha" fresh busy={busy} /><PasswordField name="confirmPassword" label="Confirmar nova senha" fresh busy={busy} />
    <p className="account-hint">{PASSWORD_RULE} A nova senha deve ser diferente da senha atual. Após salvar, entre novamente com a nova senha.</p>
    <button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
    {view === 'password' && <button type="button" className="account-link" disabled={busy} onClick={() => setView('profile')}>Cancelar</button>}</form>;
  return <><form onSubmit={event => submit(event, view === 'signup' ? 'signup' : view === 'recover' ? 'recover' : 'login')}>
    <label>E-mail<input name="email" defaultValue={pendingEmail} type="email" autoComplete="username" maxLength="254" required disabled={busy} /></label>
    {view !== 'recover' && <PasswordField busy={busy} fresh={view === 'signup'} />}
    {view === 'signup' && <><PasswordField name="confirmPassword" label="Confirmar senha" fresh busy={busy} /><p className="account-hint">{PASSWORD_RULE} Confirme seu e-mail após o cadastro.</p></>}
    {view === 'login' && <div className="account-options"><label className="account-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={busy || !capabilities.remember} />Lembrar de mim</label>
      <button type="button" className="account-link" disabled={busy} onClick={() => setView('recover')}>Esqueci minha senha</button></div>}
    {view==='login'&&remember&&<p className="account-hint">Mantém sua conta conectada ao fechar o Ploa. Ao sair da conta, você tem 10 minutos para entrar novamente neste dispositivo sem repetir o código por e-mail; senha ou Google continuam necessários.</p>}
    <button className="primary" disabled={busy || view === 'signup' && !capabilities.signup}>{busy ? 'Aguarde…' : view === 'signup' ? 'Criar conta' : view === 'recover' ? 'Enviar instruções' : 'Entrar'}</button>
    {view === 'signup' && <button type="button" className="account-link" disabled={busy} onClick={event => openSignupConfirmation(new FormData(event.currentTarget.form).get('email'))}>Já criei a conta: confirmar e-mail</button>}</form>
    {view === 'login' && <><button type="button" className="account-google" disabled={busy || !capabilities.google} aria-describedby={!capabilities.google ? 'google-pending' : undefined} onClick={google}><span aria-hidden="true">G</span>Continuar com Google</button>
      {!capabilities.google && <p id="google-pending" className="account-hint account-provider-hint">Google ainda não está disponível. Use seu e-mail e senha.</p>}
      {capabilities.signup ? <p className="account-switch">Ainda não tem conta? <button type="button" className="account-link" disabled={busy} onClick={() => setView('signup')}>Criar conta</button></p> : <p className="account-hint account-provider-hint">Novos cadastros estão indisponíveis no momento.</p>}</>}
    {view !== 'login' && <button type="button" className="account-link account-back" disabled={busy} onClick={() => setView('login')}>Voltar para entrar</button>}</>;
}
