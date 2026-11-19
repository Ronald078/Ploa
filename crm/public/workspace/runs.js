'use strict';
// Área de runs; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.runs = function mountArea(ctx) {
const runs=ctx.section('Histórico das buscas','Os resumos passam a ser registrados quando uma execução iniciada pelo painel termina. A planilha principal continua a mesma.');

const runList=ctx.node('div');

runs.append(runList);

ctx.view('search').append(runs);

function renderRuns(){
    runList.replaceChildren();
    for(const run of (ctx.report?.runs||[]).filter(item=>item.script==='search').slice(0,12)){
      const row=ctx.node('div','ploa-ledger-row'),metrics=run.metrics||{};
      row.append(ctx.node('strong',null,formatDate(run.startedAt,true)),
        ctx.node('small',null,(run.stopped?'Interrompida':run.exitCode===0?'Finalizada':'Com erro')+' · '+
          (metrics.newLeads||0)+' novos · '+(metrics.totalLeads==null?'base sem medição':metrics.totalLeads+' na base medida')+' · '+
          (metrics.completedCities||0)+'/'+(metrics.totalCities||0)+' cidades'));runList.append(row);
    }
    if(!runList.childElementCount)runList.append(ctx.node('p','ploa-note','Nenhuma execução finalizada registrada ainda.'));
  }
  return Object.defineProperties({}, {
    runs: { enumerable: true, get: () => runs },
    runList: { enumerable: true, get: () => runList },
    renderRuns: { enumerable: true, get: () => renderRuns }
  });
};
