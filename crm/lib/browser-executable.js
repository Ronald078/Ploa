'use strict';
const fs = require('node:fs');
const path = require('node:path');

function findBrowserExecutable({ env = process.env, platform = process.platform, preferredBrowser = 'opera', isFile = file => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
} } = {}) {
  const candidates = [env.PUPPETEER_EXECUTABLE_PATH];
  if (platform === 'win32') {
    if(preferredBrowser==='edge')for(const base of [env.ProgramFiles || 'C:\\Program Files',env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']){
      candidates.push(path.win32.join(base,'Microsoft','Edge','Application','msedge.exe'));
    }
    // Prefer the installed Opera used on this notebook. A custom executable
    // explicitly supplied by the user still takes priority when it exists.
    if (env.LOCALAPPDATA) for (const name of ['Opera', 'Opera GX']) candidates.push(path.win32.join(env.LOCALAPPDATA, 'Programs', name, 'opera.exe'));
    for (const base of [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      for (const name of ['Opera', 'Opera GX']) candidates.push(path.win32.join(base, name, 'opera.exe'));
    }
    for (const base of [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      candidates.push(path.win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.win32.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    if (env.LOCALAPPDATA) candidates.push(path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return [...new Set(candidates)].find(file => typeof file === 'string' && file.length > 0 && isFile(file));
}

function findWhatsAppBrowserExecutable(options={}){
  return findBrowserExecutable({...options,preferredBrowser:'edge'});
}
module.exports = { findBrowserExecutable, findWhatsAppBrowserExecutable };
