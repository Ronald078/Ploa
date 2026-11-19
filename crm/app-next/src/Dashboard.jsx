import React, { useState } from 'react';
import { pageLink } from './navigation.js';
import { ConnectedFunnel } from './ConnectedFunnel.jsx';
import { Icon } from './icons.jsx';
import { attentionNews, dateLabel, financeModel, integer, money, percent } from './model.js';
import {useOperatorName} from './operator-context.jsx';

const currencies = [['BRL', 'BRL · Real'], ['EUR', 'EUR · Euro'], ['USD', 'USD · Dólar']];
const periods = [['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Últimos 12 meses'], ['0', 'Todo o histórico']];
const preference = (key, allowed, fallback) => { try { const value = localStorage.getItem(key); return allowed.includes(value) ? value : fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } };
const Link = ({ view = 'leads', attention, status, children, className = 'text-action', ...props }) => <a className={className} href={pageLink(view, attention, status)} {...props}>{children}</a>;

function Hero({ data }) {
  const news = attentionNews(data), metric = data.dashboard.response_metric;
  const value = metric?.value ?? data.dashboard.resumo.taxa_resposta;
  const circleLength = 2 * Math.PI * 54;
  return <div className="overview-hero">
    <div className="command-copy">
      <p className="today-label">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
      <h2 id="overview-title">O que merece sua atenção</h2>
      <div className="attention-feed" aria-live="polite">
        {news.length ? news.map(item => <Link key={item.title} view={item.targetView || 'leads'} attention={item.attention} className="attention-news-item" data-tone={item.tone}>
          <span className={'attention-news-marker tone-' + item.tone} /><span className="attention-news-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
          {item.timestamp ? <time className="attention-news-time" dateTime={item.timestamp}>{dateLabel(item.timestamp, true)}</time> : null}
        </Link>) : <div className="attention-news-empty"><strong>Nenhuma ação pendente agora</strong><p>Novas respostas, propostas e recebimentos aparecerão aqui quando forem registrados.</p></div>}
      </div>
      <div className="hero-actions"><Link>Abrir fila de leads</Link><span className="live-indicator"><i />Atualização automática a cada 30 segundos</span></div>
    </div>
    <div className="response-visual" aria-label={`${percent(value)}. ${metric?.numerator ?? 0} de ${metric?.denominator ?? 0} contatos com resposta registrada, incluindo atendimentos automáticos.`}>
      <svg className="response-ring" viewBox="0 0 140 140" aria-hidden="true"><circle className="response-ring-track" cx="70" cy="70" r="54" /><circle className="response-ring-value" cx="70" cy="70" r="54" style={{ strokeDasharray: circleLength, strokeDashoffset: circleLength * (1 - Math.min(100, Math.max(0, value)) / 100) }} /></svg>
      <div className="response-ring-copy"><strong data-metric="response">{percent(value)}</strong><span>Respostas</span></div>
    </div>
  </div>;
}

function Sources({ data }) {
  const metric = data.dashboard.response_metric;
  const sources = [
    ['Planilha atual', data.operations.bases?.sheet, 'linhas; podem incluir registros ainda não prospectados'],
    ['Último lote de disparos', data.operations.bases?.lastRun, 'contatos na lista usada naquela execução'],
    ['Contatos acompanhados', { value: data.dashboard.resumo.total, source: 'Histórico do CRM', updatedAt: data.dashboard.resumo.atualizado_em }, 'telefones identificados no acompanhamento'],
  ];
  return <div className="ploa-base-strip" aria-label="Bases dos indicadores">{sources.map(([label, source, description]) => <article className="ploa-base-item" key={label}>
    <span>{label}</span><strong>{source?.value == null ? '—' : integer(source.value)}</strong><small>{source?.value == null ? 'Sem medição disponível' : description}</small>
    <small className="ploa-source-date">{source?.source || 'Fonte ainda não carregada'}{source?.updatedAt ? ' · ' + dateLabel(source.updatedAt, true) : ''}</small>
    {label === 'Contatos acompanhados' && metric ? <small>{metric.automaticCount} com atendimento automático · {metric.withoutText} respostas sem texto disponível. A taxa histórica inclui todos os contatos com resposta registrada.</small> : null}
  </article>)}</div>;
}

function MetricCards({ finance, currency }) {
  const rows = [
    ['revenue', 'Recebido no período', finance?.received, 'trend', finance ? finance.period.label + ' · ' + currency : 'Dados indisponíveis'],
    ['pipeline', 'Pipeline aberto agora', finance?.pipelineNow, 'funnel', 'Estimativas de oportunidades abertas · ' + currency],
    ['sales', 'Clientes com pagamento', finance?.customersWithPayment, 'leads', 'Clientes distintos com pagamento confirmado no período'],
    ['ticket', 'Recebimento médio por cliente', finance?.averageReceived, 'pulse', 'Recebido no período dividido por clientes com pagamento'],
  ];
  return <dl className="metric-grid executive-metrics" aria-label="Resultado comercial">{rows.map(([id, title, value, icon, detail]) => <div className={'metric-card metric-card-' + id} key={id}>
    <dt>{title}</dt><dd data-metric={id}>{value == null ? '—' : id === 'sales' ? integer(value) : money(value, currency)}</dd><span className="metric-detail">{detail}</span><Icon name={icon} />
  </div>)}</dl>;
}

function Receipts({ finance, currency }) {
  const [selected, setSelected] = useState('');
  const peak = Math.max(1, ...finance?.bars.map(bar => bar.value) || []);
  return <section className="panel ploa-section"><h3>Recebimentos confirmados</h3><p className="ploa-note">Pagamentos registrados no período e na moeda selecionados. Aceite de proposta e previsão de venda são apurados separadamente.</p>
    {finance ? <p className="ploa-note">{finance.period.label} · {money(finance.received, currency)} recebido · {finance.customersWithPayment} clientes com pagamento. Contratado no histórico: {money(finance.contractedHistory, currency)} · Saldo atual a receber: {money(finance.outstandingNow, currency)}</p> : <p className="ploa-note">Não há uma medição disponível para este período.</p>}
    <div className="ploa-sparkline">{finance?.bars.length ? finance.bars.map((bar, index) => <button key={bar.label} type="button" className="next-receipt-bar" style={{ height: Math.max(3, bar.value / peak * 100) + '%' }} title={bar.label + ': ' + money(bar.value, currency)} aria-label={bar.label + ': ' + money(bar.value, currency)} onClick={() => setSelected(String(index))} />) : <p className="ploa-note">Nenhum pagamento confirmado neste período e moeda.</p>}</div>
    {finance?.bars.length ? <p className="ploa-note" aria-live="polite">{finance.bars[Number(selected)] && selected !== '' ? finance.bars[Number(selected)].label + ': ' + money(finance.bars[Number(selected)].value, currency) : 'Selecione uma coluna para consultar o valor.'}</p> : null}
  </section>;
}

function StageValues({ finance, currency }) {
  const peak = Math.max(1, ...Object.values(finance?.stages || {}));
  return <section className="panel revenue-panel"><div className="panel-heading"><div><h3>Valor por etapa comercial</h3><p>Distribuição entre interesse, proposta, negociação e venda.</p></div><Link view="funnel">Ver análise completa</Link></div>
    <div className="revenue-stage-chart">{[['qualificado', 'Interesse'], ['proposta', 'Proposta'], ['negociacao', 'Negociação'], ['ganho', 'Vendas']].map(([id, title]) => <Link className={'revenue-stage stage-' + id} status={id} key={id}>
      <div className="revenue-stage-copy"><span>{title}</span><strong>{finance ? money(finance.stages[id], currency) : '—'}</strong></div><div className="revenue-stage-track"><span className="revenue-stage-fill" style={{ width: ((finance?.stages[id] || 0) / peak * 100) + '%' }} /></div>
    </Link>)}</div>
  </section>;
}

function Signals({ summary }) {
  const items = [['acao_agora', 'Conversas que precisam de você', summary.acao_ronald ?? summary.respostas_para_classificar, 'decisões, negociações e retornos atuais'], ['propostas', 'Propostas em andamento', summary.propostas_abertas, 'proposta ou negociação'], ['retornos', 'Retornos pendentes', summary.retornos_pendentes, 'vencidos ou para hoje']];
  return <section className="panel attention-panel"><div className="panel-heading"><div><h3>Sinais da operação</h3><p>O que realmente pede uma próxima ação.</p></div></div><div className="signal-list">{items.map(([id, title, value, detail]) => <Link key={id} attention={id} className="next-signal"><span>{title}</span><strong>{integer(value)}</strong><small>{detail}</small></Link>)}</div></section>;
}

function Funnel({ steps = [] }) {
  return <section className="panel overview-funnel-panel"><div className="panel-heading"><div><h3>Conversão da prospecção</h3><p>Da primeira copy enviada até o cliente conquistado.</p></div><Link view="funnel">Abrir funil</Link></div><div className="funnel-preview"><ConnectedFunnel steps={steps} compact /></div></section>;
}

export function Dashboard({ data,businessName }) {
  const operator=useOperatorName();
  const [currency, setCurrency] = useState(() => preference('ploa-currency', currencies.map(([id]) => id), 'BRL'));
  const [period, setPeriod] = useState(() => preference('ploa-finance-period', periods.map(([id]) => id), '30'));
  const finance = financeModel(data, currency, period), cohort = data.report.cohort || {};
  return <section className="view-panel next-dashboard" data-view-panel="overview" aria-labelledby="overview-title">
    <div className="dashboard-greeting"><h2>Olá, {businessName||operator}.</h2></div>
    <Hero data={data} />
    <div className="ploa-toolbar ploa-finance-filters">
      <label><span>Moeda dos resultados</span><select aria-label="Moeda dos resultados" value={currency} onChange={event => { setCurrency(event.target.value); save('ploa-currency', event.target.value); }}>{currencies.map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label>
      <label><span>Período dos recebimentos</span><select aria-label="Período dos recebimentos" value={period} onChange={event => { setPeriod(event.target.value); save('ploa-finance-period', event.target.value); }}>{periods.map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label>
      <p className="ploa-note">Recebimentos e gráfico usam o período selecionado. Pipeline e saldo representam a situação atual. Sem conversão cambial.</p>
    </div>
    <Sources data={data} /><MetricCards finance={finance} currency={currency} /><Receipts key={currency + period} finance={finance} currency={currency} />
    <div className="overview-grid overview-commerce-grid"><StageValues finance={finance} currency={currency} /><Signals summary={data.dashboard.resumo} /></div>
    <Funnel steps={data.dashboard.funnel_steps} />
    <section className="panel ploa-section"><h3>Qualidade das abordagens acompanhadas</h3><p className="ploa-note">Base própria: envios com identificação da copy. Consulte o denominador antes de comparar com o histórico geral.</p><p className="ploa-note">{cohort.sent ? `${integer(cohort.humanResponses)} respostas em ${integer(cohort.sent)} contatos por variação · ${percent(cohort.responseRate)} de resposta nesta base. Envios registrados de ${dateLabel(cohort.from, true)} a ${dateLabel(cohort.to, true)}. Respostas apuradas até ${dateLabel(cohort.updatedAt, true)}.` : 'Sem abordagens identificadas. Novos envios identificados alimentarão estes indicadores.'}</p></section>
  </section>;
}
