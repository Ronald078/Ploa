'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { localDateKey } = require('./store');
const { readSmallJson } = require('./json-files');
function createOperationsSnapshot({ PROJECT_ROOT, sheetMetrics }) {
const operationFiles = {
  searchProgress: path.join(PROJECT_ROOT, 'progresso_busca.json'),
  searchTelemetry: path.join(PROJECT_ROOT, 'andamento_busca.json'),
  messageProgress: path.join(PROJECT_ROOT, 'progresso_envios.json'),
  messageTelemetry: path.join(PROJECT_ROOT, 'andamento_envios.json'),
  dailyCounter: path.join(PROJECT_ROOT, 'contador_diario.json'),
};

async function directoryContainsPrefix(directory, prefix) {
  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    return entries.some((entry) => entry.name.startsWith(prefix));
  } catch {
    return false;
  }
}

async function directoryHasFiles(directory) {
  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) return true;
      if (entry.isDirectory() && await directoryHasFiles(path.join(directory, entry.name))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function getOperationsSnapshot() {
  const [searchTelemetry, messageProgress, messageTelemetry, dailyCounter, sheet] = await Promise.all([
    readSmallJson(operationFiles.searchTelemetry),
    readSmallJson(operationFiles.messageProgress),
    readSmallJson(operationFiles.messageTelemetry),
    readSmallJson(operationFiles.dailyCounter),
    sheetMetrics(),
  ]);
  // Telemetry is the normal path. A bounded legacy/header fallback must never
  // load the sources or lead lists from a large checkpoint into the UI server.
  const searchProgress = searchTelemetry.cidades_concluidas_quantidade != null
    ? {} : await readSmallJson(operationFiles.searchProgress);

  const completedCities = Array.isArray(searchProgress.cidades_concluidas)
    ? searchProgress.cidades_concluidas
    : [];
  const processed = Math.max(0, Number(messageProgress.indice) || 0);
  const total = Math.max(0, Number(messageProgress.totalContatos) || 0);
  const percentage = total ? Math.round((processed / total) * 1000) / 10 : 0;
  const completedCityCount = Math.max(
    0,
    Number(searchTelemetry.cidades_concluidas_quantidade ?? completedCities.length) || 0,
  );
  const totalCities = Math.max(0, Number(searchTelemetry.total_cidades) || 0);
  const remainingCities = Math.max(
    0,
    Number.isFinite(Number(searchTelemetry.cidades_faltantes))
      ? Number(searchTelemetry.cidades_faltantes)
      : totalCities - completedCityCount,
  );
  const searchPercentage = totalCities
    ? Math.round((completedCityCount / totalCities) * 1000) / 10
    : 0;
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const userProfile = process.env.USERPROFILE || '';

  const [ffmpegInstalled, tesseractInstalled, ollamaInstalled, ollamaHasModel] = await Promise.all([
    directoryContainsPrefix(path.join(localAppData, 'Microsoft', 'WinGet', 'Packages'), 'Gyan.FFmpeg_'),
    fs.promises.access(path.join(programFiles, 'Tesseract-OCR', 'tesseract.exe')).then(() => true).catch(() => false),
    fs.promises.access(path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe')).then(() => true).catch(() => false),
    directoryHasFiles(path.join(userProfile, '.ollama', 'models', 'manifests')),
  ]);

  return {
    search: {
      status: searchTelemetry.status || 'aguardando',
      completedCities: completedCityCount,
      totalCities,
      remainingCities,
      percentage: searchPercentage,
      currentCity: searchTelemetry.cidade_atual || '',
      currentCategory: searchTelemetry.categoria_atual || '',
      categoryIndex: Math.max(0, Number(searchTelemetry.categoria_indice) || 0),
      totalCategories: Math.max(0, Number(searchTelemetry.total_categorias) || 0),
      processedQueries: Math.max(0, Number(searchTelemetry.consultas_processadas) || 0),
      totalQueries: Math.max(0, Number(searchTelemetry.total_consultas) || 0),
      newLeads: Math.max(0, Number(searchTelemetry.novos_leads) || 0),
      foundLeads: Math.max(0, Number(searchTelemetry.encontrados) || 0),
      totalLeads: searchTelemetry.total_leads==null?null:Math.max(0,Number(searchTelemetry.total_leads)||0),
      measured:searchTelemetry.total_leads!=null,
      lastCity: searchTelemetry.ultima_cidade || completedCities.at(-1) || '',
      startedAt: searchTelemetry.iniciada_em || null,
      updatedAt: searchTelemetry.atualizado_em || searchProgress.atualizado_em || null,
    },
    messages: {
      processed,
      total,
      percentage,
      sentToday: dailyCounter.data===localDateKey()?Math.max(0, Number(dailyCounter.enviados) || 0):0,
      executionStatus: messageTelemetry.status || 'aguardando',
      executionAudience: messageTelemetry.audience?.label || 'Envio geral',
      executionTotal: Math.max(0, Number(messageTelemetry.totalContatos) || 0),
      executionPosition: Math.max(0, Number(messageTelemetry.indiceAtual) || 0),
      executionSent: Math.max(0, Number(messageTelemetry.enviadas) || 0),
      executionTarget: Math.max(0, Number(messageTelemetry.metaMensagens) || 0),
      executionRemaining: Math.max(0, Number(messageTelemetry.faltantes) || 0),
      executionProcessed: Math.max(0, Number(messageTelemetry.processados) || 0),
      executionResults: messageTelemetry.resultados && typeof messageTelemetry.resultados === 'object' ? messageTelemetry.resultados : null,
      nextSendAt: messageTelemetry.proximoEnvioEm || null,
      waitKind: messageTelemetry.esperaTipo || '',
      listFinished: messageTelemetry.listaPercorrida === true,
      currentContact: messageTelemetry.contatoAtual || '',
      executionStartedAt: messageTelemetry.iniciadaEm || null,
      updatedAt: messageTelemetry.atualizadoEm || messageProgress.atualizadoEm || null,
    },
    bases:{sheet,lastRun:{value:messageTelemetry.totalContatos??messageProgress.totalContatos??null,unit:'contatos no último lote',source:'Progresso dos disparos',updatedAt:messageTelemetry.atualizadoEm||messageProgress.atualizadoEm||null}},
    ads: {
      ffmpegInstalled,
      tesseractInstalled,
      ollamaInstalled,
      ollamaHasModel,
    },
  };
}
  return getOperationsSnapshot;
}
module.exports = { createOperationsSnapshot };
