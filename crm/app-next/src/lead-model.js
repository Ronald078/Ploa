export const attentionOptions = [['todos','Todos os contatos'],['precisam_acao','Precisam de ação'],['acao_agora','Ação atual com Ronald'],['historico_triagem','Histórico para triagem'],['sem_texto','Sem texto disponível'],['para_classificar','Respostas para classificar'],['sem_resposta','Sem resposta'],['automaticos','Atendimento automático'],['resposta_humana','Resposta humana'],['retornos','Retornos pendentes'],['oportunidades','Oportunidades'],['propostas','Propostas'],['negociacoes','Negociações'],['clientes','Clientes'],['vendas','Vendas'],['encerrados','Encerrados'],['vinculos','Aguardando vínculo']];
export const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function matchesLead(lead, { attention = 'todos', status = '', search = '' }) {
  if (status && lead.status !== status) return false;
  const checks = {
    acao_agora: lead.fila_atendimento?.actionNow,
    historico_triagem: lead.fila_atendimento?.history,
    sem_texto: lead.fila_atendimento?.withoutText,
    precisam_acao: lead.fila_atendimento?.actionNow || lead.retorno_atrasado || lead.retorno_hoje || ['proposta','negociacao'].includes(lead.status),
    sem_resposta: lead.status === 'novo', automaticos: lead.status === 'automatico',
    resposta_humana: lead.respostas_recebidas > 0 && lead.status !== 'automatico' && !lead.vinculo_pendente,
    para_classificar: lead.status === 'respondeu' && lead.classificacao_revisao && String(lead.ultima_mensagem || '').trim(),
    retornos: lead.retorno_atrasado || lead.retorno_hoje,
    oportunidades: ['qualificado','proposta','negociacao','ganho'].includes(lead.status),
    propostas: ['proposta','negociacao','ganho'].includes(lead.status), negociacoes: ['negociacao','ganho'].includes(lead.status),
    clientes: lead.status === 'ganho', vendas: Number(lead.valor_recebido) > 0,
    encerrados: ['perdido','nao_contatar'].includes(lead.status), vinculos: lead.vinculo_pendente,
  };
  if (attention !== 'todos' && Object.hasOwn(checks, attention) && !checks[attention]) return false;
  return !search || normalize(`${lead.nome} ${lead.numero} ${lead.numero_mascarado} ${lead.status_label} ${lead.ultima_mensagem}`).includes(normalize(search));
}
export function nextAction(lead) {
  if (lead.vinculo_pendente) return 'Aguardando vínculo com telefone';
  return lead.proxima_acao || lead.acao_sugerida || ({novo:'Aguardar resposta',automatico:'Aguardar atendimento humano',respondeu:'Classificar resposta humana',qualificado:'Preparar diagnóstico comercial',proposta:'Acompanhar proposta',negociacao:'Conduzir negociação',ganho:'Iniciar atendimento',nao_contatar:'Contato encerrado',perdido:'Oportunidade encerrada'}[lead.status]) || 'Definir próxima ação';
}
export function transcript(lead) {
  return [...(lead.historico_completo || []), ...(lead.notas || []).map(note => ({ id: note.id, direction: 'note', text: note.texto, at: note.criado_em, actor: 'human' }))].filter(item => item.text).sort((a,b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
}
