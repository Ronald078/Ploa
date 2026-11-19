'use strict';
const path = require('node:path');
const os = require('node:os');
const { createCredentialStore } = require('../lib/credential-store');
const GMAIL = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:gmail|googlemail)\.com$/i;

function normalizeGmail(user, password) {
  const email = typeof user === 'string' ? user.trim().toLowerCase() : '';
  const appPassword = typeof password === 'string' ? password.replace(/\s/g, '') : '';
  if (!GMAIL.test(email) || email.length > 254 || !/^[a-z0-9]{16}$/i.test(appPassword)) {
    throw new Error('Informe o Gmail e a senha de app gerada pelo Google, com 16 caracteres.');
  }
  return { user: email, appPassword };
}
function createGmailSettings({ store = createCredentialStore({ directory: path.join(os.homedir(), 'AppData', 'Local', 'Ploa', 'Cloud', 'Gmail') }) } = {}) {
  return {
    load() { const saved = store.load(); return saved.gmail ? normalizeGmail(saved.gmail.user, saved.gmail.appPassword) : null; },
    save(user, password) { const value = normalizeGmail(user, password); store.save({ gmail: value }); },
  };
}
module.exports = { createGmailSettings, normalizeGmail };
