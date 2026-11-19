'use strict';
// Área de connection; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.connection = function mountArea(ctx) {
const connection=ctx.section('Conexão de IA','No atendimento autônomo, a IA conduz a conversa usando a base comercial. Você acompanha e assume quando necessário.');

const connectionStatus=ctx.node('p','ploa-pill','Desativada');

connectionStatus.setAttribute('role','status');

const runtimeNote=ctx.node('p','ploa-note');runtimeNote.setAttribute('role','status');

const connectionGrid=ctx.node('div','ploa-form-grid');

const providerField=ctx.field('Provedor','select'),keyField=ctx.field('Chave da API','password');

keyField.input.autocomplete='off';

keyField.input.placeholder='Salva com proteção do Windows';

ctx.options(providerField.input,[['groq','Groq · plano gratuito']]);

const responseModeField=ctx.field('Modo de atendimento','select');

ctx.options(responseModeField.input,[['autonomous','Atendimento autônomo com base comercial'],['review','Sugerir e aguardar minha aprovação'],['automatic','Automático apenas para respostas simples']]);

const aiDaily=ctx.field('Limite diário de consultas à IA','number');

aiDaily.input.min=1;

aiDaily.input.max=1000;

const aiEnabled=ctx.field('Ativar conexão de IA','checkbox',true);

const aiConsent=ctx.field('Contexto filtrado, instruções e exemplos autorizados para Groq','checkbox',true);

aiConsent.input.checked=true;

aiConsent.input.disabled=true;

const aiFree=ctx.field('Minha chave pertence a uma conta no plano gratuito, sem faturamento ativado','checkbox',true);
const aiFallback=ctx.field('Trocar de modelo automaticamente quando houver limite ou indisponibilidade','checkbox',true);
aiFallback.input.checked=true;

connectionGrid.append(providerField.wrap,keyField.wrap,responseModeField.wrap,aiDaily.wrap,aiConsent.wrap,aiFree.wrap,aiFallback.wrap,aiEnabled.wrap);
const routingPanel=ctx.node('div','ploa-model-routing');
routingPanel.setAttribute('aria-label','Modelos do atendimento');
function renderModelRouting(){
  routingPanel.replaceChildren();const routing=ctx.snapshot?.modelRouting;
  routingPanel.append(ctx.node('h4',null,'Continuidade entre modelos'),ctx.node('p','ploa-note',routing?.enabled===false?'Troca automática desativada. Apenas o modelo principal será consultado.':'Qwen → GPT-OSS 120B → GPT-OSS 20B. A mesma chave Groq, o histórico e as regras comerciais acompanham a troca.'));
  const cards=ctx.node('div','ploa-model-grid');
  for(const model of routing?.models||[]){const card=ctx.node('article','ploa-model-card');
    card.dataset.status=model.status;
    card.append(ctx.node('span','ploa-note',model.role),ctx.node('strong',null,model.label));
    const state=model.status==='paused'?'Em pausa até '+formatDate(model.availableAt,true):model.id===routing.lastUsedModel?'Último modelo usado':model.priority===1?'Prioridade de atendimento':'Disponível como reserva';
    card.append(ctx.node('span','ploa-note',state));cards.append(card);
  }
  routingPanel.append(cards,ctx.node('p','ploa-note','Ao esgotar as opções, o atendimento aguarda a liberação da cota. Cada nova tentativa respeita o limite diário de consultas do Ploa. A disponibilidade dos modelos e os limites dependem da sua conta Groq.'));
  if(routing?.warning)routingPanel.append(ctx.node('p','ploa-note',routing.warning));
}

const providerNote=ctx.node('p','ploa-note');

const updateProviderNote=()=>{
    providerNote.textContent=providerField.input.value==='gemini'
      ? 'Gemini gratuito: o Google pode usar o conteúdo para melhorar seus produtos. Nesta integração inicial, fica em sugestões para revisão interna. Não há bloqueio automático por DDI.'
      : 'Groq: as conversas não são usadas para treinar modelos sem autorização, mas são processadas pelo provedor e podem ter retenção operacional. Confira os controles da sua conta.';
  };

providerField.input.addEventListener('change',()=>{aiConsent.input.checked=true;aiFree.input.checked=false;aiEnabled.input.checked=false;keyField.input.value='';updateProviderNote();ctx.refreshSelects();});

let connectionDirty=false;

connectionGrid.addEventListener('input',()=>{connectionDirty=true;});

connectionGrid.addEventListener('change',()=>{connectionDirty=true;});

connection.append(connectionStatus,runtimeNote,connectionGrid,providerNote,
    ctx.node('p','ploa-note','O filtro remove identificadores conhecidos, telefones, e-mails e links; não garante anonimização completa. A chave é salva com proteção do Windows e recuperada ao reabrir com o mesmo usuário. Deixe o campo vazio para manter a chave salva ou informe outra para substituí-la. A chave não entra no backup. Cotas e cobranças dependem do plano da sua conta; não há troca automática para outro provedor.'),
    ctx.actions(ctx.button('Salvar conexão',async()=>{
      ctx.snapshot=await ctx.api('/api/workspace/settings','PUT',{provider:providerField.input.value,apiKey:keyField.input.value,
        enabled:aiEnabled.input.checked,dataConsent:aiConsent.input.checked,freeAccountConfirmed:aiFree.input.checked,
        responseMode:responseModeField.input.value,maxDailyRequests:Number(aiDaily.input.value),modelFallback:aiFallback.input.checked});
      keyField.input.value='';connectionDirty=false;ctx.renderKnowledge();showToast(ctx.snapshot.settings.enabled?'Conexão configurada. Novas mensagens seguirão o modo escolhido.':'Configuração salva com IA desativada.');
    },true),ctx.button('Desativar e remover chave',async()=>{
      ctx.snapshot=await ctx.api('/api/workspace/settings','PUT',{provider:ctx.snapshot?.settings.provider||providerField.input.value,enabled:false,clearKey:true});
      keyField.input.value='';connectionDirty=false;ctx.renderKnowledge();showToast('IA desativada e chave salva removida deste computador.');
    })),routingPanel);

ctx.view('messages').append(connection);
  return Object.defineProperties({}, {
    connection: { enumerable: true, get: () => connection },
    connectionStatus: { enumerable: true, get: () => connectionStatus },
    runtimeNote: { enumerable: true, get: () => runtimeNote },
    connectionGrid: { enumerable: true, get: () => connectionGrid },
    providerField: { enumerable: true, get: () => providerField },
    keyField: { enumerable: true, get: () => keyField },
    responseModeField: { enumerable: true, get: () => responseModeField },
    aiDaily: { enumerable: true, get: () => aiDaily },
    aiEnabled: { enumerable: true, get: () => aiEnabled },
    aiConsent: { enumerable: true, get: () => aiConsent },
    aiFree: { enumerable: true, get: () => aiFree },
    aiFallback: { enumerable: true, get: () => aiFallback },
    renderModelRouting: { enumerable: true, get: () => renderModelRouting },
    providerNote: { enumerable: true, get: () => providerNote },
    updateProviderNote: { enumerable: true, get: () => updateProviderNote },
    connectionDirty: { enumerable: true, get: () => connectionDirty, set: value => { connectionDirty = value; } }
  });
};
