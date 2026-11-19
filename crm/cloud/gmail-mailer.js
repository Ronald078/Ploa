'use strict';
const { CloudError } = require('./errors');
const { normalizeGmail } = require('./gmail-settings');
const { codeEmail } = require('./email-template');

function createGmailMailer({ user = '', appPassword = '', createTransport,logoContent,onFailure } = {}) {
  let settings;
  try { settings = normalizeGmail(user, appPassword); } catch { /* A missing configuration must not start an SMTP connection. */ }
  let transport;
  function client() {
    if (!settings) throw new CloudError(503, 'gmail_configuration', 'Cadastre a senha de app do Gmail na configuração privada do Ploa.');
    if (!transport) transport = (createTransport || require('nodemailer').createTransport)({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: settings.user, pass: settings.appPassword },
      tls: { minVersion: 'TLSv1.2', servername: 'smtp.gmail.com', rejectUnauthorized: true },
      pool: false, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      connectionTimeout: 10000, greetingTimeout: 7000, socketTimeout: 12000, maxRecipients: 1,
    });
    return transport;
  }
  function failure(error) {
    // Diagnostics are opt-in and exclude SMTP responses, addresses and credentials.
    try { onFailure?.({code: /^[A-Z_0-9]{1,40}$/.test(error.code || '') ? error.code : 'unknown',
      command: /^[A-Z ]{1,30}$/.test(error.command || '') ? error.command : 'unknown',
      responseCode: Number.isInteger(error.responseCode) ? error.responseCode : null,
      originalCode: /^[A-Z_0-9]{1,50}$/.test(error.originalCode || '') ? error.originalCode : 'unknown',
      category: /different request/i.test(error.message || '') ? 'request_context' : /not implemented|not supported|unsupported/i.test(error.message || '') ? 'unsupported' : /timed?\s*out|timeout/i.test(error.message || '') ? 'timeout' : 'other'}); } catch {}
    if (error instanceof CloudError) return error;
    if (error.responseCode === 421 || error.responseCode === 450 || error.responseCode === 454 || /(?:limit|quota|4\.7\.0)/i.test(error.response || '')) {
      return new CloudError(429, 'email_limit', 'O Gmail limitou temporariamente os envios. Aguarde antes de tentar novamente.');
    }
    if (error.code === 'EAUTH') return new CloudError(503, 'gmail_auth', 'O Google não aceitou a senha de app. Confira a configuração privada do Gmail.');
    return new CloudError(503, 'email_unavailable', 'Não foi possível confirmar o envio pelo Gmail. Aguarde antes de solicitar outro código.');
  }
  return {
    ready: Boolean(settings),
    async verify() { try { return await client().verify(); } catch (error) { throw failure(error); } },
    async sendCode(email, code, id) {
      if (typeof email !== 'string' || !/^[^\s<>\r\n]+@[^\s<>\r\n]+\.[^\s<>\r\n]+$/.test(email) || !/^\d{6}$/.test(code) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new CloudError(400, 'email', 'Os dados do envio não são válidos.');
      try {
        const result = await client().sendMail({ from: { name: 'Equipe Ploa', address: settings.user }, to: email,
          messageId: `<ploa-${id}@${settings.user.split('@')[1]}>`,
          ...codeEmail(code, { withLogo: true,logoContent }),
        });
        if (!result.accepted?.some(value => String(value).toLowerCase() === email.toLowerCase()) || result.rejected?.length) throw new Error('not accepted');
      } catch (error) { throw failure(error); }
    },
    close() { transport?.close?.(); },
  };
}
module.exports = { createGmailMailer };
