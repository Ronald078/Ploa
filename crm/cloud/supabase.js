'use strict';
const { CloudError } = require('./errors');
const { createAccountProvider } = require('./account-provider');
const {PASSWORD_RULE}=require('../lib/password-policy.mjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSupabaseGateway({ url, key, fetch: fetcher = fetch, timeout = 12000 }) {
  async function request(path, { method = 'GET', body, token, prefer } = {}) {
    let response;
    try {
      response = await fetcher(url + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(prefer ? { Prefer: prefer } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new CloudError(503, 'provider_unavailable', 'Não foi possível acessar sua conta agora. Tente novamente.');
    }
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch { /* Never surface upstream bodies. */ }
      if (response.status === 429) throw new CloudError(429, 'provider_limit', 'O serviço limitou as tentativas ou os envios. Aguarde antes de solicitar novamente.');
      if ((detail.error_code || detail.code) === 'email_not_confirmed') throw new CloudError(400, 'email_not_confirmed', 'Seu e-mail ainda não foi confirmado. Solicite um novo link de confirmação.');
      if (['email_address_not_authorized', 'email_address_invalid', 'over_email_send_rate_limit', 'email_provider_disabled'].includes(detail.error_code || detail.code)) {
        throw new CloudError(503, 'email_unavailable', 'O envio de e-mails ainda precisa ser configurado pelo responsável do Ploa.');
      }
      if ((detail.error_code || detail.code)==='same_password')throw new CloudError(400,'same_password','A nova senha deve ser diferente da senha atual.');
      if ((detail.error_code || detail.code)==='weak_password')throw new CloudError(400,'password',PASSWORD_RULE);
      if ([400, 401, 403, 422].includes(response.status) && path.startsWith('/auth/')) {
        throw new CloudError(401, 'authentication', 'Confira seu acesso ou entre novamente.');
      }
      throw new CloudError(503, 'provider_unavailable', 'O serviço da conta está indisponível. Tente novamente.');
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch {
      throw new CloudError(503, 'provider_response', 'Não foi possível confirmar os dados da conta.');
    }
  }
  function session(data) {
    if (!data?.access_token || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new CloudError(503, 'provider_response', 'Não foi possível confirmar sua sessão.');
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  }
  async function user(accessToken) {
    const data = await request('/auth/v1/user', { token: accessToken });
    if (!UUID.test(data?.id) || !data.email || data.is_anonymous) {
      throw new CloudError(401, 'authentication', 'Entre com uma conta de e-mail válida.');
    }
    // Identity is confirmed by Auth, never by decoding a caller-supplied JWT or metadata.
    return { id: data.id, email: data.email };
  }
  async function workspaces(accessToken, identity) {
    const [spaces, memberships] = await Promise.all([
      request('/rest/v1/ploa_workspaces?select=id,name,owner_id,created_at&order=created_at.asc', { token: accessToken }),
      request('/rest/v1/ploa_workspace_members?select=workspace_id,role&user_id=eq.' + identity.id, { token: accessToken }),
    ]);
    if (!Array.isArray(spaces) || !Array.isArray(memberships)) throw new CloudError(503, 'provider_response', 'Não foi possível consultar suas empresas.');
    return spaces.flatMap(space => {
      const role = space.owner_id === identity.id ? 'owner' : memberships.find(item => item.workspace_id === space.id)?.role;
      return ['owner', 'editor', 'viewer'].includes(role) ? [{ id: space.id, name: space.name, role }] : [];
    });
  }
  return {
    user, workspaces,
    ...createAccountProvider({ request, session, url }),
    async signIn(email, password) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024) {
        throw new CloudError(400, 'validation', 'Informe seu e-mail e sua senha.');
      }
      return session(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } }));
    },
    async refresh(refreshToken) {
      return session(await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }));
    },
    async signOut(accessToken) { await request('/auth/v1/logout?scope=local', { method: 'POST', token: accessToken }); },
    async createWorkspace(accessToken, identity, name) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new CloudError(400, 'validation', 'Use um nome de empresa com até 80 caracteres.');
      }
      const rows = await request('/rest/v1/ploa_workspaces?select=id,name,owner_id,created_at', {
        method: 'POST', token: accessToken, prefer: 'return=representation', body: { name: name.trim(), owner_id: identity.id },
      });
      if (!Array.isArray(rows) || !UUID.test(rows[0]?.id) || rows[0]?.owner_id !== identity.id) {
        throw new CloudError(503, 'provider_response', 'Não foi possível confirmar a criação da empresa.');
      }
      return { id: rows[0].id, name: rows[0].name, role: 'owner' };
    },
    async requireWorkspace(accessToken, identity, id) {
      if (!UUID.test(id || '')) throw new CloudError(404, 'workspace', 'Empresa não encontrada.');
      const space = (await workspaces(accessToken, identity)).find(item => item.id === id);
      if (!space) throw new CloudError(404, 'workspace', 'Empresa não encontrada.');
      return space;
    },
  };
}

module.exports = { createSupabaseGateway };
