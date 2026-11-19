'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process');
function readContactRows(file) {
  const portable = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  const python = process.env.CRM_PYTHON_COMMAND || (process.platform === 'win32' && fs.existsSync(portable) ? portable : 'python');
  return new Promise((resolve,reject) => execFile(python, ['-B', path.resolve(__dirname, '../contact_rows.py'), file],
    { windowsHide:true, timeout:55000, maxBuffer:32 * 1024 * 1024, encoding:'utf8' }, (error,stdout) => {
      if(error) { reject(Error('Contact worksheet unavailable'));return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(Error('Contact worksheet invalid')); }
    }));
}
module.exports = { readContactRows };
