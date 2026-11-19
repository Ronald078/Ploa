'use strict';
const fs=require('node:fs'),path=require('node:path');
const {CloudError}=require('../cloud/errors');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKETS=['Brasil','Portugal','Estados Unidos','Espanha'];
const LOCALES=['pt-BR','pt-PT','en-US','es-ES'];
function seedFile(file,data){try{fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
function createAccountData({directory,codeRoot,legacyBinding=null}){
 const base=path.resolve(directory),legacyRoot=fs.realpathSync(codeRoot);
 if(legacyBinding&&(!UUID.test(legacyBinding.userId||'')||!UUID.test(legacyBinding.workspaceId||'')))throw Error('Vínculo local do dono inválido.');
 function resolve(identity,workspace){
  if(!UUID.test(identity?.id||'')||!UUID.test(workspace?.id||'')||!['owner','editor','viewer'].includes(workspace.role))throw new CloudError(403,'workspace','Empresa não autorizada.');
  if(legacyBinding?.workspaceId===workspace.id){
   if(identity.id!==legacyBinding.userId||workspace.role!=='owner')throw new CloudError(403,'legacy_owner','A operação existente pertence exclusivamente à conta do dono.');
   return {root:legacyRoot,legacy:true,workspaceId:workspace.id,accountId:identity.id};
  }
  fs.mkdirSync(path.join(base,'workspaces'),{recursive:true});
  const container=fs.realpathSync(path.join(base,'workspaces')),root=path.join(container,workspace.id.toLowerCase());
  fs.mkdirSync(root,{recursive:true});
  if(fs.realpathSync(root)!==root)throw new CloudError(503,'data_directory','O diretório desta empresa precisa de conferência local.');
  const marker=path.join(root,'.ploa-account.json');
  if(fs.existsSync(marker)){
   let saved;try{saved=JSON.parse(fs.readFileSync(marker,'utf8'));}catch{throw new CloudError(503,'data_directory','Não foi possível conferir os dados desta empresa.');}
   if(saved.workspaceId!==workspace.id)throw new CloudError(503,'data_directory','O diretório não pertence a esta empresa.');
  }else{
   // Only neutral structures are created. Never copy a file from the owner's root.
   seedFile(path.join(root,'copys_internacionais.json'),Object.fromEntries(MARKETS.map(m=>[m,{genericas:[],porCategoria:{}}])));
   seedFile(path.join(root,'copys_respostas_automaticas.json'),{version:1,categorias:Object.fromEntries(['agradecimento','bot-atendimento'].map(key=>[key,{porIdioma:Object.fromEntries(LOCALES.map(locale=>[locale,[]]))}]))});
   seedFile(path.join(root,'ploa_workspace.json'),{version:1,settings:{enabled:false,provider:'',model:'',responseMode:'review',dataConsent:false,freeAccountConfirmed:false,keepConnected:false,autoExternal:false,maxDailyRequests:60,debounceSeconds:10,guidance:'',services:'',examples:[],business:{offers:[],allowAutoProposals:false,allowAutoAcceptance:false,guidance:''}},records:{},jobs:[],usage:{},savedFilters:[],copyVersions:[]});
   seedFile(path.join(root,'configuracoes_operacao.json'),{version:1,messages:{delayMinSeconds:40,delayMaxSeconds:120,dailyLimit:1},search:{localities:[],categories:[]}});
   seedFile(path.join(root,'leads.json'),{});
   fs.mkdirSync(path.join(root,'crm'),{recursive:true});
   seedFile(path.join(root,'crm','ai-test-contact.json'),{contact:'',name:''});
   seedFile(marker,{version:1,workspaceId:workspace.id,createdBy:identity.id,businessName:String(workspace.name||'').slice(0,80),identity:{name:'',businessName:String(workspace.name||'').slice(0,80)},setup:{identity:false,copies:false,messages:false,search:false},createdAt:new Date().toISOString()});
  }
  return {root,legacy:false,workspaceId:workspace.id,accountId:identity.id};
 }
 return{resolve};
}
module.exports={createAccountData,UUID,MARKETS,LOCALES};
