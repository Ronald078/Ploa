const http = require('http');

const path = require('path');
const {CODE_ROOT,dataRoot,credentialDirectory}=require('./lib/runtime-paths');
const {createCredentialStore}=require('./lib/credential-store');

const { createCrmStore } = require('./lib/store');

const { createWorkspaceService } = require('./lib/workspace-service');

const {createSheetMetrics}=require('./lib/metrics');

const {createTriageService}=require('./lib/triage-service');

const {
  operationSettingsSnapshot,
  readOperationSettings,
  writeOperationSettings,
} = require('./lib/operation-settings');

const {
  copySettingsSnapshot,
  readCopySettings,
  writeCopySettings,
} = require('./lib/copy-settings');
const { createProcessManager } = require('./lib/process-manager');
const { createOperationsSnapshot } = require('./lib/operations-snapshot');
const { createHttpTools } = require('./lib/http-tools');
const { createRequestHandler } = require('./lib/http-routes');
const {createAiTestManager}=require('./lib/ai-test-manager');
const {createCreativeMiner}=require('./lib/creative-miner');
const {startRemoteAccess}=require('./lib/remote-access');
const {createMobileAccessStatus}=require('./lib/mobile-access-status');

const HOST = '127.0.0.1';

const PORT = Number(process.env.CRM_PORT || 4310);

const PROJECT_ROOT = dataRoot();
const bridgeToken=process.env.PLOA_ACCOUNT_WORKER==='1'?process.env.PLOA_LOCAL_BRIDGE_TOKEN:null;
if(process.env.PLOA_ACCOUNT_WORKER==='1'&&!/^[a-f0-9]{64}$/.test(bridgeToken||''))throw new Error('O painel privado precisa de autorização local.');

const PUBLIC_ROOT = path.join(__dirname, 'public');

const store = createCrmStore(PROJECT_ROOT);

const workspace = createWorkspaceService(PROJECT_ROOT, store,{credentialStore:createCredentialStore({directory:credentialDirectory(PROJECT_ROOT)}),neutralDefaults:PROJECT_ROOT!==CODE_ROOT});

const sheetMetrics=createSheetMetrics(PROJECT_ROOT);

const triage=createTriageService(PROJECT_ROOT,store,workspace);
const getOperationsSnapshot = createOperationsSnapshot({ PROJECT_ROOT, sheetMetrics });
const getMessageAudience = require('./lib/outreach-audience').createAudiencePreview(PROJECT_ROOT);
const getAdsCatalogSnapshot = () => getCreativeMiner().legacySnapshot();
let creativeMiner=null;
const getCreativeMiner=()=>creativeMiner||=(createCreativeMiner({root:PROJECT_ROOT,workspace,autoStart:process.env.PLOA_ACCOUNT_WORKER!=='1',credentials:createCredentialStore({directory:credentialDirectory(PROJECT_ROOT,'minerador')})}));
const processes = createProcessManager({ workspace, PORT, PROJECT_ROOT, codeRoot:CODE_ROOT, getOperationsSnapshot });
const { startManagedScript, stopManagedScript, pauseManagedScript, getProcessesSnapshot,
  notifyAttendancePower, attendanceWanted, activeProcessStatuses, scriptProcesses } = processes;
const tools = createHttpTools({ HOST, PORT, PUBLIC_ROOT });
const mobileAccess=createMobileAccessStatus({root:PROJECT_ROOT,targetPort:PORT});
let shuttingDown=false;
let remoteAccess=null;
const aiTests=createAiTestManager({root:PROJECT_ROOT,codeRoot:CODE_ROOT,port:PORT,workspace,store,getWhatsapp:()=>getProcessesSnapshot().whatsapp});
const server = http.createServer(createRequestHandler({ HOST, PORT, PROJECT_ROOT, codeRoot:CODE_ROOT, bridgeToken, store, workspace, triage,
  getOperationsSnapshot, getMessageAudience, getAdsCatalogSnapshot, startManagedScript, stopManagedScript, pauseManagedScript,
  getCreativeMiner, getMobileAccess:()=>mobileAccess.snapshot(),
  getProcessesSnapshot, notifyAttendancePower, activeProcessStatuses, scriptProcesses, aiTests, ...processes, ...tools,
  operationSettingsSnapshot, readOperationSettings, writeOperationSettings,
  copySettingsSnapshot, readCopySettings, writeCopySettings, isShuttingDown:()=>shuttingDown }));

server.listen(PORT, HOST, () => {
  if(process.env.PLOA_ACCOUNT_WORKER!=='1')remoteAccess=startRemoteAccess({root:CODE_ROOT,targetPort:PORT});
  console.log(`CRM de prospecção disponível em http://${HOST}:${PORT}`);
  console.log('O painel está restrito a esta máquina. Pressione Ctrl+C para encerrar.');
  // Only previously enabled catalog searches run; collection never calls the sales AI.
  try{getCreativeMiner();}catch{console.error('O catálogo de criativos não iniciou. As outras áreas do Ploa continuam disponíveis.');}
  if(process.env.PLOA_ACCOUNT_WORKER!=='1'&&attendanceWanted())try{startManagedScript('whatsapp');}catch(error){console.error('Atendimento contínuo não iniciou:',error.message);}
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Defina CRM_PORT com outra porta e tente novamente.`);
  } else {
    console.error('Não foi possível iniciar o CRM:', error.message);
  }
  process.exitCode = 1;
});

async function shutdown() {
  sheetMetrics.close?.();
  if (shuttingDown) return;
  shuttingDown=true;
  await remoteAccess?.close();
  if(creativeMiner)await creativeMiner.close();
  workspace.close();
  triage.close();
  await aiTests.close();
  await processes.stopManagedScriptsOnExit();
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.once('disconnect', () => void shutdown());
process.on('message', message => { if (message?.type === 'ploa-shutdown') void shutdown(); });
