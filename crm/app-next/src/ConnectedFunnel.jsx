import React from 'react';
import { integer, percent } from './model.js';
import { pageLink } from './navigation.js';

export const stageFilter = id => ({ primeiro_contato: 'todos', apresentacao_proposta: 'propostas', conversao_cliente: 'clientes', vendas: 'vendas' }[id] || 'todos');
export function ConnectedFunnel({ steps = [], compact = false }) {
  const first = Math.max(steps[0]?.count || 0, 1), edge = compact ? 12 : 22, center = compact ? 94 : 178;
  const width = (1200 - 2 * edge) / Math.max(1, steps.length);
  const heights = steps.map(step => Math.round((compact ? 62 : 104) + (compact ? 70 : 168) * Math.sqrt(Math.max(0, Math.min(1, step.count / first)))));
  const final = Math.max(compact ? 38 : 58, Math.round((heights.at(-1) || 0) * .84));
  const outline = sign => [...heights.map((height, i) => `${edge + width * i},${center + sign * height / 2}`), `${1200 - edge},${center + sign * final / 2}`].join(' ');
  return <div className={'connected-funnel' + (compact ? ' connected-funnel-compact' : '')}>
    <svg className="connected-funnel-shape" viewBox={`0 0 1200 ${center * 2}`} preserveAspectRatio="none" aria-hidden="true">
      {steps.map((step, i) => { const x = edge + width * i, left = heights[i], right = heights[i + 1] ?? final; return <polygon key={step.id} className="connected-funnel-segment" points={`${x},${center - left / 2} ${x + width},${center - right / 2} ${x + width},${center + right / 2} ${x},${center + left / 2}`} fill={['#426e9d', '#3a6084', '#344f69', '#2b404f'][i] || '#2b404f'} />; })}
      <polyline className="connected-funnel-outline" points={outline(-1)} /><polyline className="connected-funnel-outline" points={outline(1)} />
    </svg>
    <div className="connected-funnel-labels">{steps.map((step, i) => <a key={step.id} href={pageLink('leads', stageFilter(step.id))} className="connected-funnel-stage" aria-label={`${step.label}: ${step.count}. Conversão acumulada de ${percent(step.count / first * 100)}.`}>
      <span className="connected-funnel-index">{String(i + 1).padStart(2, '0')}</span><strong className="connected-funnel-label">{step.label}</strong><b className="connected-funnel-count">{integer(step.count)}</b><small className="connected-funnel-rate">{percent(step.count / first * 100)}{!compact && ` do início · ${i ? percent(steps[i - 1].count ? step.count / steps[i - 1].count * 100 : 0) + ' da anterior' : 'base'}`}</small>
    </a>)}</div>
  </div>;
}
