'use strict';
const path=require('node:path');
const os=require('node:os');
const CODE_ROOT=path.resolve(__dirname,'../..');
function dataRoot(env=process.env){
 const root=env.PLOA_DATA_ROOT;
 if(!root)return CODE_ROOT;
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw new Error('Diretório de dados do Ploa inválido.');
 return path.resolve(root);
}
function credentialDirectory(root,area='ai'){
 const base=path.resolve(root)===CODE_ROOT?path.join(os.homedir(),'AppData','Local','Ploa'):path.join(root,'.credentials');
 return area==='ai'?base:path.join(base,area);
}
module.exports={CODE_ROOT,dataRoot,credentialDirectory};
