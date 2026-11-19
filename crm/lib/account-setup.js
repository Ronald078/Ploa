'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {credentialDirectory}=require('./runtime-paths');
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
function snapshot(root){
 const marker=read(path.join(root,'.ploa-account.json'));
 if(!marker)return {required:false,steps:[]};
 const library=read(path.join(root,'copys_internacionais.json'))||{},automatic=read(path.join(root,'copys_respostas_automaticas.json'))||{},workspace=read(path.join(root,'ploa_workspace.json'))||{};
 const locales={'Brasil':'pt-BR','Portugal':'pt-PT','Estados Unidos':'en-US','Espanha':'es-ES'};
 const active=Object.keys(locales).filter(m=>[...(library[m]?.genericas||[]),...Object.values(library[m]?.porCategoria||{}).flat()].some(text=>String(text).trim()));
 const copies=active.length>0&&active.every(m=>['agradecimento','bot-atendimento'].every(c=>(automatic.categorias?.[c]?.porIdioma?.[locales[m]]||[]).length>0));
 const settings=workspace.settings||{},identity=Boolean(String(marker.identity?.name||'').trim()&&String(marker.identity?.businessName||'').trim());
 const ai=Boolean(settings.provider&&settings.guidance&&settings.services&&settings.dataConsent&&settings.freeAccountConfirmed&&settings.business?.offers?.length&&fs.existsSync(path.join(credentialDirectory(root),'credenciais-ia.dpapi.json')));
 const steps=[{id:'identity',label:'Identidade do negócio',ready:identity},{id:'copies',label:'Copys de primeiro contato e respostas automáticas',ready:copies,view:'copies'},
  {id:'messages',label:'Intervalos e limite diário',ready:marker.setup?.messages===true,view:'messages'},
  {id:'search',label:'Países, cidades e categorias da busca',ready:marker.setup?.search===true,view:'search'},
  {id:'ai',label:'IA, chave própria e base comercial',ready:ai,view:'ai',optional:true}];
 return {required:steps.some(step=>!step.ready&&!step.optional),identity:marker.identity,steps,activeMarkets:active};
}
function change(root,update){
 const file=path.join(root,'.ploa-account.json'),value=read(file);if(!value)return;
 update(value);const temp=file+'.'+randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function saveIdentity(root,body){
 const name=String(body?.name||'').trim(),businessName=String(body?.businessName||'').trim();
 if(!name||!businessName||name.length>80||businessName.length>80||/[\x00-\x1f\x7f]/.test(name+businessName))throw Object.assign(new Error('Informe o nome do responsável e do negócio, com até 80 caracteres.'),{statusCode:400});
 change(root,data=>{data.identity={name,businessName};data.setup.identity=true;});return snapshot(root);
}
function markConfigured(root,section){if(['messages','search'].includes(section))change(root,data=>{data.setup[section]=true;});}
function requireSetup(root,feature){
 const state=snapshot(root);if(!state.required&&!state.steps.length)return;
 const required=feature==='search'?['identity','search']:feature==='whatsapp'?['identity']:feature==='ai'?['identity','ai']:['identity','copies','messages'];
 const missing=state.steps.filter(step=>required.includes(step.id)&&!step.ready);
 if(missing.length)throw Object.assign(new Error('Conclua a configuração desta empresa: '+missing.map(step=>step.label).join(', ')+'.'),{statusCode:409,code:'PLOA_SETUP_REQUIRED'});
}
module.exports={snapshot,saveIdentity,markConfigured,requireSetup};
