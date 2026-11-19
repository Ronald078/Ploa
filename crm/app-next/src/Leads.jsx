import {useOperatorName} from './operator-context.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { attentionOptions, matchesLead, nextAction } from './lead-model.js';
import { Conversation } from './Conversation.jsx';
import { LeadDetails } from './LeadDetails.jsx';
import { Button, Field } from './forms.jsx';
import { dateLabel, integer } from './model.js';
import {pageLink} from './navigation.js';
import {OperationNotice} from './OperationNotice.jsx';
import {actionOrigin} from './action-origin.js';
import {scopedStorageKey} from './browser-scope.js';

const emptyFilters = { attention:'todos',status:'',search:'',country:'',category:'',mode:'' };
function readFilters(search, statuses) {
  let saved; try { saved = JSON.parse(sessionStorage.getItem(scopedStorageKey('ploa-next-filters'))); } catch { /* Optional preference. */ }
  const query = new URLSearchParams(search), result = { ...emptyFilters,...saved };
  if (query.has('attention') || query.has('status')) { result.attention = query.get('attention') || 'todos'; result.status = query.get('status') || ''; }
  if (!attentionOptions.some(([id]) => id === result.attention)) result.attention = 'todos';
  if (!statuses.some(item => item.id === result.status)) result.status = '';
  return result;
}
export function Leads({ data, routeSearch, refresh }) {
  const operator=useOperatorName();
  const { leads, resumo:summary, status_options:statuses, pipeline_options:pipeline } = data.dashboard, workspace = data.workspace;
  const [filters,setFilters] = useState(() => readFilters(routeSearch,statuses)), [limit,setLimit] = useState(120);
  const [selected,setSelected] = useState(null), [busy,setBusy] = useState(false), [notice,setNotice] = useState(null);
  const lock = useRef(false), [mobile,setMobile] = useState(() => matchMedia('(max-width:860px)').matches), list = useRef(null);
  useEffect(() => { const media = matchMedia('(max-width:860px)'), change = () => setMobile(media.matches); media.addEventListener('change',change); return () => media.removeEventListener('change',change); },[]);
  useEffect(() => { setFilters(readFilters(routeSearch,statuses)); setLimit(120); },[routeSearch]);
  useEffect(() => { try { sessionStorage.setItem(scopedStorageKey('ploa-next-filters'),JSON.stringify(filters)); } catch { /* Optional preference. */ } },[filters]);
  const filtered = useMemo(() => leads.filter(lead => matchesLead(lead,filters) && (!filters.country || lead.pais === filters.country) && (!filters.category || lead.categoria === filters.category) && (!filters.mode || lead.atendimento_modo === filters.mode)),[leads,filters]);
  const visible = filtered.slice(0,limit), lead = visible.find(item => item.id === selected) || (!mobile ? visible[0] : null);
  useEffect(() => { if (lead && selected !== lead.id && !mobile) setSelected(lead.id); },[lead?.id,mobile,selected]);
  function filter(patch) { setFilters(previous => ({ ...previous,...patch })); setLimit(120); setSelected(null); setNotice(null); }
  async function mutate(url, method, payload, message) {
    if (lock.current) return false;
    const source=actionOrigin();
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(url,{method,headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.erro || 'Não foi possível concluir a ação.');
      await refresh(); setNotice({text:message,error:false,source}); return true;
    } catch(error) { setNotice({text:error.message === 'Failed to fetch' ? 'A comunicação foi interrompida. Confira o registro antes de tentar novamente; o rascunho foi preservado.' : error.message,error:true}); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  const command = (action,payload = {},message = 'Alteração salva.') => mutate('/api/workspace/leads/' + encodeURIComponent(lead.id),'POST',{action,...payload},message);
  const patch = (payload,message) => mutate('/api/leads/' + encodeURIComponent(lead.id),'PATCH',payload,message);
  const countries = [...new Set(leads.map(item => item.pais).filter(Boolean))].sort(), categories = [...new Set(leads.map(item => item.categoria).filter(Boolean))].sort();
  function openContact(id) {
    const index = leads.findIndex(item => item.id === id); if (index < 0) return;
    setFilters(emptyFilters); setLimit(Math.max(120,Math.ceil((index + 1) / 120) * 120)); setSelected(id); setNotice(null);
  }
  useEffect(() => { const contact = new URLSearchParams(routeSearch).get('contact'); if (contact) openContact(contact); },[routeSearch]);
  useEffect(() => {
    if (mobile && lead) requestAnimationFrame(() => {
      const head = document.querySelector('.next-conversation');
      head?.setAttribute('tabindex','-1'); head?.focus({preventScroll:true}); head?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth'});
    });
  },[mobile,lead?.id]);
  function closeContact() { setSelected(null); requestAnimationFrame(() => list.current?.querySelector('[data-lead-id]')?.focus()); }
  return <section className="view-panel next-leads next-enter" data-view-panel="leads">
    <div className="page-intro compact-intro"><div><p>Relacionamento comercial</p><h2>Fluxo de contatos</h2><span>{integer(filtered.length)} contatos neste filtro</span></div><a className="text-action" href={pageLink('ai')}>Organizar histórico com IA</a></div>
    {!workspace.capabilities?.nextAppRoutes ? <div className="next-notice" role="status">Reabra o Ploa para concluir esta atualização. O envio manual nesta versão ficará disponível após a reabertura; os rascunhos estão preservados.</div> : null}
    <div className="next-queues">{[['para_classificar','Analisar respostas',summary.respostas_para_classificar,'respostas humanas novas'],['automaticos','Atendimento automático',summary.respostas_automaticas,'bots separados do interesse real'],['oportunidades','Oportunidades',summary.oportunidades,'interesse até fechamento'],['retornos','Retornos',summary.retornos_pendentes,'vencidos ou para hoje']].map(([id,title,count,detail]) => <button className="lead-queue" type="button" key={id} aria-pressed={filters.attention === id && !filters.status} onClick={() => filter({attention:id,status:''})}><span>{title}</span><strong>{integer(count)}</strong><small>{detail}</small></button>)}</div>
    <section className="panel next-lead-filters"><h2>Fila de acompanhamento</h2><div className="next-filter-grid"><Field label="Buscar lead" type="search" value={filters.search} onChange={search => filter({search})} placeholder="Nome ou final do número" /><Field label="Mostrar" options={attentionOptions} value={filters.attention} onChange={attention => filter({attention,status:''})} /><Field label="País" options={[["","Todos os países"],...countries.map(value => [value,value])]} value={filters.country} onChange={country => filter({country})} /><Field label="Categoria" options={[["","Todas as categorias"],...categories.map(value => [value,value])]} value={filters.category} onChange={category => filter({category})} /><Field label="Atendimento" options={[["","Todos"],['human','Com '+operator],['automatic','Liberado para IA']]} value={filters.mode} onChange={mode => filter({mode})} /><Field label="Filtro salvo" value="" options={[["","Escolher filtro"],...(workspace.savedFilters || []).map(item => [item.id,item.name])]} onChange={id => { const saved = workspace.savedFilters.find(item => item.id === id); if (saved) filter({...emptyFilters,...Object.fromEntries(Object.keys(emptyFilters).map(key => [key,saved[key] || emptyFilters[key]])),status:''}); }} /></div><div className="ploa-actions"><Button disabled={busy} onClick={() => { const name = window.prompt('Nome deste filtro:'); if (name?.trim()) void mutate('/api/workspace/filters','POST',{name,...filters},'Filtro salvo.'); }}>Salvar filtro</Button><Button onClick={() => filter(emptyFilters)}>Limpar filtros</Button></div>
      <div className="next-pipeline" aria-label="Filtrar por etapa">{pipeline.map(item => <button className={'pipeline-button stage-' + item.id} key={item.id} type="button" aria-pressed={filters.status === item.id} onClick={() => filter({status:filters.status === item.id ? '' : item.id,attention:'todos'})}><span>{item.label}</span><strong>{integer(summary.por_status[item.id])}</strong></button>)}</div><p className="ploa-note" role="status">{integer(filtered.length)} registros{visible.length < filtered.length ? ' · exibindo ' + visible.length : ''} · {integer(summary.total)} leads vinculados</p>
    </section>
    <OperationNotice notice={notice}/>
    {data.report.attention?.length ? <details className="panel next-details"><summary>Conversas que precisam de você · {data.report.attention.length}</summary><div className="next-details-content"><p className="ploa-note">Pedidos fora das condições cadastradas ou informações que a IA não consegue confirmar.</p>{data.report.attention.slice(0,20).map(item => <article className="next-ledger" key={item.contact}><strong>{item.name}</strong><p>{item.reason}</p><small>{dateLabel(item.at,true)}</small><div className="ploa-actions"><Button onClick={() => openContact(item.contact)}>Abrir conversa</Button><Button disabled={busy} onClick={() => mutate('/api/workspace/leads/' + encodeURIComponent(item.contact),'POST',{action:'resolve-attention'},'Aviso dispensado.')}>Dispensar aviso</Button></div></article>)}</div></details> : null}
    <div className={'next-lead-workspace' + (mobile && lead ? ' next-contact-open' : '')}>
      <section className="panel next-lead-list" ref={list} aria-label="Lista de leads" hidden={mobile && Boolean(lead)}><div className="next-lead-rows">{visible.map(item => <button key={item.id} type="button" className="next-lead-row" data-lead-id={item.id} aria-current={lead?.id === item.id ? 'true' : undefined} aria-label={`Abrir ${item.nome}, etapa ${item.status_label}`} onClick={() => { setSelected(item.id); setNotice(null); }}>
        <span className="next-lead-identity"><strong>{item.nome}</strong><small>{item.numero_mascarado}</small></span><span className="status-chip" data-status={item.status} data-origin={item.classificacao_origem}><span>{item.status_label}</span><small>{item.classificacao_origem === 'manual' ? 'manual' : item.classificacao_revisao ? 'revisar' : 'automática'}</small></span><span className="next-lead-action">{nextAction(item)}<small>{item.proximo_contato ? dateLabel(item.proximo_contato) : 'Sem data definida'}</small></span><small className="next-lead-activity">{dateLabel(item.ultima_resposta || item.ultimo_contato,true)} · {item.respostas_recebidas || 0} respostas</small>
      </button>)}</div>{!filtered.length ? <p className="ploa-note">Nenhum contato corresponde a estes filtros.</p> : null}{visible.length < filtered.length ? <Button onClick={() => setLimit(value => value + 120)}>Carregar mais {Math.min(120,filtered.length - limit)} leads</Button> : null}</section>
      <div className="next-selected-contact" hidden={mobile && !lead}>
        {lead ? <React.Fragment key={lead.id}>{mobile ? <Button onClick={closeContact}>← Voltar à lista</Button> : null}<Conversation lead={lead} workspace={workspace} command={command} busy={busy} /><LeadDetails lead={lead} workspace={workspace} statuses={statuses} command={command} patch={patch} busy={busy} /></React.Fragment> : <section className="panel next-empty-contact"><h3>Escolha um lead</h3><p>Abra um contato para acompanhar a conversa e a próxima ação.</p></section>}
      </div>
    </div>
  </section>;
}
