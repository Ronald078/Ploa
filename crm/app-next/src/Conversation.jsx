import {useOperatorName} from './operator-context.jsx';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useDraft } from './drafts.js';
import { Field, Button } from './forms.jsx';
import { dateLabel } from './model.js';
import { transcript } from './lead-model.js';

const jobLabels = { ready:'Na fila de envio', sending:'Enviando; aguarde a confirmação', sent:'Mensagem enviada', review:'Envio exige conferência no WhatsApp; não será repetido automaticamente', cancelled:'Envio cancelado', queued:'Aguardando a conversa completar', thinking:'Preparando o próximo passo', draft:'Sugestão pronta para aprovação', approved:'Sugestão aprovada', dismissed:'Sugestão descartada', held:'Precisa de uma informação ou decisão', closed:'Abordagem encerrada' };
function Suggestion({ lead, job, command, busy }) {
  const [draft, set] = useDraft(lead.id, 'suggestion-' + job.id, job.text || '');
  return <div className="ploa-composer"><h4>Resposta sugerida</h4><p className="ploa-note">Confira o contexto e ajuste antes de aprovar o envio.</p><p className="ploa-note">{[job.analysis?.reason, job.analysis?.nextStep].filter(Boolean).join(' · ')}</p><Field label="Resposta para revisar" type="textarea" value={draft} onChange={set} maxLength={2500} /><div className="ploa-actions">
    <Button disabled={busy} primary onClick={() => command('approve-suggestion', { jobId: job.id, text: draft }, 'Resposta aprovada e colocada na fila. Acompanhe a confirmação do envio.')}>Aprovar e enviar</Button>
    <Button disabled={busy} onClick={() => command('learn-suggestion', { jobId: job.id, text: draft }, 'Exemplo aprovado guardado, sem enviar a mensagem.')}>Guardar correção como exemplo</Button>
    <Button disabled={busy} onClick={() => command('dismiss-suggestion', { jobId: job.id }, 'Sugestão descartada.')}>Descartar</Button>
  </div></div>;
}
export function Conversation({ lead, workspace, command, busy }) {
  const operator=useOperatorName();
  const record = workspace.records?.[lead.id] || {}, human = record.mode === 'human';
  const autonomous = workspace.settings?.enabled && workspace.settings.responseMode === 'autonomous';
  const [draft, set, clear, request] = useDraft(lead.id, 'message', '');
  const entries = transcript(lead), area = useRef(null), nearEnd = useRef(true);
  const [showAll, setShowAll] = useState(false);
  const jobs = (workspace.jobs || []).filter(job => job.contact === lead.id), last = jobs.at(-1), suggestion = jobs.filter(job => job.kind === 'ai' && job.status === 'draft').at(-1);
  const status = last ? (jobLabels[last.status] || last.status) + (last.reason ? ' · ' + last.reason : '') : workspace.workerConnected ? 'WhatsApp conectado ao painel.' : 'Conecte o atendimento do WhatsApp na página Mensagens para enviar.';
  const identity = record.autoClosed ? 'Abordagem encerrada · novos envios pausados' : human ? 'Atendimento com '+operator+' · IA pausada neste contato' : !workspace.settings?.enabled ? 'IA não ativada · atendimento disponível com '+operator : ['no_key','setup','quota','offline','error'].includes(workspace.runtime?.code) ? workspace.runtime.label : autonomous ? 'IA conduz a conversa com as regras comerciais' : workspace.settings.responseMode === 'automatic' ? 'IA automática habilitada' : 'IA prepara sugestões para aprovação';
  const blocked = lead.vinculo_pendente || lead.status === 'nao_contatar';
  useLayoutEffect(() => { if (nearEnd.current && area.current) area.current.scrollTop = area.current.scrollHeight; }, [entries.length, entries.at(-1)?.text, entries.at(-1)?.at]);
  async function send() {
    const text = draft.trim(); if (!text) return;
    const payload = { text }, snapshot = draft;
    const ok = await command('message', { ...payload, requestId: request(payload) }, 'Mensagem colocada na fila. Acompanhe a confirmação abaixo.');
    if (ok) clear(snapshot);
  }
  return <section className="ploa-conversation next-conversation" aria-label="Conversa do contato">
    <div className="ploa-conversation-head"><div><h3>{lead.nome}</h3><p className="ploa-note">{identity}</p></div><Button disabled={busy || blocked || lead.status === 'perdido'} onClick={() => command('mode', { mode: human ? 'automatic' : 'human' }, human ? 'Conversa liberada para IA, quando configurada.' : 'Você assumiu esta conversa. A IA está pausada neste contato.')}>{human ? 'Liberar para IA' : 'Assumir atendimento'}</Button></div>
    {autonomous && !human ? <p className="ploa-auto-status" role="status">{status}</p> : null}
    <div className="ploa-transcript" ref={area} aria-label="Histórico da conversa" onScroll={() => { const e = area.current; nearEnd.current = e.scrollHeight - e.scrollTop - e.clientHeight < 100; }}>
      {entries.length > 300 && !showAll ? <Button onClick={() => { nearEnd.current = false; setShowAll(true); }}>Mostrar registros anteriores ({entries.length - 300})</Button> : null}
      {!entries.length ? <p className="ploa-note">Ainda não há mensagens registradas. Novas mensagens aparecerão aqui quando o WhatsApp estiver conectado.</p> : (showAll ? entries : entries.slice(-300)).map((entry,i) => <article key={(entry.id || entry.messageId || entry.at || '') + '-' + i} className="ploa-bubble" data-direction={entry.direction || 'in'}>{entry.text}<small>{entry.direction === 'note' ? 'Nota' : ({ human:operator, ai:'IA', script:'Script', bot:'Resposta automática', contact:'Contato' }[entry.actor] || 'Contato')} · {entry.at ? dateLabel(entry.at, true) : 'Data não disponível no registro antigo'}</small></article>)}
    </div>
    {suggestion ? <Suggestion key={suggestion.id} lead={lead} job={suggestion} command={command} busy={busy} /> : null}
    {!(autonomous && !human) ? <div className="ploa-composer"><Field label="Mensagem para o contato" type="textarea" value={draft} onChange={set} maxLength={5000} placeholder="Escreva a resposta. O envio usa a sessão conectada ao painel." /><div className="ploa-actions">
      <Button disabled={busy || !workspace.settings?.enabled || !workspace.hasKey || blocked || ['perdido','automatico'].includes(lead.status)} onClick={() => command('suggest', {}, 'Sugestão solicitada. Ela aparecerá para revisão.')}>Sugerir resposta com IA</Button>
      <Button primary disabled={busy || !workspace.capabilities?.manualMessageIdempotency || !workspace.workerConnected || blocked || !draft.trim()} onClick={send}>Enviar mensagem</Button>
    </div><p className="ploa-note" role="status">{status}</p></div> : null}
  </section>;
}
