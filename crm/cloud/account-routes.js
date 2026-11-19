'use strict';
const { CloudError } = require('./errors');
const { createAuthFlows } = require('./auth-flows');
const { createEmailChallenges } = require('./email-challenges');
const { createConfirmationResults } = require('./confirmation-results');
const { validPassword, validEmail } = require('./account-provider');
const {createRememberedVerification,VERIFICATION_COOKIE}=require('./remembered-verification');
const FLOW = 'ploa_auth_flow', CODE = 'ploa_email_challenge', CONFIRMATION = 'ploa_signup_result';

function createAccountRoutes({ origin, gateway, sessions, persistence, mailer, emailSecurity, now, cookie, setCookie, readBody, checkLoginRate, runtime,panelAvailable=false,desktopPending=()=>false }) {
  const flows = runtime?.flows || createAuthFlows({ origin, now });
  const challenges = runtime?.challenges || createEmailChallenges({ mailer, now });
  const confirmations = runtime?.confirmations || createConfirmationResults({ now });
  const verifications=runtime?.verifications||createRememberedVerification({now});
  function verificationCookie(res,proof){setCookie(res,proof?.id||'',proof?Math.max(0,Math.floor((proof.until-now())/1000)):0,VERIFICATION_COOKIE,'Lax');}
  const resendAttempts = new Map();
  async function normalSession(req) {
    const session = await sessions.resolve(cookie(req));
    if (session.kind !== 'normal') throw new CloudError(403, 'recovery_only', 'Defina a nova senha antes de acessar sua conta.');
    if (gateway.emailAccess && !await gateway.emailAccess(session.accessToken)) throw new CloudError(401, 'session', 'Entre novamente para confirmar seu acesso.');
    return session;
  }
  async function finishLogin(req, res, credentials, remember = false, { verified = false, kind = 'normal' } = {}) {
    const identity = await gateway.user(credentials.accessToken);
    const security = gateway.security ? await gateway.security(credentials.accessToken) : { email2fa: false };
    if (kind === 'normal' && security.email2fa && !verified) {
      if (!emailSecurity.ready) throw new CloudError(503, 'email_configuration', 'A verificação por e-mail precisa ser configurada antes deste acesso.');
      const proof=remember?await verifications.check(cookie(req,VERIFICATION_COOKIE),identity):null;
      if(proof){
        // Each new Supabase Auth session still needs its own verified-session gate.
        await emailSecurity.mark(credentials,identity,remember);
        verified=true;
      }
      if(!verified){
      const challenge = await challenges.issue(identity, credentials, { remember });
      setCookie(res, challenge.id, 300, CODE);
      return { challenge: { email: challenge.email, expiresIn: challenge.expiresIn } };
      }
    }
    if(kind==='normal'&&!remember){await verifications.remove(cookie(req,VERIFICATION_COOKIE));verificationCookie(res,null);}
    const session = await sessions.create(credentials, { remember, kind });
    // Do not revoke upstream credentials when merely rotating a local session cookie.
    await sessions.remove(cookie(req), { revoke: false });
    setCookie(res, session.id, session.maxAge);
    setCookie(res, '', 0, CODE);
    return { user: session.identity, mode: kind, ...(kind === 'normal' ? { security } : {}) };
  }
  function redirect(res, outcome) {
    res.writeHead(303, { Location: '/?notice=' + outcome }); res.end();
  }
  const handle = async (req, res, url, json) => {
    const route = url.pathname;
    if (route === '/auth/callback' && req.method === 'GET') {
      const id = url.searchParams.get('flow');
      let flowKind;
      const clearFlowCookie = () => { if (cookie(req, FLOW) === id) setCookie(res, '', 0, FLOW, 'Lax'); };
      try {
        flowKind=await flows.kind(id);
        if (flowKind === 'signup') {
          if (url.searchParams.has('error')) return redirect(res, 'callback_failed');
          const flow = await flows.consumeConfirmation(id);
          const credentials = await gateway.exchangeCode(url.searchParams.get('code'), flow.verifier);
          try { await gateway.user(credentials.accessToken); }
          finally {
            // Revoke only this transient provider session. Never sign out existing app sessions globally.
            try { await gateway.signOut(credentials.accessToken); } catch { /* Tokens stay private and are not persisted or returned. */ }
          }
          clearFlowCookie();
          setCookie(res, await confirmations.issue(), 600, CONFIRMATION);
          redirect(res, 'signup_confirmed'); return true;
        }
        const flow = await flows.consume(url.searchParams.get('flow'), cookie(req, FLOW));
        clearFlowCookie();
        if (url.searchParams.has('error')) return redirect(res, 'cancelled');
        const credentials = await gateway.exchangeCode(url.searchParams.get('code'), flow.verifier);
        const result = await finishLogin(req, res, credentials, flow.remember, { kind: flow.kind === 'recovery' ? 'recovery' : 'normal' });
        redirect(res, result.challenge ? 'email_code' : flow.kind === 'recovery' ? 'recovery' : 'welcome');
      } catch { clearFlowCookie(); redirect(res, flowKind==='recovery'?'recovery_failed':'callback_failed'); }
      return true;
    }
    if (route === '/api/cloud/capabilities' && req.method === 'GET') {
      const provider = gateway.capabilities ? await gateway.capabilities() : { google: false, signup: true };
      json(res, 200, { ...provider, remember: persistence?.available === true, email2fa: mailer.ready && emailSecurity.ready,localPanel:panelAvailable,desktopLogin:panelAvailable,desktopPending:await desktopPending(req) }); return true;
    }
    if (route === '/api/cloud/session' && req.method === 'GET') {
      if (await confirmations.has(cookie(req, CONFIRMATION))) { json(res, 200, { signupConfirmed: true }); return true; }
      const challenge = await challenges.status(cookie(req, CODE));
      if (challenge) { json(res, 200, { challenge }); return true; }
      const session = await sessions.resolve(cookie(req));
      const security = session.kind === 'normal' && gateway.security ? await gateway.security(session.accessToken) : { email2fa: false };
      if (session.kind === 'normal' && gateway.emailAccess && !await gateway.emailAccess(session.accessToken)) throw new CloudError(401, 'session', 'Entre novamente para confirmar seu acesso.');
      json(res, 200, { user: session.identity, mode: session.kind, security,remember:session.remember===true }); return true;
    }
    if (req.method !== 'POST') return false;
    if (!['login', 'logout', 'signup', 'recover', 'resend', 'google', 'verify-email', 'password', 'email-security'].some(name => route === '/api/cloud/' + name)) return false;
    // A user must still be able to leave after reaching the attempt limit.
    if (route !== '/api/cloud/logout') await checkLoginRate(req);
    const body = await readBody(req);
    if (['/api/cloud/login', '/api/cloud/logout', '/api/cloud/signup'].includes(route)) {
      await confirmations.remove(cookie(req, CONFIRMATION)); setCookie(res, '', 0, CONFIRMATION);
    }
    if (route === '/api/cloud/resend') {
      const email = validEmail(body.email), key = email.toLowerCase();
      if (runtime?.reserveResend) await runtime.reserveResend(key);
      else {
        for (const [address, until] of resendAttempts) if (until <= now()) resendAttempts.delete(address);
        if (resendAttempts.has(key) || resendAttempts.size >= 1000) throw new CloudError(429, 'resend_wait', 'Aguarde pelo menos um minuto antes de solicitar outro link.');
        resendAttempts.set(key, now() + 60000);
      }
      const flow = await flows.create('signup', body.remember === true);
      await gateway.resendConfirmation(email, flow);
      setCookie(res, flow.id, 1800, FLOW, 'Lax');
      json(res, 200, { retryAfter: 60, message: 'Se o cadastro ainda precisar de confirmação, enviaremos um novo link. Confira também o spam e use o e-mail mais recente. Depois, entre com sua senha.' }); return true;
    }
    if (route === '/api/cloud/logout') {
      let proof=null;
      try{
        const session=await normalSession(req);
        if(session.remember&&(await gateway.security?.(session.accessToken))?.email2fa){
          // Ten minutes start when leaving a verified, remembered account, even
          // if that session was originally confirmed several days earlier.
          proof=await verifications.issue(session.identity);
        }
      }catch{/* Logout stays available when the session expired or the provider is down. */}
      await challenges.cancel(cookie(req, CODE));
      await sessions.remove(cookie(req));
      if(proof){await verifications.remove(cookie(req,VERIFICATION_COOKIE));verificationCookie(res,proof);}
      setCookie(res, '', 0); setCookie(res, '', 0, CODE);
      json(res, 200, { signedOut: true, message: 'Você saiu da conta.' }); return true;
    }
    if (route === '/api/cloud/login') {
      if (body.remember === true && !persistence?.available) throw new CloudError(503, 'remember', 'Entre sem “Lembrar de mim” enquanto a proteção local é configurada.');
      const credentials = await gateway.signIn(body.email, body.password);
      const result = await finishLogin(req, res, credentials, body.remember === true);
      json(res, 200, { ...result, message: result.challenge ? 'Enviamos um código para seu e-mail.' : 'Acesso realizado.' }); return true;
    }
    if (route === '/api/cloud/signup' || route === '/api/cloud/recover' || route === '/api/cloud/google') {
      const kind = route.endsWith('recover') ? 'recovery' : route.endsWith('google') ? 'google' : 'signup';
      if (body.remember === true && !persistence?.available) throw new CloudError(503, 'remember', 'Entre sem “Lembrar de mim” enquanto a proteção local é configurada.');
      if (kind === 'google' && !(await gateway.capabilities()).google) throw new CloudError(409, 'google_configuration', 'O responsável do Ploa ainda precisa conectar o login do Google.');
      if(kind==='signup'){
        validPassword(body.password);
        if(body.password!==body.confirmPassword)throw new CloudError(400,'password_match','As senhas precisam ser iguais.');
      }
      const flow = await flows.create(kind, body.remember === true);
      if (kind === 'signup') {
        const credentials = await gateway.signUp(body.email, body.password, flow);
        if (credentials) { json(res, 200, { ...await finishLogin(req, res, credentials, body.remember === true), message: 'Cadastro realizado.' }); return true; }
      } else if (kind === 'recovery') await gateway.recover(body.email, flow);
      setCookie(res, flow.id, 1800, FLOW, 'Lax');
      json(res, 200, kind === 'google' ? { url: gateway.googleUrl(flow) } : {
        message: kind === 'signup' ? 'Confira seu e-mail para confirmar o cadastro. Depois, entre com seu e-mail e sua senha.' : 'Se houver uma conta com esse e-mail, você receberá as instruções. Abra o link neste mesmo navegador.',
      }); return true;
    }
    if (route === '/api/cloud/verify-email') {
      const item = await challenges.consume(cookie(req, CODE), body.code);
      const identity = await gateway.user(item.credentials.accessToken);
      if (identity.id !== item.identity.id || identity.email !== item.identity.email) throw new CloudError(401, 'session', 'Entre novamente para confirmar sua conta.');
      if (item.action === 'login') await emailSecurity.mark(item.credentials, identity, item.remember);
      else {await verifications.removeUser(identity.id);verificationCookie(res,null);await emailSecurity.set(item.credentials, identity, item.remember, item.action === 'enable');}
      const result = await finishLogin(req, res, item.credentials, item.remember, { verified: true });
      if(item.action==='login'&&item.remember){
        await verifications.remove(cookie(req,VERIFICATION_COOKIE));
        verificationCookie(res,await verifications.issue(identity));
      }
      json(res, 200, { ...result, message: item.action === 'enable' ? 'Verificação por e-mail ativada.' : item.action === 'disable' ? 'Verificação por e-mail desativada.' : 'Código confirmado. Acesso realizado.' }); return true;
    }
    if (route === '/api/cloud/email-security') {
      const session = await normalSession(req);
      if (!mailer.ready || !emailSecurity.ready) throw new CloudError(503, 'email_configuration', 'O remetente e a proteção do servidor ainda precisam ser configurados.');
      if (typeof body.enabled !== 'boolean') throw new CloudError(400, 'validation', 'Escolha ativar ou desativar a verificação.');
      const challenge = await challenges.issue(session.identity, session, { action: body.enabled ? 'enable' : 'disable', remember: session.remember });
      setCookie(res, challenge.id, 300, CODE);
      json(res, 200, { challenge: { email: challenge.email, expiresIn: 300 }, message: 'Confirme o código enviado para seu e-mail.' }); return true;
    }
    if (route === '/api/cloud/password') {
      const session = await sessions.resolve(cookie(req));
      validPassword(body.password);
      if (body.password !== body.confirmPassword) throw new CloudError(400, 'password_match', 'As senhas precisam ser iguais.');
      let accessToken = session.accessToken, fresh;
      if (session.kind !== 'recovery') {
        await normalSession(req);
        if(body.password===body.currentPassword)throw new CloudError(400,'same_password','A nova senha deve ser diferente da senha atual.');
        try { fresh = await gateway.signIn(session.identity.email, body.currentPassword); }
        catch (error) {
          if (error.status === 401 && error.code === 'authentication') throw new CloudError(400, 'current_password', 'A senha atual não confere. Corrija e tente novamente.');
          throw error;
        }
        if ((await gateway.user(fresh.accessToken)).id !== session.identity.id) throw new CloudError(401, 'session', 'Não foi possível confirmar sua conta.');
        accessToken = fresh.accessToken;
      }
      // Fail closed: a password change cannot leave an old device proof reusable.
      await verifications.removeUser(session.identity.id);
      await gateway.changePassword(accessToken, body.password);
      // Password was changed even if a subsequent global sign-out is unavailable.
      let allSessionsRevoked = true;
      try { await gateway.revokeAll(accessToken); } catch { allSessionsRevoked = false; }
      let rememberedAccessCleared = true;
      try { await sessions.removeUser(session.identity.id); } catch { rememberedAccessCleared = false; }
      setCookie(res, '', 0); setCookie(res, '', 0, CODE);verificationCookie(res,null);
      json(res, 200, { signedOut: true, allSessionsRevoked, rememberedAccessCleared,
        message: allSessionsRevoked && rememberedAccessCleared ? 'Senha alterada. Entre novamente com a nova senha.' : 'Senha alterada. Entre novamente; a limpeza completa dos acessos precisa ser conferida.' }); return true;
    }
    return false;
  };
  handle.normalSession = normalSession;
  handle.verificationFor=async(req,identity)=>identity?verifications.check(cookie(req,VERIFICATION_COOKIE),identity):verifications.inspect(cookie(req,VERIFICATION_COOKIE));
  handle.restoreVerification=async(res,proof,identity)=>{const checked=proof&&(identity?await verifications.check(proof.id,identity):await verifications.inspect(proof.id));if(checked)verificationCookie(res,checked);};
  handle.dispose = () => { flows.clear(); challenges.clear(); confirmations.clear(); verifications.clear();resendAttempts.clear(); };
  return handle;
}
module.exports = { createAccountRoutes };
