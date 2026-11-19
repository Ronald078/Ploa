import React,{useLayoutEffect,useRef} from 'react';
import {Button,Details} from './forms.jsx';
import {useDraft} from './drafts.js';
import {Pairing} from './Pairing.jsx';
import {separateLogs} from './ProcessPanel.jsx';
function QrCode({text}){
 const pre=useRef(null);
 useLayoutEffect(()=>{const element=pre.current,container=element.parentElement;const fit=()=>{const columns=Math.max(...text.split('\n').map(line=>line.length),1);element.style.fontSize=Math.min(10,(container.clientWidth-40)/(columns*.62))+'px';};fit();const observer=new ResizeObserver(fit);observer.observe(container);return()=>observer.disconnect();},[text]);
 return <div className="next-qr"><h3>Conectar por QR Code</h3><pre ref={pre} aria-label="QR Code do WhatsApp">{text}</pre><p>WhatsApp → Aparelhos conectados → Conectar um aparelho.</p></div>;
}
export function Check({label,value,onChange,disabled}){return <label className="next-check"><input type="checkbox" checked={Boolean(value)} onChange={event=>onChange(event.target.checked)} disabled={disabled}/><span>{label}</span></label>;}
export function Attendance({data,run,busy}){
 const worker=data.processes.whatsapp||{},settings=data.workspace.settings;
 const [draft,setDraft,clear]=useDraft('attendance','settings',{keepConnected:settings.keepConnected===true||(settings.keepConnected!==false&&settings.enabled),preventSleep:settings.preventSleep===true,autoExternal:settings.autoExternal!==false});
 const {qr,text}=separateLogs(worker.logs),hideQr=worker.pairing&&worker.pairing.status!=='error'||['ready','authenticating','pairing'].includes(worker.connection);
 const labels={ready:'WhatsApp conectado · atendimento contínuo',qr:'Aguardando QR Code ou conexão por código',pairing:'Aguardando confirmação do código',authenticating:'Concluindo conexão',reconnecting:'Reconectando',auth_failure:'Autenticação encerrada',starting:'Iniciando WhatsApp',disconnected:'WhatsApp desconectado'};
 return <section className="panel ploa-section next-operation-panel next-attendance"><h2>WhatsApp · atendimento contínuo</h2><p>Receba conversas sem deixar os disparos em execução. Mantenha o Ploa aberto ou minimizado.</p><p className="ploa-pill" role="status">{worker.running?labels[worker.connection]||'Conectando WhatsApp':'WhatsApp desconectado'}</p>{worker.lastError?<p className="next-error" role="alert">{worker.lastError}</p>:null}<div className="ploa-actions"><Button primary disabled={busy||worker.running} onClick={()=>run('/api/whatsapp/start','POST',{},null)}>Conectar WhatsApp</Button><Button disabled={busy||!worker.running} onClick={()=>{if(window.confirm('Desconectar o atendimento? A IA e os disparos deixarão de enviar até a próxima conexão.'))void run('/api/whatsapp/stop','POST',{},null);}}>Desconectar atendimento</Button></div>
 <Pairing process={worker} run={run} busy={busy}/>
 {!hideQr&&qr?<QrCode text={qr}/>:null}
 <fieldset disabled={busy}>{[['keepConnected','Reconectar o atendimento ao abrir o Ploa'],['preventSleep','Evitar suspensão automática enquanto o atendimento estiver ligado'],['autoExternal','IA também nas conversas que eu iniciar fora do script']].map(([key,label])=><Check key={key} label={label} value={draft[key]} onChange={value=>setDraft({...draft,[key]:value})}/>)}<div className="ploa-actions"><Button onClick={async()=>{const stamp=draft,result=await run('/api/workspace/settings','PUT',stamp,'Preferências do atendimento salvas.');if(result.ok)clear(stamp);}}>Salvar atendimento</Button></div></fieldset><Details title="Registros da conexão"><pre className="next-process-log" tabIndex={0}>{text||'Conecte o WhatsApp para iniciar.'}</pre></Details></section>;
}
