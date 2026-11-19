import React from 'react';
import {Button,Field,Details} from './forms.jsx';
import {useDraft} from './drafts.js';
import {useCommand} from './operation-api.js';
import {OperationNotice} from './OperationNotice.jsx';
import {pageLink} from './navigation.js';
export function AccountSetup({context,refresh}){
 const {run,busy,notice}=useCommand(refresh),[identity,setIdentity,clear]=useDraft('account','identity',context.setup.identity||{name:'',businessName:context.account.businessName||''});
 if(!context.setup.required)return null;
 return <section className="next-operation next-account-setup"><Details title="Configure sua empresa" defaultOpen><p>Suas configurações são individuais. Complete os itens abaixo antes de executar as automações.</p><OperationNotice notice={notice}/><form onSubmit={async event=>{event.preventDefault();const stamp=identity,result=await run('/api/account-setup','PUT',stamp,'Identidade salva.');if(result.ok)clear(stamp);}}><fieldset disabled={busy}><div className="next-operation-grid"><Field label="Nome do responsável" required maxLength={80} value={identity.name} onChange={name=>setIdentity({...identity,name})}/><Field label="Nome do negócio" required maxLength={80} value={identity.businessName} onChange={businessName=>setIdentity({...identity,businessName})}/></div><div className="ploa-actions"><Button primary type="submit">Salvar identidade</Button></div></fieldset></form><ul className="next-account-steps">{context.setup.steps.map(step=><li key={step.id}><span>{step.ready?'✓':'○'} {step.label}{step.optional?' · opcional':''}</span>{step.view?<a className="text-action" href={pageLink(step.view)}>{step.ready?'Revisar':'Configurar'}</a>:null}</li>)}</ul><p>Conecte seu próprio WhatsApp em IA → Configurações. Cada chave de IA e condição comercial também deve ser sua.</p></Details></section>;
}
