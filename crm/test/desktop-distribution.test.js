'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {distributionSettings}=require('../lib/desktop-distribution');
const options={packaged:true,codeRoot:path.resolve('fixture/program'),resourcesPath:path.resolve('fixture/resources'),userData:path.resolve('fixture/user-data'),read:()=>JSON.stringify({protocol:1,version:'0.2.0',accountsOrigin:'https://accounts.example.invalid'}),isFile:()=>true};
test('distribuição usa dados graváveis fora do programa e não leva chaves privadas ao processo',()=>{
 const settings=distributionSettings({...options,env:{PATH:'fixture-path',PLOA_SUPABASE_SERVER_KEY:'fixture-secret',PLOA_SERVER_STATE_KEY:'fixture-state',PLOA_GMAIL_APP_PASSWORD:'fixture-password',PLOA_LOCAL_PANEL:'1'}});
 assert.equal(settings.server,path.join(options.codeRoot,'crm/cloud/desktop-agent.js'));assert.equal(settings.env.PLOA_LOCAL_ROOT,path.join(options.userData,'BusinessData'));
 assert.equal(settings.env.CRM_PYTHON_COMMAND,path.join(options.resourcesPath,'python/python.exe'));assert.equal(settings.env.PLOA_ACCOUNTS_ORIGIN,'https://accounts.example.invalid');
 assert.doesNotMatch(JSON.stringify(settings),/fixture-secret|fixture-state|fixture-password|PLOA_LOCAL_PANEL/);
 assert.equal(distributionSettings({...options,packaged:false,read(){assert.fail();}}),null);
});
test('distribuição recusa configuração privada e instalação incompleta sem alterar arquivos',()=>{
 assert.throws(()=>distributionSettings({...options,read:()=>JSON.stringify({protocol:1,accountsOrigin:'https://accounts.example.invalid',serverKey:'forbidden'})}),/inválida/);
 assert.throws(()=>distributionSettings({...options,isFile:()=>false}),/Python/);
});
