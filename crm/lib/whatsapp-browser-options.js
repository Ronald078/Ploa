'use strict';
const {findWhatsAppBrowserExecutable}=require('./browser-executable');

function whatsappBrowserOptions({env=process.env,executablePath=findWhatsAppBrowserExecutable({env})}={}){
  const opera=/(?:^|[\\/])opera(?:\.exe)?$/i.test(executablePath||'');
  return {
    executablePath,headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas','--disable-gpu','--no-first-run','--no-default-browser-check',
      ...(opera?['--disable-splash-screen']:[])],
    ...(opera?{env:{...env,OPERA_DISABLE_SPLASH_SCREEN:'1'}}:{}),
  };
}
module.exports={whatsappBrowserOptions};
