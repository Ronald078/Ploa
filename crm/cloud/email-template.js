'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CloudError } = require('./errors');
const LOGO_CID = 'ploa-logo@ploa';
let logo;
function inlineLogo() {
  if (logo === undefined) {
    try { logo = fs.readFileSync(path.join(__dirname, '../public/assets/ploa-app-icon.png')); }
    catch { logo = null; } // Branding must never prevent a security email.
  }
  return logo;
}

// Layout uses presentation tables and inline styles, with no external font or script.
// Content comes only from the fixed models below; code is validated before insertion.
function layout({ title, preheader, introduction, action, guidance, warning, logoSrc = '' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
  <title>${title} · Ploa</title>
  <style>@media only screen and (max-width:600px){.email-outer{padding:16px 10px!important}.email-content{padding:28px 22px!important}.email-title{font-size:27px!important}.email-code{font-size:38px!important;letter-spacing:5px!important}.email-button{display:block!important;text-align:center!important}}</style>
</head>
<body style="margin:0;padding:0;background-color:#03070c;color:#e4edf7;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
  <div style="display:none;font-size:1px;line-height:1px;color:#03070c;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#03070c" style="width:100%;background-color:#03070c">
    <tr><td class="email-outer" align="center" style="padding:32px 16px">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1c2b" style="width:100%;max-width:600px;background-color:#0b1c2b;border:1px solid #29465f;border-radius:18px">
        <tr><td class="email-content" style="padding:38px 40px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px"><tr>
            ${logoSrc ? `<td width="62" style="width:62px;padding-right:12px;vertical-align:middle"><img src="${logoSrc}" width="50" height="50" alt="" style="display:block;width:50px;height:50px;border:0"></td>` : ''}
            <td style="color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;letter-spacing:-1px;vertical-align:middle">Ploa</td>
          </tr></table>
          <h1 class="email-title" style="margin:0 0 24px;color:#b0d0ff;font-size:30px;line-height:1.25;font-weight:bold">${title}</h1>
          <p style="margin:0 0 12px;color:#f1f5f9;font-size:18px;line-height:1.5;font-weight:bold">Olá!</p>
          <p style="margin:0 0 26px;color:#d5e1ed;font-size:16px;line-height:1.65">${introduction}</p>
          ${action}
          <p style="margin:22px 0 0;color:#d5e1ed;font-size:14px;line-height:1.65">${guidance}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr><td style="border-top:1px solid #29465f;padding-top:24px">
            <h2 style="margin:0 0 10px;color:#b0d0ff;font-size:20px;line-height:1.4">Não foi você?</h2>
            <p style="margin:0;color:#d5e1ed;font-size:14px;line-height:1.65">${warning}</p>
          </td></tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr><td style="border-left:3px solid #b0d0ff;padding:2px 0 2px 14px;color:#d5e1ed;font-size:15px;line-height:1.6">Atenciosamente,<br><strong style="color:#f1f5f9">Equipe Ploa</strong></td></tr></table>
          <p style="margin:28px 0 0;border-top:1px solid #29465f;padding-top:20px;color:#a9bed2;font-size:12px;line-height:1.6">Este é um e-mail automático de segurança.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
function button(label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr><td align="center" bgcolor="#b0d0ff" style="background-color:#b0d0ff;border-radius:9px"><a class="email-button" href="{{ .ConfirmationURL }}" style="display:block;padding:16px 22px;border:1px solid #b0d0ff;border-radius:9px;color:#102039;font-size:16px;line-height:1.4;font-weight:bold;text-decoration:none;text-align:center">${label}</a></td></tr></table>`;
}
function supabaseTemplates() {
  return {
    confirmation: layout({title:'Confirme seu e-mail',preheader:'Confirme seu endereço para concluir o cadastro no Ploa.',
      introduction:'Falta só confirmar este endereço de e-mail para concluir seu cadastro no Ploa.',action:button('Confirmar meu e-mail'),
      guidance:'Depois de confirmar, entre no Ploa com seu e-mail e sua senha. Se solicitou outra mensagem, use o link mais recente.',
      warning:'Se você não criou uma conta no Ploa, ignore esta mensagem. Não é necessário clicar no botão.'}),
    recovery: layout({title:'Redefina sua senha',preheader:'Use o link seguro para escolher uma nova senha para sua conta.',
      introduction:'Recebemos uma solicitação para redefinir a senha da sua conta. Use o botão abaixo para escolher uma nova senha.',action:button('Redefinir minha senha'),
      guidance:'Abra o link no mesmo navegador em que solicitou a recuperação. Ele tem validade limitada e só pode ser usado uma vez. Se expirar, solicite um novo link pelo Ploa.',
      warning:'Se não pediu a redefinição, ignore este e-mail. Sua senha não será alterada por esta mensagem.'}),
  };
}
function codeHtml(code, logoSrc = '') {
  return layout({title:'Confirme sua solicitação',preheader:'Seu código de segurança do Ploa é válido por 5 minutos.',
    introduction:'Use o código abaixo para confirmar sua solicitação de acesso ou de segurança no Ploa.',logoSrc,
    action:`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#06121e" style="width:100%;background-color:#06121e;border:1px solid #78afe2;border-radius:12px"><tr><td align="center" style="padding:24px 12px"><p style="margin:0 0 12px;color:#d5e1ed;font-size:15px;line-height:1.5">Seu código de verificação</p><p class="email-code" style="margin:0;color:#b0d0ff;font-family:Arial,Helvetica,sans-serif;font-size:46px;font-weight:bold;line-height:1.25;letter-spacing:7px;white-space:nowrap">${code}</p><p style="margin:12px 0 0;color:#a9bed2;font-size:14px;line-height:1.5">Válido por 5 minutos</p></td></tr></table>`,
    guidance:'<strong style="color:#f1f5f9">Não compartilhe este código com ninguém.</strong> Ele só pode ser usado uma vez.',
    warning:'Se não solicitou esta ação, não utilize o código e revise a segurança da sua conta.'});
}
function codeEmail(code, { withLogo = false,logoContent } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new CloudError(400, 'email', 'Código de segurança inválido.');
  const image = withLogo ? (logoContent||inlineLogo()) : null;
  return {subject:'Seu código de acesso ao Ploa',
    text:`Seu código de acesso ao Ploa é ${code}. Ele vale por 5 minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail. Não compartilhe o código.`,
    html:codeHtml(code, image ? 'cid:' + LOGO_CID : ''),
    ...(image ? {attachments:[{filename:'ploa.png',content:image,contentType:'image/png',cid:LOGO_CID,contentDisposition:'inline'}]} : {})};
}
module.exports = { supabaseTemplates, codeEmail };
