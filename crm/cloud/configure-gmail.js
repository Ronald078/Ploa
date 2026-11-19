'use strict';
const { createGmailSettings, normalizeGmail } = require('./gmail-settings');
const { createGmailMailer } = require('./gmail-mailer');

async function configureGmail({ input, store = createGmailSettings(), createMailer = createGmailMailer }) {
  const value = normalizeGmail(input.user, input.appPassword);
  const mailer = createMailer(value);
  try {
    // SMTP connection/authentication only. This does not send an email.
    await mailer.verify();
    store.save(value.user, value.appPassword);
    return { saved: true, verified: true, message: 'Gmail verificado e salvo com a proteção do Windows. A prévia de acesso deve ser reaberta para carregar a conexão.' };
  } finally { mailer.close?.(); }
}
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 8192) process.exit(1); });
  process.stdin.on('end', async () => {
    try { process.stdout.write(JSON.stringify(await configureGmail({ input: JSON.parse(raw) }))); }
    catch (error) {
      process.stdout.write(JSON.stringify({ saved: false, message: error.code || error.status ? error.message : 'Não foi possível salvar a conexão. Confira o Gmail, a senha de app e a proteção do Windows.' }));
      process.exitCode = 1;
    }
  });
}
module.exports = { configureGmail };
