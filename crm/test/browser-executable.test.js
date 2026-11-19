'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { findBrowserExecutable,findWhatsAppBrowserExecutable } = require('../lib/browser-executable');
test('preserva um navegador explicitamente configurado que existe', () => {
  assert.equal(findBrowserExecutable({ env: { PUPPETEER_EXECUTABLE_PATH: 'D:\\Browser\\chrome.exe' }, platform: 'win32', isFile: file => file === 'D:\\Browser\\chrome.exe' }), 'D:\\Browser\\chrome.exe');
});
test('caminho antigo de Chrome ausente usa Edge instalado, sem apagar sessão', () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(findBrowserExecutable({ env: { PUPPETEER_EXECUTABLE_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }, platform: 'win32', isFile: file => file === edge }), edge);
});
test('sem navegador do sistema mantém a resolução padrão do Puppeteer', () => {
  assert.equal(findBrowserExecutable({ env: {}, platform: 'linux', isFile: () => false }), undefined);
  assert.equal(findBrowserExecutable({ env: {}, platform: 'win32', isFile: () => false }), undefined);
});
test('Opera GX instalado tem preferência sobre Edge e Chrome encontrados por padrão', () => {
  const opera='C:\\Users\\Teste\\AppData\\Local\\Programs\\Opera GX\\opera.exe';
  const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(findBrowserExecutable({env:{LOCALAPPDATA:'C:\\Users\\Teste\\AppData\\Local'},platform:'win32',isFile:file=>[opera,edge].includes(file)}),opera);
});
test('WhatsApp usa Edge autorizado sem trocar a preferência do navegador normal',()=>{
 const opera='C:\\Users\\Teste\\AppData\\Local\\Programs\\Opera GX\\opera.exe',edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 const options={env:{LOCALAPPDATA:'C:\\Users\\Teste\\AppData\\Local'},platform:'win32',isFile:file=>[opera,edge].includes(file)};
 assert.equal(findWhatsAppBrowserExecutable(options),edge);assert.equal(findBrowserExecutable(options),opera);
});
