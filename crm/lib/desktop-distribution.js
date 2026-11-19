'use strict';
const path=require('node:path'),fs=require('node:fs');
const {accountOrigin}=require('../cloud/remote-account-client');
function distributionSettings({packaged,codeRoot,resourcesPath,userData,env=process.env,read=file=>fs.readFileSync(file,'utf8'),isFile=file=>fs.existsSync(file)}){
 if(!packaged)return null;
 const config=JSON.parse(read(path.join(codeRoot,'desktop-config.json')));
 if(config.protocol!==1||Object.keys(config).some(key=>!['protocol','accountsOrigin','version'].includes(key)))throw Error('Configuração pública do aplicativo inválida.');
 const origin=accountOrigin(config.accountsOrigin),python=path.join(resourcesPath,'python','python.exe');
 if(!isFile(python))throw Error('O Python do Ploa não foi encontrado. Reinstale o aplicativo; seus dados serão preservados.');
 const variables={...env};
 for(const name of Object.keys(variables))if(/^PLOA_(?:SUPABASE|SERVER_STATE|GMAIL|RESEND|EMAIL|STATE_MODE|LOCAL_PANEL)/.test(name))delete variables[name];
 Object.assign(variables,{PLOA_DISTRIBUTED_DESKTOP:'1',PLOA_ACCOUNTS_ORIGIN:origin,PLOA_LOCAL_ROOT:path.join(userData,'BusinessData'),CRM_PYTHON_COMMAND:python,PYTHONPATH:codeRoot,PYTHONUTF8:'1'});
 return{env:variables,server:path.join(codeRoot,'crm/cloud/desktop-agent.js')};
}
module.exports={distributionSettings};
