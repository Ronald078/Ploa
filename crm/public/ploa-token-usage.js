'use strict';
window.PloaTokenUsage={mount({host,compact=false}){
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const root=make('section','ploa-section ploa-token-usage'+(compact?' ploa-token-compact':''));
  root.append(make('h3',null,compact?'Tokens do teste hoje':'Consumo de tokens'));
  const note=make('p','ploa-note',compact?'Consumo diário deste teste; Novo cenário mantém a contagem.':'Tokens registrados pelo Ploa: atendimento, criativos e testes. Horário de Brasília.');root.append(note);
  const controls=make('div','ploa-token-controls');let period=1,source='all',report=null;
  function group(label,entries,change){const wrap=make('div','ploa-token-filter');wrap.append(make('span',null,label));
    const row=make('div','ploa-token-options');row.setAttribute('role','group');row.setAttribute('aria-label',label);
    for(const [value,text] of entries){const button=make('button','button button-secondary',text);button.type='button';button.dataset.value=value;button.addEventListener('click',()=>{change(value);render();});row.append(button);}wrap.append(row);controls.append(wrap);return row;}
  const periods=compact?null:group('Período',[[1,'Hoje'],[7,'7 dias'],[30,'30 dias']],value=>{period=Number(value);});
  const sources=compact?null:group('Origem',[['all','Todos'],['attendance','Operação'],['tests','Testes']],value=>{source=value;});
  if(!compact)root.append(controls);
  const stats=make('dl','ploa-token-stats'),values={};
  for(const [key,label] of [['total','Total de tokens'],['input','Entrada'],['output','Saída']]){const item=make('div');values[key]=make('dd',null,'—');item.append(make('dt',null,label),values[key]);stats.append(item);}root.append(stats);
  const quotaNote=make('p','ploa-token-quota');root.append(quotaNote);
  const modelStats=make('div','ploa-model-grid');modelStats.setAttribute('aria-label','Consumo por modelo');root.append(modelStats);
  const graph=make('div','ploa-token-graph');graph.setAttribute('role','img');graph.hidden=true;root.append(graph);
  const range=make('div','ploa-token-range');range.hidden=true;root.append(range);
  const coverage=make('p','ploa-token-coverage');root.append(coverage);host.append(root);
  const format=value=>new Intl.NumberFormat('pt-BR').format(value);
  const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
  function render(){
    for(const [row,selected] of [[periods,String(period)],[sources,source]])for(const button of row?.children||[])button.setAttribute('aria-pressed',String(button.dataset.value===selected));
    if(!report){for(const value of Object.values(values))value.textContent='—';quotaNote.textContent='';coverage.textContent='Aguardando o registro de consumo do painel.';return;}
    const current=report.day||report.today?.day||new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),start=new Date(current+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-period+1);const first=start.toISOString().slice(0,10);
    const selected=compact?[report]:source==='all'?Object.values(report.sources||{}):[report.sources?.[source]].filter(Boolean);
    const daily=new Map();for(const section of selected)for(const item of section.daily||[]){if(item.day<first||item.day>current)continue;const row=daily.get(item.day)||{input:0,output:0};row.input+=number(item.input);row.output+=number(item.output);daily.set(item.day,row);}
    const input=[...daily.values()].reduce((sum,row)=>sum+row.input,0),output=[...daily.values()].reduce((sum,row)=>sum+row.output,0);
    const limit=number(report.quota?.dailyLimit),dailyView=period===1,multiple=(report.quota?.models?.length||0)>1;
    values.total.textContent=format(input+output)+(dailyView&&!multiple?' / '+(limit?format(limit):'—'):'');values.input.textContent=format(input);values.output.textContent=format(output);
    values.total.classList.toggle('ploa-token-ratio',dailyView&&!multiple);
    values.total.previousElementSibling.textContent=dailyView&&!multiple?'Tokens usados / limite diário':'Total de tokens registrados';
    const hasSharedToday=!compact||Number.isFinite(report.sharedToday);
    const sharedToday=compact?number(report.sharedToday):Object.values(report.sources||{}).reduce((sum,item)=>sum+number(item.today?.total),0);
    quotaNote.textContent=multiple?'Consumo separado por modelo. Cada referência depende dos limites da conta; a soma das referências não garante uma cota conjunta.':limit?(hasSharedToday?'Operação + testes hoje: '+format(sharedToday)+' / '+format(limit)+' tokens. ':'')+'Limite de referência do plano gratuito; compartilhado entre atendimento e testes na Groq.':'Limite diário não informado para este provedor.';
    modelStats.replaceChildren();modelStats.hidden=!multiple;
    if(multiple)for(const model of report.quota.models){
      const total=selected.flatMap(section=>section.byModel||[]).filter(row=>row.provider==='groq'&&row.model===model.id).flatMap(row=>row.daily||[]).filter(row=>row.day>=first&&row.day<=current).reduce((sum,row)=>sum+number(row.total),0);
      const card=make('article','ploa-model-card');card.append(make('strong',null,model.label),make('span','ploa-model-tokens',format(total)+(dailyView?' / '+format(model.dailyLimit):'')),make('span','ploa-note',dailyView?'Tokens registrados / referência diária':'Tokens registrados no período'));modelStats.append(card);
    }
    if(limit)quotaNote.title=report.quota.model+' · '+report.quota.source;
    graph.hidden=compact||period===1;range.hidden=graph.hidden;graph.replaceChildren();range.replaceChildren();
    if(!graph.hidden){const max=Math.max(1,...[...daily.values()].map(row=>row.input+row.output));for(let offset=0;offset<period;offset++){
      const day=new Date(start);day.setUTCDate(day.getUTCDate()+offset);const key=day.toISOString().slice(0,10),item=daily.get(key)||{input:0,output:0},total=item.input+item.output;
      const bar=make('span','ploa-token-bar');bar.style.setProperty('--token-height',Math.max(2,total/max*100)+'%');bar.dataset.empty=String(!total);bar.title=key.split('-').reverse().join('/')+': '+format(total)+' tokens';graph.append(bar);
    }graph.setAttribute('aria-label','Consumo diário nos últimos '+period+' dias: '+format(input+output)+' tokens.');
      const date=key=>key.slice(8)+'/'+key.slice(5,7);range.append(make('span',null,date(first)),make('span',null,'Consumo por dia'),make('span',null,date(current)));}
    const warnings=selected.map(item=>item.warning||item.recordingWarning).filter(Boolean);if(report.recordingWarning)warnings.push(report.recordingWarning);
    coverage.textContent=(warnings.length?[...new Set(warnings)].join(' '):'Inclui os tokens informados pelo provedor, mesmo quando a resposta precisa de correção. Uso externo e chamadas sem contagem informada não aparecem aqui.')+(multiple?' Registros antigos sem identificação de modelo permanecem apenas no total.':'')+(limit?' O limite exato da sua conta pode variar; o saldo restante da Groq não é consultado por este contador.':'');
  }
  render();return{root,update:(value,metadata={})=>{
    // Compatibilidade com servidores já abertos que ainda não enviam quota.
    // Referência pública por modelo, não uma consulta ao saldo da conta.
    const reference=metadata.model==='qwen/qwen3.8-27b'&&(!metadata.provider||metadata.provider==='groq')
      ?{dailyLimit:200000,model:metadata.model,provider:'groq',reference:true,source:'https://console.groq.com/docs/rate-limits'}:null;
    report=value?{...value,quota:value.quota||reference}:value;render();
  }};
}};

