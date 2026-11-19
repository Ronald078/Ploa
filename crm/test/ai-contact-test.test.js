'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {temporaryRoot}=require('./fixture-helpers');
const {run,preflight,lockFor}=require('../ai-contact-test');
const contact='5511999999999',other='5521999999999';
function fixture(t){
  const root=temporaryRoot(t);fs.mkdirSync(path.join(root,'crm'));
  fs.writeFileSync(path.join(root,'crm','ai-test-contact.json'),JSON.stringify({contact,name:'Empresa de teste'}));
  fs.writeFileSync(path.join(root,'ploa_conversas.jsonl'),JSON.stringify({id:'old',contact,direction:'in',text:'Mensagem antiga',at:'2026-10-25T12:00:00Z'})+'\n');
  const snapshot={settings:{enabled:false,provider:'groq',dataConsent:true,freeAccountConfirmed:true,maxDailyRequests:200,updatedAt:'saved'},hasKey:true,records:{},jobs:[]};
  let sends=0;
  const api=async(route,method,body)=>{
    if(route==='/api/workspace')return snapshot;
    if(route==='/api/dashboard')return{leads:[{id:contact,nome:'Empresa de teste',status:'respondeu'}]};
    if(route==='/api/whatsapp')return{running:true,connection:'ready'};
    if(route.includes('/leads/')){sends++;throw Error('Não deve enviar.');}
    throw Error('Rota inesperada: '+route);
  };
  return{root,api,snapshot,sends:()=>sends};
}
function workspaceStub(ingested,held=false){
  return(directory)=>{
    const data=JSON.parse(fs.readFileSync(path.join(directory,'ploa_workspace.json'),'utf8'));
    return{mutate:async fn=>fn(data),recordFor:(state,id)=>state.records[id]||=( {} ),saveSettings:async()=>{},ingest:async e=>ingested.push(e),
      nextDelivery:async()=>null,read:()=>({jobs:held?[{contact,id:'held',status:'held',reason:'Exceção para revisão.'}]:[]}),close(){}};
  };
}
test('abrir preserva o contexto salvo e só recebe mensagens novas do contato autorizado',async t=>{
  const f=fixture(t),ingested=[],dir=path.join(f.root,'teste_ia_local',contact);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'ploa_workspace.json'),JSON.stringify({settings:{},records:{[contact]:{lastQuotedOffer:{amount:200},facts:{}}},jobs:[],usage:{}}));
  let waits=0;await run(f.root,{api:f.api,log(){},makeWorkspace:workspaceStub(ingested),wait:async()=>{
    if(++waits===1)for(const [id,who] of [['other',other],['new',contact]])fs.appendFileSync(path.join(f.root,'ploa_conversas.jsonl'),JSON.stringify({id,contact:who,direction:'in',text:'Nova mensagem',at:new Date().toISOString()})+'\n');
    else fs.writeFileSync(path.join(f.root,'teste_ia_local','parar.flag'),'stop');
  }});
  assert.deepEqual(ingested.map(e=>e.id),['new']);assert.equal(f.sends(),0);
  const old=JSON.parse(fs.readFileSync(path.join(dir,'ploa_workspace.json'),'utf8'));assert.equal(old.records[contact].lastQuotedOffer.amount,200);
  assert.equal(fs.existsSync(path.join(f.root,'teste_ia_local','execucao.lock.json')),false);
});
test('dois iniciadores não criam dois atendimentos simultâneos',t=>{
  const f=fixture(t),file=path.join(f.root,'lock.json'),release=lockFor(file);
  assert.throws(()=>lockFor(file),/já está aberto/);release();assert.equal(fs.existsSync(file),false);
});
test('IA geral ligada impede o ensaio separado sem desativá-la automaticamente',async t=>{
  const f=fixture(t);f.snapshot.settings.enabled=true;await assert.rejects(preflight(f.root,f.api),/Desative a conexão/);assert.equal(f.snapshot.settings.enabled,true);assert.equal(f.sends(),0);
});
test('nome diferente impede usar um destinatário inesperado',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'crm','ai-test-contact.json'),JSON.stringify({contact,name:'Outra empresa'}));
  await assert.rejects(preflight(f.root,f.api),/não confere/);assert.equal(f.sends(),0);
});
test('uma retenção de revisão não encerra a janela nem remove o contexto',async t=>{
  const f=fixture(t),logs=[];let loops=0;
  await run(f.root,{api:f.api,log:text=>logs.push(text),makeWorkspace:workspaceStub([],true),wait:async()=>{if(++loops===3)fs.writeFileSync(path.join(f.root,'teste_ia_local','parar.flag'),'stop');}});
  assert.equal(loops,3);assert.equal(logs.filter(text=>text.startsWith('Aguardando revisão:')).length,1);assert.equal(f.sends(),0);
});

test('ensaio reavalia saudação marcada pelo worker antigo e permite resposta humana',async t=>{
 const f=fixture(t),ingested=[],logs=[];let loops=0,localStore;
 const api=async(route,...args)=>route==='/api/dashboard'?{leads:[{id:contact,nome:'Empresa de teste',status:'automatico'}]}:f.api(route,...args);
 await run(f.root,{api,log:text=>logs.push(text),makeWorkspace:(dir,store)=>{localStore=store;return workspaceStub(ingested)(dir);},wait:async()=>{
  if(++loops===1)fs.appendFileSync(path.join(f.root,'ploa_conversas.jsonl'),JSON.stringify({id:'greeting',messageId:'greeting',contact,direction:'in',actor:'bot',text:'Boa noite, bem vindo a hostinger.',at:new Date().toISOString()})+'\n');
  else{assert.equal((await localStore.getDashboard()).leads[0].status,'respondeu');fs.writeFileSync(path.join(f.root,'teste_ia_local','parar.flag'),'stop');}
 }});
 assert.equal(ingested.length,1);assert.equal(ingested[0].actor,'contact');assert.equal(ingested[0].eligible,true);
 assert.ok(logs.some(text=>text.startsWith('Mensagem recebida.')));assert.equal(f.sends(),0);
});

test('mensagem realmente automática informa o bloqueio sem fingir que há consulta na fila',async t=>{
 const f=fixture(t),ingested=[],logs=[];let loops=0;
 await run(f.root,{api:f.api,log:text=>logs.push(text),makeWorkspace:workspaceStub(ingested),wait:async()=>{
  if(++loops===1)fs.appendFileSync(path.join(f.root,'ploa_conversas.jsonl'),JSON.stringify({id:'real-bot',contact,direction:'in',actor:'bot',text:'Resposta automática. Digite 1 para vendas.',at:new Date().toISOString()})+'\n');
  else{const status=JSON.parse(fs.readFileSync(path.join(f.root,'teste_ia_local/status.json'),'utf8'));assert.equal(status.status,'ignored_bot');assert.match(status.reason,/não foi enviada à IA/);fs.writeFileSync(path.join(f.root,'teste_ia_local','parar.flag'),'stop');}
 }});
 assert.equal(ingested[0].eligible,false);assert.equal(ingested[0].actor,'bot');assert.ok(!logs.some(text=>text.startsWith('Mensagem recebida.')));assert.equal(f.sends(),0);
});
