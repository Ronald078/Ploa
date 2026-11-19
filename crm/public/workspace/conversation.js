'use strict';
// Área de conversation; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.conversation = function mountArea(ctx) {
const chat = ctx.node('section', 'ploa-conversation');

chat.setAttribute('aria-label', 'Conversa do contato');

const chatHead = ctx.node('div', 'ploa-conversation-head');

const chatIdentity = ctx.node('div');

const chatTitle = ctx.node('h3', null, 'Conversa');

const chatStatus = ctx.node('p', 'ploa-note', 'Selecione um contato para abrir o histórico.');

chatIdentity.append(chatTitle, chatStatus);

const modeButton = ctx.button('Assumir atendimento', async () => {
    const lead = selectedLead();
    await ctx.command('mode', { mode: lead.atendimento_modo === 'human' ? 'automatic' : 'human' });
    showToast(lead.atendimento_modo === 'human' ? 'Atendimento liberado para IA, quando configurada.' : 'Você assumiu esta conversa. A IA não responderá.');
  });

chatHead.append(chatIdentity, modeButton);

const transcript = ctx.node('div', 'ploa-transcript');

transcript.setAttribute('aria-label', 'Histórico da conversa');

const composer = ctx.node('div', 'ploa-composer');

const messageLabel = ctx.field('Mensagem para o contato', 'textarea', true);

messageLabel.input.maxLength = 5000;

messageLabel.input.placeholder = 'Escreva a resposta. O envio usa a sessão conectada ao painel.';

const composeActions = ctx.node('div', 'ploa-actions');

const sendButton = ctx.button('Enviar mensagem', async () => {
    const text = messageLabel.input.value.trim();
    if (!text) throw new Error('Escreva uma mensagem.');
    if (!ctx.snapshot?.workerConnected) throw new Error('Inicie o script de mensagens e conecte o WhatsApp antes de enviar.');
    await ctx.command('message', { text });
    messageLabel.input.value = '';
    ctx.drafts.delete(selectedLead()?.id);
    showToast('Mensagem colocada na fila. Acompanhe a confirmação abaixo.');
  }, true);

const jobStatus = ctx.node('p', 'ploa-note');

jobStatus.setAttribute('role', 'status');

const suggestButton=ctx.button('Sugerir resposta com IA',async()=>{
    await ctx.command('suggest');showToast('Sugestão solicitada. Ela aparecerá abaixo para revisão.');
  });

composeActions.append(suggestButton,sendButton);

composer.append(messageLabel.wrap, composeActions, jobStatus);

chat.append(chatHead, transcript, composer);

const autoStatus=ctx.node('p','ploa-auto-status');

autoStatus.setAttribute('role','status');

chatHead.after(autoStatus);

ctx.$('.workspace').insertBefore(chat, elements.inspector);

elements.inspector.classList.add('ploa-commercial');

ctx.$('.history', elements.inspector).hidden = true;

let transcriptKey = '';

renderHistory = (lead) => {
    const entries = [...(lead.historico_completo || []),
      ...(lead.notas || []).map((note) => ({ id: note.id, direction: 'note', text: note.texto, at: note.criado_em, actor: 'human' }))]
      .filter((item) => item.text)
      .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
    const key = lead.id + '|' + entries.length + '|' + entries.at(-1)?.text + '|' + entries.at(-1)?.at;
    if (key === transcriptKey) return;
    const nearEnd = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
    const changed = ctx.selected !== lead.id;
    transcriptKey = key;
    transcript.replaceChildren();
    if (!entries.length) transcript.append(ctx.node('p', 'ploa-note', 'Ainda não há mensagens registradas. Novas mensagens aparecerão aqui quando o WhatsApp estiver conectado.'));
    const names = { human: 'Ronald', ai: 'IA', script: 'Script', bot: 'Resposta automática', contact: 'Contato' };
    for (const entry of entries.slice(-300)) {
      const bubble = ctx.node('article', 'ploa-bubble');
      bubble.dataset.direction = entry.direction || 'in';
      bubble.append(document.createTextNode(entry.text));
      bubble.append(ctx.node('small', null, (entry.direction === 'note' ? 'Nota' : names[entry.actor] || 'Contato') +
        ' · ' + (entry.at ? formatDate(entry.at, true) : 'Data não disponível no registro antigo')));
      transcript.append(bubble);
    }
    if (entries.length > 300) transcript.prepend(ctx.node('p', 'ploa-note', 'Exibindo os 300 registros mais recentes. O arquivo local preserva os demais.'));
    if (changed || nearEnd) requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; });
  };

const automaticFacts=ctx.section('Ficha automática da conversa','A IA registra o que o contato informou. Você pode acompanhar ou corrigir quando necessário.');

const automaticFactList=ctx.node('dl','ploa-auto-facts');

automaticFacts.append(automaticFactList);

elements.inspectorContent.append(automaticFacts);

const projectPricingDetails=ctx.details('Diagnóstico e preço do projeto');
const projectPricingContent=ctx.node('div');
projectPricingDetails.append(projectPricingContent);
elements.inspectorContent.append(projectPricingDetails);

const facts = ctx.details('Correções e informações manuais — opcional');

const factGrid = ctx.node('div', 'ploa-form-grid');

const factFields = {};

for (const [name, label] of [['need','Necessidade'], ['objection','Objeção / dúvida'], ['agreed','O que foi combinado'], ['nextStep','Próximo passo']]) {
    const f = ctx.field(label, 'textarea'); f.input.maxLength = 1500;
    factFields[name] = f.input; factGrid.append(f.wrap);
    f.input.addEventListener('input', () => ctx.markDirty('facts'));
  }

facts.append(ctx.node('p', 'ploa-note', 'Preencha apenas o que você deseja corrigir ou confirmar. Suas informações têm prioridade sobre a ficha automática.'), factGrid);

facts.append(ctx.actions(ctx.button('Salvar contexto', async () => {
    const stamp = ctx.saveStamp('facts');
    await ctx.command('facts', Object.fromEntries(Object.entries(factFields).map(([key, input]) => [key, input.value])));
    ctx.markSaved('facts',stamp); renderExtras(); showToast('Contexto salvo.');
  })));

elements.inspectorContent.append(facts);

const followUp = ctx.details('Horário, moeda e classificação');

const followGrid = ctx.node('div', 'ploa-form-grid');

const timeField = ctx.field('Hora do retorno', 'time');

const zoneField = ctx.field('Fuso horário', 'select');

ctx.options(zoneField.input, [['America/Sao_Paulo','Brasil · Brasília'],['Europe/Lisbon','Portugal · Lisboa'],
    ['Europe/Madrid','Espanha · Madrid'],['America/New_York','EUA · Nova Iorque'],['America/Los_Angeles','EUA · Los Angeles']]);

const currencyField = ctx.field('Moeda do contato', 'select');

ctx.options(currencyField.input, [['BRL','Real (BRL)'],['EUR','Euro (EUR)'],['USD','Dólar (USD)']]);

const classificationField = ctx.field('Classificação', 'select');

ctx.options(classificationField.input, [['automatica','Automática a cada nova resposta'],['manual','Manter etapa escolhida por mim']]);

followGrid.append(timeField.wrap, zoneField.wrap, currencyField.wrap, classificationField.wrap);

followUp.append(followGrid, ctx.actions(ctx.button('Salvar preferências do contato', async () => {
    const stamp = ctx.saveStamp('preferences');
    await ctx.api('/api/leads/' + encodeURIComponent(selectedLead().id), 'PATCH', {
      moeda: currencyField.input.value, fuso: zoneField.input.value, retorno_hora: timeField.input.value,
      classificacao_modo: classificationField.input.value,
      ...(classificationField.input.value === 'manual' ? { status: elements.leadStatus.value } : {}),
    });
    ctx.markSaved('preferences',stamp); await loadDashboard({quiet:true}); renderExtras(); showToast('Preferências salvas.');
  })));

followGrid.addEventListener('input', () => ctx.markDirty('preferences'));

followGrid.addEventListener('change', () => ctx.markDirty('preferences'));

elements.inspectorContent.append(followUp);

const aiSuggestion=ctx.section('Resposta sugerida','Confira o contexto e ajuste a mensagem antes de aprovar o envio.');

const suggestionReason=ctx.node('p','ploa-note');

const suggestionField=ctx.field('Resposta para revisar','textarea',true);

suggestionField.input.maxLength=2500;

suggestionField.input.addEventListener('input',()=>{if(ctx.displayedSuggestion)ctx.suggestionDrafts.set(ctx.displayedSuggestion,suggestionField.input.value);});

const suggestionActions=ctx.actions(
    ctx.button('Aprovar e enviar',async()=>{
      const id=ctx.displayedSuggestion;
      await ctx.command('approve-suggestion',{jobId:id,text:suggestionField.input.value});
      ctx.suggestionDrafts.delete(id);showToast('Resposta aprovada e colocada na fila. Acompanhe a confirmação do envio.');
    },true),
    ctx.button('Guardar correção como exemplo',async()=>{
      await ctx.command('learn-suggestion',{jobId:ctx.displayedSuggestion,text:suggestionField.input.value});
      showToast('Exemplo aprovado guardado. Ele orientará respostas futuras, sem enviar esta mensagem.');
    }),
    ctx.button('Descartar',async()=>{const id=ctx.displayedSuggestion;await ctx.command('dismiss-suggestion',{jobId:id});ctx.suggestionDrafts.delete(id);}),
  );

aiSuggestion.append(suggestionReason,suggestionField.wrap,suggestionActions);

aiSuggestion.hidden=true;

composer.before(aiSuggestion);

const contextAnalysis=ctx.section('Leitura da conversa','Interpretação contextual, separada dos fatos confirmados e dos recebimentos.');

const analysisText=ctx.node('p','ploa-note');

const analysisConfirm=ctx.button('Confirmar classificação sugerida',async()=>{await ctx.command('confirm-analysis');showToast('Classificação confirmada por você.');});

contextAnalysis.append(analysisText,ctx.actions(analysisConfirm));

contextAnalysis.hidden=true;

facts.after(contextAnalysis);

const suggestedReturn=ctx.section('Próximo acompanhamento','A sugestão organiza a próxima ação. Nenhuma mensagem é enviada ao marcar o retorno.');

const returnText=ctx.node('p','ploa-note');

const scheduleReturn=ctx.button('Marcar retorno sugerido',async()=>{await ctx.command('schedule-suggested-return');showToast('Retorno marcado. Revise a data e o horário nas preferências do contato.');});

suggestedReturn.append(returnText,ctx.actions(scheduleReturn));

suggestedReturn.hidden=true;

followUp.after(suggestedReturn);

const commercial = ctx.details('Propostas e recebimentos');

const financeTotals = ctx.node('p', 'ploa-note');

const proposalList = ctx.node('div');

const proposalGrid = ctx.node('div', 'ploa-form-grid');

const proposalTitle = ctx.field('Serviço / título');

const proposalAmount = ctx.field('Valor da proposta', 'number');

proposalAmount.input.min = '0.01';

proposalAmount.input.step = '0.01';

const proposalScope = ctx.field('Escopo', 'textarea', true);

const proposalTerms = ctx.field('Condições / pagamento', 'textarea', true);

proposalGrid.append(proposalTitle.wrap, proposalAmount.wrap, proposalScope.wrap, proposalTerms.wrap);

proposalGrid.addEventListener('input',()=>ctx.markDirty('proposal'));

commercial.append(financeTotals, proposalList, proposalGrid, ctx.actions(ctx.button('Criar versão da proposta', async () => {
    const stamp=ctx.saveStamp('proposal');
    await ctx.command('proposal', { title: proposalTitle.input.value, amount: Number(proposalAmount.input.value),
      scope: proposalScope.input.value, terms: proposalTerms.input.value, currency: selectedLead().moeda });
    if(selectedLead()?.id===stamp.id&&(ctx.sectionRevisions.get('proposal')||0)===stamp.revision){
      proposalTitle.input.value = ''; proposalAmount.input.value = ''; proposalScope.input.value = ''; proposalTerms.input.value = '';
    }
    ctx.markSaved('proposal',stamp);
    showToast('Proposta criada como rascunho. Nenhuma mensagem foi enviada.');
  })));

const paymentGrid = ctx.node('div', 'ploa-form-grid');

const paymentAmount = ctx.field('Valor efetivamente recebido', 'number');

paymentAmount.input.min = '0.01';

paymentAmount.input.step = '0.01';

const paymentDescription = ctx.field('Referência do pagamento');

const paymentCheck = ctx.field('Confirme: verifiquei o recebimento', 'checkbox', true);

paymentGrid.append(paymentAmount.wrap, paymentDescription.wrap, paymentCheck.wrap);

paymentGrid.addEventListener('input',()=>ctx.markDirty('payment'));

const paymentList = ctx.node('div');

commercial.append(ctx.node('h4', null, 'Registrar recebimento'), paymentGrid, ctx.actions(ctx.button('Confirmar recebimento', async () => {
    if (!paymentCheck.input.checked) throw new Error('Confirme primeiro que verificou o pagamento.');
    if (!window.confirm('Registrar este valor como dinheiro efetivamente recebido? Não é um orçamento ou promessa de pagamento.')) return;
    const stamp=ctx.saveStamp('payment');
    await ctx.command('payment', { amount: Number(paymentAmount.input.value), description: paymentDescription.input.value,
      currency: selectedLead().moeda, confirmed: true });
    if(selectedLead()?.id===stamp.id&&(ctx.sectionRevisions.get('payment')||0)===stamp.revision){
      paymentAmount.input.value = ''; paymentDescription.input.value = ''; paymentCheck.input.checked = false;
    }
    ctx.markSaved('payment',stamp);
    showToast('Recebimento registrado no financeiro.');
  })), paymentList);

const deliveryField = ctx.field('Entrega do projeto', 'select');

ctx.options(deliveryField.input, [['pending','A iniciar'],['working','Em produção'],['delivered','Entregue']]);

deliveryField.input.addEventListener('input',()=>ctx.markDirty('delivery'));

deliveryField.input.addEventListener('change',()=>ctx.markDirty('delivery'));

commercial.append(deliveryField.wrap, ctx.actions(ctx.button('Salvar entrega', async () => {
    const stamp=ctx.saveStamp('delivery');
    await ctx.command('delivery', {status:deliveryField.input.value});
    ctx.markSaved('delivery',stamp); renderExtras(); showToast('Estado da entrega salvo.');
  })));

elements.inspectorContent.append(commercial);

function rememberDraft() {
    if(!ctx.selected)return;
    ctx.contactDrafts.set(ctx.selected,{
      dirty:[...ctx.dirtySections],
      facts:Object.fromEntries(Object.entries(factFields).map(([key,input])=>[key,input.value])),
      preferences:{time:timeField.input.value,zone:zoneField.input.value,currency:currencyField.input.value,classification:classificationField.input.value},
      proposal:{title:proposalTitle.input.value,amount:proposalAmount.input.value,scope:proposalScope.input.value,terms:proposalTerms.input.value},
      payment:{amount:paymentAmount.input.value,description:paymentDescription.input.value},
      delivery:deliveryField.input.value,
    });
  }

function restoreDraft(id) {
    const draft=ctx.contactDrafts.get(id);
    ctx.dirtySections.clear();
    for(const section of draft?.dirty||[])ctx.dirtySections.add(section);
    ctx.dirty=ctx.dirtySections.size>0;
    for(const [key,input] of Object.entries(factFields))input.value=draft?.facts?.[key]||'';
    timeField.input.value=draft?.preferences?.time||'';
    zoneField.input.value=draft?.preferences?.zone||'America/Sao_Paulo';
    currencyField.input.value=draft?.preferences?.currency||'BRL';
    classificationField.input.value=draft?.preferences?.classification||'automatica';
    proposalTitle.input.value=draft?.proposal?.title||'';
    proposalAmount.input.value=draft?.proposal?.amount||'';
    proposalScope.input.value=draft?.proposal?.scope||'';
    proposalTerms.input.value=draft?.proposal?.terms||'';
    paymentAmount.input.value=draft?.payment?.amount||'';
    paymentDescription.input.value=draft?.payment?.description||'';
    paymentCheck.input.checked=false;
    deliveryField.input.value=draft?.delivery||'pending';
  }

function renderExtras() {
    const lead = selectedLead();
    modeButton.hidden = !lead;
    if (!lead) {
      if(ctx.selected){rememberDraft();ctx.drafts.set(ctx.selected,messageLabel.input.value);ctx.selected=null;ctx.dirtySections.clear();ctx.dirty=false;}
      transcript.replaceChildren(ctx.node('p', 'ploa-note', 'Selecione um contato na lista.'));
      chatTitle.textContent = 'Conversa'; chatStatus.textContent = 'O histórico e as ações aparecem ao abrir um contato.';
      sendButton.disabled = true;suggestButton.disabled=true;aiSuggestion.hidden=true; return;
    }
    if (ctx.selected !== lead.id) {
      rememberDraft();
      if (ctx.selected) ctx.drafts.set(ctx.selected, messageLabel.input.value);
      ctx.selected = lead.id;
      restoreDraft(lead.id); messageLabel.input.value = ctx.drafts.get(lead.id) || '';
    }
    chatTitle.textContent = lead.nome;
    const record = ctx.snapshot?.records?.[lead.id] || {};
    projectPricingContent.replaceChildren();
    const pendingProject=record.projectDraft?.status==='pending'?record.projectDraft:null;
    const project=pendingProject||record.projectAssessment;
    if(project){
      const names={site:'Site',system:'Sistema',site_system:'Site + sistema'};
      const dimensions={presentation:'Apresentação',contentManagement:'Gestão de conteúdo',purchaseFlow:'Fluxo de compra',businessRules:'Regras da operação',dataHandling:'Tratamento de dados',externalConnections:'Conexões com outros serviços',changeEffort:'Trabalho de criação ou atualização'};
      const levels={basic:'Básico',moderate:'Intermediário',advanced:'Avançado'};
      projectPricingContent.append(ctx.node('strong',null,(names[project.serviceType]||'Projeto')+' · '+(pendingProject?'Aguardando confirmação do cliente':'Diagnóstico confirmado')),
        ctx.node('p','ploa-note',project.summary));
      for(const driver of project.drivers||[])projectPricingContent.append(ctx.node('p','ploa-note',(dimensions[driver.dimension]||driver.dimension)+': '+(levels[driver.level]||driver.level)+' · “'+driver.evidence+'”'));
      if(project.technicalReview)projectPricingContent.append(ctx.node('p','ploa-note','Precisa da sua avaliação de viabilidade antes de proposta fechada.'));
      if(!pendingProject&&Number.isFinite(project.amount))projectPricingContent.append(ctx.node('strong',null,'Preço original: '+ctx.money(project.amount,project.currency)),
        ctx.node('p','ploa-note','Faixa: '+ctx.money(project.minimum,project.currency)+' a '+ctx.money(project.maximum,project.currency)+'. Descontos são aplicados separadamente; mensalidade preservada.'));
    }else projectPricingContent.append(ctx.node('p','ploa-note','O diagnóstico aparecerá quando a IA enviar um resumo do projeto para confirmação.'));
    automaticFactList.replaceChildren();
    const factLabels={need:'Necessidade',objection:'Objeção ou dúvida',decisionMaker:'Responsável pela decisão',currentChannel:'Canal atual',requirements:'Requisitos',agreed:'Combinado',nextStep:'Próximo passo'};
    for(const [key,label] of Object.entries(factLabels)){
      const item=ctx.node('div'),value=record.facts?.[key]||record.memory?.[key]?.value;
      item.append(ctx.node('dt',null,label),ctx.node('dd',null,value||'Ainda não informado'));
      if(value)item.append(ctx.node('small',null,record.facts?.[key]?'Confirmado por você':'Extraído da conversa'));
      automaticFactList.append(item);
    }
    const analysis=lead.analise_ia;
    contextAnalysis.hidden=!analysis;
    if(analysis){
      analysisText.textContent=[analysis.reason,analysis.evidence?'Trecho usado: “'+analysis.evidence+'”':'',analysis.nextStep].filter(Boolean).join(' · ');
      analysisConfirm.hidden=ctx.snapshot?.settings.responseMode==='autonomous'||!analysis.suggestedStatus||analysis.automatic||Boolean(analysis.confirmedAt);
    }
    const returnPlan=lead.retorno_sugerido;
    suggestedReturn.hidden=!returnPlan;
    if(returnPlan){
      returnText.textContent=returnPlan.action+' · '+returnPlan.reason+' · '+returnPlan.date+(returnPlan.time?' às '+returnPlan.time:'')+' · '+returnPlan.zone;
      scheduleReturn.hidden=returnPlan.existing;
    }
    const human = record.mode === 'human';
    modeButton.textContent = human ? 'Liberar para IA' : 'Assumir atendimento';
    modeButton.disabled = lead.vinculo_pendente||['nao_contatar','perdido'].includes(lead.status);
    const autonomous=ctx.snapshot?.settings.enabled&&ctx.snapshot.settings.responseMode==='autonomous';
    chatStatus.textContent = record.autoClosed?'Abordagem encerrada · novos envios pausados':human ? 'Atendimento com Ronald · IA pausada neste contato'
      : ctx.snapshot?.settings.enabled ? (['no_key','setup','quota','offline','error'].includes(ctx.snapshot.runtime?.code)?ctx.snapshot.runtime.label:autonomous?'IA conduz a conversa com as regras comerciais':ctx.snapshot.settings.responseMode==='automatic'?'IA automática habilitada':'IA prepara sugestões para aprovação') : 'IA não ativada · atendimento disponível com Ronald';
    composer.hidden=autonomous&&!human;
    suggestButton.hidden=autonomous&&!human;
    sendButton.disabled = !ctx.snapshot?.workerConnected || lead.vinculo_pendente || lead.status === 'nao_contatar';
    suggestButton.disabled=!ctx.snapshot?.settings.enabled||!ctx.snapshot?.hasKey||lead.vinculo_pendente||['nao_contatar','perdido','automatico'].includes(lead.status);
    const jobs = (ctx.snapshot?.jobs || []).filter((job) => job.contact === lead.id);
    const suggestion=jobs.filter(job=>job.kind==='ai'&&job.status==='draft').at(-1);
    aiSuggestion.hidden=!suggestion;
    if(suggestion){
      ctx.displayedSuggestion=suggestion.id;
      suggestionReason.textContent=[suggestion.analysis?.reason,suggestion.analysis?.nextStep].filter(Boolean).join(' · ');
      if(document.activeElement!==suggestionField.input)suggestionField.input.value=ctx.suggestionDrafts.get(suggestion.id)??suggestion.text??'';
    }else ctx.displayedSuggestion=null;
    const last = jobs.at(-1);
    const statusText = { ready:'Na fila de envio', sending:'Enviando; aguarde a confirmação', sent:'Mensagem enviada',
      review:'Envio exige conferência no WhatsApp; não será repetido automaticamente', cancelled:'Envio cancelado',
      queued:'Aguardando a conversa completar', thinking:'Preparando o próximo passo', draft:'Sugestão pronta para aprovação', approved:'Sugestão aprovada', dismissed:'Sugestão descartada', held:'Precisa de uma informação ou decisão', closed:'Abordagem encerrada' };
    jobStatus.textContent = last ? (statusText[last.status] || last.status) + (last.reason ? ' · ' + last.reason : '')
      : ctx.snapshot?.workerConnected ? 'WhatsApp conectado ao painel.' : 'Conecte o atendimento contínuo do WhatsApp na página Mensagens para enviar.';
    autoStatus.textContent=autonomous&&!human?(last?jobStatus.textContent:'IA aguardando a próxima mensagem do contato. Use Assumir atendimento quando quiser intervir.'):'';
    autoStatus.hidden=!autoStatus.textContent;
    if (!ctx.dirtySections.has('facts')) {
      for (const [key, input] of Object.entries(factFields)) input.value = record.facts?.[key] || '';
    }
    if (!ctx.dirtySections.has('preferences')) {
      timeField.input.value = lead.retorno_hora || '';
      zoneField.input.value = lead.fuso || 'America/Sao_Paulo';
      currencyField.input.value = lead.moeda;
      classificationField.input.value = lead.classificacao_modo || 'automatica';
    }
    if (!ctx.dirtySections.has('delivery')) deliveryField.input.value = record.delivery?.status || 'pending';
    ctx.refreshSelects();
    financeTotals.textContent = 'Contratado: ' + ctx.money(lead.valor_contratado,lead.moeda) +
      ' · Recebido: ' + ctx.money(lead.valor_recebido,lead.moeda) + ' · A receber: ' + ctx.money(lead.valor_a_receber,lead.moeda);
    proposalList.replaceChildren();
    for (const proposal of record.proposals || []) {
      const row = ctx.node('article', 'ploa-ledger-row');
      const copy = ctx.node('div');
      const labels = {draft:'Rascunho',sent:'Apresentada',accepted:'Aceite confirmado',declined:'Recusada',replaced:'Substituída'};
      copy.append(ctx.node('strong',null, proposal.title + ' · v' + proposal.version),
        ctx.node('small',null,ctx.money(proposal.amount,proposal.currency) + ' · ' + (labels[proposal.status] || proposal.status)));
      if (proposal.scope) copy.append(ctx.node('p','ploa-note',proposal.scope));
      if (proposal.terms) copy.append(ctx.node('p','ploa-note',proposal.terms));
      const actions = ctx.node('div','ploa-actions');
      actions.append(ctx.button('Preparar mensagem',async()=>{
        messageLabel.input.value = [proposal.title, proposal.scope, ctx.money(proposal.amount,proposal.currency),proposal.terms].filter(Boolean).join('\n\n');
        messageLabel.input.focus(); showToast('Revise a proposta antes de enviar.');
      }));
      for(const [status,label] of [['sent','Registrar apresentação'],['accepted','Confirmar aceite'],['declined','Registrar recusa']]){
        if(proposal.status===status)continue;
        actions.append(ctx.button(label,async()=>{
          if(!window.confirm(label+' desta proposta? Isso apenas registra o fato, sem enviar mensagem.'))return;
          await ctx.command('proposal-status',{proposalId:proposal.id,status});
        }));
      }
      copy.append(actions);row.append(copy);proposalList.append(row);
    }
    paymentList.replaceChildren(...(record.payments || []).map((payment)=>{
      const row=ctx.node('div','ploa-ledger-row');
      row.append(ctx.node('strong',null,ctx.money(payment.amount,payment.currency)),
        ctx.node('small',null,formatDate(payment.at,true)+' · '+(payment.description||'Recebimento confirmado')));return row;
    }));
    renderHistory(lead);
  }

const oldInspector = renderInspector;

renderInspector = () => { oldInspector(); renderExtras(); };

elements.leadList.addEventListener('click',(event)=>{
    const target=event.target.closest('[data-lead-id]');
    if(target&&target.dataset.leadId!==state.selectedLeadId&&(ctx.dirty||state.formDirty)){
      if(!window.confirm('Há alterações no contato que não foram salvas. Abrir outro contato mesmo assim?')){
        event.stopImmediatePropagation();event.preventDefault();
      }
    }
  },true);
  return Object.defineProperties({}, {
    chat: { enumerable: true, get: () => chat },
    chatHead: { enumerable: true, get: () => chatHead },
    chatIdentity: { enumerable: true, get: () => chatIdentity },
    chatTitle: { enumerable: true, get: () => chatTitle },
    chatStatus: { enumerable: true, get: () => chatStatus },
    modeButton: { enumerable: true, get: () => modeButton },
    transcript: { enumerable: true, get: () => transcript },
    composer: { enumerable: true, get: () => composer },
    messageLabel: { enumerable: true, get: () => messageLabel },
    composeActions: { enumerable: true, get: () => composeActions },
    sendButton: { enumerable: true, get: () => sendButton },
    jobStatus: { enumerable: true, get: () => jobStatus },
    suggestButton: { enumerable: true, get: () => suggestButton },
    autoStatus: { enumerable: true, get: () => autoStatus },
    transcriptKey: { enumerable: true, get: () => transcriptKey, set: value => { transcriptKey = value; } },
    automaticFacts: { enumerable: true, get: () => automaticFacts },
    automaticFactList: { enumerable: true, get: () => automaticFactList },
    facts: { enumerable: true, get: () => facts },
    factGrid: { enumerable: true, get: () => factGrid },
    factFields: { enumerable: true, get: () => factFields },
    followUp: { enumerable: true, get: () => followUp },
    followGrid: { enumerable: true, get: () => followGrid },
    timeField: { enumerable: true, get: () => timeField },
    zoneField: { enumerable: true, get: () => zoneField },
    currencyField: { enumerable: true, get: () => currencyField },
    classificationField: { enumerable: true, get: () => classificationField },
    aiSuggestion: { enumerable: true, get: () => aiSuggestion },
    suggestionReason: { enumerable: true, get: () => suggestionReason },
    suggestionField: { enumerable: true, get: () => suggestionField },
    suggestionActions: { enumerable: true, get: () => suggestionActions },
    contextAnalysis: { enumerable: true, get: () => contextAnalysis },
    analysisText: { enumerable: true, get: () => analysisText },
    analysisConfirm: { enumerable: true, get: () => analysisConfirm },
    suggestedReturn: { enumerable: true, get: () => suggestedReturn },
    returnText: { enumerable: true, get: () => returnText },
    scheduleReturn: { enumerable: true, get: () => scheduleReturn },
    commercial: { enumerable: true, get: () => commercial },
    financeTotals: { enumerable: true, get: () => financeTotals },
    proposalList: { enumerable: true, get: () => proposalList },
    proposalGrid: { enumerable: true, get: () => proposalGrid },
    proposalTitle: { enumerable: true, get: () => proposalTitle },
    proposalAmount: { enumerable: true, get: () => proposalAmount },
    proposalScope: { enumerable: true, get: () => proposalScope },
    proposalTerms: { enumerable: true, get: () => proposalTerms },
    paymentGrid: { enumerable: true, get: () => paymentGrid },
    paymentAmount: { enumerable: true, get: () => paymentAmount },
    paymentDescription: { enumerable: true, get: () => paymentDescription },
    paymentCheck: { enumerable: true, get: () => paymentCheck },
    paymentList: { enumerable: true, get: () => paymentList },
    deliveryField: { enumerable: true, get: () => deliveryField },
    rememberDraft: { enumerable: true, get: () => rememberDraft },
    restoreDraft: { enumerable: true, get: () => restoreDraft },
    renderExtras: { enumerable: true, get: () => renderExtras },
    oldInspector: { enumerable: true, get: () => oldInspector }
  });
};
