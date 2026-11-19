/* Histórico em lotes. Esta interface nunca solicita envio de mensagens. */
(() => {
  'use strict';
  window.PloaTriage={create({node,details,field,actions,button,api,showToast,getCandidates,getSnapshot,isActive,onChanged,openContact,host,chooseContacts}){
    const panel=details('Triagem do histórico · analisar sem enviar mensagens');panel.classList.add('ploa-triage-panel');
    const status=node('p','ploa-note','Analise os contatos deste filtro e confira a prévia antes de aplicar as categorias.');status.setAttribute('role','status');
    const useAi=field('Usar IA somente nos casos ambíguos','checkbox',true),aiLimit=field('Máximo de consultas nesta análise','number');aiLimit.input.min=1;aiLimit.input.max=100;aiLimit.input.value=20;
    const inputs=node('div','ploa-form-grid');inputs.append(useAi.wrap,aiLimit.wrap);
    const list=node('div','ploa-triage-preview'),progress=node('progress','ploa-triage-progress');progress.max=1;progress.value=0;
    let batch={status:'idle',safe:0},loading=false;
    const start=button('Analisar contatos do filtro',async()=>{
      const contacts=getCandidates().filter(lead=>lead.status==='respondeu'&&lead.classificacao_revisao&&lead.classificacao_modo!=='manual').slice(0,2000).map(lead=>lead.id);
      if(!contacts.length)throw new Error('Este filtro não tem respostas pendentes de triagem.');
      batch=await api('/api/triage/start','POST',{contacts,useAi:useAi.input.checked,aiLimit:Number(aiLimit.input.value)});panel.open=true;render();
    },true);
    const apply=button('Aplicar categorias seguras',async()=>{
      const result=await api('/api/triage/apply','POST',{});batch=result;render();await onChanged();showToast(result.applied+(result.applied===1?' categoria aplicada.':' categorias aplicadas.')+' Novas mensagens e classificações manuais foram preservadas.');
    });
    const undo=button('Desfazer aplicação',async()=>{const result=await api('/api/triage/undo','POST',{});batch=result;render();await onChanged();showToast(result.restored+' classificações de triagem desfeitas.');});
    panel.append(node('p','ploa-note','A análise usa os filtros selecionados em Leads. Escolha lá o país, a categoria ou a fila e volte para conferir a prévia. Até 2.000 contatos por análise; a IA é opcional e prioriza o atendimento atual.'),...(chooseContacts?[actions(button('Escolher contatos em Leads',chooseContacts))]:[]),inputs,actions(start,apply,undo),progress,status,
      node('p','ploa-note','A análise não envia mensagens, não confirma vendas e não modifica etapas definidas manualmente. Históricos sem texto recebem somente essa identificação, sem interpretar intenção ou consultar a IA. Novas mensagens são preservadas; a aplicação pode ser desfeita.'),list);
    host.before(panel);
    function render(){
      const running=batch.status==='running',snapshot=getSnapshot();
      start.disabled=running;apply.disabled=running||!batch.safe||batch.applied>0;undo.disabled=!batch.canUndo;
      useAi.input.disabled=running||!snapshot?.settings.enabled||!snapshot?.hasKey;aiLimit.input.disabled=running||!useAi.input.checked;
      apply.textContent=batch.applied?'Categorias aplicadas':'Aplicar '+(batch.safe||0)+(batch.safe===1?' categoria segura':' categorias seguras');
      progress.max=Math.max(1,batch.total||0);progress.value=batch.processed||0;progress.hidden=!batch.total;
      const labels={idle:'Nenhuma análise iniciada',running:'Analisando',completed:'Prévia concluída',paused:'Análise pausada',error:'Análise indisponível'};
      status.textContent=(labels[batch.status]||batch.status)+(batch.total?` · ${batch.processed||0}/${batch.total} avaliadas · ${batch.safe||0} categorias seguras (${batch.withoutText||0} sem texto) · ${batch.pending||0} para conferir · ${batch.aiUsed||0}/${batch.aiLimit||0} consultas à IA`:'')+(batch.reason?' · '+batch.reason:'');
      list.replaceChildren();
      for(const item of (batch.items||[]).slice(0,80)){
        const row=node('article','ploa-triage-item'),title=node('div','ploa-triage-item-head');title.append(node('strong',null,item.name),node('span','ploa-pill',item.analysis.label));
        row.append(title,node('p',null,item.analysis.reason),node('small',null,(item.analysis.source==='ai'?'IA com evidência':'Regra local')+' · '+(item.analysis.needsReview?'Precisa conferir o contexto':'Categoria pronta para aplicação')),
          actions(button('Abrir contato',()=>openContact(item.contact))));list.append(row);
      }
      if(batch.total>80)list.append(node('p','ploa-note','Prévia dos primeiros 80 de '+batch.total+' contatos. A aplicação considera todos os resultados seguros deste lote.'));
    }
    async function refresh(){if(loading||!isActive())return;loading=true;try{batch=await api('/api/triage');render();}catch(error){status.textContent=error.message;}finally{loading=false;}}
    useAi.input.addEventListener('change',render);
    const timer=setInterval(()=>{if(isActive()&&batch.status==='running'&&!document.hidden)void refresh();},2500);
    window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    return{refresh,render};
  }};
})();
