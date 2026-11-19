'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('resposta automática ausente na conta nova nunca usa a copy embutida do dono',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../enviar_mensagens_whatsapp.js'),'utf8');
 const loader=source.slice(source.indexOf('function carregarCopysRespostasAutomaticas('),source.indexOf('let CATEGORIAS_RESPOSTA_AUTOMATICA ='));
 const locales=['pt-BR','pt-PT','en-US','es-ES'],defaults=[{nome:'bot-atendimento',respostasPorIdioma:Object.fromEntries(locales.map(locale=>[locale,['Copy fictícia do dono']]))}];
 for(const individual of [true,false])for(const contents of [null,{categorias:{}},{categorias:{'bot-atendimento':{porIdioma:{'pt-BR':['Copy da conta']}}}}]){
  const context=vm.createContext({fs:{existsSync:()=>individual,readFileSync:()=>{if(contents===null)throw Object.assign(new Error('ausente'),{code:'ENOENT'});return JSON.stringify(contents);}},caminho:name=>name,ARQUIVO_COPYS_RESPOSTAS_AUTOMATICAS:'fixture.json',IDIOMAS_RESPOSTAS_AUTOMATICAS:locales,console:{warn(){}}});
  vm.runInContext(loader+'\nglobalThis.load=carregarCopysRespostasAutomaticas;',context);
  const replies=context.load(defaults)[0].respostasPorIdioma;
  for(const locale of locales)assert.deepEqual(Array.from(replies[locale]),contents?.categorias?.['bot-atendimento']?.porIdioma?.[locale]||(individual?[]:['Copy fictícia do dono']));
 }
});
