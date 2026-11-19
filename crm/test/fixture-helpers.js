'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCrmStore}=require('../lib/store');
const {createWorkspaceService}=require('../lib/workspace-service');
function temporaryRoot(t){const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ploa-test-'));
  t.after(()=>{const target=fs.realpathSync(root);if(path.dirname(target)!==parent||!path.basename(target).startsWith('ploa-test-'))throw new Error('Pasta de teste inesperada.');fs.rmSync(target,{recursive:true,force:true});});return root;}
function workspaceFixture(t,{text='Olá, tudo bem?',at='2026-10-23T12:00:00.000Z',manual=false}={}){
  const root=temporaryRoot(t),contact='5511999999999';
  fs.writeFileSync(path.join(root,'leads.json'),JSON.stringify({[contact]:{numero:contact,nome:'Empresa fictícia',status:'frio',primeiro_contato:'2026-10-22T12:00:00.000Z',ultima_resposta:at,respostas_recebidas:1}}));
  fs.writeFileSync(path.join(root,'respostas_recebidas.json'),JSON.stringify([{numero:contact,texto:text,data:at,mensagemId:'fixture-in'}]));
  fs.writeFileSync(path.join(root,'ploa_conversas.jsonl'),JSON.stringify({contact,direction:'in',actor:'contact',text,at,messageId:'fixture-in'})+'\n');
  if(manual)fs.writeFileSync(path.join(root,'crm_dados.json'),JSON.stringify({versao:1,leads:{[contact]:{classificacao_modo:'manual',status:'proposta'}}}));
  const store=createCrmStore(root),workspace=createWorkspaceService(root,store,{credentialStore:{available:true,load:()=>({}),save(){}}});
  t.after(()=>workspace.close());return{root,contact,store,workspace};
}
module.exports={temporaryRoot,workspaceFixture};
