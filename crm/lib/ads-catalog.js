'use strict';
const { readOptionalJson } = require('./json-files');
function createAdsCatalog({ file }) {
  const ADS_CATALOG_FILE = file;
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function normalizeAdEntry(raw, index) {
  const activeDays = Math.max(0, Number(raw.activeDays) || 0);
  const variants = Math.max(0, Number(raw.variants) || 0);
  const placements = Math.max(0, Number(raw.placements) || 0);
  const sightings = Math.max(0, Number(raw.sightings) || 0);
  const derivedScore = Math.round((activeDays * 1.5) + (variants * 9) + (placements * 5) + (sightings * 2));
  const scaleScore = clamp(Number.isFinite(Number(raw.scaleScore)) ? Number(raw.scaleScore) : derivedScore, 0, 100);
  const scaleLevel = scaleScore >= 80 ? 'Muito forte' : scaleScore >= 60 ? 'Forte' : scaleScore >= 35 ? 'Em validação' : 'Baixo sinal';

  return {
    id: String(raw.id || `ad-${index + 1}`).slice(0, 120),
    title: String(raw.title || 'Anúncio sem título').slice(0, 180),
    advertiser: String(raw.advertiser || 'Anunciante não informado').slice(0, 160),
    niche: String(raw.niche || 'Sem nicho').slice(0, 100),
    platform: String(raw.platform || 'Meta Ads').slice(0, 80),
    format: String(raw.format || 'Não informado').slice(0, 80),
    status: String(raw.status || 'observado').slice(0, 60),
    summary: String(raw.summary || '').slice(0, 700),
    hook: String(raw.hook || '').slice(0, 500),
    offer: String(raw.offer || '').slice(0, 500),
    referenceUrl: safeHttpUrl(raw.referenceUrl),
    firstSeen: raw.firstSeen || null,
    lastSeen: raw.lastSeen || null,
    activeDays,
    variants,
    placements,
    sightings,
    scaleScore,
    scaleLevel,
  };
}

async function getAdsCatalogSnapshot() {
  const rawCatalog = await readOptionalJson(ADS_CATALOG_FILE);
  const entries = Array.isArray(rawCatalog) ? rawCatalog : rawCatalog.ads;
  const ads = (Array.isArray(entries) ? entries : [])
    .slice(0, 500)
    .map(normalizeAdEntry)
    .sort((left, right) => right.scaleScore - left.scaleScore);
  const niches = [...new Set(ads.map((ad) => ad.niche))].sort((left, right) => left.localeCompare(right, 'pt-BR'));

  return {
    ads,
    summary: {
      total: ads.length,
      highScale: ads.filter((ad) => ad.scaleScore >= 60).length,
      niches: niches.length,
      active: ads.filter((ad) => normalizeSearchValue(ad.status) === 'ativo').length,
    },
    niches,
    methodology: 'O índice de escala é um sinal de 0 a 100 calculado por duração, variações, posicionamentos e recorrência. Não representa faturamento ou orçamento real.',
  };
}

function normalizeSearchValue(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
  return getAdsCatalogSnapshot;
}
module.exports = { createAdsCatalog };
