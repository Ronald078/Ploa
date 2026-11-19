'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash}=require('node:crypto');
// Inventory only. Never import, rename, overwrite or read credential/session stores.
const DATA_FILES=[
 'contatos.xlsx','leads.json','leads_ja_capturados.json','crm_dados.json','configuracoes_operacao.json',
 'copys_internacionais.json','copys_respostas_automaticas.json','ploa_workspace.json','ploa_conversas.jsonl',
 'ploa_execucoes.jsonl','ploa_tokens.jsonl','ploa_triagem.json','respostas_recebidas.json',
 'respostas_automaticas_enviadas.json','bloqueados.json','contador_diario.json','envios_pendentes.json',
 'mapeamento_contatos.json','log_envios.json','progresso_busca.json','cache_cidades.json',
 'crm/ai-test-contact.json','crm/anuncios_catalogo.json','crm/minerador/criativos.sqlite'
];
async function planMigration(directory){
 const root=await fs.realpath(path.resolve(directory)),files=[];
 for(const relative of DATA_FILES){
  const file=path.join(root,relative);let stat;
  try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Confira o arquivo de dados: '+relative);
  const resolved=await fs.realpath(file),within=path.relative(root,resolved);if(path.isAbsolute(within)||within==='..'||within.startsWith('..'+path.sep))throw Error('Arquivo fora da raiz de dados: '+relative);
  if(relative.endsWith('.sqlite')){
   files.push({file:relative,bytes:stat.size,sha256:null,requiresConsistentSqliteBackup:true});continue;
  }
  const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
  const after=await fs.stat(file),unchanged=stat.size===after.size&&stat.mtimeMs===after.mtimeMs;
  files.push({file:relative,bytes:after.size,sha256:unchanged?digest.digest('hex'):null,unchangedDuringRead:unchanged});
 }
 return{version:1,createdAt:new Date().toISOString(),mode:'read-only-inventory',source:root,files,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),backupCreated:false,importPerformed:false,
  excluded:['Credenciais e chaves de API','Sessões WhatsApp/navegador','Sessões/chaves administrativas de contas','Vínculo antigo do dono','Execuções e controles de processos em andamento'],
  next:['Confirmar conta e empresa autenticadas do destino','Encerrar operações antes do backup consistente','Criar backup com checksum e SQLite backup API','Conferir importação em diretório separado sem iniciar scripts','Cadastrar credenciais e parear WhatsApp no destino quando necessário']};
}
if(require.main===module)planMigration(process.argv[2]||path.resolve(__dirname,'../..')).then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={planMigration,DATA_FILES};
