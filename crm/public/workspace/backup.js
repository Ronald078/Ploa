'use strict';
// Área de backup; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.backup = function mountArea(ctx) {
const backup=ctx.details('Backup do acompanhamento e configurações');

backup.classList.add('ploa-backup');

backup.append(ctx.node('p','ploa-note','Baixe uma cópia dos dados salvos do acompanhamento: conversas registradas pelo painel, propostas, pagamentos, exemplos, configurações e copys. A planilha, a autenticação do WhatsApp e o histórico original dos scripts não fazem parte desta cópia. Guarde o arquivo em local privado.'));

const download=ctx.button('Baixar backup',async()=>{
    const data=await ctx.api('/api/workspace/backup');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='ploa-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Backup gerado. Guarde a cópia em local privado.');
  });

const restoreInput=ctx.field('Arquivo de backup do Ploa','file',true);

restoreInput.input.accept='.json,application/json';

backup.append(ctx.actions(download),ctx.node('h4',null,'Restaurar uma cópia salva'),
    ctx.node('p','ploa-note','A restauração substitui os dados correspondentes pelos do arquivo escolhido. Encerre os scripts antes de continuar. O Ploa preserva uma cópia dos arquivos anteriores antes de restaurar.'),
    restoreInput.wrap,ctx.actions(ctx.button('Restaurar backup',async()=>{
    const file=restoreInput.input.files?.[0];if(!file)throw new Error('Escolha o arquivo de backup.');
    if(file.size>25*1024*1024)throw new Error('O arquivo excede 25 MB.');
    if(!window.confirm('Restaurar os dados deste backup? Os arquivos atuais serão preservados numa cópia de segurança. Encerre os scripts antes de continuar.'))return;
    const result=await ctx.api('/api/workspace/restore','POST',JSON.parse(await file.text()));
    showToast('Backup restaurado. Cópia anterior: '+result.safetyCopy);await loadDashboard({quiet:true});await ctx.loadWorkspace();
  })));

ctx.view('overview').append(backup);

for(const id of ['search','messages']){
    const stop=ctx.$('[data-process-stop="'+id+'"]');const pause=ctx.button('Pausar',async()=>{
      const action=state.processes?.[id]?.status==='paused'?'resume':'pause';
      const result=await ctx.api('/api/processes/'+id+'/'+action,'POST');
      state.processes={...state.processes,[id]:result.process};renderProcess(id);
      showToast(action==='pause'?'Pausa solicitada após a operação atual.':'Continuação solicitada.');
    });
    pause.dataset.ploaPause=id;stop.before(pause);
  }
  return Object.defineProperties({}, {
    backup: { enumerable: true, get: () => backup },
    download: { enumerable: true, get: () => download },
    restoreInput: { enumerable: true, get: () => restoreInput }
  });
};
