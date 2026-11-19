'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
const backend=[
  'account-provider.js','account-routes.js','account-access.js','access-routes.js','auth-flows.js','code-mailer.js','confirmation-results.js','config.js',
  'email-challenges.js','email-security-provider.js','email-service.js','email-template.js','errors.js','gmail-mailer.js','gmail-settings.js',
  'http.js','server.js','server-key-settings.js','session-persistence.js','sessions.js','shared-auth-flows.js',
  'shared-challenges.js','shared-runtime.js','shared-sessions.js','shared-state.js','state-crypto.js','state-key-settings.js','supabase.js','remembered-verification.js',
  'remote-desktop-login.js','public-information.js','check-readiness.js','package.json','package-lock.json','project.json','.env.production.example',
];
async function buildServerPackage(destination){
  const root=path.resolve(__dirname,'../..'),allowed=path.join(root,'output');
  const output=path.resolve(destination||path.join(allowed,'cloud-server-package-20261104','staging'));
  if(!output.startsWith(allowed+path.sep))throw new Error('A preparação deve ficar dentro de output.');
  // Only explicit source/asset names: never recursively copy project files, .env, auth or credentials.
  const files=backend.map(file=>'crm/cloud/'+file);
  files.push('crm/lib/credential-store.js','crm/lib/password-policy.mjs','crm/public/assets/ploa-logo-transparent.png','crm/public/assets/ploa-app-icon.png','crm/cloud/public/cloud.html');
  for(const file of await fs.readdir(path.join(__dirname,'public/cloud-assets'))){
    if(/^cloud-[A-Za-z0-9_-]+\.(js|css)$/.test(file))files.push('crm/cloud/public/cloud-assets/'+file);
  }
  for(const relative of files){const target=path.join(output,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,relative),target);}
  await fs.writeFile(path.join(output,'MANIFEST.json'),JSON.stringify({purpose:'Ploa account server only',files},null,2));
  return{files:files.length,output};
}
if(require.main===module)buildServerPackage(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Não foi possível preparar o pacote do servidor.');process.exitCode=1;});
module.exports={buildServerPackage};
