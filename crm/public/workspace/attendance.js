'use strict';
// Área de attendance; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.attendance = function mountArea(ctx) {
const attendance=ctx.section('WhatsApp · atendimento contínuo','Receba conversas e mantenha a IA disponível sem deixar os disparos em execução. O Ploa precisa permanecer aberto ou minimizado.');

const attendanceStatus=ctx.node('p','ploa-pill','WhatsApp desconectado');

attendanceStatus.setAttribute('role','status');

const attendanceActions=ctx.actions(ctx.button('Conectar WhatsApp',async()=>{
    await ctx.api('/api/whatsapp/start','POST',{});await loadProcesses();await ctx.loadWorkspace();
  },true),ctx.button('Desconectar atendimento',async()=>{
    if(!window.confirm('Encerrar a conexão do atendimento? A IA e os disparos deixarão de enviar até você conectar novamente.'))return;
    await ctx.api('/api/whatsapp/stop','POST',{});await loadProcesses();await ctx.loadWorkspace();
  }));

const keepConnected=ctx.field('Reconectar o atendimento ao abrir o Ploa','checkbox',true);

const preventSleep=ctx.field('Evitar suspensão automática enquanto o atendimento estiver ligado','checkbox',true);

const autoExternal=ctx.field('IA também nas conversas que eu iniciar fora do script','checkbox',true);

const attendanceGrid=ctx.node('div','ploa-form-grid');

attendanceGrid.append(keepConnected.wrap,preventSleep.wrap,autoExternal.wrap);

let attendanceDirty=false;

attendanceGrid.addEventListener('change',()=>{attendanceDirty=true;});

const attendanceLog=ctx.node('pre','ploa-agent-log');

attendanceLog.tabIndex=0;

const attendanceDetails=ctx.node('details');

attendanceDetails.append(ctx.node('summary',null,'Registros da conexão'),attendanceLog);

attendance.append(attendanceStatus,attendanceActions);
const pairing=window.PloaWhatsappPairing?.mount
  ?window.PloaWhatsappPairing.mount({host:attendance,api:ctx.api,refresh:async()=>{await loadProcesses();renderAttendance();},notify:showToast})
  :(()=>{const note=ctx.node('p','ploa-note','Para habilitar a conexão por código, feche e abra o Ploa no notebook. O QR Code e as outras áreas continuam disponíveis.');attendance.append(note);return{update(){}};})();
attendance.append(attendanceGrid,ctx.actions(ctx.button('Salvar atendimento',async()=>{
    ctx.snapshot=await ctx.api('/api/workspace/settings','PUT',{keepConnected:keepConnected.input.checked,preventSleep:preventSleep.input.checked,autoExternal:autoExternal.input.checked});
    attendanceDirty=false;renderAttendance();showToast('Preferências do atendimento salvas.');
  })),ctx.node('p','ploa-note','Ao concluir ou parar os disparos, a conexão continua disponível. Mensagens manuais iniciadas fora do script entram no painel; “Assumir atendimento” mantém você no controle daquele contato. Após logout, conecte por QR Code ou código de aparelho. Nenhuma mensagem antiga é enviada novamente ao conectar.'),attendanceDetails);

ctx.view('messages').querySelector('.process-control').after(attendance);

const attendanceQr=ctx.$('#messages-qr-panel');

if(attendanceQr)attendanceDetails.before(attendanceQr);

function renderAttendance(){
    const process=state.processes?.whatsapp;
    const labels={ready:'WhatsApp conectado · atendimento contínuo',qr:'Aguardando QR Code ou conexão por código',pairing:'Aguardando confirmação do código no WhatsApp',authenticating:'Concluindo a conexão do WhatsApp',reconnecting:'Reconectando ao WhatsApp',auth_failure:'Autenticação encerrada · conecte novamente',starting:'Iniciando WhatsApp',disconnected:'WhatsApp desconectado'};
    pairing.update(process);
    attendanceStatus.textContent=process?.running?(labels[process.connection]||'Conectando WhatsApp'):'WhatsApp desconectado';
    const buttons=attendanceActions.querySelectorAll('button');buttons[0].disabled=Boolean(process?.running);buttons[1].disabled=!process?.running;
    const text=process?formatProcessLogs(process,separateQrFromProcessLogs(process.logs).visibleLogs):'Conecte o WhatsApp para iniciar o atendimento.';
    if(attendanceLog.textContent!==text)attendanceLog.textContent=text;
    if(ctx.snapshot&&!attendanceDirty){keepConnected.input.checked=ctx.snapshot.settings.keepConnected===true||(ctx.snapshot.settings.keepConnected!==false&&ctx.snapshot.settings.enabled);preventSleep.input.checked=ctx.snapshot.settings.preventSleep===true;autoExternal.input.checked=ctx.snapshot.settings.autoExternal!==false;}
  }
  return Object.defineProperties({}, {
    attendance: { enumerable: true, get: () => attendance },
    attendanceStatus: { enumerable: true, get: () => attendanceStatus },
    attendanceActions: { enumerable: true, get: () => attendanceActions },
    keepConnected: { enumerable: true, get: () => keepConnected },
    preventSleep: { enumerable: true, get: () => preventSleep },
    autoExternal: { enumerable: true, get: () => autoExternal },
    attendanceGrid: { enumerable: true, get: () => attendanceGrid },
    attendanceDirty: { enumerable: true, get: () => attendanceDirty, set: value => { attendanceDirty = value; } },
    attendanceLog: { enumerable: true, get: () => attendanceLog },
    attendanceDetails: { enumerable: true, get: () => attendanceDetails },
    attendanceQr: { enumerable: true, get: () => attendanceQr },
    renderAttendance: { enumerable: true, get: () => renderAttendance }
  });
};
