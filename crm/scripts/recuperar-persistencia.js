'use strict';
// Confere o alerta sem abrir WhatsApp. Só --resolver-alerta altera o aviso.
const fs=require('node:fs'),path=require('node:path');
const {createSenderPersistence,validCounter}=require('../lib/sender-persistence');
const {createDailySendLedger}=require('../lib/daily-send-ledger');
function inspect(root,{resolve=false}={}){
 const persistence=createSenderPersistence({root}),read=()=>JSON.parse(fs.readFileSync(path.join(root,'contador_diario.json'),'utf8'));
 const counter=read();if(!validCounter(counter))throw new Error('O contador não tem formato válido.');
 const day=()=>{const now=new Date();return[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');};
 const ledger=createDailySendLedger({root,day,readCounter:read,saveCounter:()=>{throw new Error('Há confirmações ainda não aplicadas ao contador; a recuperação deve ser feita pelo agente.');}});
 const expected=ledger.recover();
 const recovery=resolve?persistence.resolveHistoricalCounter():undefined;
 return{counter,expected,alert:persistence.readAlert(),...(resolve?{recovery}:{} )};
}
if(require.main===module){try{const result=inspect(path.resolve(__dirname,'../..'),{resolve:process.argv.includes('--resolver-alerta')});console.log(JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={inspect};
