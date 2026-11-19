'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {temporaryRoot}=require('./fixture-helpers');
const {verifyAccountsOrigin,dependencyTree,copyTree,buildInstaller,prepareDesktop}=require('../tools/prepare-desktop');

test('versão inválida não inicia rede nem preparação do instalador',async()=>{
 let network=false;
 for(const version of ['../outside','1.2','01.2.3','1.2.3-pilot.01','1.2.3/other'])await assert.rejects(prepareDesktop({version,fetch:async()=>{network=true;throw Error('not reached');}}),/versão semântica/);
 assert.equal(network,false);
});
test('instalador exige serviço de contas real e protocolo compatível antes de preparar arquivos',async()=>{
 for(const response of [new Response('{}',{status:503}),new Response(JSON.stringify({application:'Outra aplicação',protocol:1,localScripts:true}))])await assert.rejects(verifyAccountsOrigin('https://accounts.example.invalid',{fetch:async()=>response}));
 assert.equal(await verifyAccountsOrigin('https://accounts.example.invalid',{fetch:async()=>new Response(JSON.stringify({application:'Ploa',protocol:1,localScripts:true}))}),'https://accounts.example.invalid');
 await assert.rejects(buildInstaller({verify:false}),/serviço público/);
});
test('cópia da distribuição exclui arquivos operacionais, cofres, ambientes e sessões',async t=>{
 const root=temporaryRoot(t),source=path.join(root,'source'),target=path.join(root,'target');await fs.mkdir(source);
 await fs.writeFile(path.join(source,'program.js'),'module.exports=true;');
 for(const name of ['.env','.env.production','leads.json','contatos.xlsx','ploa_workspace.json','owner-binding.json'])await fs.writeFile(path.join(source,name),'PRIVATE_FIXTURE');
 for(const name of ['.credentials','.wwebjs_auth','backups','.ploa-local']){await fs.mkdir(path.join(source,name));await fs.writeFile(path.join(source,name,'fixture'),'PRIVATE_FIXTURE');}
 await copyTree(source,target);assert.deepEqual(await fs.readdir(target),['program.js']);
});
test('dependências de execução resolvem da instalação local sem incluir ferramentas de desenvolvimento',async()=>{
 const packages=await dependencyTree(),names=[...packages.values()].map(p=>p.name);
 assert.ok(names.includes('whatsapp-web.js'));assert.ok(names.includes('puppeteer'));assert.ok(names.includes('xlsx'));
 assert.ok(!names.includes('electron-builder'));assert.ok(!names.includes('wrangler'));assert.ok(!names.includes('electron'));
});
