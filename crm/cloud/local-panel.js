'use strict';
const http=require('node:http');
const {CloudError}=require('./errors');
const {UUID}=require('../lib/account-data');
const setup=require('../lib/account-setup');
const VIEWS={dashboard:'dashboard',funnel:'funnel',leads:'leads',search:'search',messages:'messages',ai:'ai',copies:'copies'};
function modulesFor(pathname,method){
 if(pathname.startsWith('/api/internal/'))throw new CloudError(403,'internal','Esta rota pertence ao agente local.');
 if(/^\/api\/processes\/(messages|search)(?:\/|$)/.test(pathname))return[pathname.split('/')[3]];
 if(pathname.startsWith('/api/whatsapp'))return['messages','ai'];
 if(pathname==='/api/messages-audience')return['messages'];
 if(pathname.startsWith('/api/creative-miner')||pathname.startsWith('/api/ads'))return['ads'];
 if(pathname.startsWith('/api/ai-tests')||pathname.startsWith('/api/triage'))return['ai'];
 if(pathname.startsWith('/api/copies')||pathname.startsWith('/api/workspace/copies/'))return['copies'];
 if(pathname==='/api/search-plan')return['search','copies','ai'];
 if(pathname==='/api/settings')return method==='GET'?['messages','search','copies']:['messages','search'];
 if(/^\/api\/workspace\/(restore|backup)$/.test(pathname))return['*'];
 if(pathname.startsWith('/api/workspace/examples')||pathname==='/api/workspace/settings')return['ai'];
 if(pathname.startsWith('/api/workspace/leads/')||pathname.startsWith('/api/leads/')||pathname.startsWith('/api/workspace/filters'))return['leads'];
 if(['/api/processes','/api/operations','/api/dashboard','/api/reports','/api/workspace','/api/mobile-access'].includes(pathname))return['dashboard','funnel','leads','search','messages','ai','copies'];
 throw new CloudError(404,'route','Página não encontrada.');
}
function isPanelPath(pathname){if(pathname==='/assets/ploa-logo-transparent.png')return false;return pathname==='/painel'||pathname.startsWith('/app-next/')||pathname==='/operacao'||pathname.startsWith('/api/')&&!pathname.startsWith('/api/cloud/')||/^\/(?:styles(?:\/|\.css$)|modules\/|workspace\/|assets\/|ploa-[a-z-]+\.(?:css|js)$|app\.js$|creative-[a-z-]+\.(?:css|js)$|mobile-access\.js$|acesso-celular$)/.test(pathname);}
function createLocalPanel({gateway,accessControl,accounts,cookie,setCookie,readBody,runtimes,registry,origin,resolveScope}){
 const selectionCookie=new URL(origin).protocol==='https:'?'__Host-ploa_workspace':'ploa_active_workspace';
 const pendingScopes=new Map();
 async function checkedScope(req,id){
  if(resolveScope)return resolveScope(req,id||cookie(req,selectionCookie));
  const session=await accounts.normalSession(req),selected=id||cookie(req,selectionCookie);
  if(!UUID.test(selected||''))throw new CloudError(409,'workspace_selection','Escolha sua empresa para abrir o painel.');
  const workspace=await gateway.requireWorkspace(session.accessToken,session.identity,selected);
  if(workspace.role!=='owner')throw new CloudError(403,'local_owner','A instalação local precisa ser aberta pela conta responsável pela empresa.');
  const access=await accessControl.access(session.identity);
  if(!Object.values(access.modules).some(Boolean))throw new CloudError(403,'module_blocked','As funções desta conta estão bloqueadas. Consulte a administração.');
  return{session,workspace,access};
 }
 function scope(req,id,{fresh=false}={}){
  const selected=id||cookie(req,selectionCookie),key=(req.headers.cookie||'')+'\n'+selected;
  if(fresh||pendingScopes.size>=128)return checkedScope(req,id);
  if(!pendingScopes.has(key))pendingScopes.set(key,checkedScope(req,id).finally(()=>pendingScopes.delete(key)));
  return pendingScopes.get(key);
 }
 async function handle({req,res,url,json}){
  if(url.pathname==='/api/cloud/panel/agent-authorize'&&req.method==='POST'){
   const item=runtimes.findLease(req.headers['x-ploa-agent-lease']);
   if(!item)throw new CloudError(403,'agent','Agente não autorizado.');
   const context=await scope({headers:{cookie:item.context.cookie}},item.workspaceId,{fresh:true});
   if(context.session.identity.id!==item.accountId)throw new CloudError(403,'agent','Agente não autorizado.');
   const body=await readBody(req);
   if(!Array.isArray(body.modules)||!body.modules.length||body.modules.some(module=>!['messages','ai','search'].includes(module)))throw new CloudError(400,'module','Permissão inválida.');
   if(!body.modules.every(module=>context.access.modules[module]))throw new CloudError(403,'module_blocked','Esta função está bloqueada para sua conta.');
   json(res,200,{authorized:true});return true;
  }
  const opening=url.pathname==='/api/cloud/panel/open'&&req.method==='POST';
  if(!opening&&!isPanelPath(url.pathname))return false;
  if(!accessControl)throw new CloudError(503,'access_configuration','O controle de acesso precisa estar disponível.');
  const body=opening?await readBody(req):null;
  const context=await scope(req,body?.workspaceId);
  const {workspace,session,access}=context;
  if(opening){
   // Identity/membership/permissions are checked before any directory is created.
   const data=registry.resolve(session.identity,workspace);
   await runtimes.check?.(data);
   setCookie(res,workspace.id,undefined,selectionCookie);
   json(res,200,{url:'/painel'});return true;
  }
  const view=url.pathname.match(/^\/app-next\/([a-z]+)\/?$/)?.[1];
  if(view&&(!VIEWS[view]||!access.modules[VIEWS[view]]))throw new CloudError(403,'module_blocked','Esta função está bloqueada para sua conta.');
  if(url.pathname==='/painel'){
   const first=Object.keys(VIEWS).find(key=>access.modules[VIEWS[key]]);
   res.writeHead(302,{Location:first?'/app-next/'+first:'/operacao?view=ads'});res.end();return true;
  }
  if(url.pathname==='/api/account-context'){
   const data=registry.resolve(session.identity,workspace);
   const state=setup.snapshot(data.root);
   json(res,200,{account:{email:session.identity.email,workspaceId:workspace.id,businessName:state.identity?.businessName||workspace.name,name:state.identity?.name||workspace.name,role:workspace.role,administrator:access.administrator,modules:access.modules,legacy:data.legacy},accountUrl:'/conta',setup:state});return true;
  }
  if(url.pathname==='/api/account-setup'&&req.method==='PUT'){
   const data=registry.resolve(session.identity,workspace);
   if(data.legacy)throw new CloudError(409,'legacy_setup','A operação existente mantém suas configurações atuais.');
   try{json(res,200,{setup:setup.saveIdentity(data.root,await readBody(req))});}catch(error){throw new CloudError(error.statusCode||503,'setup',error.statusCode===400?error.message:'Não foi possível salvar a identificação da empresa.');}return true;
  }
  if(url.pathname.startsWith('/api/')){
   if(!['GET','HEAD'].includes(req.method)&&workspace.role==='viewer')throw new CloudError(403,'workspace_read_only','Seu acesso a esta empresa é somente leitura.');
   const required=modulesFor(url.pathname,req.method);
   if(required[0]==='*'?!Object.values(access.modules).every(Boolean):!required.some(key=>access.modules[key]))throw new CloudError(403,'module_blocked','Esta função está bloqueada para sua conta.');
  }
  if(url.pathname==='/operacao'&&!access.modules.ads)throw new CloudError(403,'module_blocked','Esta função está bloqueada para sua conta.');
  const data=registry.resolve(session.identity,workspace);
  const runtime=await runtimes.get(data,{...context,cookie:req.headers.cookie||''});
  await new Promise((resolve,reject)=>{
   const upstream=http.request({hostname:'127.0.0.1',port:runtime.port,path:url.pathname+url.search,method:req.method,
    headers:{host:'127.0.0.1:'+runtime.port,origin:'http://127.0.0.1:'+runtime.port,accept:req.headers.accept||'*/*',
     ...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{}),...(req.headers['content-length']?{'content-length':req.headers['content-length']}:{}),
     'x-ploa-local-token':runtime.token,'x-ploa-account-modules':JSON.stringify(access.modules)}},incoming=>{
      for(const [name,value]of Object.entries(incoming.headers))if(!['set-cookie','connection','transfer-encoding'].includes(name)&&value!==undefined)res.setHeader(name,value);
      res.writeHead(incoming.statusCode);incoming.pipe(res);incoming.once('end',resolve);incoming.once('error',reject);
    });
   upstream.setTimeout(120000,()=>upstream.destroy(new Error('Local panel timeout')));
   upstream.once('error',()=>reject(new CloudError(503,'panel_unavailable','O painel desta empresa está iniciando ou foi encerrado. Tente novamente.')));
   req.once('aborted',()=>upstream.destroy());req.pipe(upstream);
  });
  return true;
 }
 return{handle,scope};
}
module.exports={createLocalPanel,modulesFor,isPanelPath};
