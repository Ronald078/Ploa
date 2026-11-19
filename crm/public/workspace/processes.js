'use strict';
// Área de processes; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.processes = function mountArea(ctx) {
const oldProcess=renderProcess;

renderProcess=(id)=>{
    window.PloaMessageSections?.update();
    if(id==='messages')ctx.renderAttendance();
    oldProcess(id);const process=state.processes?.[id],pause=ctx.$('[data-ploa-pause="'+id+'"]');
    if(pause){pause.disabled=!process?.running||process.status==='stopping';pause.textContent=process?.status==='paused'?'Continuar':'Pausar';}
    if(process?.status==='paused'){
      const items=getProcessElements(id);items.status.textContent='Pausa solicitada';if(items.badge?.lastChild)items.badge.lastChild.textContent='Pausa solicitada';
    }
  };
  return Object.defineProperties({}, {
    oldProcess: { enumerable: true, get: () => oldProcess }
  });
};
