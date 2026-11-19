'use strict';
const { CloudError } = require('./errors');
const { codeEmail } = require('./email-template');

function createEmailService({ key = '', from = '', fetch: fetcher = fetch } = {}) {
  const ready = key.startsWith('re_') && /^[^\r\n<>\s]+@[^\r\n<>\s]+\.[^\r\n<>\s]+$/.test(from);
  return {
    ready,
    async sendCode(email, code, id) {
      if (!ready) throw new CloudError(503, 'email_unavailable', 'O remetente dos códigos de acesso ainda precisa ser configurado.');
      const message = codeEmail(code);
      let response;
      try {
        response = await fetcher('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'ploa-code/' + id },
          body: JSON.stringify({ from: `Ploa <${from}>`, to: [email], ...message }),
        });
      } catch { throw new CloudError(503, 'email_unavailable', 'Não foi possível enviar o código agora. Tente novamente.'); }
      await response.body?.cancel();
      if (!response.ok) throw new CloudError(response.status === 429 ? 429 : 503, 'email_unavailable', 'Não foi possível enviar o código agora. Confira o remetente ou tente mais tarde.');
    },
  };
}
module.exports = { createEmailService };
