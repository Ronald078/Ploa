'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {accountOrigin}=require('../cloud/remote-account-client');
const ROOT=path.resolve(__dirname,'../..');
const VERSION='0.2.0';
function releaseVersion(value=VERSION){
 if(typeof value!=='string'||value.length>64||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(value)||value.split('-').slice(1).join('-').split('.').some(part=>/^\d+$/.test(part)&&part.length>1&&part.startsWith('0')))throw Error('Informe uma versão semântica válida, como 0.2.1-pilot.1.');
 return value;
}
const banned=new Set(['.env','.credentials','.ploa-local','.wwebjs_auth','.wwebjs_cache','backups','leads.json','contatos.xlsx','ploa_workspace.json','owner-binding.json','credenciais-ia.dpapi.json']);
async function copyTree(source,target,{skipModules=false}={}){
 const info=await fs.lstat(source);if(info.isSymbolicLink())throw Error('O pacote não aceita links simbólicos.');
 const name=path.basename(source);if(banned.has(name)||name.startsWith('.env.')||name==='__pycache__'||name.endsWith('.pyc')||skipModules&&name==='node_modules')return;
 if(info.isDirectory()){await fs.mkdir(target,{recursive:true});for(const child of await fs.readdir(source))await copyTree(path.join(source,child),path.join(target,child),{skipModules});}
 else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);}
}
async function dependencyTree(root=ROOT){
 const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')),packages=new Map();
 async function visit(name,from,optional=false){
  const bases=require('node:module').createRequire(path.join(from,'package.json')).resolve.paths(name+'/package.json')||[];
  let folder;
  for(const base of bases){const candidate=path.join(base,name);try{await fs.access(path.join(candidate,'package.json'));folder=candidate;break;}catch{}}
  if(!folder){if(optional)return;throw Error('Dependência ausente: '+name);}
  if(!folder.startsWith(path.join(root,'node_modules')+path.sep))throw Error('Dependência fora da instalação do projeto.');
  if(packages.has(folder))return;const pkg=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));packages.set(folder,{name:pkg.name,version:pkg.version});
  for(const dep of Object.keys(pkg.dependencies||{}))await visit(dep,folder,Boolean(pkg.optionalDependencies?.[dep]));
  for(const dep of Object.keys(pkg.optionalDependencies||{}))await visit(dep,folder,true);
 }
 for(const name of Object.keys(manifest.dependencies))await visit(name,root);
 return packages;
}
async function verifyAccountsOrigin(origin,{fetch:fetcher=fetch}={}){
 origin=accountOrigin(origin);const response=await fetcher(origin+'/api/cloud/desktop-manifest',{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('O serviço público de contas ainda não está pronto para distribuir o aplicativo.');
 const data=await response.json();if(data.application!=='Ploa'||data.protocol!==1||data.localScripts!==true)throw Error('O endereço não oferece o protocolo de contas do aplicativo.');return origin;
}
async function prepareDesktop({destination,version=VERSION,accountsOrigin,pythonRoot,verify=true,fetch:fetcher=fetch}={}){
 version=releaseVersion(version);
 const output=path.resolve(destination||path.join(ROOT,'output','desktop-distribution',version+'-'+Date.now()));if(!output.startsWith(path.join(ROOT,'output')+path.sep))throw Error('Prepare a distribuição somente dentro de output.');
 const origin=verify?await verifyAccountsOrigin(accountsOrigin,{fetch:fetcher}):accountOrigin(accountsOrigin);
 if(!path.isAbsolute(pythonRoot||''))throw Error('Informe o Python portátil de compilação.');
 await fs.access(path.join(pythonRoot,'python.exe'));await fs.mkdir(path.dirname(output),{recursive:true});
 // Reusing staging could retain a private/stale file. Require a new directory.
 try{await fs.mkdir(output);}catch(error){if(error.code==='EEXIST')throw Error('Use um destino de preparação novo, sem arquivos anteriores.');throw error;}
 const resources=path.join(output,'resources'),app=path.join(resources,'app');await fs.mkdir(app,{recursive:true});
 const files=['enviar_mensagens_whatsapp.js','buscar_leads.py','puppeteer.config.cjs','crm/desktop.js','crm/desktop-accounts.js','crm/server.js','crm/attendance-agent.js','crm/ai-contact-test.js','crm/startup.html','crm/search-catalog.json'];
 for(const name of await fs.readdir(path.join(ROOT,'crm')))if(name.endsWith('.py'))files.push('crm/'+name);
 for(const folder of ['crm/lib','crm/cloud'])for(const name of await fs.readdir(path.join(ROOT,folder)))if(/\.(?:js|mjs|json)$/.test(name)&&name!=='package-lock.json'&&name!=='package.json')files.push(folder+'/'+name);
 for(const relative of files)await copyTree(path.join(ROOT,relative),path.join(app,relative));
 await copyTree(path.join(ROOT,'crm/public'),path.join(app,'crm/public'));
 await copyTree(path.join(ROOT,'crm/cloud/public'),path.join(app,'crm/cloud/public'));
 // A private voice derived from the owner's conversation is not a public asset.
 await fs.writeFile(path.join(app,'crm/lib/sales-voice.js'),"'use strict';module.exports={VOICE_RULES:'',SAVED_VOICE_GUIDANCE:'',selectVoiceExample:()=>null,publicVoice:()=>null};\n");
 const packages=await dependencyTree();for(const folder of packages.keys())await copyTree(folder,path.join(app,path.relative(ROOT,folder)),{skipModules:true});
 const python=path.join(resources,'python');await fs.mkdir(python,{recursive:true});
 for(const name of await fs.readdir(pythonRoot))if(/^(?:python(?:w|3|312)?\.(?:exe|dll)|vcruntime.*\.dll|LICENSE.*)$/i.test(name)||['Lib','DLLs'].includes(name)){
  if(name==='Lib'){
   await fs.mkdir(path.join(python,'Lib'));for(const child of await fs.readdir(path.join(pythonRoot,'Lib')))if(child!=='site-packages')await copyTree(path.join(pythonRoot,'Lib',child),path.join(python,'Lib',child));
  }else await copyTree(path.join(pythonRoot,name),path.join(python,name));
 }
 await copyTree(path.join(ROOT,'.python-deps'),path.join(python,'Lib/site-packages'));
 await fs.writeFile(path.join(python,'python312._pth'),'.\nLib\nLib/site-packages\nDLLs\n../app\nimport site\n');
 await fs.writeFile(path.join(app,'desktop-config.json'),JSON.stringify({protocol:1,accountsOrigin:origin,version},null,2));
 const declared=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8')).dependencies;
 const productionDependencies=Object.fromEntries(Object.keys(declared).map(name=>[name,packages.get(path.join(ROOT,'node_modules',name))?.version||declared[name]]));
 await fs.writeFile(path.join(app,'package.json'),JSON.stringify({name:'ploa',productName:'Ploa',version,description:'Operação e vendas',author:'Ploa',main:'crm/desktop-accounts.js',private:true,dependencies:productionDependencies},null,2));
 const manifest={application:'Ploa',version,protocol:1,accountsOrigin:origin,sourceFiles:files,dependencies:[...packages.values()],privateDataIncluded:false,serverSecretsIncluded:false,validatedPublicService:verify};
 await fs.writeFile(path.join(output,'MANIFEST.json'),JSON.stringify(manifest,null,2));
 return{output,app,resources,manifest};
}
async function buildInstaller(options){
 if(options?.verify===false)throw Error('O instalador exige um serviço público de contas validado.');
 const prepared=await prepareDesktop(options);return buildPreparedInstaller(prepared.output);
}
async function buildPreparedInstaller(directory){
 const output=path.resolve(directory);if(!output.startsWith(path.join(ROOT,'output')+path.sep))throw Error('Use uma preparação em output.');
 const manifest=JSON.parse(await fs.readFile(path.join(output,'MANIFEST.json'),'utf8'));
 if(!manifest.validatedPublicService)throw Error('A preparação não validou o serviço público de contas.');
 const app=path.join(output,'resources/app'),config=JSON.parse(await fs.readFile(path.join(app,'desktop-config.json'),'utf8'));
 const appManifest=JSON.parse(await fs.readFile(path.join(app,'package.json'),'utf8'));
 const version=releaseVersion(manifest.version);if(config.version!==version||appManifest.version!==version)throw Error('As versões da preparação, aplicativo e configuração precisam coincidir.');
 await verifyAccountsOrigin(config.accountsOrigin);
 const prepared={output,app,resources:path.join(output,'resources')};const {build,Platform,Arch}=require('electron-builder');
 const root=JSON.parse(await fs.readFile(path.join(ROOT,'node_modules/electron/package.json'),'utf8'));
 const previousPath=process.env.PATH;process.env.PATH=path.dirname(process.execPath)+path.delimiter+(previousPath||'');
 try{await build({targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),publish:'never',config:{
  appId:'com.ronald.ploa',productName:'Ploa',asar:false,electronVersion:root.version,electronDist:path.join(ROOT,'node_modules/electron/dist'),
  directories:{app:prepared.app,output:path.join(prepared.output,'installer')},files:['**/*'],
  extraResources:[{from:path.join(prepared.resources,'python'),to:'python'}],
  npmRebuild:false,compression:'normal',win:{icon:path.join(ROOT,'crm/public/assets/ploa-app.ico'),signExecutable:false},
  nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,shortcutName:'Ploa',deleteAppDataOnUninstall:false,artifactName:'Ploa-${version}-Setup.${ext}'}
 }});}finally{if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;}return prepared.output;
}
if(require.main===module){const args=process.argv.slice(2);buildInstaller({accountsOrigin:args[0],pythonRoot:args[1],...(args[2]?{destination:args[2]}:{}),...(args[3]?{version:args[3]}:{})}).then(output=>console.log('Instalador preparado em '+output)).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={prepareDesktop,buildInstaller,buildPreparedInstaller,verifyAccountsOrigin,dependencyTree,copyTree,releaseVersion};
