'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createAccountData}=require('../lib/account-data');
const {createLocalRuntimes}=require('../cloud/local-runtimes');
async function checkStage(staging){
 const root=path.resolve(staging),app=path.join(root,'resources/app'),python=path.join(root,'resources/python/python.exe');
 const expected=path.resolve(__dirname,'../../output');if(!root.startsWith(expected+path.sep))throw Error('Confira somente uma preparação em output.');
 const manifest=JSON.parse(await fs.readFile(path.join(root,'MANIFEST.json'),'utf8'));
 const py=spawnSync(python,['-I','-c','import requests, openpyxl, phonenumbers, overturemaps, pyarrow, shapely; from crm.runtime_paths import data_root; print("Python e bibliotecas OK")'],{cwd:app,encoding:'utf8',windowsHide:true,timeout:30000});
 if(py.status!==0)throw Error('Python portátil falhou: '+String(py.stderr).slice(-900));
 const boundary=path.join(root,'module-boundary.cjs');
 await fs.writeFile(boundary,"const M=require('node:module'),p=require('node:path');const root="+JSON.stringify(app+path.sep)+";const original=M._resolveFilename;M._resolveFilename=function(...args){const value=original.apply(this,args);if(p.isAbsolute(value)&&!value.startsWith(root))throw Error('Dependência fora do pacote: '+args[0]);return value;};\n");
 const bootstrap=path.join(root,'package-check-bootstrap.cjs');
 await fs.writeFile(bootstrap,'require('+JSON.stringify(boundary)+');require(process.argv[2]);\n');
 const parent=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(parent,'ploa-package-check-'));
 const registry=createAccountData({directory,codeRoot:app});
 const data=registry.resolve({id:'11111111-1111-4111-8111-111111111111'},{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Empresa fictícia portátil',role:'owner'});
 let errors='';
 const pool=createLocalRuntimes({codeRoot:app,origin:'http://127.0.0.1:4313',spawn:(exe,args,options)=>{
  const child=require('node:child_process').spawn(exe,[bootstrap,...args],{...options,env:{...options.env,CRM_PYTHON_COMMAND:python}});
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-3500);});return child;
 }});
 try{
  let worker;try{worker=await pool.get(data,{cookie:'fixture-package'});}catch(error){throw Error(error.message+'\n'+errors);}
  for(const route of ['/healthz','/app-next/dashboard','/api/copies','/api/workspace','/api/processes']){
   const response=await fetch('http://127.0.0.1:'+worker.port+route,{headers:{'x-ploa-local-token':worker.token}});if(response.status!==200)throw Error('Rota portátil indisponível: '+route);
   if(route==='/api/workspace'){const value=await response.json();if(value.hasKey||value.settings.enabled||Object.keys(value.records).length)throw Error('Pacote não iniciou vazio.');}
   if(route==='/api/processes')for(const state of Object.values(await response.json()))if(state.running)throw Error('Automação iniciou durante a conferência.');
  }
  return{python:true,pythonLibraries:true,isolatedCommercialWorker:true,developerDependenciesUsed:false,automationsStarted:false,sourceFiles:manifest.sourceFiles.length,dependencies:manifest.dependencies.length,publicServiceValidated:manifest.validatedPublicService};
 }finally{
  await pool.close();const resolved=await fs.realpath(directory);if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('ploa-package-check-'))throw Error('Pasta descartável inesperada.');await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:250});
 }
}
if(require.main===module)checkStage(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={checkStage};
