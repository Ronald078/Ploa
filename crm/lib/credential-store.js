'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');

// DPAPI CurrentUser ties the encrypted file to this Windows user. Secrets travel
// through stdin only: never command arguments, environment variables or disk.
const dpapiScript = (decrypt) => `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $value = [Console]::In.ReadToEnd()
  $entropy = [Text.Encoding]::UTF8.GetBytes('Ploa.AI.Credentials.v1')
  ${decrypt
    ? '$bytes = [Convert]::FromBase64String($value)\n  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)\n  [Console]::Write([Text.Encoding]::UTF8.GetString($result))'
    : '$bytes = [Text.Encoding]::UTF8.GetBytes($value)\n  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)\n  [Console]::Write([Convert]::ToBase64String($result))'}
} catch { exit 1 }
`;

function createCredentialStore({ directory = path.join(os.homedir(), 'AppData', 'Local', 'Ploa'),
  platform = process.platform, run = spawnSync } = {}) {
  const file = path.join(directory, 'credenciais-ia.dpapi.json');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const available = platform === 'win32' && fs.existsSync(executable);

  function transform(input, decrypt) {
    if (!available) throw new Error('A proteção de chaves do Windows não está disponível.');
    try {
      const result = run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', dpapiScript(decrypt)],
        { input, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 65536 });
      if (result.error || result.status !== 0 || !result.stdout?.trim()) throw new Error();
      return result.stdout.trim();
    } catch {
      throw new Error(decrypt
        ? 'Não foi possível recuperar a chave protegida. Informe e salve a chave novamente neste usuário do Windows.'
        : 'Não foi possível proteger e salvar a chave. A configuração anterior foi mantida.');
    }
  }

  function load() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Não foi possível acessar a chave protegida. Informe e salve a chave novamente.'); }
    try {
      if (raw.length > 65536) throw new Error();
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || typeof saved.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(saved.ciphertext)) throw new Error();
      const keys = JSON.parse(transform(saved.ciphertext, true));
      if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error();
      return keys;
    } catch {
      throw new Error('Não foi possível recuperar a chave protegida. Informe e salve a chave novamente neste usuário do Windows.');
    }
  }

  function save(keys) {
    let temp;
    try {
      if (!Object.keys(keys).length) {
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return;
      }
      const ciphertext = transform(JSON.stringify(keys), false);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) throw new Error();
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      temp = path.join(directory, `credenciais-ia.${randomUUID()}.tmp`);
      fs.writeFileSync(temp, JSON.stringify({ version: 1, ciphertext }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
    } catch {
      throw new Error('Não foi possível salvar ou remover a chave protegida. A configuração anterior foi mantida.');
    } finally {
      if (temp) { try { fs.unlinkSync(temp); } catch {} }
    }
  }

  return { available, load, save };
}

module.exports = { createCredentialStore };
