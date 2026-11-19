import React from 'react';
import { Button, Details } from './forms.jsx';
import { anyRunning } from './operation-api.js';
import { dateLabel, money } from './model.js';
import { normalize } from './lead-model.js';

export function CopyHistory({ data, market, category, command, busy, reset }) {
  const performance = (data.report?.copies || []).filter(item => item.country === market && (category === '__generic__' ? !item.category || ['generica','genericas'].includes(normalize(item.category)) : normalize(item.category) === normalize(category)));
  return <>
    <Details title="Versões anteriores da biblioteca de copys"><p className="ploa-note">Cada salvamento preserva a versão anterior. Para restaurar, encerre os scripts e desconecte o atendimento.</p>
      {(data.workspace?.copyVersions || []).slice().reverse().map(version => <article className="next-ledger" key={version.id}><span>{dateLabel(version.at,true)}</span><div className="ploa-actions"><Button disabled={busy || anyRunning(data.processes)} onClick={async() => {
        if (!window.confirm('Substituir as copys atuais por esta versão? A biblioteca atual também será preservada.')) return;
        const result = await command('/api/workspace/copies/' + encodeURIComponent(version.id),'POST',{},'Biblioteca restaurada.');
        if (result.ok) reset();
      }}>Restaurar versão</Button></div></article>)}
      {!data.workspace?.copyVersions?.length ? <p className="ploa-note">O próximo salvamento criará a primeira versão.</p> : null}
    </Details>
    <Details title="Acompanhamento das variações de copy"><p className="ploa-note">Cada contato conta uma vez por variação. Bots ficam fora das respostas humanas. Os resultados mostram associação com a abordagem, sem provar que ela causou a venda.</p>
      {performance.map(item => <article className="next-ledger" key={item.id}><strong>{item.country} · {item.category || 'Genérica'} · {item.id.slice(0,8)}</strong><p>{item.preview}</p><p className="ploa-note">{item.sent} contatos · {item.humanResponses} respostas humanas ({item.responseRate}%) · {item.proposals} propostas · {item.clients} aceites confirmados</p><p className="ploa-note">{Object.entries(item.received || {}).map(([currency,value]) => money(value,currency) + ' recebido').join(' · ') || 'Nenhum recebimento associado.'}</p></article>)}
      {!performance.length ? <p className="ploa-note">Ainda não há envios identificados para esta seleção.</p> : null}
    </Details>
  </>;
}
