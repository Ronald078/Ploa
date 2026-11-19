'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBusiness,decideAutonomous}=require('../lib/commercial-policy');
const {paymentAction,paymentResult,normalizePaymentDetails}=require('../lib/payment-flow');
const {buildContext}=require('../lib/conversation-context');
const {scopeAction}=require('../lib/project-pricing');
const {confirmedScopeResult}=require('../lib/commercial-transition');
const {workspaceFixture}=require('./fixture-helpers');
const key='00000000-0000-4000-8000-000000000000';
const offer={id:'site-br',title:'Site',market:'Brasil',currency:'BRL',amount:200,scope:'Site para apresentar produtos e receber contatos pelo WhatsApp.',terms:'Pagamento integral antes do início ou 50% de entrada e 50% na entrega.',deadline:'7 a 15 dias úteis.',maintenance:'R$50 por mês a partir da entrega.',autoPresent:true,serviceType:'site'};
const settings=()=>({responseMode:'autonomous',business:normalizeBusiness({offers:[offer],allowAutoProposals:true,allowAutoAcceptance:true,paymentDetails:{pixKey:key,pixRecipient:'Titular fictício'}})});
const lead={pais:'Brasil',moeda:'BRL',status:'qualificado',id:'5511999999999',numero:'5511999999999'};
const record=()=>({conversationStage:'quotation',payments:[],proposals:[],lastQuotedOffer:{...offer,status:'quoted',quotedAt:new Date().toISOString()}});
const context=latestMessage=>({language:'pt-BR',latestMessage,automation:{manualRequest:false}});

test('chave é preservada integralmente; formato inválido não é truncado silenciosamente',()=>{
 assert.deepEqual(normalizePaymentDetails({pixKey:' '+key+' ',pixRecipient:'Titular fictício'}),{pixKey:key,pixRecipient:'Titular fictício'});
 assert.equal(normalizeBusiness({paymentDetails:{pixKey:key}}).paymentDetails.pixKey,key);
 assert.throws(()=>normalizePaymentDetails({pixKey:'x'.repeat(141)}),/completa/);
 assert.throws(()=>normalizePaymentDetails({pixKey:'chave\nerrada'}),/quebras/);
});
test('escolhas claras enviam o valor já apresentado e a chave cadastrada',()=>{
 const s=settings();
 for(const text of ['Prefiro pagamento integral','Vou pagar tudo agora','Quero pagar à vista']){
  const action=paymentAction(s,lead,record(),context(text));assert.equal(action.status,'ready');assert.equal(action.paymentChoice.mode,'full');assert.match(action.text,/200,00/);assert.ok(action.text.includes(key));
 }
 for(const text of ['Vou pagar 50% de entrada e o resto na entrega','Prefiro a entrada','Quero pagar 50% do valor total']){
  const action=paymentAction(s,lead,record(),context(text));assert.equal(action.paymentChoice.mode,'deposit');assert.equal(action.paymentChoice.amount,100);assert.match(action.text,/100,00/);assert.ok(action.text.includes(key));
 }
 const r=record();r.lastQuotedOffer.amount=180;assert.equal(paymentAction(s,lead,r,context('Quero pagar integral')).paymentChoice.amount,180);
});
test('entrada e saldo fecham os centavos do valor real, sem alterar a mensalidade',()=>{
 const r=record();r.lastQuotedOffer.amount=200.01;const action=paymentAction(settings(),lead,r,context('Prefiro a entrada'));
 assert.equal(action.paymentChoice.amount,100.01);assert.match(action.text,/100,01/);assert.match(action.text,/100,00/);assert.equal(r.payments.length,0);
});
test('pedir chave sem escolher modalidade pergunta a preferência antes de enviar',()=>{
 const r=record(),s=settings(),action=paymentAction(s,lead,r,context('Qual a chave Pix?'));
 assert.match(action.text,/integral.*50%/);assert.ok(!action.text.includes(key));
 r.paymentChoice=paymentAction(s,lead,r,context('Prefiro a entrada')).paymentChoice;
 assert.ok(paymentAction(s,lead,r,context('Pode mandar a chave Pix?')).text.includes(key));
});
test('não usa Pix em proposta estrangeira, faixa não fechada, rascunho ou pedido manual',()=>{
 const s=settings();
 assert.equal(paymentAction(s,{...lead,pais:'Portugal',moeda:'EUR'},record(),context('Pagamento integral')),null);
 for(const patch of [{status:'draft'},{pricingMode:'range'},{currency:'USD'},{quotedAt:null}]){const r=record();Object.assign(r.lastQuotedOffer,patch);assert.equal(paymentAction(s,lead,r,context('Pagamento integral')),null);}
 assert.equal(paymentAction(s,lead,record(),{...context('Pagamento integral'),automation:{manualRequest:true}}),null);
 for(const text of ['Se eu pagar integral tem desconto?','Não quero pagar','Quero 50% de desconto','Posso pagar integral?',
  'Vou pagar integral na entrega','Prefiro pagar integral no cartão','Quero entender a entrada de 50%'])assert.equal(paymentAction(s,lead,record(),context(text)),null,text);
});

test('aviso de pagamento não reenvia Pix, não confunde fotos e não confirma dinheiro',()=>{
 for(const text of ['Paguei o Pix','Já fiz o Pix e vou mandar o comprovante para você conferir.','Enviei o comprovante','Segue o comprovante']){
  const action=paymentAction(settings(),lead,record(),context(text));assert.ok(action?.paymentNotice,text);assert.equal(action.status,'ready');assert.ok(!action.text.includes(key));assert.match(action.text,/precisa ser conferido/);
 }
 for(const text of ['Já enviei as fotos do projeto','Ainda não paguei o Pix','Vou fazer o Pix e mandar o comprovante','Onde envio o comprovante?'])assert.ok(!paymentAction(settings(),lead,record(),context(text))?.paymentNotice,text);
});

test('aviso fica como pendência financeira até confirmação manual, sem consulta à IA',async t=>{
 const f=workspaceFixture(t);await f.workspace.saveSettings({...settings(),provider:'groq',enabled:true,dataConsent:true,freeAccountConfirmed:true,apiKey:'fixture-not-a-real-api-key'});
 f.workspace.setProvider({hasKey:()=>true,close(){},generate:async()=>{throw new Error('Não deve consultar a IA.');}});
 await f.workspace.mutate(data=>{data.records[f.contact]=record();});
 await f.store.updateLead(f.contact,{status:'ganho'});
 await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Já fiz o Pix e vou mandar o comprovante.',messageId:'payment-reported',eligible:true});
 await f.workspace.mutate(data=>{data.jobs.at(-1).dueAt=0;});
 const deadline=performance.now()+5000;let delivery;
 while(performance.now()<deadline){delivery=await f.workspace.nextDelivery();if(delivery)break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.ok(delivery);assert.ok(!delivery.text.includes(key));await f.workspace.ack({id:delivery.id,ok:true,messageId:'notice-only'});
 let saved=f.workspace.read().records[f.contact];assert.equal(saved.payments.length,0);assert.equal(saved.attention.kind,'payment_review');assert.equal(saved.attention.resolvedAt,null);
 const dashboard=await f.store.getDashboard();assert.equal(dashboard.leads[0].fila_atendimento.actionNow,true);
 await f.workspace.command(f.contact,{action:'payment',amount:100,currency:'BRL',description:'Entrada conferida',confirmed:true,requestId:'confirmed-payment'});
 saved=f.workspace.read().records[f.contact];assert.equal(saved.payments.length,1);assert.ok(saved.attention.resolvedAt);
});
test('chave ausente e condições incompatíveis pedem intervenção, sem inventar cobrança',()=>{
 const s=settings();s.business.paymentDetails.pixKey='';assert.equal(paymentAction(s,lead,record(),context('Prefiro a entrada')).status,'held');
 const r=record();r.lastQuotedOffer.terms='Pagamento integral antes do início.';assert.equal(paymentAction(settings(),lead,r,context('Prefiro a entrada')).status,'held');
});
test('chave e titular não entram no contexto compartilhado com a IA',()=>{
 const s=settings(),ctx=buildContext(lead,record(),[{direction:'out',text:`Chave Pix: ${key}. Titular: Titular fictício`,at:new Date().toISOString()},{direction:'in',text:'Como funciona?',at:new Date().toISOString()}],s);
 assert.ok(!JSON.stringify(ctx).includes(key));assert.ok(!JSON.stringify(ctx).includes('Titular fictício'));assert.equal(ctx.automation.pixAvailable,true);
});
test('proposta calculada inclui descrição curta do escopo confirmado',()=>{
 const request='Quero um site para mostrar produtos e receber contatos pelo WhatsApp.';
 const s=settings();s.business=normalizeBusiness({...s.business,projectPricing:{enabled:true,method:'qualitative_factors_v1'},offers:[{...offer,pricingMode:'range',amount:150,amountMax:250}]});
 const draft=scopeAction({serviceType:'site',work:'new',summary:'Site para apresentar produtos e receber contatos pelo WhatsApp.',requirements:[{text:'Apresentar os produtos e direcionar o contato para o WhatsApp',evidence:request}],drivers:[{dimension:'presentation',level:'basic',evidence:request}],technicalReview:false},{language:'pt-BR',history:[{role:'contato',text:request}]}).scopeDraft;
 const r={...record(),lastInbound:'confirm',projectDraft:{...draft,status:'pending',sentAt:new Date().toISOString(),inbound:'initial'}},ctx=context('Sim, envie a proposta.');
 const result=confirmedScopeResult(s,lead,r,ctx),action=decideAutonomous(result,s,lead,r,ctx);
 assert.equal(action.status,'ready');assert.ok(action.text.startsWith(draft.summary));assert.match(action.text,/150,00/);assert.ok(!action.text.includes('•'));assert.ok(action.text.length<900);assert.ok(action.offer.scope.includes(draft.requirements[0].text));
});
test('fila envia instruções sem consumir consulta nem registrar recebimento',async t=>{
 const f=workspaceFixture(t);await f.workspace.saveSettings({...settings(),provider:'groq',enabled:true,dataConsent:true,freeAccountConfirmed:true,apiKey:'fixture-not-a-real-api-key'});
 let calls=0;f.workspace.setProvider({hasKey:()=>true,close(){},generate:async()=>{calls++;throw Error('Não deve consultar o modelo.');}});
 await f.workspace.mutate(data=>{data.records[f.contact]=record();});
 await f.workspace.ingest({contact:f.contact,direction:'in',actor:'contact',text:'Prefiro a entrada',messageId:'payment-choice',eligible:true});
 await f.workspace.mutate(data=>{data.jobs.at(-1).dueAt=0;});
 const end=Date.now()+5000;let delivery;while(Date.now()<end){delivery=await f.workspace.nextDelivery();if(delivery)break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(delivery);assert.ok(delivery.text.includes(key));assert.equal(calls,0);
 assert.equal(f.workspace.read().records[f.contact].conversationStage,'quotation');assert.equal(f.workspace.read().records[f.contact].payments.length,0);
 await f.workspace.ack({id:delivery.id,ok:true,messageId:'fictional-payment-instruction'});
 assert.equal(f.workspace.read().records[f.contact].payments.length,0);assert.equal(f.workspace.publicSnapshot().settings.business.paymentDetails.pixKey,key);
});
