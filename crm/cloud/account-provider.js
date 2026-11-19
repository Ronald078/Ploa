'use strict';
const { CloudError } = require('./errors');
const {passwordProblem}=require('../lib/password-policy.mjs');

function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new CloudError(400, 'validation', 'Informe um e-mail válido.');
  return value.trim();
}
function validPassword(value) {
  const problem=passwordProblem(value);if(problem)throw new CloudError(400,'password',problem);
  return value;
}
function createAccountProvider({ request, session, url }) {
  return {
    async capabilities() {
      const settings = await request('/auth/v1/settings');
      return { google: settings.external?.google === true, signup: settings.disable_signup !== true && settings.external?.email !== false };
    },
    async signUp(email, password, flow) {
      const data = await request('/auth/v1/signup?redirect_to=' + encodeURIComponent(flow.redirect), {
        method: 'POST', body: { email: validEmail(email), password: validPassword(password), code_challenge: flow.challenge, code_challenge_method: 's256' },
      });
      return data?.access_token ? session(data) : null;
    },
    async recover(email, flow) {
      await request('/auth/v1/recover?redirect_to=' + encodeURIComponent(flow.redirect), {
        method: 'POST', body: { email: validEmail(email), code_challenge: flow.challenge, code_challenge_method: 's256' },
      });
    },
    async resendConfirmation(email, flow) {
      await request('/auth/v1/resend?redirect_to=' + encodeURIComponent(flow.redirect), {
        method: 'POST', body: { type: 'signup', email: validEmail(email), code_challenge: flow.challenge, code_challenge_method: 's256' },
      });
    },
    googleUrl(flow) {
      const target = new URL(url + '/auth/v1/authorize');
      target.search = new URLSearchParams({ provider: 'google', redirect_to: flow.redirect,
        code_challenge: flow.challenge, code_challenge_method: 's256', scopes: 'openid email profile' });
      return target.href;
    },
    async exchangeCode(code, verifier) {
      if (typeof code !== 'string' || !code || code.length > 4096) throw new CloudError(400, 'callback', 'Este link não é válido. Solicite um novo.');
      return session(await request('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: verifier } }));
    },
    async changePassword(accessToken, password) {
      await request('/auth/v1/user', { method: 'PUT', token: accessToken, body: { password: validPassword(password) } });
    },
    async revokeAll(accessToken) { await request('/auth/v1/logout?scope=global', { method: 'POST', token: accessToken }); },
    async security(accessToken) {
      const rows = await request('/rest/v1/ploa_account_security?select=email_2fa_enabled', { token: accessToken });
      return { email2fa: rows.some(row => row.email_2fa_enabled === true) };
    },
    async emailAccess(accessToken) { return await request('/rest/v1/rpc/ploa_email_access', { method: 'POST', token: accessToken, body: {} }) === true; },
  };
}
module.exports = { createAccountProvider, validEmail, validPassword };
