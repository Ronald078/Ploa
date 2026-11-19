'use strict';
const {CloudError}=require('./errors');
const {validModule}=require('./account-access');
function createAccessRoutes({accessControl,gateway,readBody,moduleHandlers={}}){
 const configured=()=>{if(!accessControl)throw new CloudError(503,'access_configuration','O controle de funções ainda precisa ser configurado.');};
 return async function handle({req,res,url,json,session}){
  if(url.pathname==='/api/cloud/access'&&req.method==='GET'){
   configured();json(res,200,await accessControl.access(session.identity));return true;
  }
  if(url.pathname==='/api/cloud/desktop/workspace'&&req.method==='POST'){
   configured();const {workspaceId}=await readBody(req);
   const workspace=await gateway.requireWorkspace(session.accessToken,session.identity,workspaceId);
   if(workspace.role!=='owner')throw new CloudError(403,'local_owner','A instalação local precisa ser aberta pela conta responsável pela empresa.');
   const access=await accessControl.access(session.identity);
   if(!Object.values(access.modules).some(Boolean))throw new CloudError(403,'module_blocked','As funções desta conta estão bloqueadas.');
   json(res,200,{session:{identity:session.identity,kind:'normal',remember:session.remember===true},workspace,access});return true;
  }
  if(url.pathname==='/api/cloud/admin/accounts'&&req.method==='GET'){
   configured();const pageText=url.searchParams.get('page')||'0';
   if(!/^\d+$/.test(pageText))throw new CloudError(400,'validation','Página inválida.');
   json(res,200,await accessControl.accounts(session.identity,{search:url.searchParams.get('search')||'',page:Number(pageText)}));return true;
  }
  if(url.pathname==='/api/cloud/admin/features'&&req.method==='POST'){
   configured();json(res,200,await accessControl.setFeature(session.identity,await readBody(req)));return true;
  }
  const scope=url.pathname.match(/^\/api\/cloud\/workspaces\/([a-f0-9-]+)\/modules\/([a-z]+)(?:\/|$)/i);
  if(scope){
   configured();if(!validModule(scope[2]))throw new CloudError(404,'module','Função não encontrada.');
   const workspace=await gateway.requireWorkspace(session.accessToken,session.identity,scope[1]);
   await accessControl.requireModule(session.identity,scope[2]);
   // Every migrated handler runs behind membership and a fresh account-module check.
   const handler=moduleHandlers[scope[2]];
   if(typeof handler!=='function')throw new CloudError(503,'module_not_migrated','A integração desta função com as contas ainda está em preparação.');
   await handler({req,res,url,json,session,workspace});return true;
  }
  return false;
 };
}
module.exports={createAccessRoutes};
