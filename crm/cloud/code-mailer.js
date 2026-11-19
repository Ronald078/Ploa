'use strict';
const { createEmailService } = require('./email-service');
const { createGmailSettings } = require('./gmail-settings');
const { createGmailMailer } = require('./gmail-mailer');

function createCodeMailer(config, { settingsStore, createTransport } = {}) {
  if (config.mailProvider === 'gmail') {
    const saved = config.production ? null : (settingsStore || createGmailSettings()).load();
    return createGmailMailer({ ...(saved || { user: config.gmailUser, appPassword: config.gmailPassword }), createTransport });
  }
  return createEmailService({ key: config.emailKey, from: config.emailFrom });
}
module.exports = { createCodeMailer };
