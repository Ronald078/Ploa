'use strict';
// Área de versions; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.versions = function mountArea(ctx) {
const versions=ctx.details('Versões anteriores da biblioteca de copys');

versions.append(ctx.node('p','ploa-note','A versão anterior é preservada a cada salvamento. A restauração exige os scripts encerrados.'));

const versionList=ctx.node('div');

versions.append(versionList);

ctx.view('messages').append(versions);

const performance=ctx.details('Acompanhamento das variações de copy');

performance.append(ctx.node('p','ploa-note','Cada contato conta uma vez por variação. Respostas e resultados são associados à última abordagem identificada anterior; bots ficam fora. Isso mostra associação, não prova de que a copy causou a venda.'));

const performanceList=ctx.node('div');

performance.append(performanceList);

ctx.view('messages').append(performance);

function renderVersions(){
    versionList.replaceChildren();
    for(const version of (ctx.snapshot?.copyVersions||[]).slice().reverse()){
      const row=ctx.node('div','ploa-ledger-row');
      row.append(ctx.node('span',null,formatDate(version.at,true)),ctx.button('Restaurar versão',async()=>{
        if(!window.confirm('Substituir as copys atuais por esta versão? A biblioteca atual também será preservada.'))return;
        await ctx.api('/api/workspace/copies/'+encodeURIComponent(version.id),'POST',{});
        state.copySettingsDirty=false;
        if(typeof loadCopySettings==='function')await loadCopySettings();
        await ctx.loadWorkspace();showToast('Biblioteca restaurada.');
      }));versionList.append(row);
    }
    if(!versionList.childElementCount)versionList.append(ctx.node('p','ploa-note','O próximo salvamento criará a primeira versão.'));
    performanceList.replaceChildren();
    const marketNames={BR:'Brasil',PT:'Portugal',US:'Estados Unidos',ES:'Espanha'};
    const copies=(ctx.report?.copies||[]).filter(item=>(!state.copyMarket||item.country===state.copyMarket||item.country===marketNames[state.copyMarket])&&
      (!state.copyCategory||(state.copyCategory==='__generic__'? !item.category||item.category==='generica'||item.category==='genericas' : normalizeSearch(item.category)===normalizeSearch(state.copyCategory))));
    for(const copy of copies){
      const row=ctx.node('article','ploa-ledger-row'),text=ctx.node('div');
      text.append(ctx.node('strong',null,(copy.country||'País não informado')+' · '+(copy.category||'Genérica')+' · '+copy.id.slice(0,8)),
        ctx.node('p','ploa-note',copy.preview||'Variação registrada'),
        ctx.node('small',null,copy.sent+' contatos nesta variação · '+copy.humanResponses+' respostas humanas ('+copy.responseRate+'%) · '+copy.proposals+' propostas apresentadas · '+copy.clients+' aceites confirmados'),
        ctx.node('small',null,Object.entries(copy.received||{}).map(([currency,value])=>ctx.money(value,currency)+' recebido').join(' · ')||'Nenhum recebimento associado a esta abordagem'));
      row.append(text);performanceList.append(row);
    }
    if(!copies.length)performanceList.append(ctx.node('p','ploa-note','Ainda não há envios registrados para esta seleção.'));
  }

for(const select of document.querySelectorAll('#copy-market, #copy-category, #copy-type')){
    select.addEventListener('change',()=>renderVersions());
  }
  return Object.defineProperties({}, {
    versions: { enumerable: true, get: () => versions },
    versionList: { enumerable: true, get: () => versionList },
    performance: { enumerable: true, get: () => performance },
    performanceList: { enumerable: true, get: () => performanceList },
    renderVersions: { enumerable: true, get: () => renderVersions }
  });
};
