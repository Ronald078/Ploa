'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
async function prepareWorkerAssets(root=path.resolve(__dirname,'../..')){
 const target=path.join(root,'output','cloud-worker-assets'),source=path.join(root,'crm/cloud/public');
 await fs.mkdir(path.join(target,'cloud-assets'),{recursive:true});await fs.mkdir(path.join(target,'assets'),{recursive:true});
 await fs.copyFile(path.join(source,'cloud.html'),path.join(target,'cloud.html'));
 for(const file of await fs.readdir(path.join(source,'cloud-assets')))if(/^cloud-[A-Za-z0-9_-]+\.(js|css)$/.test(file))await fs.copyFile(path.join(source,'cloud-assets',file),path.join(target,'cloud-assets',file));
 await fs.copyFile(path.join(root,'crm/public/assets/ploa-logo-transparent.png'),path.join(target,'assets/ploa-logo-transparent.png'));
 return target;
}
if(require.main===module)prepareWorkerAssets().then(()=>console.log('Assets públicos de acesso preparados.')).catch(()=>{console.error('Não foi possível preparar os assets de acesso.');process.exitCode=1;});
module.exports={prepareWorkerAssets};
