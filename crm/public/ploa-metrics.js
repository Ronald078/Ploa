/* Indicadores: cada número mantém sua base, período e moeda. */
(() => {
  'use strict';
  window.PloaMetrics={create({node,section,field,options,view,$,elements,button,money,formatDate,localGet,localSet,getDashboard,getReport,getOperations,onCurrency}){
    let currency=localGet('ploa-currency')||'BRL';if(!['BRL','EUR','USD'].includes(currency))currency='BRL';
    const financeBar=node('div','ploa-toolbar'),financeCurrency=field('Moeda dos resultados','select'),period=field('Período dos recebimentos','select');
    financeBar.classList.add('ploa-finance-filters');
    options(financeCurrency.input,[['BRL','BRL · Real'],['EUR','EUR · Euro'],['USD','USD · Dólar']],currency);
    options(period.input,[['30','Últimos 30 dias'],['90','Últimos 90 dias'],['365','Últimos 12 meses'],['0','Todo o histórico']],localGet('ploa-finance-period')||'30');
    financeBar.append(financeCurrency.wrap,period.wrap,node('p','ploa-note','Recebimentos e gráfico usam o período selecionado. Pipeline e saldo representam a situação atual. Sem conversão cambial.'));
    const bases=node('div','ploa-base-strip');bases.setAttribute('aria-label','Bases dos indicadores');
    $('.overview-hero').after(financeBar,bases);
    $('.response-ring-copy > span').textContent='Respostas';
    const results=section('Recebimentos confirmados','Pagamentos registrados no período e na moeda selecionados. Aceite de proposta e previsão de venda são apurados separadamente.');
    const paidSummary=node('p','ploa-note'),bars=node('div','ploa-sparkline'),chartDetail=node('p','ploa-note');results.append(paidSummary,bars,chartDetail);$('.executive-metrics').after(results);
    const cardLabels=[['.metric-card-revenue','Recebido no período'],['.metric-card-pipeline','Pipeline aberto agora'],['.metric-card-sales','Clientes com pagamento'],['.metric-card-ticket','Recebimento médio por cliente']];
    for(const [selector,label]of cardLabels)$(selector+' dt').textContent=label;
    const acquisition=section('Da abordagem ao fechamento','Cada contato conta uma vez por variação identificada. O histórico sem identificação de copy fica fora desta base.');
    const acquisitionGrid=node('div','ploa-analysis-grid'),acquisitionBars=node('div'),acquisitionNote=node('p','ploa-note');acquisition.append(acquisitionGrid,acquisitionBars,acquisitionNote);view('funnel').append(acquisition);
    const overviewAcquisition=section('Qualidade das abordagens acompanhadas','Base própria: envios com identificação da copy. Consulte o denominador antes de comparar com o histórico geral.');
    const overviewAcquisitionText=node('p','ploa-note');overviewAcquisition.append(overviewAcquisitionText);view('overview').append(overviewAcquisition);
    function renderSources(){
      const dashboard=getDashboard();if(!dashboard)return;
      const operations=getOperations(),metric=dashboard.response_metric;
      const rows=[['Planilha atual',operations?.bases?.sheet,'linhas; podem incluir registros ainda não prospectados'],
        ['Último lote de disparos',operations?.bases?.lastRun,'contatos na lista usada naquela execução'],
        ['Contatos acompanhados',{value:dashboard.resumo.total,updatedAt:dashboard.resumo.atualizado_em,source:'Histórico do CRM'},'telefones identificados no acompanhamento']];
      bases.replaceChildren();
      for(const [label,data,detail]of rows){const item=node('article','ploa-base-item');item.append(node('span',null,label),node('strong',null,data?.value==null?'—':Number(data.value).toLocaleString('pt-BR')),
        node('small',null,data?.value==null?'Sem medição disponível':detail),node('small','ploa-source-date',(data?.source||'Fonte ainda não carregada')+(data?.updatedAt?' · '+formatDate(data.updatedAt,true):'')));
        if(label==='Contatos acompanhados'&&metric)item.append(node('small',null,metric.automaticCount+' com atendimento automático · '+metric.withoutText+' respostas sem texto disponível. A taxa histórica inclui todos os contatos com resposta registrada.'));bases.append(item);}
      if(metric){const explanation=`${metric.numerator} de ${metric.denominator} contatos com resposta registrada. Inclui ${metric.automaticCount} atendimentos automáticos.`;
        elements.metricResponseRate.title=explanation+' Atualizado em '+formatDate(metric.updatedAt,true);
        $('.response-visual').title=explanation;$('.response-visual').setAttribute('aria-label',`${metric.value}%: ${explanation}`);}
    }
    function renderFinance(){
      renderSources();const dashboard=getDashboard(),report=getReport(),window=report?.financialWindows?.[period.input.value];
      const totals=window?.currencies?.[currency];if(!dashboard||!totals)return;
      elements.metricRevenue.textContent=money(totals.received,currency);elements.metricPipelineValue.textContent=money(totals.pipelineNow,currency);
      elements.metricSales.textContent=totals.customersWithPayment;elements.metricTicket.textContent=money(totals.averageReceived,currency);
      $('.metric-card-revenue .metric-detail').textContent=window.period.label+' · '+currency;
      $('.metric-card-pipeline .metric-detail').textContent='Estimativas de oportunidades abertas · '+currency;
      $('.metric-card-sales .metric-detail').textContent='Clientes distintos com pagamento confirmado no período';
      $('.metric-card-ticket .metric-detail').textContent='Recebido no período dividido por clientes com pagamento';
      const stageValues={};for(const lead of dashboard.leads)if(lead.moeda===currency)stageValues[lead.status]=(stageValues[lead.status]||0)+(lead.status==='ganho'?lead.valor_recebido:lead.valor_estimado||0);
      const highest=Math.max(...Object.values(stageValues),1);
      for(const el of elements.revenueStageChart.children){const value=stageValues[el.dataset.status]||0;$('strong',el).textContent=money(value,currency);el.setAttribute('aria-label',el.querySelector('.revenue-stage-copy > span')?.textContent+': '+money(value,currency));const fill=$('.revenue-stage-fill',el);if(fill)fill.style.width=value/highest*100+'%';}
      const rows=(report.daily||[]).filter(item=>item.currency===currency&&item.day<=window.period.end&&(!window.period.start||item.day>=window.period.start));
      paidSummary.textContent=window.period.label+' · '+money(totals.received,currency)+' recebido · '+totals.customersWithPayment+' clientes com pagamento. Contratado no histórico: '+money(totals.contractedHistory,currency)+' · Saldo atual a receber: '+money(totals.outstandingNow,currency);
      bars.replaceChildren();if(!rows.length){bars.append(node('p','ploa-note','Nenhum pagamento confirmado neste período e moeda.'));chartDetail.textContent='';return;}
      const chunks=[],size=Math.max(1,Math.ceil(rows.length/31));for(let i=0;i<rows.length;i+=size){const slice=rows.slice(i,i+size);chunks.push({label:slice[0].day+(slice.length>1?' a '+slice.at(-1).day:''),value:slice.reduce((sum,item)=>sum+item.received,0)});}
      const peak=Math.max(1,...chunks.map(item=>item.value));for(const item of chunks){const label=item.label+': '+money(item.value,currency),bar=button('',()=>{chartDetail.textContent=label;});bar.title=label;bar.setAttribute('aria-label',label);bar.style.height=Math.max(3,item.value/peak*100)+'%';bars.append(bar);}chartDetail.textContent='Selecione uma coluna para consultar o valor.';
    }
    function renderAcquisition(){
      const report=getReport();if(!report)return;const data=report.cohort||{},n=value=>Number(value)||0;
      acquisitionGrid.replaceChildren();acquisitionBars.replaceChildren();
      const basis=data.sent?`${n(data.humanResponses)} respostas em ${n(data.sent)} contatos por variação`:'Sem abordagens identificadas';
      const metrics=[['Resposta humana nesta base',data.sent?n(data.responseRate)+'%':'—',basis],['Propostas apresentadas',String(n(data.proposals)),n(data.sent)+' contatos por variação'],['Aceites confirmados',String(n(data.clients)),'Pagamento é registrado separadamente'],['Tempo até a resposta',data.medianResponseHours==null?'Sem dados':Number(data.medianResponseHours).toFixed(1)+' h','Mediana das primeiras respostas humanas']];
      for(const [label,value,note]of metrics){const card=node('article','ploa-analysis-card');card.append(node('span',null,label),node('strong',null,value),node('small',null,note));acquisitionGrid.append(card);}
      for(const [label,value]of [['Contatos por variação',n(data.sent)],['Respostas humanas',n(data.humanResponses)],['Propostas apresentadas',n(data.proposals)],['Aceites confirmados',n(data.clients)]]){const row=node('div','ploa-analysis-bar'),track=node('span','ploa-analysis-track'),fill=node('span');fill.style.width=(data.sent?value/data.sent*100:0)+'%';track.append(fill);row.append(node('span',null,label),node('strong',null,String(value)),track);acquisitionBars.append(row);}
      const dateNote=data.from?'Envios registrados de '+formatDate(data.from,true)+' a '+formatDate(data.to,true)+'. Respostas apuradas até '+formatDate(data.updatedAt,true)+'.':'Novos envios identificados alimentarão estes indicadores.';
      acquisitionNote.textContent=dateNote+' Contatos sem avanço podem estar em conversa; a diferença entre etapas não confirma uma perda.';
      overviewAcquisitionText.textContent=basis+(data.sent?' · '+n(data.responseRate)+'% de resposta nesta base. ':'. ')+dateNote;
    }
    financeCurrency.input.addEventListener('change',()=>{currency=financeCurrency.input.value;localSet('ploa-currency',currency);onCurrency?.(currency);renderFinance();});
    period.input.addEventListener('change',()=>{localSet('ploa-finance-period',period.input.value);renderFinance();});
    return{renderFinance,renderAcquisition,renderSources};
  }};
})();
