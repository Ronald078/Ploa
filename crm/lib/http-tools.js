'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { endJson } = require('./http-compression');
const { createNextAppStatic } = require('./next-app-static');
function createHttpTools({ HOST, PORT, PUBLIC_ROOT }) {
const staticFiles = new Map([
  ['/acesso-celular',{file:'mobile-access.html',type:'text/html; charset=utf-8'}],
  ['/mobile-access.js',{file:'mobile-access.js',type:'application/javascript; charset=utf-8'}],
  ['/styles/mobile-diagnostic.css',{file:'styles/mobile-diagnostic.css',type:'text/css; charset=utf-8'}],
  ['/styles/mobile-access.css',{file:'styles/mobile-access.css',type:'text/css; charset=utf-8'}],
  ['/creative-site.js',{file:'creative-site.js',type:'application/javascript; charset=utf-8'}],
  ['/creative-production.js',{file:'creative-production.js',type:'application/javascript; charset=utf-8'}],
  ['/creative-render.js',{file:'creative-render.js',type:'application/javascript; charset=utf-8'}],
  ['/creative-miner.js',{file:'creative-miner.js',type:'application/javascript; charset=utf-8'}],
  ['/creative-miner.css',{file:'creative-miner.css',type:'text/css; charset=utf-8'}],
  ['/ploa-token-usage.js', {file:'ploa-token-usage.js',type:'application/javascript; charset=utf-8'}],
  ['/ploa-token-usage.css', {file:'ploa-token-usage.css',type:'text/css; charset=utf-8'}],
  ['/ploa-ia-tests.js', {file:'ploa-ia-tests.js',type:'application/javascript; charset=utf-8'}],
  ['/ploa-ia-tests.css', {file:'ploa-ia-tests.css',type:'text/css; charset=utf-8'}],
  ['/styles/foundation.css', { file: 'styles/foundation.css', type: 'text/css; charset=utf-8' }],
  ['/styles/navigation.css', { file: 'styles/navigation.css', type: 'text/css; charset=utf-8' }],
  ['/styles/dashboard-funnel.css', { file: 'styles/dashboard-funnel.css', type: 'text/css; charset=utf-8' }],
  ['/styles/lead-workspace.css', { file: 'styles/lead-workspace.css', type: 'text/css; charset=utf-8' }],
  ['/styles/script-controls.css', { file: 'styles/script-controls.css', type: 'text/css; charset=utf-8' }],
  ['/styles/catalog-display.css', { file: 'styles/catalog-display.css', type: 'text/css; charset=utf-8' }],
  ['/styles/responsive.css', { file: 'styles/responsive.css', type: 'text/css; charset=utf-8' }],
  ['/styles/theme-layout.css', { file: 'styles/theme-layout.css', type: 'text/css; charset=utf-8' }],
  ['/styles/settings-layout.css', { file: 'styles/settings-layout.css', type: 'text/css; charset=utf-8' }],
  ['/styles/window-search.css', { file: 'styles/window-search.css', type: 'text/css; charset=utf-8' }],
  ['/styles/copy-editor.css', { file: 'styles/copy-editor.css', type: 'text/css; charset=utf-8' }],
  ['/styles/brand-metrics.css', { file: 'styles/brand-metrics.css', type: 'text/css; charset=utf-8' }],
  ['/styles/funnel-layout.css', { file: 'styles/funnel-layout.css', type: 'text/css; charset=utf-8' }],
  ['/styles/card-spacing.css', { file: 'styles/card-spacing.css', type: 'text/css; charset=utf-8' }],
  ['/styles/attention-sidebar.css', { file: 'styles/attention-sidebar.css', type: 'text/css; charset=utf-8' }],
  ['/styles/lead-classification.css', { file: 'styles/lead-classification.css', type: 'text/css; charset=utf-8' }],
  ['/ploa-page-details.css', { file: 'ploa-page-details.css', type: 'text/css; charset=utf-8' }],
  ['/ploa-search-plan.js', { file: 'ploa-search-plan.js', type: 'application/javascript; charset=utf-8' }],
  ['/ploa-copy-preview.js', { file: 'ploa-copy-preview.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/catalogs.js', { file: 'modules/catalogs.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/elements.js', { file: 'modules/elements.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/core.js', { file: 'modules/core.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/suggestions.js', { file: 'modules/suggestions.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/dashboard.js', { file: 'modules/dashboard.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/leads.js', { file: 'modules/leads.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/funnel.js', { file: 'modules/funnel.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/settings.js', { file: 'modules/settings.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/copies.js', { file: 'modules/copies.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/processes.js', { file: 'modules/processes.js', type: 'application/javascript; charset=utf-8' }],
  ['/modules/ads.js', { file: 'modules/ads.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/selects.js', { file: 'workspace/selects.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/conversation.js', { file: 'workspace/conversation.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/filters.js', { file: 'workspace/filters.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/attendance.js', { file: 'workspace/attendance.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/pairing.js', { file: 'workspace/pairing.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/connection.js', { file: 'workspace/connection.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/business.js', { file: 'workspace/business.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/knowledge.js', { file: 'workspace/knowledge.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/versions.js', { file: 'workspace/versions.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/priorities.js', { file: 'workspace/priorities.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/runs.js', { file: 'workspace/runs.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/backup.js', { file: 'workspace/backup.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/processes.js', { file: 'workspace/processes.js', type: 'application/javascript; charset=utf-8' }],
  ['/workspace/sidebar.js', { file: 'workspace/sidebar.js', type: 'application/javascript; charset=utf-8' }],
  ['/operacao', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'application/javascript; charset=utf-8' }],
  ['/ploa-theme.css', { file: 'ploa-theme.css', type: 'text/css; charset=utf-8' }],
  ['/ploa-workspace.js', { file: 'ploa-workspace.js', type: 'application/javascript; charset=utf-8' }],
  ['/ploa-metrics.js',{file:'ploa-metrics.js',type:'application/javascript; charset=utf-8'}],
  ['/ploa-sections.js',{file:'ploa-sections.js',type:'application/javascript; charset=utf-8'}],
  ['/ploa-triage.js',{file:'ploa-triage.js',type:'application/javascript; charset=utf-8'}],
  ['/ploa-operations.css',{file:'ploa-operations.css',type:'text/css; charset=utf-8'}],
  ['/assets/pipeline-logo.png', { file: 'assets/pipeline-logo.png', type: 'image/png' }],
  ['/assets/ploa-logo-transparent.png', { file: 'assets/ploa-logo-transparent.png', type: 'image/png' }],
]);

function applySecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, payload) {
  applySecurityHeaders(response);
  endJson(response, status, payload);
}

function requestIsLocalAndSameOrigin(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;

  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const allowedHost = ['127.0.0.1', 'localhost'].includes(parsed.hostname);
    return allowedHost && Number(parsed.port || 80) === PORT;
  } catch {
    return false;
  }
}

async function readJsonBody(request, maximumBytes = 32768) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) {
      const error = new Error('A atualização ultrapassa o limite permitido.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('O conteúdo enviado não é um JSON válido.');
    error.statusCode = 400;
    throw error;
  }
}

const serveNextApp = createNextAppStatic({ PUBLIC_ROOT, applySecurityHeaders });
async function serveStatic(response, pathname) {
  if (await serveNextApp(response, pathname)) return true;
  const asset = staticFiles.get(pathname);
  if (!asset) return false;

  try {
    const content = await fs.promises.readFile(path.join(PUBLIC_ROOT, asset.file));
    applySecurityHeaders(response);
    response.writeHead(200, { 'Content-Type': asset.type });
    response.end(content);
  } catch {
    sendJson(response, 500, { erro: 'Não foi possível carregar a interface do CRM.' });
  }
  return true;
}
  return { sendJson, applySecurityHeaders, requestIsLocalAndSameOrigin, readJsonBody, serveStatic };
}
module.exports = { createHttpTools };
