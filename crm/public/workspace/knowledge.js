'use strict';
// Área de knowledge; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.knowledge = function mountArea(ctx) {
const knowledge=ctx.section('Ensinar o atendimento','Instruções e exemplos ficam salvos neste computador. Quando você ativar a IA, os exemplos selecionados e as instruções integrarão o contexto enviado ao provedor.');

const knowledgeStatus=ctx.node('p','ploa-pill','Base local · sem conexão externa');

const knowledgeGrid=ctx.node('div','ploa-form-grid');

const guidanceField=ctx.field('Como Ronald atende','textarea',true);

const servicesField=ctx.field('Serviços, limites e condições confirmadas','textarea',true);

guidanceField.input.maxLength=12000;

servicesField.input.maxLength=16000;

knowledgeGrid.append(guidanceField.wrap,servicesField.wrap);

knowledge.append(knowledgeStatus,knowledgeGrid,ctx.actions(ctx.button('Salvar instruções',async()=>{
    ctx.snapshot=await ctx.api('/api/workspace/settings','PUT',{guidance:guidanceField.input.value,services:servicesField.input.value});
    knowledgeDirty=false;showToast('Instruções salvas na base local.');
  })));

const voiceGuide=ctx.details('Voz do atendimento — referência da sua conversa');
const voiceBasis=ctx.node('p','ploa-note');
const voicePrinciples=ctx.node('ul','ploa-note');
const voiceLocale=ctx.field('Idioma dos exemplos de estilo','select');
ctx.options(voiceLocale.input,[['pt-BR','Brasil'],['pt-PT','Portugal'],['en-US','Estados Unidos'],['es-ES','Espanha']],'pt-BR');
const voiceExamples=ctx.node('div');
voiceGuide.append(voiceBasis,voicePrinciples,voiceLocale.wrap,ctx.node('p','ploa-note','Exemplos adaptados para orientar o jeito de responder. Não são transcrições do cliente nem substituem o contexto, os preços ou as condições comerciais.'),voiceExamples);
knowledge.append(voiceGuide);
function renderVoiceGuide(){
    const voice=ctx.snapshot?.playbook?.voice;
    voiceGuide.hidden=!voice;
    if(!voice)return;
    voiceBasis.textContent=voice.basis;
    voicePrinciples.replaceChildren(...voice.principles.map(text=>ctx.node('li',null,text)));
    voiceExamples.replaceChildren();
    for(const example of voice.examples){
      const row=ctx.node('article','ploa-ledger-row'),copy=ctx.node('div'),language=voiceLocale.input.value;
      copy.append(ctx.node('strong',null,example.title),ctx.node('p','ploa-note','Cliente: '+example.incoming[language]),ctx.node('p','ploa-note','Resposta: '+example.replies[language]));
      row.append(copy);voiceExamples.append(row);
    }
  }
voiceLocale.input.addEventListener('change',renderVoiceGuide);

let knowledgeDirty=false;

knowledgeGrid.addEventListener('input',()=>{knowledgeDirty=true;});

const responseGuide=ctx.details('Guia de respostas por situação');

responseGuide.append(ctx.node('p','ploa-note','A IA recebe a orientação da situação relevante e confere se ela faz sentido no histórico. Aqui você pode consultar o objetivo, os caminhos possíveis e um exemplo. Os casos são ilustrativos: não confirmam problemas do cliente nem autorizam serviços, valores ou novos envios.'));

const guideFilters=ctx.node('div','ploa-form-grid');

const guideLocale=ctx.field('Idioma dos exemplos','select'),guideSituation=ctx.field('Situação da conversa','select');

ctx.options(guideLocale.input,[['pt-BR','Brasil'],['pt-PT','Portugal'],['en-US','Estados Unidos'],['es-ES','Espanha']],'pt-BR');

const guideReason=ctx.node('p','ploa-note');

const guideIncoming=ctx.field('Mensagem recebida — caso ilustrativo','textarea',true);
guideIncoming.input.readOnly=true;
guideIncoming.input.rows=2;

const guideBranches=ctx.node('ol','ploa-note');
const guideAvoid=ctx.node('p','ploa-note');
const guideCheckpoint=ctx.node('p','ploa-note');

const guideExample=ctx.field('Exemplo de construção — adapte ao contexto','textarea',true);

guideExample.input.readOnly=true;

guideExample.input.rows=4;

const guideState=ctx.node('p','ploa-note');

guideFilters.append(guideLocale.wrap,guideSituation.wrap);

responseGuide.append(guideFilters,guideIncoming.wrap,guideReason,ctx.node('h4',null,'Como conduzir conforme a resposta'),guideBranches,guideAvoid,guideCheckpoint,guideExample.wrap,guideState);

knowledge.append(responseGuide);

let guideVersion='';

function renderBaseResponseGuide(){
    const playbook=ctx.snapshot?.playbook;
    if(!playbook){guideState.textContent='Reabra o Ploa para carregar o guia desta atualização.';return;}
    if(guideVersion!==playbook.version){
      const current=guideSituation.input.value;
      ctx.options(guideSituation.input,playbook.scenarios.map(item=>[item.id,item.title]));
      if(playbook.scenarios.some(item=>item.id===current))guideSituation.input.value=current;
      else guideSituation.input.value='already_website';
      guideVersion=playbook.version;ctx.refreshSelects();
    }
    const item=playbook.scenarios.find(item=>item.id===guideSituation.input.value);
    if(!item)return;
    guideReason.textContent='Objetivo: '+(item.objective||item.strategy);
    guideIncoming.input.value=item.incoming?.[guideLocale.input.value]||'';
    guideIncoming.wrap.hidden=!guideIncoming.input.value;
    guideBranches.replaceChildren();
    for(const branch of item.branches||[])guideBranches.append(ctx.node('li',null,branch));
    guideAvoid.textContent=item.avoid?'Evitar: '+item.avoid:'';
    guideCheckpoint.textContent=item.checkpoint?'Próximo passo: '+item.checkpoint:'';
    guideExample.input.value=item.examples[guideLocale.input.value]||'Nenhuma mensagem comercial: encerrar e respeitar o pedido.';
    guideState.textContent=playbook.scenarios.length+' situações · 4 idiomas · '+(item.review?'Revisão necessária antes de uma resposta automática.':'A resposta deve se apoiar no histórico, sem pressupor interesse ou necessidade.');
  }

function renderResponseGuide(){
    renderBaseResponseGuide();
    if(ctx.snapshot?.settings.responseMode==='autonomous'&&ctx.snapshot?.playbook)guideState.textContent=ctx.snapshot.playbook.scenarios.length+' situações · 4 idiomas · A IA adapta a conversa ao histórico e às condições autorizadas. Exceções ficam para Ronald; consultar este guia não envia mensagens.';
  }

guideLocale.input.addEventListener('change',renderResponseGuide);

guideSituation.input.addEventListener('change',renderResponseGuide);

const exampleGrid=ctx.node('div','ploa-form-grid');

const exampleQuestion=ctx.field('Situação / mensagem do cliente','textarea'),exampleAnswer=ctx.field('Resposta que você aprovou','textarea');

exampleQuestion.input.maxLength=2000;

exampleAnswer.input.maxLength=2500;

exampleGrid.append(exampleQuestion.wrap,exampleAnswer.wrap);

const examples=ctx.node('div');

knowledge.append(ctx.node('h4',null,'Exemplos para ensinar'),exampleGrid,ctx.actions(ctx.button('Adicionar exemplo aprovado',async()=>{
    ctx.snapshot=await ctx.api('/api/workspace/examples','POST',{question:exampleQuestion.input.value,answer:exampleAnswer.input.value});
    exampleQuestion.input.value='';exampleAnswer.input.value='';renderKnowledge();showToast('Exemplo salvo. Ele não substitui os fatos de cada conversa.');
  })),examples);

ctx.view('messages').append(knowledge);

function renderKnowledge(){
    ctx.renderAttendance();
    if(!ctx.snapshot)return;
    renderVoiceGuide();
    renderResponseGuide();
    if(!ctx.connectionDirty){
      ctx.providerField.input.value='groq';ctx.responseModeField.input.value=ctx.snapshot.settings.responseMode||'autonomous';
      ctx.aiDaily.input.value=ctx.snapshot.settings.maxDailyRequests;ctx.aiEnabled.input.checked=ctx.snapshot.settings.enabled;
      ctx.aiConsent.input.checked=true;ctx.aiFree.input.checked=ctx.snapshot.settings.freeAccountConfirmed===true;
      ctx.aiFallback.input.checked=ctx.snapshot.settings.modelFallback!==false;
      ctx.updateProviderNote();ctx.refreshSelects();
    }
    const runtime=ctx.snapshot.runtime;
    ctx.renderModelRouting();
    ctx.connectionStatus.textContent=(runtime?.label||(ctx.snapshot.settings.enabled?'Habilitada':'Desativada'))+' · '+ctx.snapshot.usage.requests+'/'+ctx.snapshot.settings.maxDailyRequests+' consultas hoje';
    ctx.runtimeNote.textContent=[runtime?.detail,runtime?.modeLabel,ctx.snapshot.keyStorage?.error||(ctx.snapshot.keyStorage?.saved?'Chave salva e protegida':ctx.snapshot.hasKey?'Chave carregada':'Sem chave salva'),
      runtime?.lastSentAt?'Última resposta enviada: '+formatDate(runtime.lastSentAt,true):''].filter(Boolean).join(' · ');
    knowledgeStatus.textContent=ctx.snapshot.settings.enabled?'Base local usada no contexto da IA':'Base local · conexão desativada';
    if(!knowledgeDirty){guidanceField.input.value=ctx.snapshot.settings.guidance;servicesField.input.value=ctx.snapshot.settings.services;}
    examples.replaceChildren();
    for(const example of ctx.snapshot.settings.examples||[]){
      const row=ctx.node('article','ploa-ledger-row');const copy=ctx.node('div');
      copy.append(ctx.node('strong',null,example.question),ctx.node('p','ploa-note',example.answer));
      row.append(copy,ctx.button('Excluir',async()=>{
        if(!window.confirm('Excluir este exemplo da base local?'))return;
        ctx.snapshot=await ctx.api('/api/workspace/examples/'+encodeURIComponent(example.id),'DELETE',{});renderKnowledge();
      }));examples.append(row);
    }
  }
  return Object.defineProperties({}, {
    knowledge: { enumerable: true, get: () => knowledge },
    knowledgeStatus: { enumerable: true, get: () => knowledgeStatus },
    knowledgeGrid: { enumerable: true, get: () => knowledgeGrid },
    guidanceField: { enumerable: true, get: () => guidanceField },
    servicesField: { enumerable: true, get: () => servicesField },
    knowledgeDirty: { enumerable: true, get: () => knowledgeDirty, set: value => { knowledgeDirty = value; } },
    responseGuide: { enumerable: true, get: () => responseGuide },
    guideFilters: { enumerable: true, get: () => guideFilters },
    guideLocale: { enumerable: true, get: () => guideLocale },
    guideSituation: { enumerable: true, get: () => guideSituation },
    guideReason: { enumerable: true, get: () => guideReason },
    guideExample: { enumerable: true, get: () => guideExample },
    guideState: { enumerable: true, get: () => guideState },
    guideVersion: { enumerable: true, get: () => guideVersion, set: value => { guideVersion = value; } },
    renderBaseResponseGuide: { enumerable: true, get: () => renderBaseResponseGuide },
    renderResponseGuide: { enumerable: true, get: () => renderResponseGuide },
    exampleGrid: { enumerable: true, get: () => exampleGrid },
    exampleQuestion: { enumerable: true, get: () => exampleQuestion },
    exampleAnswer: { enumerable: true, get: () => exampleAnswer },
    examples: { enumerable: true, get: () => examples },
    renderKnowledge: { enumerable: true, get: () => renderKnowledge }
  });
};
