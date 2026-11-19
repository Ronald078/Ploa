'use strict';
const { createCipheriv, createDecipheriv, randomBytes, createHmac, hkdfSync } = require('node:crypto');
const { CloudError } = require('./errors');

function createStateCrypto(encoded) {
  const key = Buffer.from(encoded || '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new CloudError(503, 'state_configuration', 'Configure a proteção do estado do servidor.');
  const hmacKey = Buffer.from(hkdfSync('sha256', key, 'Ploa.server.v1', 'identifiers-and-codes', 32));
  return {
    hash(value) { return createHmac('sha256', hmacKey).update(value).digest('hex'); },
    seal(kind, id, data) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`Ploa.state.v1:${kind}:${id}`));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
      return { v:1, iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:ciphertext.toString('base64') };
    },
    open(kind,id,envelope) {
      try {
        if (envelope?.v !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
        decipher.setAAD(Buffer.from(`Ploa.state.v1:${kind}:${id}`)); decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
      } catch { throw new CloudError(503,'state_protection','Não foi possível recuperar o acesso protegido.'); }
    },
  };
}
module.exports = { createStateCrypto };
