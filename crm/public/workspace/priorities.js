'use strict';
// Área de priorities; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.priorities = function mountArea(ctx) {
const aiAttention=ctx.section('Conversas que precisam de você','Aqui aparecem pedidos fora das condições cadastradas ou informações que a IA não consegue confirmar.');

const aiAttentionList=ctx.node('div');

aiAttention.append(aiAttentionList);

ctx.$('.workspace').before(aiAttention);

aiAttention.hidden=true;

const aiAttentionOverview=ctx.section('Decisões pendentes da IA','O atendimento continua nos demais contatos. Abra uma conversa para tratar a exceção.');

const aiAttentionOverviewList=ctx.node('div');

aiAttentionOverview.append(aiAttentionOverviewList);

ctx.view('overview').append(aiAttentionOverview);

aiAttentionOverview.hidden=true;

function renderAiAttention(){
    const pending=ctx.report?.attention||[];
    aiAttention.hidden=!pending.length;aiAttentionOverview.hidden=!pending.length;
    for(const [container,limit] of [[aiAttentionList,20],[aiAttentionOverviewList,5]]){
      container.replaceChildren();
      for(const item of pending.slice(0,limit)){
        const row=ctx.node('article','ploa-ledger-row'),copy=ctx.node('div');
        copy.append(ctx.node('strong',null,item.name),ctx.node('p','ploa-note',item.reason),ctx.node('small',null,formatDate(item.at,true)));
        row.append(copy,ctx.actions(ctx.button('Abrir conversa',()=>openContact(item.contact)),ctx.button('Dispensar aviso',async()=>{
          await ctx.api('/api/workspace/leads/'+encodeURIComponent(item.contact),'POST',{action:'resolve-attention'});await ctx.loadWorkspace();
        })));container.append(row);
      }
    }
  }

function openContact(id){
    if(state.formDirty||ctx.dirty||ctx.messageLabel.input.value.trim()){
      showToast('Salve o acompanhamento ou a mensagem em edição antes de trocar de contato.','error');return;
    }
    ctx.extra.country='';ctx.extra.category='';ctx.extra.mode='';state.search='';elements.searchInput.value='';
    state.statusFilter=null;state.attentionFilter='todos';elements.attentionFilter.value='todos';
    state.selectedLeadId=id;setActiveView('leads');renderLeadList();renderInspector();ctx.renderExtras();
  }

  return Object.defineProperties({}, {
    aiAttention: { enumerable: true, get: () => aiAttention },
    aiAttentionList: { enumerable: true, get: () => aiAttentionList },
    aiAttentionOverview: { enumerable: true, get: () => aiAttentionOverview },
    aiAttentionOverviewList: { enumerable: true, get: () => aiAttentionOverviewList },
    renderAiAttention: { enumerable: true, get: () => renderAiAttention },
    openContact: { enumerable: true, get: () => openContact }
  });
};
