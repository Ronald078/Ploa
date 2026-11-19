'use strict';
const path=require('node:path');const os=require('node:os');const {randomBytes}=require('node:crypto');
const {createCredentialStore}=require('../lib/credential-store');
const {createStateCrypto}=require('./state-crypto');
const {CloudError}=require('./errors');
function withStateKey(config,{store}={}){
  if(config.stateMode!=='shared')return config;
  if(config.stateKey){createStateCrypto(config.stateKey);return config;}
  if(config.production)throw new CloudError(503,'state_configuration','Configure a chave protegida do estado no servidor.');
  const keys=store||createCredentialStore({directory:path.join(os.homedir(),'AppData','Local','Ploa','Cloud','State')});
  const saved=keys.load();
  if(!saved.sharedEncryptionKey){saved.sharedEncryptionKey=randomBytes(32).toString('base64');keys.save(saved);}
  createStateCrypto(saved.sharedEncryptionKey);
  return {...config,stateKey:saved.sharedEncryptionKey};
}
module.exports={withStateKey};
