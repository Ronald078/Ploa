'use strict';
const {loadSearchPlan}=require('./search-plan');
const {handleCreativeRoute}=require('./creative-routes');
const {panelRedirect}=require('./panel-navigation');
const {timingSafeEqual}=require('node:crypto');
const {requireSetup,markConfigured}=require('./account-setup');
function createRequestHandler({
  HOST,
  PORT,
  PROJECT_ROOT,
  codeRoot=PROJECT_ROOT,
  bridgeToken=null,
  store,
  workspace,
  triage,
  aiTests,
  getOperationsSnapshot,
  getMessageAudience,
  getAdsCatalogSnapshot,
  getCreativeMiner,
  getMobileAccess,
  getProcessesSnapshot,
  startManagedScript,
  stopManagedScript,
  pauseManagedScript,
  requestWhatsappPairing,
  cancelWhatsappPairing,
  notifyAttendancePower,
  attendanceWanted,
  publicProcessState,
  processError,
  cancelAttendanceRetry,
  activeProcessStatuses,
  scriptProcesses,
  sendJson,
  applySecurityHeaders,
  requestIsLocalAndSameOrigin,
  readJsonBody,
  serveStatic,
  operationSettingsSnapshot,
  readOperationSettings,
  writeOperationSettings,
  copySettingsSnapshot,
  readCopySettings,
  writeCopySettings,
  isShuttingDown = () => false
}) {
  return async (request, response) => {
  if (!new Set([HOST + ':' + PORT, 'localhost:' + PORT]).has(String(request.headers.host || '').toLowerCase())) {
    sendJson(response,403,{erro:'O painel aceita somente o endereço local configurado.'}); return;
  }
  let requestUrl;
  try { requestUrl = new URL(request.url, `http://${HOST}:${PORT}`); }
  catch { sendJson(response,400,{erro:'Endereço de solicitação inválido.'}); return; }
  const pathname = requestUrl.pathname;

  try {
    if(bridgeToken&&pathname!=='/healthz'&&!pathname.startsWith('/api/internal/')){
      const supplied=request.headers['x-ploa-local-token'];
      if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(bridgeToken))){sendJson(response,403,{erro:'Abra o painel pela sua conta do Ploa.'});return;}
    }
    const redirect=request.method==='GET'&&panelRedirect(requestUrl);
    if(redirect){applySecurityHeaders(response);response.writeHead(302,{Location:redirect});response.end();return;}
    if(request.method==='GET'&&pathname==='/api/mobile-access'){
      if(!requestIsLocalAndSameOrigin(request)){sendJson(response,403,{erro:'Origem não permitida.'});return;}
      if(!getMobileAccess){sendJson(response,503,{erro:'Reabra o Ploa para carregar o diagnóstico.'});return;}
      try{sendJson(response,200,await getMobileAccess());}
      catch{sendJson(response,503,{erro:'Não foi possível concluir o diagnóstico. Tente novamente.'});}return;
    }
    if(pathname.startsWith('/api/creative-miner')){
      if(!getCreativeMiner){sendJson(response,503,{erro:'Reabra o Ploa para carregar o minerador.'});return;}
      try{await handleCreativeRoute({request,response,pathname,url:requestUrl,getMiner:getCreativeMiner,sendJson,readJsonBody,requestIsLocalAndSameOrigin,applySecurityHeaders});}
      catch(error){const storage=/SQLITE|EPERM|ENOSPC|EACCES/.test(String(error.code||''));sendJson(response,storage?503:error.statusCode||400,{erro:storage?'Não foi possível acessar o banco ou salvar o arquivo do minerador. Confira o espaço e a permissão da pasta.':String(error.message||'Não foi possível concluir a operação.').slice(0,700)});}return;
    }
    if(pathname.startsWith('/api/ai-tests')){
      if(!requestIsLocalAndSameOrigin(request)){sendJson(response,403,{erro:'Origem não permitida.'});return;}
      if(!aiTests){sendJson(response,503,{erro:'Reabra o Ploa para carregar os controles de teste.'});return;}
      if(request.method==='GET'&&pathname==='/api/ai-tests'){sendJson(response,200,aiTests.snapshot());return;}
      if(request.method==='POST'&&['/api/ai-tests/start','/api/ai-tests/stop','/api/ai-tests/reset'].includes(pathname)){
        if(!String(request.headers['content-type']||'').startsWith('application/json')){sendJson(response,415,{erro:'Envie JSON.'});return;}
        await readJsonBody(request,4096);
        const result=pathname.endsWith('/start')?await aiTests.start():pathname.endsWith('/reset')?aiTests.reset():aiTests.stop();sendJson(response,202,result);return;
      }
      sendJson(response,404,{erro:'Rota não encontrada.'});return;
    }
    if(pathname.startsWith('/api/triage')){
      if(!requestIsLocalAndSameOrigin(request)){sendJson(response,403,{erro:'Origem não permitida.'});return;}
      if(request.method==='GET'&&pathname==='/api/triage'){sendJson(response,200,triage.snapshot());return;}
      if(request.method==='POST'){
        if(!String(request.headers['content-type']||'').startsWith('application/json')){sendJson(response,415,{erro:'Envie JSON.'});return;}
        const body=await readJsonBody(request,100*1024);
        if(pathname==='/api/triage/start'){sendJson(response,202,await triage.start(body));return;}
        if(pathname==='/api/triage/apply'){sendJson(response,200,await triage.apply());return;}
        if(pathname==='/api/triage/undo'){sendJson(response,200,await triage.undo());return;}
      }
      sendJson(response,404,{erro:'Rota não encontrada.'});return;
    }
    if(pathname.startsWith('/api/whatsapp')){
      if(!requestIsLocalAndSameOrigin(request)){sendJson(response,403,{erro:'Origem não permitida.'});return;}
      if(request.method==='POST'&&['/api/whatsapp/pairing','/api/whatsapp/pairing/cancel'].includes(pathname)){
        if(!pathname.endsWith('/cancel'))requireSetup(PROJECT_ROOT,'whatsapp');
        if(!String(request.headers['content-type']||'').startsWith('application/json')){sendJson(response,415,{erro:'Envie JSON.'});return;}
        const body=await readJsonBody(request,4096);
        if(!requestWhatsappPairing||!cancelWhatsappPairing){sendJson(response,503,{erro:'Reabra o Ploa para carregar a conexão por código.'});return;}
        const pairing=pathname.endsWith('/cancel')?cancelWhatsappPairing():requestWhatsappPairing(body.phone);
        sendJson(response,202,{pairing});return;
      }
      if(request.method==='GET'&&pathname==='/api/whatsapp'){sendJson(response,200,publicProcessState(scriptProcesses.get('whatsapp')));return;}
      if(request.method==='POST'&&pathname==='/api/whatsapp/start'){
        requireSetup(PROJECT_ROOT,'whatsapp');
        await workspace.mutate(data=>{data.settings.keepConnected=true;});
        const state=scriptProcesses.get('whatsapp');
        sendJson(response,202,{process:activeProcessStatuses.has(state.status)?publicProcessState(state):startManagedScript('whatsapp')});return;
      }
      if(request.method==='POST'&&pathname==='/api/whatsapp/stop'){
        await workspace.mutate(data=>{data.settings.keepConnected=false;});
        cancelAttendanceRetry();
        const state=scriptProcesses.get('whatsapp');
        sendJson(response,202,{process:activeProcessStatuses.has(state.status)?stopManagedScript('whatsapp'):publicProcessState(state)});return;
      }
      sendJson(response,404,{erro:'Rota não encontrada.'});return;
    }
    if (pathname.startsWith('/api/internal/')) {
      if (request.method !== 'POST' || !workspace.authorizeInternal(request)) {
        sendJson(response, 403, { erro: 'Agente local não autorizado.' }); return;
      }
      const body = await readJsonBody(request, 100 * 1024);
      if (pathname === '/api/internal/events') sendJson(response, 200, await workspace.ingest(body));
      else if (pathname === '/api/internal/next') sendJson(response, 200, { job: await workspace.nextDelivery() });
      else if (pathname === '/api/internal/ack') { await workspace.ack(body); sendJson(response, 200, { saved: true }); }
      else sendJson(response, 404, { erro: 'Rota não encontrada.' });
      return;
    }
    if (pathname.startsWith('/api/workspace') || pathname === '/api/reports') {
      if (!requestIsLocalAndSameOrigin(request)) { sendJson(response,403,{erro:'Origem não permitida.'}); return; }
      const running = [...scriptProcesses.values()].some((item) => activeProcessStatuses.has(item.status));
      if (request.method === 'GET' && pathname === '/api/workspace') {
        sendJson(response,200,workspace.publicSnapshot()); return;
      }
      if (request.method === 'GET' && pathname === '/api/reports') {
        sendJson(response,200,await workspace.reports()); return;
      }
      if (request.method === 'GET' && pathname === '/api/workspace/backup') {
        if (running) throw processError('Encerre os scripts antes de gerar um backup consistente.',409);
        response.setHeader('Content-Disposition', 'attachment; filename="ploa-backup.json"');
        sendJson(response,200,workspace.exportBackup()); return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        sendJson(response,415,{erro:'Envie os dados no formato JSON.'}); return;
      }
      const body = await readJsonBody(request, pathname.endsWith('/restore') ? 25 * 1024 * 1024 : pathname.endsWith('/settings') ? 512 * 1024 : 100 * 1024);
      if (request.method === 'PUT' && pathname === '/api/workspace/settings') {
        if(body.enabled===true&&aiTests?.snapshot().running){sendJson(response,409,{erro:'Encerre o teste antes de ativar o atendimento geral da IA.'});return;}
        const saved=await workspace.saveSettings(body);
        if(body.enabled===true)await workspace.mutate(data=>{data.settings.keepConnected=true;});
        if(attendanceWanted()&&!activeProcessStatuses.has(scriptProcesses.get('whatsapp').status))startManagedScript('whatsapp');
        notifyAttendancePower();sendJson(response,200,workspace.publicSnapshot()); return;
      }
      if (request.method === 'POST' && pathname === '/api/workspace/examples') {
        await workspace.addExample(body); sendJson(response,200,workspace.publicSnapshot()); return;
      }
      if (request.method === 'DELETE' && pathname.startsWith('/api/workspace/examples/')) {
        await workspace.removeExample(decodeURIComponent(pathname.split('/').at(-1)));
        sendJson(response,200,workspace.publicSnapshot()); return;
      }
      if (request.method === 'POST' && pathname === '/api/workspace/filters') {
        sendJson(response,200,await workspace.saveFilter(body)); return;
      }
      if (request.method === 'POST' && pathname === '/api/workspace/restore') {
        if (running) throw processError('Encerre os scripts antes de restaurar o backup.',409);
        sendJson(response,200,await workspace.restoreBackup(body)); return;
      }
      if (request.method === 'POST' && pathname.startsWith('/api/workspace/copies/')) {
        if (running) throw processError('Encerre os scripts antes de restaurar uma versão.',409);
        const previous = workspace.getCopyVersion(decodeURIComponent(pathname.split('/').at(-1)));
        if (!previous) throw processError('Versão não encontrada.',404);
        await workspace.saveCopyVersion(await readCopySettings(PROJECT_ROOT));
        sendJson(response,200,copySettingsSnapshot(await writeCopySettings(PROJECT_ROOT,previous))); return;
      }
      const contactMatch = pathname.match(/^\/api\/workspace\/leads\/(.+)$/);
      if (request.method === 'POST' && contactMatch) {
        sendJson(response,200,await workspace.command(decodeURIComponent(contactMatch[1]),body)); return;
      }
      sendJson(response,404,{erro:'Rota não encontrada.'}); return;
    }
    if (request.method === 'GET' && pathname === '/healthz') {
      const stopping=isShuttingDown();
      sendJson(response, stopping?503:200, { status: stopping?'stopping':'ok' });
      return;
    }

    if (request.method === 'GET' && pathname === '/favicon.ico') {
      applySecurityHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && pathname === '/api/dashboard') {
      sendJson(response, 200, await store.getDashboard());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/messages-audience') {
      if (!requestIsLocalAndSameOrigin(request)) { sendJson(response,403,{erro:'Origem não permitida.'});return; }
      if (!getMessageAudience) { sendJson(response,503,{erro:'Reabra o Ploa para carregar a seleção de país.'});return; }
      try { sendJson(response,200,await getMessageAudience(requestUrl.searchParams.get('country') || '')); }
      catch (error) { sendJson(response,error.statusCode || 503,{erro:error.statusCode ? error.message : 'Não foi possível contar os contatos. Tente atualizar a seleção.'}); }
      return;
    }
    if (request.method === 'GET' && pathname === '/api/operations') {
      const snapshot = await getOperationsSnapshot();
      const campaign = scriptProcesses?.get('messages'), attendance = scriptProcesses?.get('whatsapp');
      // Historical telemetry survives a restart; only the live manager can
      // establish whether a campaign is currently running.
      const executing = status => ['starting', 'running'].includes(status);
      sendJson(response, 200, { ...snapshot, messages: { ...snapshot.messages,
        executionActive: executing(campaign?.status) && executing(attendance?.status),
        connectionStatus: attendance?.connection || 'disconnected',
      } });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/processes') {
      sendJson(response, 200, getProcessesSnapshot());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/ads') {
      sendJson(response, 200, await getAdsCatalogSnapshot());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/settings') {
      sendJson(response, 200, operationSettingsSnapshot(await readOperationSettings(PROJECT_ROOT)));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/search-plan') {
      if(!requestIsLocalAndSameOrigin(request)){sendJson(response,403,{erro:'Origem não permitida.'});return;}
      sendJson(response,200,await loadSearchPlan(PROJECT_ROOT,{codeRoot}));return;
    }

    if (request.method === 'GET' && pathname === '/api/copies') {
      sendJson(response, 200, copySettingsSnapshot(await readCopySettings(PROJECT_ROOT)));
      return;
    }

    if (request.method === 'PUT' && pathname === '/api/settings') {
      if (!requestIsLocalAndSameOrigin(request)) {
        sendJson(response, 403, { erro: 'Origem da atualização não permitida.' });
        return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        sendJson(response, 415, { erro: 'Use application/json para atualizar as configurações.' });
        return;
      }
      if ([...scriptProcesses.values()].some((state) => state.id!=='whatsapp'&&activeProcessStatuses.has(state.status))) {
        sendJson(response, 409, { erro: 'Encerre os scripts em execução antes de alterar as configurações.' });
        return;
      }

      const nextSettings=await readJsonBody(request);
      if(bridgeToken){
        const permissions=JSON.parse(request.headers['x-ploa-account-modules']||'{}'),previous=await readOperationSettings(PROJECT_ROOT);
        for(const key of ['messages','search'])if(!permissions[key]&&JSON.stringify(nextSettings[key])!==JSON.stringify(previous[key])){sendJson(response,403,{erro:'Esta configuração está bloqueada para sua conta.'});return;}
      }
      const settings = await writeOperationSettings(PROJECT_ROOT,nextSettings);
      markConfigured(PROJECT_ROOT,requestUrl.searchParams.get('section'));
      scriptProcesses.get('whatsapp').child?.send({type:'ploa-reload-settings'},()=>{});
      sendJson(response, 200, operationSettingsSnapshot(settings));
      return;
    }

    if (request.method === 'PUT' && pathname === '/api/copies') {
      if (!requestIsLocalAndSameOrigin(request)) {
        sendJson(response, 403, { erro: 'Origem da atualização não permitida.' });
        return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        sendJson(response, 415, { erro: 'Use application/json para atualizar as copys.' });
        return;
      }
      if ([...scriptProcesses.values()].some((state) => state.id!=='whatsapp'&&activeProcessStatuses.has(state.status))) {
        sendJson(response, 409, { erro: 'Encerre os scripts em execução antes de alterar as copys.' });
        return;
      }

      const copyBody = await readJsonBody(request, 512 * 1024);
      await workspace.saveCopyVersion(await readCopySettings(PROJECT_ROOT));
      const settings = await writeCopySettings(PROJECT_ROOT, copyBody);
      scriptProcesses.get('whatsapp').child?.send({type:'ploa-reload-settings'},()=>{});
      sendJson(response, 200, copySettingsSnapshot(settings));
      return;
    }

    const processAction = pathname.match(/^\/api\/processes\/(search|messages)\/(start|stop|pause|resume)$/);
    if (request.method === 'POST' && processAction) {
      if (!requestIsLocalAndSameOrigin(request)) {
        sendJson(response, 403, { erro: 'Origem da execução não permitida.' });
        return;
      }
      const [, scriptId, action] = processAction;
      const processState = action === 'start'
        ? (requireSetup(PROJECT_ROOT,scriptId),startManagedScript(scriptId))
        : action === 'stop' ? stopManagedScript(scriptId) : pauseManagedScript(scriptId, action);
      sendJson(response, 202, { process: processState });
      return;
    }

    if (request.method === 'PATCH' && pathname.startsWith('/api/leads/')) {
      if (!requestIsLocalAndSameOrigin(request)) {
        sendJson(response, 403, { erro: 'Origem da atualização não permitida.' });
        return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        sendJson(response, 415, { erro: 'Use application/json para atualizar um lead.' });
        return;
      }

      const encodedId = pathname.slice('/api/leads/'.length);
      let id;
      try {
        id = decodeURIComponent(encodedId);
      } catch {
        sendJson(response, 400, { erro: 'Identificador de lead inválido.' });
        return;
      }

      const lead = await store.updateLead(id, await readJsonBody(request));
      sendJson(response, 200, { lead });
      return;
    }

    if (request.method === 'GET' && await serveStatic(response, pathname)) return;
    sendJson(response, 404, { erro: 'Rota não encontrada.' });
  } catch (error) {
    const clientError = /inválid|permitido|encontrado|máximo|formato|número/i.test(error.message);
    sendJson(response, error.statusCode || (clientError ? 400 : 500), {
      erro: clientError || error.statusCode ? error.message : 'O CRM encontrou um erro ao processar a solicitação.',
    });
  }
};
}
module.exports = { createRequestHandler };
