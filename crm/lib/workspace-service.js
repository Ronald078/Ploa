'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { createAiProvider, buildContext, PROVIDERS } = require('./ai-provider');
const { planFollowUp } = require('./followup-planner');
const { analyzeCopies } = require('./sales-analysis');
const { publicPlaybook } = require('./sales-playbook');
const {defaults:businessDefaults,normalizeBusiness,captureMemory,decideAutonomous}=require('./commercial-policy');
const {uniqueConversationEvents,isOutgoingEcho}=require('./conversation-events');
const {dayKey,financialWindows}=require('./metrics');
const {addProposal,addPayment,confirmedPayments,roundMoney}=require('./commercial-records');
const {describeAiRuntime}=require('./ai-runtime');
const {generateWithReview}=require('./ai-result-review');
const {confirmedScopeResult,negotiationResult}=require('./commercial-transition');
const {paymentResult}=require('./payment-flow');
const {captureBudget}=require('./negotiation-budget');
const {createTokenRecorder,tokenDashboard}=require('./ai-token-usage');
const {routingStore,GROQ_MODELS}=require('./model-routing');
const {filterText}=require('./conversation-context');
const {credentialDirectory}=require('./runtime-paths');
const {createCredentialStore}=require('./credential-store');
const {requireSetup}=require('./account-setup');

const DEFAULT_GUIDANCE = 'Atenda em nome de Ronald, programador e engenheiro de software. Use o idioma do cliente. Responda de forma simples e curta, com uma pergunta por vez. Consulte o histórico. Entenda a necessidade antes de propor. Não invente pesquisa, problemas, resultados, exemplos, preços ou urgência. Respeite recusas. Encaminhe exceções a Ronald.';
const dateKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const contactId = (value) => {
  const id = clean(value, 160).replace(/@c\.us$/, '');
  if (!/^\d{7,16}(?:@lid)?$/.test(id)) throw fail('Contato inválido.');
  return id;
};
const emptyWorkspace = () => ({ version: 1, settings: { enabled: false, provider: '', model: '', responseMode: 'autonomous', dataConsent: false, freeAccountConfirmed: false,business:businessDefaults(),keepConnected:null,preventSleep:false,autoExternal:true,
  modelFallback:true,maxDailyRequests: 60, debounceSeconds: 10, guidance: DEFAULT_GUIDANCE,
  services: 'Criação e melhoria de websites para empresas. Valores e condições precisam ser definidos por Ronald.',
  examples: [], anonymousOnly: true }, records: {}, jobs: [], usage: {}, savedFilters: [], copyVersions: [] });

function createWorkspaceService(root, store, { credentialStore,neutralDefaults=false,identityRoot=root,authorize=require('./account-authorization').createAccountAuthorization() } = {}) {
  const initialWorkspace=()=>{
    const data=emptyWorkspace();
    if(neutralDefaults)Object.assign(data.settings,{guidance:'Use somente a identidade, os serviços e as condições configurados nesta empresa. Não invente informações. Respeite recusas e encaminhe exceções à pessoa responsável.',services:'',keepConnected:false,autoExternal:false,business:{...businessDefaults(),guidance:'Negocie somente nas condições cadastradas. Exceções precisam da pessoa responsável.'}});
    return data;
  };
  const file = path.join(root, 'ploa_workspace.json');
  const eventFile = path.join(root, 'ploa_conversas.jsonl');
  const runFile = path.join(root, 'ploa_execucoes.jsonl');
  const controlFile = path.join(root, 'ploa_controle.json');
  const accountIdentity=()=>neutralDefaults?JSON.parse(fs.readFileSync(path.join(identityRoot,'.ploa-account.json'),'utf8')).identity:null;
  const contextFor=(lead,record,events,settings)=>buildContext(lead,record,events,{...settings,accountIdentity:accountIdentity()});
  const humanName=neutralDefaults?'a pessoa responsável':'Ronald';
  const internalToken = randomUUID();
  let queue = Promise.resolve();
  let workerSeenAt = 0;
  let eventCache = { size: -1, mtime: -1, items: [] };
  const tokenRecorder=createTokenRecorder(root,()=>read().usage);
  let provider = createAiProvider({ credentialStore:credentialStore||createCredentialStore({directory:credentialDirectory(root)}),onUsage:tokenRecorder.record,routeStore:routingStore(root) });
  let thinking = false;
  let closed = false;
  let nextRequestAt = 0;
  let readCache = null;

  function read() {
    try {
      const stat=fs.statSync(file),signature=stat.mtimeMs+':'+stat.size;
      if(readCache?.signature===signature)return readCache.data;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const merged={ ...initialWorkspace(), ...data, settings: { ...initialWorkspace().settings, ...data.settings }, records: data.records || {}, jobs: data.jobs || [] };
      readCache={signature,data:merged};return merged;
    }
    catch (error) { if (error.code === 'ENOENT') return initialWorkspace(); throw fail('Não foi possível ler o acompanhamento do Ploa. Restaure um backup antes de continuar.', 503); }
  }
  function write(data) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temp, file);
    readCache=null;
  }
  function mutate(fn) {
    const operation = queue.catch(() => {}).then(() => {
      const data = structuredClone(read()); const result = fn(data); write(data); return result;
    });
    queue = operation; return operation;
  }
  function recordFor(data, id) {
    const record = data.records[id] ||= { mode: 'automatic', facts: {}, proposals: [], payments: [] };
    record.proposals ||= []; record.payments ||= []; record.facts ||= {};
    return record;
  }
  function events() {
    try {
      const stat = fs.statSync(eventFile);
      if (eventCache.size !== stat.size || eventCache.mtime !== stat.mtimeMs) {
        eventCache = { size: stat.size, mtime: stat.mtimeMs, items: uniqueConversationEvents(fs.readFileSync(eventFile, 'utf8').split('\n').filter(Boolean)
          .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })) };
      }
      return eventCache.items;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  function appendEvent(event) {
    const item = { ...event, id: event.id || randomUUID(), at: event.at || new Date().toISOString() };
    if (item.messageId && events().some((existing) => existing.messageId === item.messageId && existing.direction === item.direction)) return false;
    if (item.actor === 'human' && item.direction === 'out' && events().some((existing) => isOutgoingEcho(existing,item))) return false;
    fs.appendFileSync(eventFile, `${JSON.stringify(item)}\n`, { mode: 0o600 });
    return true;
  }
  async function ingest(raw) {
    const id = contactId(raw.contact);
    const event = { contact: id, messageId: clean(raw.messageId, 220), direction: ['in','out','note'].includes(raw.direction) ? raw.direction : 'in',
      contactName:clean(raw.contactName,160),origin:raw.origin==='whatsapp_external'?'whatsapp_external':'',
      text: clean(raw.text, 16000), actor: ['script','human','bot','ai'].includes(raw.actor) ? raw.actor : 'contact',
      at: raw.at && Number.isFinite(Date.parse(raw.at)) ? raw.at : new Date().toISOString(),
      ...(raw.kind === 'copy' ? { kind:'copy', copyId:clean(raw.copyId,64), copyPreview:clean(raw.copyPreview,2500), country:clean(raw.country,60), category:clean(raw.category,80) } : {}) };
    return mutate((data) => {
      if (!appendEvent(event)) return { duplicate: true };
      const record = recordFor(data, id);
      if (event.direction === 'out' && event.actor === 'human') {
        const externalAutomatic=event.origin==='whatsapp_external'&&data.settings.autoExternal===true&&!record.manualOverride&&record.mode!=='human';
        if(!externalAutomatic)record.mode='human';
        if(externalAutomatic)record.externalConversation=true;
        // message_create arrives after a short echo-detection delay. An opening
        // captured after the customer's reply must not cancel that reply's job.
        const olderOpening=externalAutomatic&&record.lastInboundAt&&Date.parse(event.at)<=Date.parse(record.lastInboundAt);
        if(!olderOpening)for (const job of data.jobs) if (job.contact === id && ['queued','thinking','ready','held','draft'].includes(job.status)) job.status = 'cancelled';
      }
      if (event.direction === 'in') {
        captureBudget(record,event);
        record.lastInbound = event.messageId || event.at;
        record.lastInboundAt=event.at;
        for (const job of data.jobs) if (job.contact === id && ['queued','thinking','ready','held','draft'].includes(job.status)) job.status = 'cancelled';
        if (raw.eligible === true && record.mode !== 'human' && data.settings.enabled && !id.endsWith('@lid')) {
          data.jobs.push({ id: randomUUID(), contact: id, kind: 'ai', status: 'queued',
            inbound: record.lastInbound, dueAt: Date.now() + data.settings.debounceSeconds * 1000, createdAt: event.at, attempts: 0 });
        }
      }
      return { recorded: true };
    });
  }
  function publicSnapshot() {
    const data = read();
    const hasKey = provider?.hasKey(data.settings.provider) || false;
    const workerConnected = Date.now()-workerSeenAt < 15000;
    const modelRouting=provider?.routingStatus?.(data.settings)||null;
    let runtime=describeAiRuntime(data, { hasKey, workerConnected, thinking, nextRequestAt });
    if(neutralDefaults)runtime={...runtime,detail:runtime.detail.replace(/\bRonald\b/g,humanName)};
    if(modelRouting?.enabled&&modelRouting.models.length&&modelRouting.models.every(model=>model.status==='paused')&&runtime.queued&& !['quota','off','no_key','setup','generating','sending'].includes(runtime.code)){
      runtime={...runtime,code:'models_paused',label:'Modelos aguardando cota',detail:'A conversa permanece na fila. Uma nova tentativa será feita quando um modelo estiver disponível.'};
    }
    return { settings: {...data.settings,model:PROVIDERS[data.settings.provider]?.model||data.settings.model}, hasKey: provider?.hasKey(data.settings.provider) || false,
      capabilities: { manualMessageIdempotency: true, nextAppRoutes: true },
      runtime,modelRouting,
      keyStorage: provider?.keyStatus?.(data.settings.provider) || { saved:false, persistenceAvailable:false, error:'' },
      playbook: neutralDefaults?{version:1,rules:[],voice:null,scenarios:[]}:publicPlaybook(),
      providers: Object.entries(PROVIDERS).map(([id,item])=>({id,label:item.label,model:item.model})),
      providerAvailable: Boolean(provider), usage: data.usage[dateKey()] || { requests: 0, input: 0, output: 0 },
      tokenUsage:{...tokenDashboard(root,data.usage),recordingWarning:tokenRecorder.warning(),
        quota:{provider:data.settings.provider,model:PROVIDERS[data.settings.provider]?.model||'',
          dailyLimit:PROVIDERS[data.settings.provider]?.dailyTokenLimitReference||null,
          models:data.settings.provider==='groq'?GROQ_MODELS.slice(0,data.settings.modelFallback===false?1:3).map(model=>({id:model.id,label:model.label,dailyLimit:model.dailyTokenLimitReference})):[],
          reference:true,source:PROVIDERS[data.settings.provider]?.tokenLimitSource||''}},
      workerConnected: Date.now()-workerSeenAt < 15000, jobs: data.jobs.slice(-100).map(({ inbound, ...job }) => job),
      savedFilters: data.savedFilters || [], records: data.records, copyVersions: (data.copyVersions || []).map(({settings,...version}) => version) };
  }
  async function saveSettings(body) {
    const chosenProvider = body.provider ?? read().settings.provider;
    if (chosenProvider && !Object.hasOwn(PROVIDERS,chosenProvider)) throw fail('Provedor inválido.');
    const submittedKey=body.apiKey ? clean(body.apiKey,500) : '';
    if(submittedKey&&(submittedKey.length<20||/\s/.test(submittedKey)))throw fail('A chave da API parece incompleta.');
    await mutate((data) => {
      const enabled = body.enabled === undefined ? data.settings.enabled : body.enabled === true;
      const dataConsent = body.dataConsent === undefined ? data.settings.dataConsent : body.dataConsent === true;
      const freeAccountConfirmed = body.freeAccountConfirmed === undefined ? data.settings.freeAccountConfirmed : body.freeAccountConfirmed === true;
      if (enabled && (body.clearKey===true||(!provider?.hasKey(chosenProvider)&&!submittedKey) || !dataConsent || !freeAccountConfirmed)) throw fail('Informe a chave e confirme o contexto compartilhado e a conta gratuita antes de ativar.');
      const model = PROVIDERS[chosenProvider]?.model || '';
      const daily = Number(body.maxDailyRequests ?? data.settings.maxDailyRequests);
      if (!Number.isInteger(daily) || daily < 1 || daily > 1000) throw fail('Limite de consultas deve ficar entre 1 e 1000.');
      const responseMode=body.responseMode ?? data.settings.responseMode;
      if(!['review','automatic','autonomous'].includes(responseMode))throw fail('Modo de resposta inválido.');
      if(chosenProvider==='gemini'&&responseMode!=='review')throw fail('Nesta integração, Gemini fica no modo de sugestões internas para aprovação.');
      const business=body.business===undefined?(data.settings.business||businessDefaults()):normalizeBusiness(body.business);
      provider?.setKey({...body,apiKey:submittedKey,provider:chosenProvider});
      data.settings = { ...data.settings, enabled, provider:chosenProvider, model, responseMode, dataConsent, freeAccountConfirmed, maxDailyRequests: daily,business,
        modelFallback:body.modelFallback===undefined?data.settings.modelFallback:body.modelFallback===true,
        keepConnected:body.keepConnected===undefined?data.settings.keepConnected:body.keepConnected===true,
        preventSleep:body.preventSleep===undefined?data.settings.preventSleep:body.preventSleep===true,
        autoExternal:body.autoExternal===undefined?data.settings.autoExternal:body.autoExternal===true,
        guidance: clean(body.guidance ?? data.settings.guidance, 12000), services: clean(body.services ?? data.settings.services, 16000), anonymousOnly: true,
        debounceSeconds: Math.min(60, Math.max(5, Number(body.debounceSeconds ?? data.settings.debounceSeconds) || 10)), updatedAt:new Date().toISOString() };
      const resumed=new Set();
      for (const job of [...data.jobs].reverse()) if (job.kind === 'ai' && ['queued','thinking','ready','draft','held'].includes(job.status)) {
        const record=data.records[job.contact];
        if(enabled&&responseMode==='autonomous'&&!job.manual&&record?.mode!=='human'&&record?.lastInbound===job.inbound&&!resumed.has(job.contact)){
          resumed.add(job.contact);job.status='queued';job.dueAt=Date.now()+data.settings.debounceSeconds*1000;job.attempts=0;
          job.reason='Contexto atualizado; o atendimento automático usará as regras salvas.';
        }else{job.status='held';job.reason='As configurações mudaram. Gere uma nova sugestão para usar as instruções atuais.';}
      }
    });
    return publicSnapshot();
  }
  async function command(id, body) {
    if(['suggest','learn-suggestion'].includes(body?.action)){requireSetup(identityRoot,'ai');await authorize(['ai']);}
    if(['message','approve-suggestion'].includes(body?.action))await authorize(body.action==='approve-suggestion'?['ai','messages']:['messages']);
    id = contactId(id);
    const dashboard = await store.getDashboard();
    const lead = dashboard.leads.find((item) => item.id === id);
    if (!lead) throw fail('Contato não encontrado.',404);
    let leadPatch = null;
    const result = await mutate((data) => {
      const record = recordFor(data,id);
      if (['proposal','payment'].includes(body.action) && body.currency !== lead.moeda) {
        throw fail('Use a moeda configurada no contato. Valores em moedas diferentes não são somados.');
      }
      switch (body.action) {
        case 'suggest': {
          if (!data.settings.enabled || !provider?.hasKey(data.settings.provider)) throw fail('Ative a conexão de IA na página Mensagens.');
          if (lead.vinculo_pendente || ['nao_contatar','perdido','automatico'].includes(lead.status)) throw fail('Este contato não está disponível para uma sugestão de atendimento.');
          if (!lead.ultima_mensagem && !events().some(e=>e.contact===id && e.direction==='in' && e.actor!=='bot')) throw fail('Ainda não há uma mensagem do contato para responder.');
          for(const job of data.jobs)if(job.contact===id&&job.kind==='ai'&&['queued','thinking','draft','held'].includes(job.status))job.status='cancelled';
          record.lastInbound ||= lead.ultima_resposta || 'historico';
          data.jobs.push({id:randomUUID(),contact:id,kind:'ai',manual:true,status:'queued',inbound:record.lastInbound,dueAt:Date.now(),createdAt:new Date().toISOString(),attempts:0});
          break;
        }
        case 'approve-suggestion': {
          const job=data.jobs.find(j=>j.id===body.jobId&&j.contact===id&&j.kind==='ai'&&j.status==='draft');
          if(!job || job.inbound!==record.lastInbound)throw fail('Esta sugestão ficou desatualizada. Gere outra usando a mensagem mais recente.');
          if(lead.vinculo_pendente||['nao_contatar','perdido','automatico'].includes(lead.status))throw fail('O contato não pode receber esta resposta.');
          const text=clean(body.text,2500);if(!text)throw fail('Revise e preencha a resposta.');
          if(!workerSeenAt||Date.now()-workerSeenAt>=15000)throw fail('Conecte o WhatsApp pelo painel antes de aprovar o envio.');
          job.status='approved';job.approvedAt=new Date().toISOString();
          record.mode='human';
          for(const other of data.jobs)if(other.contact===id&&['queued','thinking','ready','draft','held'].includes(other.status))other.status='cancelled';
          data.jobs.push({id:randomUUID(),contact:id,text,kind:'human',sourceSuggestion:job.id,status:'ready',createdAt:new Date().toISOString()});
          break;
        }
        case 'dismiss-suggestion': {
          const job=data.jobs.find(j=>j.id===body.jobId&&j.contact===id&&j.status==='draft');
          if(!job)throw fail('A sugestão já foi atualizada.');job.status='dismissed';break;
        }
        case 'learn-suggestion': {
          const job=data.jobs.find(j=>j.id===body.jobId&&j.contact===id&&j.kind==='ai'&&['draft','approved'].includes(j.status));
          const answer=clean(body.text,2500);
          if(!job?.learningQuestion||!answer)throw fail('A situação e a resposta aprovada precisam estar preenchidas.');
          if(data.settings.examples.some(e=>e.sourceJob===job.id&&e.answer===answer))return record;
          data.settings.examples.push({id:randomUUID(),question:job.learningQuestion,answer,sourceJob:job.id,language:lead.classificacao_idioma,
            category:lead.categoria,at:new Date().toISOString()});data.settings.examples=data.settings.examples.slice(-80);
          job.learnedAt=new Date().toISOString();break;
        }
        case 'confirm-analysis': {
          const analysis=record.aiAnalysis;
          if(!analysis||analysis.inbound!==record.lastInbound||!analysis.suggestedStatus)throw fail('A análise ficou desatualizada. Gere uma nova sugestão.');
          if(['nao_contatar','ganho'].includes(lead.status))throw fail('A análise não altera um contato encerrado ou um cliente confirmado.');
          analysis.confirmedAt=new Date().toISOString();
          leadPatch={status:analysis.suggestedStatus,classificacao_modo:'manual'};
          appendEvent({contact:id,direction:'note',actor:'human',kind:'classification',text:`Classificação confirmada por ${humanName}: ${analysis.suggestedStatus}. ${analysis.reason}`});
          break;
        }
        case 'schedule-suggested-return': {
          const plan=planFollowUp(lead,record);
          if(!plan||plan.existing)throw fail('O contato já tem retorno marcado ou não está disponível para acompanhamento.');
          leadPatch={proximo_contato:plan.date,retorno_hora:plan.time,fuso:plan.zone,proxima_acao:plan.action};
          break;
        }
        case 'mode':
          record.mode = body.mode === 'human' ? 'human' : 'automatic';
          record.manualOverride=record.mode==='human';
          for (const job of data.jobs) if (job.contact === id && ['queued','thinking','ready','held','draft'].includes(job.status)) job.status = 'cancelled';
          break;
        case 'resolve-attention':
          if(record.attention)record.attention.resolvedAt=new Date().toISOString();
          break;
        case 'message': {
          const text = clean(body.text, 5000);
          if (!text) throw fail('Escreva a mensagem.');
          const requestId = clean(body.requestId, 120);
          const previous = requestId && data.jobs.find(job => job.contact === id && job.kind === 'human' && job.requestId === requestId);
          if (previous) {
            if (previous.text !== text) throw fail('Esta solicitação já foi usada para outra mensagem.', 409);
            return record;
          }
          if (lead.vinculo_pendente || lead.status === 'nao_contatar') throw fail('Esse contato não pode receber mensagens pelo painel.');
          record.mode = 'human';
          record.manualOverride=true;
          for (const job of data.jobs) if (job.contact === id && ['queued','thinking','ready','held','draft'].includes(job.status)) job.status = 'cancelled';
          data.jobs.push({ id: randomUUID(), contact: id, text, kind: 'human', ...(requestId ? { requestId } : {}), status: 'ready', createdAt: new Date().toISOString() });
          break;
        }
        case 'proposal': {
          addProposal(record,body);
          break;
        }
        case 'proposal-status': {
          const proposal = record.proposals.find((item) => item.id === body.proposalId);
          if (!proposal || !['draft','sent','accepted','declined','replaced'].includes(body.status)) throw fail('Proposta inválida.');
          if(proposal.status===body.status){
            if(body.status==='accepted')leadPatch={status:'ganho',moeda:proposal.currency};
            if(body.status==='sent')leadPatch={status:'proposta',moeda:proposal.currency};
            return record;
          }
          proposal.status = body.status; proposal.updatedAt = new Date().toISOString();
          if(body.status==='sent')proposal.sentAt ||= proposal.updatedAt;
          if (body.status === 'accepted') {
            // São versões da mesma proposta: o novo aceite substitui a anterior,
            // sem somar duas vezes o valor contratado.
            for (const previous of record.proposals) if(previous.id!==proposal.id && previous.status==='accepted'){
              previous.status='replaced';previous.updatedAt=proposal.updatedAt;
            }
            proposal.acceptedAt = proposal.updatedAt; leadPatch = { status: 'ganho', moeda: proposal.currency };
          }
          if (body.status === 'sent') leadPatch = { status: 'proposta', moeda: proposal.currency };
          appendEvent({ contact:id, direction:'note', text:`Proposta v${proposal.version}: ${body.status === 'accepted' ? 'aceite confirmado por '+humanName : body.status === 'sent' ? 'envio registrado por '+humanName : body.status}.`, actor:'human' });
          break;
        }
        case 'payment': {
          const {value:payment,reused}=addPayment(record,body);
          leadPatch = { status:'ganho', moeda:body.currency };
          if(reused)return record;
          if(record.attention?.kind==='payment_review')record.attention.resolvedAt=payment.at;
          appendEvent({contact:id,direction:'note',text:`Recebimento confirmado: ${payment.amount} ${body.currency}.`,actor:'human'});
          break;
        }
        case 'delivery': record.delivery = { status: ['pending','working','delivered'].includes(body.status) ? body.status : 'pending', at:new Date().toISOString() }; break;
        case 'facts':
          record.projectDraft=null;record.projectAssessment=null;
          record.facts = {
            need: clean(body.need, 1500), objection: clean(body.objection, 1500),
            agreed: clean(body.agreed, 1500), nextStep: clean(body.nextStep, 1500),
            updatedAt: new Date().toISOString(), source: 'Confirmado por '+humanName,
          };
          if(data.settings.enabled&&data.settings.responseMode==='autonomous'&&record.mode!=='human'){
            const pending=data.jobs.filter(job=>job.contact===id&&job.kind==='ai'&&!job.manual&&job.status==='ready'&&job.inbound===record.lastInbound);
            for(const job of pending){
              job.status='cancelled';job.reason='O contexto foi corrigido antes do envio.';
              const proposal=record.proposals.find(item=>item.id===job.proposalId&&item.status==='draft');
              if(proposal)proposal.status='replaced';
            }
            if(pending.length)data.jobs.push({id:randomUUID(),contact:id,kind:'ai',status:'queued',inbound:record.lastInbound,dueAt:Date.now()+data.settings.debounceSeconds*1000,createdAt:new Date().toISOString(),attempts:0});
          }
          break;
        default: throw fail('Ação não reconhecida.');
      }
      return record;
    });
    if (leadPatch) await store.updateLead(id,leadPatch);
    return result;
  }
  async function nextDelivery() {
    workerSeenAt = Date.now();
    if(read().jobs.some((item)=>item.status==='sending'&&Date.now()-Date.parse(item.claimedAt)>90000)){
      await mutate((data)=>{for(const job of data.jobs)if(job.status==='sending'&&Date.now()-Date.parse(job.claimedAt)>90000){
        job.status='review';job.reason='Confirmação do envio não recebida. Confira o WhatsApp; não haverá repetição automática.';
      }});
    }
    const dashboard = await store.getDashboard();
    const candidate = read().jobs.find((item) => item.status === 'ready');
    if (!candidate) return null;
    try{await authorize(candidate.kind==='ai'?['ai','messages']:['messages']);}
    catch(error){await mutate(data=>{const job=data.jobs.find(item=>item.id===candidate.id&&item.status==='ready');if(job){job.status='review';job.reason=clean(error.message,500);}});throw error;}
    return mutate((data) => {
      const job = data.jobs.find((item) => item.id === candidate.id && item.status === 'ready');
      if (!job) return null;
      const lead = dashboard.leads.find((item) => item.id === job.contact);
      if (!lead || lead.status === 'nao_contatar' || lead.vinculo_pendente || (job.kind === 'ai' && (['perdido','automatico'].includes(lead.status)||!data.settings.enabled || data.records[job.contact]?.mode === 'human' || data.records[job.contact]?.lastInbound !== job.inbound))) { job.status='cancelled'; return null; }
      job.status='sending'; job.claimedAt=new Date().toISOString();
      return {id:job.id,contact:job.contact,text:job.text,kind:job.kind};
    });
  }
  async function ack(body) {
    return mutate((data) => {
      const job=data.jobs.find((item)=>item.id===body.id);
      if (!job || job.status!=='sending') return;
      job.status=body.ok===true?'sent':'review';job.reason=clean(body.error,500);job.finishedAt=new Date().toISOString();
      if(body.ok===true) appendEvent({contact:job.contact,direction:'out',text:job.text,actor:job.kind==='ai'?'ai':'human',messageId:clean(body.messageId,220)});
      if(body.ok===true){
        const record=recordFor(data,job.contact);
        if(job.budgetQuestion)record.negotiationQuestion={...job.budgetQuestion,askedAt:job.finishedAt};
        if(job.scopeDraft)record.projectDraft={...job.scopeDraft,status:'pending',sentAt:job.finishedAt,inbound:job.inbound,sourceJob:job.id};
        if(job.proposalId){
          const proposal=record.proposals.find(item=>item.id===job.proposalId&&item.status==='draft');
          if(proposal){proposal.status='sent';proposal.sentAt=job.finishedAt;proposal.updatedAt=job.finishedAt;}
        }
        if(job.offerSnapshot)record.lastQuotedOffer={...job.offerSnapshot,amount:job.offerAmount,
          discountPercent:Number(job.offerDiscountPercent)||0,
          ...(job.offerSnapshot.pricingMode==='range'?{amountMin:job.offerSnapshot.amount}:{}),status:'quoted',quotedAt:job.finishedAt};
      }
    });
  }
  async function processAiQueue() {
    if(closed||thinking)return;
    const current=read();
    if(!current.settings.enabled||!provider?.hasKey(current.settings.provider))return;
    const candidate=current.jobs.find(j=>j.kind==='ai'&&j.status==='queued'&&j.dueAt<=Date.now());
    if(!candidate)return;
    thinking=true;
    let requestDay;
    try {
      await authorize(['ai']);
      requireSetup(identityRoot,'ai');
      const lead=(await store.getDashboard()).leads.find(l=>l.id===candidate.contact);
      const settings=current.settings;
      const heldReason=!lead||lead.vinculo_pendente ? 'Contato ainda sem vínculo com um telefone.'
        : ['nao_contatar','perdido','automatico'].includes(lead.status) ? 'Contato encerrado ou atendimento automático. Revise manualmente.' : '';
      if(heldReason){await mutate(data=>{const job=data.jobs.find(j=>j.id===candidate.id);if(job?.status==='queued'){job.status='held';job.reason=heldReason;}});return;}
      const claimed=await mutate(data=>{
        const job=data.jobs.find(j=>j.id===candidate.id),record=recordFor(data,candidate.contact);
        if(!job||job.status!=='queued'||!data.settings.enabled||job.inbound!==record.lastInbound||(!job.manual&&record.mode==='human'))return null;
        requestDay=dateKey();const usage=data.usage[requestDay] ||= {requests:0,input:0,output:0};
        job.status='thinking';job.attempts++;job.settingsAt=data.settings.updatedAt;job.factsAt=record.facts?.updatedAt||'';
        job.generationStartedAt=new Date().toISOString();
        return {record:structuredClone(record),settings:structuredClone(data.settings)};
      });
      if(!claimed)return;
      const history=events().filter(e=>e.contact===lead.id);
      // Acrescenta o histórico anterior quando não foi capturado pelo painel.
      for(const response of lead.respostas||[]){
        if(!history.some(e=>e.direction==='in'&&e.at===response.data&&e.text===response.texto))history.push({direction:'in',actor:'contact',text:response.texto,at:response.data});
      }
      const context=contextFor(lead,claimed.record,history,claimed.settings);
      context.automation.manualRequest=candidate.manual===true;
      const transition=paymentResult(claimed.settings,lead,claimed.record,context)
        ||confirmedScopeResult(claimed.settings,lead,claimed.record,context)
        ||negotiationResult(claimed.settings,lead,claimed.record,context);
      if(!transition){
        if(Date.now()<nextRequestAt){
          await mutate(data=>{const job=data.jobs.find(j=>j.id===candidate.id);if(job?.status==='thinking'){job.status='queued';job.dueAt=nextRequestAt;job.attempts--;delete job.generationStartedAt;}});return;
        }
        nextRequestAt=Date.now()+8000;
        const allowed=await mutate(data=>{
          const usage=data.usage[requestDay],job=data.jobs.find(j=>j.id===candidate.id),record=recordFor(data,candidate.contact);
          if(!job||job.status!=='thinking'||!data.settings.enabled||job.inbound!==record.lastInbound)return false;
          if(usage.requests>=data.settings.maxDailyRequests){job.status='held';job.reason='Limite diário de consultas à IA atingido. O envio normal e o atendimento manual continuam disponíveis.';record.attention={reason:job.reason,at:new Date().toISOString(),inbound:job.inbound,resolvedAt:null};return false;}
          usage.requests++;return true;
        });
        if(!allowed)return;
      }
      const result=transition||await generateWithReview(provider,claimed.settings,context,{beforeRetry:()=>mutate(data=>{
        const usage=data.usage[dateKey()]||={requests:0,input:0,output:0},job=data.jobs.find(j=>j.id===candidate.id);
        if(closed||!usage||usage.requests>=data.settings.maxDailyRequests||!data.settings.enabled||!job||job.status!=='thinking'||job.settingsAt!==data.settings.updatedAt||job.inbound!==data.records[candidate.contact]?.lastInbound||(!job.manual&&data.records[candidate.contact]?.mode==='human'))return false;
        usage.requests++;return true;
      })});
      let closePatch=null;
      await mutate(data=>{
        const usage=data.usage[requestDay];if(usage){usage.input+=result.usage.input;usage.output+=result.usage.output;if(!transition)usage.lastSuccessAt=new Date().toISOString();}
        const job=data.jobs.find(j=>j.id===candidate.id),record=recordFor(data,lead.id);
        if(closed||!job||job.status!=='thinking'||!data.settings.enabled||job.inbound!==record.lastInbound
          ||job.settingsAt!==data.settings.updatedAt||(!job.manual&&record.mode==='human'))return;
        if(job.factsAt!==(record.facts?.updatedAt||'')){
          job.status=job.manual?'held':'queued';job.dueAt=Date.now()+data.settings.debounceSeconds*1000;
          job.reason='O contexto foi corrigido durante a geração. A resposta será refeita com os dados atuais.';return;
        }
        const evidence=result.evidence&&context.latestMessage.includes(result.evidence);
        const sensitive=/\b(?:R\$|USD|EUR|BRL)\b|[€$]|\b(?:desconto|discount|descuento|garant|payment|pagamento|pagado|prazo|deadline)\b/i.test(result.reply);
        job.text=result.intent==='opt_out'?'':result.reply;
        job.analysis={intent:result.intent,reason:result.reason,evidence:evidence?result.evidence:'',nextStep:result.nextStep,
          needsReview:result.needsReview||context.responseGuide.requiresReview||!evidence||sensitive||/^\[(?:m[ií]dia|imagem|audio|aúdio|vídeo|video|anexo)/i.test(context.latestMessage),at:new Date().toISOString(),model:result.model,
          situation:context.responseGuide.id};
        const suggestedStatus={interested:'qualificado',proposal_request:'qualificado',refusal:'perdido',opt_out:'nao_contatar',bot:'automatico'}[result.intent]||null;
        record.aiAnalysis={...job.analysis,inbound:job.inbound,sourceMessageAt:lead.ultima_resposta,
          sourceText:clean(lead.ultima_mensagem,2000),suggestedStatus,
          // Uma interpretação isolada nunca registra proposta, contrato ou dinheiro.
          automatic:!job.analysis.needsReview&&['interested','proposal_request'].includes(result.intent)&&Boolean(evidence)};
        job.status='draft';job.reason='Sugestão pronta para revisão.';
        job.generatedAt=new Date().toISOString();
        job.timing={...result.timing,queueMs:Math.max(0,Date.parse(job.generationStartedAt)-Date.parse(job.createdAt)),
          generationMs:Math.max(0,Date.parse(job.generatedAt)-Date.parse(job.generationStartedAt))};
        job.learningQuestion=clean(lead.ultima_mensagem||context.latestMessage,2000);
        captureMemory(record,result.memory,history,job.inbound);
        if(!job.manual&&claimed.settings.responseMode==='autonomous'){
          const action=decideAutonomous(result,claimed.settings,lead,record,context);
          const previousStage=record.conversationStage;
          if(action.paymentChoice)record.paymentChoice={...action.paymentChoice,selectedAt:job.generatedAt};
          job.status=action.status;job.text=action.text||'';job.reason=action.reason;job.action=action.action;
          if(action.budgetQuestion)job.budgetQuestion=action.budgetQuestion;
          if(action.scopeDraft)job.scopeDraft=action.scopeDraft;
          if(action.projectAssessment){
            record.projectAssessment=action.projectAssessment;
            if(record.projectDraft)record.projectDraft.status='confirmed';
            job.projectAssessment=action.projectAssessment;
          }
          record.conversationStage=action.budgetQuestion?'negotiation':action.action==='accept'?'accepted':action.action==='proposal'?'proposal':action.action==='scope'?'scope_confirmation':action.action==='quote'?'quotation':result.intent==='objection'?'negotiation':action.action==='close'?'closed':'discovery';
          if(action.action==='payment')record.conversationStage=previousStage||'proposal';
          if(action.offer){
            job.offerSnapshot=action.offer;job.offerAmount=action.amount;job.offerDiscountPercent=action.discountPercent||0;
            if(action.action==='proposal'){
              const proposal={id:randomUUID(),version:record.proposals.length+1,title:action.offer.title,scope:action.offer.scope,
                terms:action.offer.terms,deadline:action.offer.deadline,maintenance:action.offer.maintenance,amount:action.amount,currency:action.offer.currency,
                catalogOfferId:action.offer.id,pricingBasisHash:action.offer.pricingBasisHash,pricingBaseAmount:action.offer.amount,
                projectAssessment:action.projectAssessment||null,discountPercent:action.discountPercent,status:'draft',createdAt:job.generatedAt,createdBy:'ai',sourceJob:job.id};
              record.proposals.push(proposal);job.proposalId=proposal.id;
            }
          }
          if(action.action==='accept'){
            const proposal=record.proposals.find(item=>item.id===action.proposalId&&item.status==='sent');
            if(proposal){
              for(const previous of record.proposals)if(previous.id!==proposal.id&&previous.status==='accepted'){previous.status='replaced';previous.updatedAt=job.generatedAt;}
              proposal.status='accepted';proposal.acceptedAt=job.generatedAt;proposal.updatedAt=job.generatedAt;proposal.acceptedBy='explicit-contact-message';
              record.conversationStage='accepted';
              appendEvent({contact:lead.id,direction:'note',actor:'ai',kind:'acceptance',text:'Aceite explícito registrado na proposta '+proposal.version+'. Recebimento financeiro permanece separado.'});
            }
          }
          if(action.action==='close'){
            record.mode='human';record.autoClosed=true;closePatch={status:action.closeStatus};
          }
          if(action.paymentNotice){job.paymentNotice=true;record.attention={kind:'payment_review',reason:action.reason,at:job.generatedAt,inbound:job.inbound,resolvedAt:null};}
          else if(action.status==='held')record.attention={reason:action.reason,at:job.generatedAt,inbound:job.inbound,resolvedAt:null};
          else if(record.attention&&record.attention.kind!=='payment_review')record.attention.resolvedAt=job.generatedAt;
          if(action.action!=='handoff')job.analysis.needsReview=false;
          record.aiAnalysis.needsReview=action.status==='held';record.aiAnalysis.autonomous=true;
          record.aiAnalysis.automatic=action.status!=='held'&&Boolean(evidence)&&['interested','proposal_request'].includes(result.intent);
          return;
        }
        // Apenas uma conversa explícita e simples pode seguir no modo automático.
        if(!job.manual&&claimed.settings.responseMode==='automatic'&&!job.analysis.needsReview&&job.text
          &&['question','interested'].includes(result.intent)&&! /\[[A-Z_]+\]/.test(job.text)){
          job.status='ready';job.reason='Resposta simples liberada pelo modo automático.';
        }
      });
      if(closePatch)await store.updateLead(lead.id,closePatch);
    } catch(error) {
      nextRequestAt=Math.max(nextRequestAt,Date.now()+(error.retryAfterMs||10000));
      await mutate(data=>{
        const job=data.jobs.find(j=>j.id===candidate.id);if(!job||!(job.status==='thinking'||job.status==='queued'&&['PLOA_ACCOUNT_ACCESS','PLOA_SETUP_REQUIRED'].includes(error.code)))return;
        if(requestDay&&data.usage[requestDay])data.usage[requestDay].lastErrorAt=new Date().toISOString();
        if(error.noRequest&&requestDay&&data.usage[requestDay])data.usage[requestDay].requests=Math.max(0,data.usage[requestDay].requests-1);
        job.reason=clean(error.message,500);
        job.status=error.routingUnavailable||(error.retryable&&job.attempts<2)?'queued':'held';job.dueAt=nextRequestAt;
        if(error.routingUnavailable)job.attempts=Math.max(0,job.attempts-1);
        if(job.status==='held')recordFor(data,job.contact).attention={reason:job.reason,at:new Date().toISOString(),inbound:job.inbound,resolvedAt:null};
      });
    } finally { thinking=false; }
  }
  function authorizeInternal(request) {
    const token=String(request.headers['x-ploa-agent']||'');
    const bytes=Buffer.from(token),expected=Buffer.from(internalToken);
    return bytes.length===expected.length && timingSafeEqual(bytes,expected);
  }
  async function classifyHistory(lead){
    await authorize(['ai']);requireSetup(identityRoot,'ai');
    const current=read();
    if(thinking||Date.now()<nextRequestAt||current.jobs.some(job=>job.kind==='ai'&&job.status==='queued'))throw Object.assign(new Error('Atendimento atual tem prioridade.'),{triageBusy:true});
    if(!current.settings.enabled||!provider?.hasKey(current.settings.provider)||!provider?.classify)throw fail('Ative a conexão de IA para interpretar os casos ambíguos. A análise por regras continua disponível.');
    thinking=true;let day;
    try{
      const settings=await mutate(data=>{
        day=dateKey();const usage=data.usage[day]||={requests:0,input:0,output:0};
        // Leave at least half the daily allowance available for live attendance.
        if(usage.requests>=Math.floor(data.settings.maxDailyRequests/2))throw fail('A triagem atingiu sua reserva de consultas. O restante do limite diário fica disponível para o atendimento.');
        usage.requests++;return structuredClone(data.settings);
      });
      nextRequestAt=Date.now()+8000;
      const record=current.records[lead.id]||{},history=(lead.historico_completo||[]).filter(event=>['in','out'].includes(event.direction));
      for(const response of lead.respostas||[])if(!history.some(event=>event.direction==='in'&&event.at===response.data&&event.text===response.texto))history.push({direction:'in',actor:'contact',text:response.texto,at:response.data});
      const context=contextFor(lead,record,history,settings);
      const result=await provider.classify(settings,{language:context.language,history:context.history,latestMessage:context.latestMessage},{beforeFallback:()=>mutate(data=>{
        const requestDay=dateKey(),usage=data.usage[requestDay]||={requests:0,input:0,output:0};
        if(closed||!data.settings.enabled||usage.requests>=Math.floor(data.settings.maxDailyRequests/2)||settings.updatedAt!==data.settings.updatedAt)return false;
        usage.requests++;return true;
      })});
      await mutate(data=>{const usage=data.usage[day];if(usage){usage.input+=result.usage?.input||0;usage.output+=result.usage?.output||0;}});
      return result;
    }catch(error){if(error.retryAfterMs)nextRequestAt=Math.max(nextRequestAt,Date.now()+error.retryAfterMs);throw error;}
    finally{thinking=false;}
  }
  async function reports() {
    const data=read();const byDay=new Map();const byCurrency={},today=dayKey(Date.now());
    for(const record of Object.values(data.records)) for(const payment of confirmedPayments(record)){
      const day=dayKey(payment.at);if(!day||day>today)continue;const key=`${day}|${payment.currency}`;
      byDay.set(key,{day,currency:payment.currency,received:roundMoney((byDay.get(key)?.received||0)+payment.amount)});
      byCurrency[payment.currency]=roundMoney((byCurrency[payment.currency]||0)+payment.amount);
    }
    let runs=[];try{runs=fs.readFileSync(runFile,'utf8').split('\n').filter(Boolean).flatMap((line)=>{try{return[JSON.parse(line)];}catch{return[];}}).slice(-100).reverse();}catch{}
    const leads=(await store.getDashboard()).leads;
    const analysis=analyzeCopies(events(),data.records);
    const followUps=leads.map(lead=>({contact:lead.id,name:lead.nome,...planFollowUp(lead,data.records[lead.id])}))
      .filter(item=>item.action).sort((a,b)=>a.priority-b.priority||a.date.localeCompare(b.date));
    const aiJobs=data.jobs.filter(job=>job.kind==='ai');
    return{daily:[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day)),financialWindows:financialWindows(data.records,leads),byCurrency,runs,...analysis,
      followUps:followUps.slice(0,60),followUpCount:followUps.length,
      attention:leads.filter(lead=>data.records[lead.id]?.attention&&!data.records[lead.id].attention.resolvedAt).map(lead=>({contact:lead.id,name:lead.nome,...data.records[lead.id].attention})),
      ai:{drafts:aiJobs.filter(j=>j.status==='draft').length,approved:aiJobs.filter(j=>j.status==='approved').length,
        held:aiJobs.filter(j=>j.status==='held').length,examples:data.settings.examples.length}};
  }
  async function creativeCall(kind,input,{signal}={}){
    await authorize(['ai']);requireSetup(identityRoot,'ai');
    if(closed||signal?.aborted)throw fail('Operação cancelada.');
    const current=read();
    if(thinking||current.jobs.some(job=>job.kind==='ai'&&job.status==='queued'))throw fail('O atendimento tem prioridade. Aguarde a fila da IA antes de analisar criativos.',409);
    if(current.settings.provider!=='groq'||!provider?.hasKey('groq')||!current.settings.dataConsent||!current.settings.freeAccountConfirmed)throw fail('Salve a chave Groq e as confirmações de compartilhamento na página IA. O atendimento automático pode permanecer desativado.');
    thinking=true;
    const initialDay=dateKey();let reserved=0;
    try{
      const reserve=()=>mutate(data=>{if(closed||signal?.aborted||data.settings.updatedAt!==current.settings.updatedAt)return false;
        const usage=data.usage[dateKey()]||={requests:0,input:0,output:0};if(usage.requests>=data.settings.maxDailyRequests)return false;usage.requests++;reserved++;return true;});
      if(!await reserve())throw fail('Limite diário de consultas do Ploa atingido ou configuração alterada.');
      const filtered=value=>typeof value==='string'?filterText(value).slice(0,5000):Array.isArray(value)?value.slice(0,12).map(filtered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).slice(0,30).map(([key,v])=>[key,filtered(v)])):value;
      const context=kind==='audio'?null:{...(neutralDefaults?{accountIdentity:accountIdentity()}:{}),content:filterText(input.content).slice(0,10000),businessContext:filterText(input.businessContext).slice(0,2000),country:input.country,
        ...(input.mode==='production'?{mode:'production',stage:input.stage,config:filtered(input.config),evidence:filtered(input.evidence||[]),reference:filtered(input.reference),plan:filtered(input.plan),slots:filtered(input.slots||[]),images:input.images||[]}: {})};
      const result=kind==='audio'?await provider.transcribe(current.settings,input,{signal}):await provider.analyzeCreative(current.settings,context,{signal,beforeFallback:reserve});
      if(result.usage)await mutate(data=>{const usage=data.usage[dateKey()]||={requests:0,input:0,output:0};usage.input+=result.usage.input||0;usage.output+=result.usage.output||0;});
      if(signal?.aborted)throw fail('Operação cancelada.');return result;
    }catch(error){if(error.noRequest&&reserved===1)await mutate(data=>{const usage=data.usage[initialDay];if(usage)usage.requests=Math.max(0,usage.requests-1);});throw error;}
    finally{thinking=false;}
  }
  function saveRun(run) { fs.appendFileSync(runFile,`${JSON.stringify({...run,id:randomUUID(),at:new Date().toISOString()})}\n`,{mode:0o600}); }
  function control(id, action) {
    if(!['search','messages'].includes(id)||!['pause','resume','stop'].includes(action))throw fail('Controle inválido.');
    let data={};try{data=JSON.parse(fs.readFileSync(controlFile,'utf8'));}catch{}
    data[id]={action,at:new Date().toISOString()};const temp=`${controlFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,controlFile);
    return data[id];
  }
  function exportBackup() {
    const files={};for(const name of ['ploa_workspace.json','ploa_conversas.jsonl','ploa_execucoes.jsonl','crm_dados.json','configuracoes_operacao.json','copys_internacionais.json','copys_respostas_automaticas.json','ploa_tokens.jsonl']){
      try{files[name]=fs.readFileSync(path.join(root,name),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return {format:'ploa-backup',version:1,createdAt:new Date().toISOString(),files};
  }
  async function restoreBackup(body) {
    if(body?.format!=='ploa-backup'||body.version!==1||!body.files||typeof body.files!=='object'||!Object.keys(body.files).length)throw fail('Backup inválido.');
    const allowed=new Set(['ploa_workspace.json','ploa_conversas.jsonl','ploa_execucoes.jsonl','crm_dados.json','configuracoes_operacao.json','copys_internacionais.json','copys_respostas_automaticas.json','ploa_tokens.jsonl']);
    for(const [name,content] of Object.entries(body.files)){
      if(!allowed.has(name)||typeof content!=='string'||Buffer.byteLength(content)>15*1024*1024)throw fail('Conteúdo de backup inválido.');
      if(name.endsWith('.json'))JSON.parse(content);else for(const line of content.split('\n').filter(Boolean))JSON.parse(line);
    }
    if(body.files['ploa_workspace.json']){
      const value=JSON.parse(body.files['ploa_workspace.json']);
      if(!value||Array.isArray(value)||typeof value.records!=='object'||!Array.isArray(value.jobs))throw fail('Estrutura de acompanhamento inválida.');
    }
    return mutate((data)=>{
      if(data.settings.enabled)throw fail('Desative a IA antes de restaurar.');
      const safety=path.join(root,'output',`backup-antes-restaurar-${Date.now()}`);fs.mkdirSync(safety,{recursive:true});
      for(const [name,content] of Object.entries(body.files)){
        const target=path.join(root,name);if(fs.existsSync(target))fs.copyFileSync(target,path.join(safety,name));
        const temp=`${target}.${process.pid}.restore.tmp`;
        let restored=content;
        if(name==='ploa_workspace.json'){
          const value=JSON.parse(content);value.settings={...value.settings,enabled:false};
            for(const job of value.jobs||[])if(['sending','ready','thinking','queued','held','draft'].includes(job.status)){job.status='review';job.reason='Restaurado do backup. Confira antes de qualquer envio.';}
          Object.assign(data,value);restored=JSON.stringify(value,null,2);
        }
        fs.writeFileSync(temp,restored);fs.renameSync(temp,target);
      }
      return{restored:true,safetyCopy:safety};
    });
  }
  if(fs.existsSync(file)) void mutate((data)=>{
    for(const job of data.jobs) if(['sending','thinking','ready','queued','draft','held'].includes(job.status)){
      job.status='review';job.reason='Execução anterior encerrada. Confira o histórico; não haverá reenvio automático.';
    }
    if (!provider?.hasKey(data.settings.provider) || !data.settings.dataConsent || !data.settings.freeAccountConfirmed) data.settings.enabled=false;
  }).catch((error)=>console.error('Ploa: não foi possível recuperar a fila:',error.message));
  const aiTimer=setInterval(()=>{void processAiQueue().catch(()=>{});},2000);aiTimer.unref?.();
  return { internalToken, publicSnapshot, saveSettings, command, ingest, nextDelivery, ack, authorizeInternal,classifyHistory,
    analyzeCreative:(input,options)=>creativeCall('analysis',input,options),transcribeCreative:(bytes,signal)=>creativeCall('audio',bytes,{signal}),
    reports, saveRun, control, exportBackup, restoreBackup, events, read, mutate, appendEvent, recordFor,
    workerConnected:()=>Date.now()-workerSeenAt<15000,
    setProvider:(value)=>{provider=value;},
    saveFilter: (filter)=>mutate((data)=>{const item={id:randomUUID(),name:clean(filter.name,70),country:clean(filter.country,60),category:clean(filter.category,80),mode:clean(filter.mode,20),attention:clean(filter.attention,50),search:clean(filter.search,140)};if(!item.name)throw fail('Dê um nome ao filtro.');data.savedFilters=[...(data.savedFilters||[]),item].slice(-30);return item;}),
    addExample: (body)=>mutate((data)=>{const question=clean(body.question,2000),answer=clean(body.answer,2500);if(!question||!answer)throw fail('Informe a situação e a resposta aprovada.');data.settings.examples.push({id:randomUUID(),question,answer,at:new Date().toISOString()});data.settings.examples=data.settings.examples.slice(-80);}),
    removeExample: (id)=>mutate((data)=>{data.settings.examples=data.settings.examples.filter((item)=>item.id!==id);}),
    saveCopyVersion: (settings)=>mutate((data)=>{data.copyVersions=[...(data.copyVersions||[]),{id:randomUUID(),at:new Date().toISOString(),settings}].slice(-20);}),
    getCopyVersion: (id)=>read().copyVersions?.find((item)=>item.id===id)?.settings,
    close: ()=>{closed=true;clearInterval(aiTimer);provider?.close?.();},
  };
}
module.exports={createWorkspaceService};
