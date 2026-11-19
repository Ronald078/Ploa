'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process');
function countSheet(file,{signal}={}){
  const portable=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
  const python=process.env.CRM_PYTHON_COMMAND||(process.platform==='win32'&&fs.existsSync(portable)?portable:'python');
  return new Promise((resolve,reject)=>execFile(python,['-B',path.resolve(__dirname,'../sheet_count.py'),file],
    {windowsHide:true,timeout:120000,maxBuffer:4096,signal},(error,stdout)=>{
      if(error){reject(new Error('Contagem da planilha indisponível'));return;}
      try{resolve(JSON.parse(stdout));}catch{reject(new Error('Contagem inválida'));}
    }));
}
module.exports={countSheet};
