import React,{useRef,useState} from 'react';
import {useCommand} from './operation-api.js';
import {OperationNotice} from './OperationNotice.jsx';
import {AiConnection} from './AiConnection.jsx';
import {AiKnowledge} from './AiKnowledge.jsx';
import {AiBusiness} from './AiBusiness.jsx';
import {AiTests} from './AiTests.jsx';
import {AiTriage} from './AiTriage.jsx';
import {TokenUsage} from './TokenUsage.jsx';
import {Backup} from './Backup.jsx';
import {usePageMotion} from './motion.js';
import {Attendance} from './Attendance.jsx';
import {PageIntro} from './ProcessPanel.jsx';
export function Ai({data,refresh}){
 const [tab,setTab]=useState('settings'),tabs=useRef(null),{run,busy,notice,setNotice}=useCommand(refresh);
 const activePanel=useRef(null);usePageMotion(activePanel,tab);
 const panels={settings:<div className="next-ai-configuration next-enter"><Attendance data={data} run={run} busy={busy}/><AiConnection workspace={data.workspace} run={run} busy={busy}/><TokenUsage report={data.workspace.tokenUsage}/><AiBusiness workspace={data.workspace} plan={data.searchPlan} run={run} busy={busy}/><AiKnowledge workspace={data.workspace} run={run} busy={busy}/><AiTriage data={data} run={run} busy={busy}/><Backup processes={data.processes} run={run} busy={busy} notify={setNotice}/></div>,tests:<AiTests data={data.aiTests} run={run} busy={busy} refresh={refresh}/>};
 return <section className="view-panel next-operation next-enter" data-view-panel="ai"><PageIntro eyebrow="Atendimento" title="IA" description="Conecte o WhatsApp e configure como a IA conduz as conversas."/><OperationNotice notice={notice}/><div className="next-ai-tabs ploa-ai-tabs" ref={tabs} role="tablist" aria-label="Áreas da IA" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'settings':event.key==='End'?'tests':tab==='tests'?'settings':'tests';setTab(next);tabs.current.querySelector('#next-ai-'+next)?.focus();}}>{[['settings','Configurações'],['tests','Testes']].map(([id,label])=><button className="button button-secondary ploa-ai-tab" type="button" role="tab" id={'next-ai-'+id} aria-selected={tab===id} aria-controls={'next-ai-panel-'+id} tabIndex={tab===id?0:-1} key={id} onClick={()=>setTab(id)}>{label}</button>)}</div><div ref={activePanel}>{Object.entries(panels).map(([id,panel])=><div className="next-ai-panel" id={'next-ai-panel-'+id} role="tabpanel" aria-labelledby={'next-ai-'+id} key={id} hidden={tab!==id}>{panel}</div>)}</div></section>;
}
