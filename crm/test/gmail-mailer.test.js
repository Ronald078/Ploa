'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGmailMailer } = require('../cloud/gmail-mailer');
const { normalizeGmail } = require('../cloud/gmail-settings');
const { configureGmail } = require('../cloud/configure-gmail');
const { createCodeMailer } = require('../cloud/code-mailer');
const settings = { user: 'contato.ploa@gmail.com', appPassword: 'abcdefghijklmnop' };
test('SMTP diagnostic includes only fixed metadata and omits message and response',async()=>{
 let diagnostic;
 const mailer=createGmailMailer({...settings,onFailure:value=>{diagnostic=value;},createTransport:()=>({async verify(){throw Object.assign(new Error('private@example.invalid 123456'),{code:'ESOCKET',command:'CONN',response:'private'});}})});
 await assert.rejects(mailer.verify(),{code:'email_unavailable'});
 assert.deepEqual(diagnostic,{code:'ESOCKET',command:'CONN',responseCode:null,originalCode:'unknown',category:'other'});
});
test('Gmail normaliza a senha de app e recusa remetente/injecao invalida', () => {
  assert.equal(normalizeGmail(settings.user, 'abcd efgh ijkl mnop').appPassword, settings.appPassword);
  assert.throws(() => normalizeGmail('a@gmail.com\r\nBcc:else@evil.invalid', settings.appPassword));
  assert.throws(() => normalizeGmail(settings.user, 'normal-password'));
});
test('SMTP exige TLS, autentica sem logs e envia para um unico destinatario', async () => {
  let config, message;
  const mailer = createGmailMailer({ ...settings, createTransport: options => { config = options; return { async sendMail(data) { message = data; return { accepted: [data.to], rejected: [] }; } }; } });
  await mailer.sendCode('user@example.invalid', '123456', 'fake-id');
  assert.equal(config.host, 'smtp.gmail.com'); assert.equal(config.port, 465); assert.equal(config.secure, true);
  assert.equal(config.tls.rejectUnauthorized, true); assert.equal(config.debug, false); assert.equal(config.logger, false);
  assert.equal(config.disableFileAccess, true); assert.equal(config.disableUrlAccess, true);
  assert.deepEqual(message.from, { name: 'Equipe Ploa', address: settings.user });
  assert.equal(message.to, 'user@example.invalid'); assert.ok(message.text.includes('123456'));
  assert.ok(message.html.includes('123456'));
  assert.ok(message.html.includes('cid:ploa-logo@ploa'));
  assert.equal(message.attachments[0].cid, 'ploa-logo@ploa');
  assert.ok(Buffer.isBuffer(message.attachments[0].content));
  assert.equal(JSON.stringify(message).includes(settings.appPassword), false);
});
test('falha de autenticacao ou quota nao e reportada como envio concluido', async () => {
  for (const [error, status, code] of [[{ code: 'EAUTH', response: 'sensitive-credential' }, 503, 'gmail_auth'], [{ responseCode: 421 }, 429, 'email_limit']]) {
    const mailer = createGmailMailer({ ...settings, createTransport: () => ({ async sendMail() { throw error; } }) });
    await assert.rejects(mailer.sendCode('user@example.invalid', '123456', 'id'), failure => failure.status === status && failure.code === code && !failure.message.includes('sensitive-credential'));
  }
});
test('Gmail ausente ou destinatario rejeitado nao produz sucesso', async () => {
  await assert.rejects(createGmailMailer().verify(), { code: 'gmail_configuration' });
  const mailer = createGmailMailer({ ...settings, createTransport: () => ({ async sendMail() { return { accepted: [], rejected: ['user@example.invalid'] }; } }) });
  await assert.rejects(mailer.sendCode('user@example.invalid', '123456', 'id'), { code: 'email_unavailable' });
});
test('configuracao salva somente depois de verificar e nao devolve a senha', async () => {
  const steps = [];
  const result = await configureGmail({ input: settings,
    store: { save(user, pass) { assert.equal(pass, settings.appPassword); steps.push('save'); } },
    createMailer: () => ({ async verify() { steps.push('verify'); }, close() { steps.push('close'); } }) });
  assert.deepEqual(steps, ['verify', 'save', 'close']); assert.equal(result.saved, true);
  assert.equal(JSON.stringify(result).includes(settings.appPassword), false);
});
test('senha incorreta mantem a configuracao anterior', async () => {
  let saved = false;
  await assert.rejects(configureGmail({ input: settings, store: { save() { saved = true; } },
    createMailer: () => ({ async verify() { throw new Error('mock auth'); }, close() {} }) }));
  assert.equal(saved, false);
});
test('selecao explicita Gmail usa credencial protegida sem mudar para outro provedor', async () => {
  let options;
  const mailer = createCodeMailer({ mailProvider: 'gmail', emailKey: 're_other' }, { settingsStore: { load: () => settings },
    createTransport: config => { options = config; return { async verify() { return true; } }; } });
  assert.equal(await mailer.verify(), true); assert.equal(options.auth.user, settings.user);
  const missing = createCodeMailer({ mailProvider: 'gmail', emailKey: 're_other' }, { settingsStore: { load: () => null } });
  assert.equal(missing.ready, false); await assert.rejects(missing.verify(), { code: 'gmail_configuration' });
});
