'use strict';
const dates=new Map();

function planFollowUp(lead, record = {}, now = new Date()) {
  if(lead.vinculo_pendente||['nao_contatar','perdido','ganho','automatico'].includes(lead.status))return null;
  if(lead.proximo_contato)return {existing:true,date:lead.proximo_contato,time:lead.retorno_hora||'09:30',zone:lead.fuso,
    action:lead.proxima_acao||record.facts?.nextStep||lead.acao_sugerida||'Rever a conversa antes do retorno',
    reason:lead.retorno_atrasado?'Retorno agendado que já venceu.':'Retorno já agendado por você.',priority:lead.retorno_atrasado?0:lead.retorno_hoje?1:6};
  const recentIn=Date.parse(lead.ultima_resposta)||0;
  const recentOut=Math.max(Date.parse(lead.ultimo_contato)||0,...(lead.historico_completo||[]).filter(e=>e.direction==='out').map(e=>Date.parse(e.at)||0));
  let days,action,reason,priority;
  if(recentIn>recentOut){days=0;priority=2;action=record.facts?.nextStep||lead.acao_sugerida||'Responder à última mensagem';reason='O contato respondeu depois da última mensagem enviada.';}
  else if(['proposta','negociacao'].includes(lead.status)){days=2;priority=3;action='Retomar a proposta com uma pergunta sobre a decisão';reason='Existe uma proposta ou negociação em andamento, sem retorno agendado.';}
  else if(lead.status==='qualificado'){days=1;priority=4;action=record.facts?.nextStep||'Retomar a necessidade e combinar o próximo passo';reason='Há interesse identificado e nenhum retorno agendado.';}
  else if(lead.status==='novo'&&recentOut){days=3;priority=5;action='Avaliar se cabe um único acompanhamento contextual';reason='A primeira abordagem ainda não teve resposta. A sugestão não autoriza insistência nem envia mensagens.';}
  else return null;
  const zone=lead.fuso||'America/Sao_Paulo';
  const minute=Math.floor(now.getTime()/60000);
  let cached=dates.get(zone);
  if(cached?.minute!==minute){cached={minute,parts:new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)};dates.set(zone,cached);}
  const parts=cached.parts;
  const get=type=>parts.find(p=>p.type===type).value;
  const date=new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);
  return {existing:false,date:date.toISOString().slice(0,10),time:days===0?'':lead.retorno_hora||'09:30',zone,action,reason,priority};
}
module.exports={planFollowUp};
