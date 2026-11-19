'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {workspaceFixture}=require('./fixture-helpers');
const {describeAiRuntime}=require('../lib/ai-runtime');
const {summarizeOutreachResults}=require('../lib/outreach-results');
const {buildSearchPlan}=require('../lib/search-plan');

test('pendência sem texto não infla a fila de análise e continua no histórico',async t=>{
  const f=workspaceFixture(t,{text:''}),d=await f.store.getDashboard();
  assert.equal(d.resumo.respostas_para_classificar,0);assert.equal(d.resumo.respostas_pendentes_total,1);assert.equal(d.resumo.historico_sem_texto,1);
  assert.equal(f.workspace.read().jobs.length,0);assert.equal(d.leads.length,1);
});

function controller(name,ctx){
  const sandbox=vm.createContext({window:{PloaAppModules:{}},Intl,Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/modules',name+'.js'),'utf8'),sandbox);
  const result=sandbox.window.PloaAppModules[name](ctx);Object.assign(ctx,result);return result;
}
test('dashboard não inventa evento recente nem alerta com zero contatos',()=>{
  const ctx={state:{dashboard:{leads:[]},operations:{messages:{sentToday:0}}},formatInteger:String};
  const c=controller('dashboard',ctx);
  const empty={sem_resposta:0,respostas_automaticas:0,enviados_hoje:9,atualizado_em:new Date().toISOString()};
  assert.equal(c.buildAttentionNews(empty).length,0);
  const news=c.buildAttentionNews({...empty,respostas_automaticas:2,sem_resposta:3});
  assert.ok(news.every(item=>item.timestamp===null));
});
test('funil com etapas vazias não escolhe uma maior etapa artificialmente',()=>{
  const values={},ctx={state:{dashboard:{resumo:{total:1,oportunidades:0,ganhos:0},funnel_steps:[{id:'first',count:1},{id:'proposal',label:'Proposta',count:0}]}},elements:{insightLargestStage:'stage',insightLargestDetail:'detail',insightOpportunityRate:'opportunity',insightClientRate:'clients'},setText:(key,value)=>{values[key]=value;},formatPercent:value=>String(value)};
  controller('funnel',ctx).renderFunnelInsights();assert.equal(values.stage,'—');assert.match(values.detail,/Nenhum avanço/);
});
test('estado da IA distingue configuração, cota, consulta, erro e confirmação de envio',()=>{
  const now=Date.now(),day=new Date(now).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const data={settings:{enabled:true,dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:20,responseMode:'review'},usage:{[day]:{requests:0}},jobs:[]};
  const options={hasKey:true,workerConnected:true,now};
  assert.equal(describeAiRuntime(data,options).code,'waiting');
  assert.equal(describeAiRuntime(data,{...options,hasKey:false}).code,'no_key');
  assert.equal(describeAiRuntime(data,{...options,workerConnected:false}).code,'offline');
  data.usage[day].requests=20;assert.equal(describeAiRuntime(data,options).code,'quota');
  assert.equal(describeAiRuntime(data,{...options,thinking:true}).code,'generating');
  data.usage[day].requests=1;data.usage[day].lastErrorAt=new Date(now).toISOString();
  assert.equal(describeAiRuntime(data,options).code,'error');
  data.usage[day].lastSuccessAt=new Date(now+1).toISOString();data.jobs=[{kind:'ai',status:'draft'}];
  assert.equal(describeAiRuntime(data,options).code,'review');
  data.jobs=[{kind:'ai',status:'sent',finishedAt:new Date(now).toISOString()}];
  assert.equal(describeAiRuntime(data,options).lastSentAt,new Date(now).toISOString());
  data.settings.updatedAt=new Date(now+2000).toISOString();
  assert.equal(describeAiRuntime(data,options).code,'waiting');
});
test('resultados contam contatos uma vez e distinguem falha LID de resultado incerto',()=>{
  const log=[{numero:'1',status:'erro: conexão'},{numero:'1',status:'enviado'},{numero:'2',status:'já enviado anteriormente'},
    {numero:'3',status:'não enviado (falha de resolução LID; não repetir automaticamente)'},
    {numero:'4',status:'envio pendente de confirmação (não será reenviado automaticamente)'},
    {numero:'5',status:'não enviado (limite diário atingido)'}];
  const before=JSON.stringify(log);assert.deepEqual(summarizeOutreachResults(log),{sent:1,skipped:1,failed:1,uncertain:1});assert.equal(JSON.stringify(log),before);
});
test('plano da busca preserva base original, adicionais e idioma das copys',()=>{
  const catalog=require('../search-catalog.json'),copies=JSON.parse(fs.readFileSync(path.join(__dirname,'../../copys_internacionais.json'),'utf8'));
  const base=buildSearchPlan(catalog,{search:{localities:[],categories:[]}},copies);
  assert.equal(base.markets.find(item=>item.name==='Brasil').cities.length,20);assert.equal(base.categoryCount,8);assert.equal(base.queryCount,208);
  const operation={search:{localities:[{market:'Brasil',city:catalog.markets.Brasil.cidades[0]},{market:'Brasil',city:'Cidade fictícia, Brasil'}],categories:[{name:'Categoria fictícia',key:'shop',value:'test'}]}};
  const plan=buildSearchPlan(catalog,operation,copies);assert.equal(plan.cityCount,27);assert.equal(plan.categoryCount,9);assert.equal(plan.queryCount,243);
  const withoutUS={...copies,'Estados Unidos':{genericas:[],porCategoria:{}}};
  const inactive=buildSearchPlan(catalog,{search:{localities:[],categories:[]}},withoutUS);assert.equal(inactive.markets.find(item=>item.name==='Estados Unidos').active,false);
  const extra=buildSearchPlan(catalog,{search:{localities:[{market:'Estados Unidos',city:'Austin, Texas, United States'}],categories:[]}},withoutUS);
  assert.equal(extra.markets.find(item=>item.name==='Estados Unidos').missing.length,8);
});
