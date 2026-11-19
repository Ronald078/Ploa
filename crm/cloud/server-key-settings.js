'use strict';
const path = require('node:path');
const os = require('node:os');
const { createCredentialStore } = require('../lib/credential-store');
const { CloudError } = require('./errors');
const project = require('./project.json');
const PROJECT_URL = `https://${project.id}.supabase.co`;

function normalizeServerKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (/^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(key)) return key;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) && key.length < 4096) {
    try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'service_role') return key; } catch { /* Reject silently. */ }
  }
  throw new CloudError(400, 'server_key', 'Use a chave secret do projeto Ploa. A chave publishable e a chave Groq nao servem neste campo.');
}

function requirePloaProject(url) {
  if (url !== PROJECT_URL) throw new CloudError(400, 'server_project', 'A configuracao deve apontar para o projeto Ploa separado. Nenhuma chave foi salva.');
}

function createServerKeySettings({ store = createCredentialStore({ directory: path.join(os.homedir(), 'AppData', 'Local', 'Ploa', 'Cloud', 'Supabase') }) } = {}) {
  return {
    load(url) {
      requirePloaProject(url);
      const saved = store.load().supabaseServer;
      if (!saved) return '';
      requirePloaProject(saved.projectUrl);
      return normalizeServerKey(saved.serverKey);
    },
    save(url, key) {
      requirePloaProject(url);
      store.save({ supabaseServer: { projectUrl: url, serverKey: normalizeServerKey(key) } });
    },
  };
}

function withProtectedServerKey(config, { settings } = {}) {
  // Hosting can supply its own secret; never load a Windows key into a shipped agent.
  if (config.serverKey) return { ...config, serverKey: normalizeServerKey(config.serverKey) };
  return { ...config, serverKey: (settings || createServerKeySettings()).load(config.url) };
}
module.exports = { PROJECT_URL, normalizeServerKey, requirePloaProject, createServerKeySettings, withProtectedServerKey };
