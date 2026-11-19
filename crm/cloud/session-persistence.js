'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID, createCipheriv, createDecipheriv } = require('node:crypto');
const { createCredentialStore } = require('../lib/credential-store');

function createSessionPersistence({ directory = path.join(os.homedir(), 'AppData', 'Local', 'Ploa', 'Cloud'), keyStore = createCredentialStore({ directory }) } = {}) {
  const file = path.join(directory, 'remembered-sessions.enc.json');
  let key;
  function getKey() {
    if (key) return key;
    const saved = keyStore.load();
    if (!saved.sessionEncryptionKey) {
      if (fs.existsSync(file)) throw new Error('Entre novamente: não foi possível abrir as sessões protegidas.');
      saved.sessionEncryptionKey = randomBytes(32).toString('base64'); keyStore.save(saved);
    }
    key = Buffer.from(saved.sessionEncryptionKey, 'base64');
    if (key.length !== 32) throw new Error('Proteção das sessões inválida.');
    return key;
  }
  return {
    available: keyStore.available,
    load() {
      if (!fs.existsSync(file)) return {};
      try {
        if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error();
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved.version !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(saved.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
        const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
        if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
        return data;
      } catch { throw new Error('Não foi possível recuperar as sessões protegidas deste usuário do Windows.'); }
    },
    save(data) {
      let temp;
      try {
        if (!Object.keys(data).length) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
        if (!keyStore.available) throw new Error();
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', getKey(), iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
        const saved = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        temp = path.join(directory, 'sessions.' + randomUUID() + '.tmp');
        fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file);
      } catch { throw new Error('Não foi possível salvar o acesso protegido. Tente entrar sem “Lembrar de mim”.'); }
      finally { if (temp && fs.existsSync(temp)) fs.unlinkSync(temp); }
    },
  };
}
module.exports = { createSessionPersistence };
