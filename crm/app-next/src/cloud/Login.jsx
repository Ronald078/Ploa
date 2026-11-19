import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { accountApi as api } from './account-api';
import { AccessForms } from './AccessForms';
import { AccountProfile } from './AccountProfile';
import { AccountPages } from './AccountPages.jsx';
import {ACCOUNT_PAGES,accountPageFromUrl} from '../account-pages.js';
import './cloud.css';
import '../action-feedback.css';
import {OperationNotice} from '../OperationNotice.jsx';
import {actionOrigin} from '../action-origin.js';
import {useDesktopLogin} from './useDesktopLogin.js';
import {initialAccessView} from './access-route.js';
import {preferredWorkspace,rememberWorkspace} from './panel-preference.js';
const titles = { login: 'Entre no Ploa', signup: 'Crie sua conta', recover: 'Recupere seu acesso', challenge: 'Confirme seu acesso', password: 'Troque sua senha', reset: 'Defina a nova senha', profile: 'Sua conta' };
const callbackNotices = { recovery_failed: 'Não foi possível validar este link neste navegador. Solicite um novo link por esta tela e abra o e-mail no mesmo navegador. Sua senha ainda não foi alterada.', welcome: 'Acesso confirmado.', email_code: 'Confira o código enviado para seu e-mail.', recovery: 'Confirmação recebida. Defina sua nova senha.', cancelled: 'O acesso foi cancelado. Você pode tentar novamente.', signup_confirmed: 'Para continuar, entre com o e-mail e a senha do cadastro.', callback_failed: 'Não foi possível concluir o acesso por este link. Se você confirmou o cadastro, tente entrar com sua senha: não é necessário confirmar de novo. Se a entrada indicar e-mail não confirmado, reenvie pela criação de conta. Para recuperar a senha, solicite um novo link.' };
function Login() {
  const accountPage=useRef(accountPageFromUrl(location.href)).current;
  const ProfileScreen=accountPage?AccountPages:AccountProfile;
  useEffect(()=>{document.documentElement.dataset.ploaAccountReady='true';},[]);
  const [user, setUser] = useState(null), [spaces, setSpaces] = useState([]), [selected, setSelected] = useState(null);
  const [view, changeView] = useState(()=>initialAccessView(location.href)), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true), [remember, setRemember] = useState(()=>{
    const choice=new URL(location.href).searchParams.get('desktop_remember');
    if(choice!==null)return choice==='1';
    try{return localStorage.getItem('ploa.access.remember.v1')==='1';}catch{return false;}
  }), [challenge, setChallenge] = useState(null);
  // Only the checkbox preference lives here. Authentication and 2FA proof stay HttpOnly.
  useEffect(()=>{try{localStorage.setItem('ploa.access.remember.v1',remember?'1':'0');}catch{}},[remember]);
  const [security, setSecurity] = useState({ email2fa: false }), [capabilities, setCapabilities] = useState({ remember: false, google: false, signup: false, email2fa: false });
  const desktop=useDesktopLogin({available:capabilities.desktopLogin,onError:setError});
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0), [bootstrapFailed, setBootstrapFailed] = useState(false), [spacesFailed, setSpacesFailed] = useState(false);
  const [motion, setMotion] = useState(() => { try { return localStorage.getItem('ploa.access.motion.v1') === 'reduced' ? 'reduced' : 'system'; } catch { return 'system'; } });
  const [preferenceNotice, setPreferenceNotice] = useState('');
  const [savedNotice,setSavedNotice]=useState(null),actionSource=useRef(null);
  const saved=text=>setSavedNotice({text,source:actionSource.current});
  useEffect(()=>{if(!preferenceNotice.startsWith('Preferência salva'))return;const timer=setTimeout(()=>setPreferenceNotice(''),3000);return()=>clearTimeout(timer);},[preferenceNotice]);
  const [signupPending, setSignupPending] = useState(false), [signupComplete, setSignupComplete] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(''), [resendUntil, setResendUntil] = useState(0), [resendSeconds, setResendSeconds] = useState(0);
  useEffect(() => { if (!resendUntil) return; const tick = () => setResendSeconds(Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000))); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [resendUntil]);
  const heading = useRef(null), inFlight = useRef(false);
  const accountRequested=useRef(Boolean(accountPage)),autoEntry=useRef('');
  const openPanel=useCallback(async workspaceId=>{
    const result=await api('panel/open',{workspaceId});
    try{rememberWorkspace(localStorage,user?.id,workspaceId);}catch{}
    location.assign(result.url);
  },[user?.id]);
  useEffect(()=>{
    if(busy||bootstrapFailed||spacesFailed||view!=='profile'||!user||!capabilities.localPanel||capabilities.desktopPending||accountRequested.current||accountPage)return;
    let workspaceId;try{workspaceId=preferredWorkspace(localStorage,user.id,spaces);}catch{return;}
    const attempt=user.id+':'+workspaceId;
    if(!workspaceId||autoEntry.current===attempt)return;
    autoEntry.current=attempt;
    action(()=>openPanel(workspaceId));
  },[busy,bootstrapFailed,spacesFailed,view,user?.id,spaces,capabilities.localPanel,capabilities.desktopPending,openPanel,accountPage]);
  async function loadSpaces(signal) {
    try { setSpaces((await api('workspaces', null, signal)).workspaces); setSpacesFailed(false); }
    catch (failure) { if (!signal?.aborted) setSpacesFailed(true); throw failure; }
  }
  function clearUser(nextView='login') { autoEntry.current='';setUser(null); setSpaces([]); setSelected(null); setChallenge(null); changeView(nextView); }
  async function accept(result, signal) {
    if (result.signupConfirmed) { setUser(null); setSpaces([]); setSelected(null); setChallenge(null); setSignupPending(false); setSignupComplete(true); changeView('signup'); setNotice('E-mail confirmado. Agora entre na sua conta.'); return; }
    if (result.challenge) { setChallenge(result.challenge); changeView('challenge'); return; }
    if (result.user) {
      if(result.mode!=='recovery'&&typeof result.remember==='boolean')setRemember(result.remember);
      setUser(result.user); setChallenge(null); setSecurity(result.security || { email2fa: false });
      changeView(result.mode === 'recovery' ? 'reset' : 'profile');
      if (result.mode !== 'recovery') await loadSpaces(signal);
    }
    if (result.signedOut) clearUser();
  }
  useEffect(() => {
    const controller = new AbortController(), outcome = new URL(location.href).searchParams.get('notice');
    const requestedView=initialAccessView(location.href)==='login'?view:initialAccessView(location.href);
    setBusy(true); setBootstrapFailed(false); setError('');
    if (outcome) { setNotice(callbackNotices[outcome] || ''); history.replaceState(null, '', '/'); }
    Promise.allSettled([api('capabilities', null, controller.signal), api('session', null, controller.signal)]).then(async results => {
      if (controller.signal.aborted) return;
      if (results[0].status === 'fulfilled') setCapabilities(results[0].value);
      else { setBootstrapFailed(true); setError('Não foi possível conferir as opções de acesso. Tente conectar novamente.'); }
      if (results[1].status === 'fulfilled') {
        if(requestedView==='recover'&&results[1].value.mode!=='recovery')clearUser('recover');
        else await accept(results[1].value, controller.signal);
      }
      else if (results[1].reason.status === 401) {
        clearUser(['recover','reset'].includes(requestedView)?'recover':'login');
        if(requestedView==='reset')setNotice('Este link não pôde ser validado ou expirou. Solicite um novo link por esta tela e abra-o no mesmo navegador. Sua senha ainda não foi alterada.');
      }
      else if (results[1].reason.name !== 'AbortError') { setBootstrapFailed(true); setError(results[1].reason.message); }
    }).catch(failure => { if (failure.name !== 'AbortError') setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [bootstrapAttempt]);
  const pageTitle=view==='profile'?(accountPage?ACCOUNT_PAGES[accountPage].title:'Escolha sua empresa'):titles[view];
  let selectedWorkspace=selected;
  if(!selectedWorkspace&&user){try{const id=preferredWorkspace(localStorage,user.id,spaces);selectedWorkspace=spaces.find(space=>space.id===id)||null;}catch{}}
  useEffect(() => { document.title = (pageTitle || 'Sua conta') + ' · Ploa'; heading.current?.focus({ preventScroll: true }); }, [pageTitle]);
  async function action(work) {
    if (inFlight.current) return;
    actionSource.current=actionOrigin();setSavedNotice(null);
    inFlight.current = true;
    setError(''); setNotice(''); setBusy(true);
    try { await work(); } catch (failure) {
      if (failure.status === 401 || failure.code === 'email_required') clearUser();
      if (['email_expired', 'email_attempts'].includes(failure.code)) setChallenge(value => ({ ...value, expired: true }));
      if (failure.code === 'email_not_confirmed') { setSignupPending(true); changeView('signup'); }
      setError(failure.message);
    } finally { inFlight.current = false; setBusy(false); }
  }
  function setView(next, cancel = false) {
    if(next==='recover'&&desktop.enabled){action(()=>desktop.start(remember,'recovery'));return;}
    if (cancel) { action(async () => { await api('logout', {}); clearUser(); }); return; }
    setError(''); setNotice(''); if (next !== 'signup') setSignupComplete(false); changeView(next);
  }
  function submit(event, endpoint) {
    event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form));
    if(endpoint==='recover'&&desktop.enabled){action(()=>desktop.start(remember,'recovery'));return;}
    if(endpoint==='password'&&body.currentPassword&&body.password===body.currentPassword){
      form.elements.password.setCustomValidity('A nova senha deve ser diferente da senha atual.');form.elements.password.reportValidity();return;
    }
    if ('confirmPassword' in body && body.password !== body.confirmPassword) {
      form.elements.confirmPassword.setCustomValidity('As senhas precisam ser iguais.'); form.elements.confirmPassword.reportValidity(); return;
    }
    if (body.email) setPendingEmail(body.email);
    action(async () => {
      if (endpoint === 'resend') setResendUntil(Date.now() + 60000);
      const result = await api(endpoint, { ...body, remember }); form.reset();
      await accept(result); setNotice(result.message || 'Ação concluída.');
      if (endpoint === 'signup' && !result.user && !result.challenge) { setSignupPending(true); changeView('signup'); setResendUntil(Date.now() + 60000); }
    });
  }
  function createWorkspace(event) {
    event.preventDefault(); const form = event.currentTarget, name = new FormData(form).get('name');
    action(async () => { await api('workspaces', { name }); form.reset(); await loadSpaces(); saved('Empresa adicionada.'); });
  }
  function saveMotion(value) {
    setMotion(value);
    try { localStorage.setItem('ploa.access.motion.v1', value); setPreferenceNotice('Preferência salva neste navegador.'); }
    catch { setPreferenceNotice('Preferência aplicada nesta página. O navegador não permitiu salvá-la.'); }
  }
  return <main className={`account-layout${view === 'profile' && user ? ' account-layout--profile'+(accountPage?' account-layout--pages':' account-layout--onboarding') : ''}`} data-motion={motion}>
    <section className="account-brand" aria-label="Ploa"><img src="/assets/ploa-logo-transparent.png" alt="" width="64" height="64" /><span>Ploa</span><p>Sua operação, conectada.</p></section>
    <section className="account-panel" aria-busy={busy}><header className="account-panel-heading"><img className="account-panel-logo" src="/assets/ploa-logo-transparent.png" alt="Ploa" width="48" height="48" /><div><h1 ref={heading} tabIndex={-1}>{pageTitle}</h1><p>{view === 'profile' ? accountPage?ACCOUNT_PAGES[accountPage].description:'Escolha ou cadastre a empresa que deseja abrir.' : view === 'reset' ? 'Escolha uma nova senha para sua conta.' : user ? user.email : view === 'signup' ? signupComplete ? 'Cadastro confirmado. Seu acesso está pronto para entrar.' : signupPending ? 'Confirme seu e-mail para concluir o cadastro.' : 'Crie seu acesso e confirme seu e-mail.' : view === 'recover' ? 'Enviaremos um link para você definir uma nova senha.' : view === 'challenge' ? 'Mais uma etapa para proteger sua conta.' : 'Acesse com seu e-mail e sua senha.'}</p></div></header>
      {error && <p className="account-error" role="alert">{error}</p>}{notice && (view!=='profile'||notice.startsWith('Entrada autorizada.')) && <p className="account-notice" role="status">{notice}</p>}<OperationNotice notice={savedNotice}/>
      {bootstrapFailed && <button className="account-retry" disabled={busy} onClick={() => setBootstrapAttempt(value => value + 1)}>Tentar conectar novamente</button>}
      {view === 'profile' && user ? <ProfileScreen page={accountPage} user={user} capabilities={capabilities} motion={motion} saveMotion={saveMotion} preferenceNotice={preferenceNotice} busy={busy} spaces={spaces} spacesFailed={spacesFailed} reloadSpaces={() => action(() => loadSpaces())} selected={selectedWorkspace} security={security} createWorkspace={createWorkspace} setView={setView}
        selectWorkspace={id => action(async () => { setSelected((await api('workspaces/' + id)).workspace); saved('Seleção salva.'); })}
        openPanel={id=>action(()=>openPanel(id))}
        completeDesktop={()=>action(async()=>{await api('desktop/complete',{});accountRequested.current=true;setCapabilities(previous=>({...previous,desktopPending:false}));setNotice('Entrada autorizada. Volte à janela do Ploa para continuar.');})}
        toggleEmailSecurity={enabled => action(async () => { const result = await api('email-security', { enabled }); await accept(result); if(result.challenge)setNotice(result.message);else saved('Preferências salvas.'); })}
        logout={() => action(async () => { const result = await api('logout', {});accountRequested.current=false;clearUser(); setNotice(result.message); })} />
        : desktop.pending?<section className="account-section" role="status"><h2>{desktop.pending==='recovery'?'Recupere seu acesso no navegador':'Continue a entrada no navegador'}</h2><p>{desktop.pending==='recovery'?'Solicite o link no navegador que abriu, defina a nova senha e entre na sua conta. Depois clique em “Concluir entrada no aplicativo”.':'Entre na sua conta e clique em “Concluir entrada no aplicativo”. O Ploa continuará automaticamente nesta janela.'}</p><button disabled={busy} onClick={()=>action(desktop.cancel)}>Cancelar entrada</button></section>:<AccessForms key={view} view={view} busy={busy} remember={remember} setRemember={setRemember} capabilities={capabilities} setView={setView} submit={submit} challenge={challenge} pendingEmail={pendingEmail} resendSeconds={resendSeconds} signupPending={signupPending} signupComplete={signupComplete}
          openSignupConfirmation={email => { setPendingEmail(email || ''); setSignupPending(true); }} editSignup={() => { setSignupPending(false); setNotice(''); setError(''); }}
          google={() => action(async () => { if(desktop.enabled){await desktop.start(remember);return;}const result = await api('google', { remember }); location.assign(result.url); })} />}
    </section></main>;
}
createRoot(document.getElementById('root')).render(<Login />);
