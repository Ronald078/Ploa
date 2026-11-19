const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, powerSaveBlocker, shell } = require('electron');
const {probeServer,waitForServer,createWindowLoader,failedPanelNavigation}=require('./lib/desktop-startup');
const {attachContentFocus}=require('./lib/desktop-focus');
const {desktopEntry,desktopLoginUrl}=require('./lib/desktop-entry');
const {distributionSettings}=require('./lib/desktop-distribution');

app.setName('Ploa');
app.setAppUserModelId('com.ronald.ploa');

const HOST = '127.0.0.1';
const PROJECT_ROOT = path.resolve(__dirname, '..');
let distributed,distributionError;
try{distributed=distributionSettings({packaged:app.isPackaged,codeRoot:PROJECT_ROOT,resourcesPath:process.resourcesPath,userData:app.getPath('userData')});}catch(error){distributionError=error;}
const entry=desktopEntry(PROJECT_ROOT,{accounts:app.isPackaged||process.env.PLOA_DESKTOP_ACCOUNTS==='1'});
if(distributed)entry.server=distributed.server;
const PORT=entry.port,APP_URL=entry.origin;

let mainWindow = null;
let serverProcess = null;
let serverOutput = '';
let attendancePowerBlocker=null;
function updateAttendancePower(active){
  if(active&&attendancePowerBlocker===null)attendancePowerBlocker=powerSaveBlocker.start('prevent-app-suspension');
  if(!active&&attendancePowerBlocker!==null){powerSaveBlocker.stop(attendancePowerBlocker);attendancePowerBlocker=null;}
}

function logStartupError(error) {
  try {
    const folder=app.getPath('userData');fs.mkdirSync(folder,{recursive:true});
    fs.appendFileSync(path.join(folder,'abertura.log'),new Date().toISOString()+' '+String(error?.message||error).slice(0,500)+'\n');
  } catch {}
}

function rememberServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk}`.slice(-3000);
}

function startInternalServer() {
  serverProcess = fork(entry.server, [], {
    cwd: PROJECT_ROOT,
    env: {
      ...(distributed?.env||process.env),
      CRM_PORT: String(PORT),
      ELECTRON_RUN_AS_NODE: '1',
    },
    silent: true,
    windowsHide: true,
  });

  serverProcess.stdout?.on('data', rememberServerOutput);
  serverProcess.stderr?.on('data', rememberServerOutput);
  serverProcess.on('message',message=>{if(message?.type==='ploa-attendance')updateAttendancePower(message.active===true&&message.keepAwake===true);});
  const child=serverProcess;
  child.on('error',error=>{rememberServerOutput(error.message);logStartupError(error);});
  child.once('exit', () => {
    if(serverProcess!==child)return;
    updateAttendancePower(false);
    serverProcess = null;
  });
}

async function ensureInternalServer(signal) {
  await waitForServer({probe:()=>probeServer(APP_URL),start:startInternalServer,
    isRunning:()=>Boolean(serverProcess),error:()=>serverOutput.trim(),signal});
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    center: true,
    frame: true,
    fullscreen: false,
    kiosk: false,
    resizable: true,
    maximizable: true,
    title: 'Ploa',
    icon: path.join(__dirname, 'public', 'assets', 'ploa-app-icon.png'),
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const window=mainWindow;
  const contentFocus=attachContentFocus(window);
  const loader=createWindowLoader(window,{url:entry.url,readyScript:entry.readyScript,loadingFile:path.join(__dirname,'startup.html'),ensureServer:ensureInternalServer,onError:logStartupError});
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    const login=desktopLoginUrl(url,APP_URL);if(login){void shell.openExternal(login);return{action:'deny'};}
    try{const target=new URL(url),offer=require('./lib/creative-offer-url').normalizeOfferUrl(url);if(offer)void shell.openExternal(offer);else if(target.protocol==='https:'&&!target.username&&!target.password&&['www.facebook.com','pt-br.facebook.com'].includes(target.hostname)&&target.pathname.startsWith('/ads/library'))void shell.openExternal(target.href);}catch{}
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(`${APP_URL}/`)) {event.preventDefault();return;}
    if(loader.fallback){event.preventDefault();void loader.retry();}
  });
  mainWindow.webContents.on('render-process-gone',()=>{void loader.recover();});
  mainWindow.webContents.on('did-fail-load',(_event,code,_description,validatedUrl,isMainFrame)=>{
    if(isMainFrame&&code!==-3&&validatedUrl.startsWith(APP_URL)&&!loader.fallback)void loader.recover();
  });
  mainWindow.webContents.on('did-navigate',(_event,targetUrl,status)=>{
    if(!loader.fallback&&failedPanelNavigation(APP_URL,targetUrl,status))void loader.recover();
  });
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', title: 'Alterações não salvas',
      message: 'Há alterações ou rascunhos que ainda não foram salvos.',
      detail: 'Volte ao painel para salvar ou continue descartando as alterações pendentes.',
      buttons: ['Voltar ao painel', 'Descartar e continuar'],
      defaultId: 0, cancelId: 0, noLink: true,
    });
    // Electron requires this to allow an unload blocked by the page.
    if (choice === 1) event.preventDefault();
    contentFocus.restore();
  });
  mainWindow.once('ready-to-show', () => { if(!window.isDestroyed())window.show(); });
  mainWindow.on('closed', () => {
    loader.dispose();
    contentFocus.dispose();
    mainWindow = null;
  });
  void loader.start();
}

function stopInternalServer() {
  updateAttendancePower(false);
  if(serverProcess&&!serverProcess.killed){
    if(serverProcess.connected)serverProcess.send({type:'ploa-shutdown'},()=>{});
    else serverProcess.kill();
  }
  serverProcess = null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  app.whenReady().then(async () => {
    try {
      if(distributionError)throw distributionError;
      createMainWindow();
    } catch (error) {
      dialog.showErrorBox(
        'Ploa não iniciou',
        `Não foi possível abrir o aplicativo.\n\n${error.message}`,
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopInternalServer);
}
