/**
 * Envio de mensagens em massa pelo WhatsApp
 * ------------------------------------------
 * Biblioteca: whatsapp-web.js (não oficial, usa o WhatsApp Web por trás)
 *
 * COMO USAR:
 * 1. Instale as dependências:
 *      npm install whatsapp-web.js qrcode-terminal csv-parse xlsx
 *
 * 2. Crie um arquivo de contatos na mesma pasta — pode ser CSV ou Excel:
 *
 *    a) "contatos.csv":
 *      numero,nome
 *      5511999999999,João
 *      5511888888888,Maria
 *
 *    b) "contatos.xlsx" (planilha Excel), com colunas na primeira linha:
 *      numero          | nome
 *      5511999999999   | João
 *      5511888888888   | Maria
 *
 *    (número com DDI+DDD, sem espaços, sem "+")
 *    O script detecta automaticamente qual usar pela extensão do arquivo
 *    definido em ARQUIVO_CONTATOS abaixo.
 *
 * 3. Rode: node enviar_mensagens_whatsapp.js
 *    Na primeira vez vai aparecer um QR Code no terminal — escaneie
 *    com o WhatsApp do celular (Aparelhos conectados > Conectar aparelho).
 *
 * VARIAÇÕES DE MENSAGEM:
 * - Defina várias mensagens em MENSAGENS (array). A cada contato, o
 *   script escolhe uma variação aleatoriamente (evita mandar o texto
 *   idêntico pra todo mundo, o que ajuda a não parecer disparo em massa).
 * - Use {nome} em qualquer variação para inserir o nome do contato.
 *
 * ANTI-DUPLICAÇÃO (NUNCA MANDA DUAS VEZES PRO MESMO NÚMERO):
 * - Todo número que recebe mensagem com sucesso é salvo em
 *   "numeros_enviados.json". Antes de enviar, o script sempre confere
 *   essa lista — se o número já está lá, ele pula, mesmo que:
 *     a) a planilha/CSV tenha o mesmo número repetido em várias linhas;
 *     b) você rode o script de novo em outro dia, com outro arquivo,
 *        que por engano tenha um número já contemplado antes.
 * - Além disso, duplicatas dentro do PRÓPRIO arquivo de contatos também
 *   são removidas antes de começar a enviar (mantém só a 1ª ocorrência).
 * - Para "resetar" e permitir reenvio a algum número, edite
 *   numeros_enviados.json e remova o número da lista.
 *
 * RESPOSTAS E RESPOSTA AUTOMÁTICA POR CATEGORIA:
 * - Toda resposta recebida de um contato é registrada em
 *   "respostas_recebidas.json" (número, texto e data/hora).
 * - CATEGORIAS_RESPOSTA_AUTOMATICA define "tipos" de resposta por
 *   palavras/frases-gatilho. Se o texto do contato bater com alguma
 *   categoria, o script manda de volta a resposta configurada pra ela
 *   (pode usar {nome}) — e registra em
 *   "respostas_automaticas_enviadas.json".
 * - Uma categoria pode ter "resposta" (texto fixo) ou "respostas" (várias
 *   opções). Quando há opções, o sorteio não repete nenhuma delas até usar
 *   todas. Cada categoria responde no máximo uma vez por contato.
 * - Categorias com "bloquear: true" também adicionam o número a
 *   "bloqueados.json". Pra desbloquear manualmente, edite esse arquivo.
 * - Pra criar uma categoria nova (ex: "interesse", "dúvida"), copie um
 *   bloco dentro de CATEGORIAS_RESPOSTA_AUTOMATICA e ajuste os gatilhos
 *   e a resposta.
 *
 * DELAY PARA CONTATO NOVO:
 * - DELAY_CONTATO_NOVO_MIN/MAX_MS usa a faixa salva no painel antes de mandar
 *   a primeira mensagem pra cada contato — já que, neste script, todo
 *   contato é sempre novo (quem já recebeu é sempre pulado). Esse delay
 *   é a única pausa programada entre envios normais; INTERVALO_MIN/MAX_MS
 *   fica zerado para não somar outra espera entre contatos.
 *
 * LIMITE DIÁRIO DE ENVIOS:
 * - LIMITE_DIARIO_ENVIOS define quantas mensagens (com sucesso) podem
 *   sair por dia. Ao atingir o limite, o script para sozinho e avisa
 *   pra rodar de novo amanhã — como quem já recebeu fica registrado em
 *   numeros_enviados.json, ele automaticamente continua de onde parou.
 * - O contador do dia fica em "contador_diario.json" e reseta sozinho
 *   quando a data muda.
 * - Use 0 ou null em LIMITE_DIARIO_ENVIOS para desativar o limite.
 *
 * REPETIÇÃO AUTOMÁTICA EM CASO DE ERRO (RETRY):
 * - A verificação se o número existe no WhatsApp tenta de novo até
 *   MAX_TENTATIVAS_ENVIO vezes, esperando cada vez mais entre as tentativas.
 * - O envio da mensagem acontece uma única vez. Se o resultado ficar incerto,
 *   ele é salvo em envios_pendentes.json e não é repetido automaticamente.
 *
 * DISJUNTOR (evita perder leads em massa por problema de conexão):
 * - Se MAX_FALHAS_CONSECUTIVAS contatos seguidos falharem mesmo depois do
 *   retry, o script entende que o problema é a CONEXÃO (não os contatos)
 *   e pausa por PAUSA_DISJUNTOR_MS antes de tentar de novo — o MESMO
 *   contato, não pula pro próximo. Isso evita que uma queda de internet
 *   no meio da execução "queime" um monte de leads como erro definitivo.
 * - Se isso acontecer mais de MAX_ACIONAMENTOS_DISJUNTOR vezes seguidas,
 *   o script entende que não é instabilidade passageira (ex: sessão do
 *   WhatsApp foi desconectada de verdade no celular), reinicia o navegador
 *   e tenta conectar novamente sem repetir quem já recebeu mensagem.
 * - O Puppeteer (Chromium por trás da lib) também roda com flags de
 *   estabilidade, que reduzem trava/fechamento inesperado da página.
 *
 * ENVIO DE MÍDIA (preparado para uso futuro — desativado por padrão):
 * - Defina CAMINHO_MIDIA_PADRAO com o caminho de um arquivo (imagem,
 *   PDF, áudio) para que toda mensagem saia com esse anexo + o texto
 *   como legenda. Deixe null para continuar mandando só texto.
 *
 * BASE PARA O FUTURO DASHBOARD (leads.json):
 * - Cada contato único ganha um registro em "leads.json" com: status
 *   (frio/quente/comprou — começa em 'frio'), datas de primeiro e
 *   último contato, total de mensagens enviadas e de respostas
 *   recebidas. Isso é atualizado em tempo real a cada envio e a cada
 *   resposta — é a base de dados que o dashboard futuro vai ler para
 *   segmentar leads e mostrar métricas de engajamento.
 * - Combinado com log_envios.json (histórico por execução) e
 *   respostas_recebidas.json (histórico de respostas), já dá pra
 *   montar gráficos de volume enviado/dia, taxa de resposta, etc.
 *   Faturamento/gastos de API ainda não têm arquivo próprio — isso
 *   entra quando a API oficial for contratada.
 *
 * AVISOS IMPORTANTES:
 * - Use apenas com contatos que já têm seu número salvo ou que
 *   autorizaram receber mensagens. Envio de spam pode banir o número.
 * - Mantenha um intervalo entre mensagens (já incluso abaixo) para
 *   reduzir o risco de bloqueio.
 * - Para volumes grandes (milhares/dia) ou uso comercial contínuo,
 *   considere a WhatsApp Business API oficial da Meta.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const EXECUCAO_PELO_PAINEL_PLOA = process.env.PLOA_PANEL_OUTPUT === '1';
const ATENDIMENTO_CONTINUO_PLOA = process.env.PLOA_CONTINUOUS_AGENT === '1';
const fs = require('fs');
const { createOutreachResults } = require('./crm/lib/outreach-results');
const { reachedDailyLimit, createProgressWriter } = require('./crm/lib/campaign-progress');
const { createSenderPersistence, validCounter } = require('./crm/lib/sender-persistence');
const { createDailySendLedger } = require('./crm/lib/daily-send-ledger');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const {
  DEFAULT_OPERATION_SETTINGS,
  normalizeOperationSettings,
} = require('./crm/lib/operation-settings');

// Pasta onde ESTE ARQUIVO está (não a pasta de onde o comando foi rodado).
// Todo arquivo que o script lê/grava (contatos, números já enviados,
// bloqueados, log, etc.) é resolvido a partir daqui — ver caminho() abaixo.
// Isso é essencial pro "retomar de onde parou amanhã" funcionar de
// verdade quando o script roda via cron/Agendador de Tarefas, que às
// vezes iniciam de uma pasta diferente da do script.
const PASTA_DO_SCRIPT = require('./crm/lib/runtime-paths').dataRoot();
const pontePloa = require('./crm/lib/whatsapp-bridge').createWhatsAppBridge(PASTA_DO_SCRIPT,{independent:ATENDIMENTO_CONTINUO_PLOA});
let campanhaPloa = null;
const campanhasPloaConhecidas = new Set();
function avisarPloa(type,details={}) { if(ATENDIMENTO_CONTINUO_PLOA&&process.connected)process.send?.({type,...details}); }
function concluirCampanhaPloa(status,error='') {
  if(!campanhaPloa)return;
  avisarPloa('ploa-campaign-finished',{runId:campanhaPloa,status,error});campanhaPloa=null;
}
let encerrandoPeloPainel = false;
let filaSuspensaPorLogout = false;
let filaInicialConcluida = false;
async function aguardarControlePloa() {
  if (filaSuspensaPorLogout) throw Object.assign(new Error('A sessão do WhatsApp foi encerrada. A fila foi interrompida sem repetir mensagens.'), { code: 'PLOA_CAMPAIGN_STOP' });
  if (!pontePloa.enabled) return;
  let pausou = false;
  while (pontePloa.control() === 'pause') {
    if (!pausou) { atualizarAndamentoEnvios({ status: 'pausada' }); pausou = true; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (pontePloa.control() === 'stop') {
    if(ATENDIMENTO_CONTINUO_PLOA)throw Object.assign(new Error('Disparos interrompidos; atendimento continua conectado.'),{code:'PLOA_CAMPAIGN_STOP'});
    while (pontePloa.isBusy()) await new Promise(resolve => setTimeout(resolve, 250));
    if (!encerrandoPeloPainel) {
      encerrandoPeloPainel = true;
      atualizarAndamentoEnvios({ status: 'interrompida' });
      pontePloa.close();
      try { await client.destroy(); } catch {}
      process.exit(0);
    }
    return;
  }
  if (pausou) atualizarAndamentoEnvios({ status: 'em_execucao' });
}
function caminho(nomeArquivo) {
  return path.join(PASTA_DO_SCRIPT, nomeArquivo);
}

const ARQUIVO_CONFIGURACOES_OPERACAO = 'configuracoes_operacao.json';

function carregarConfiguracoesOperacao() {
  const arquivo = caminho(ARQUIVO_CONFIGURACOES_OPERACAO);
  try {
    if (!fs.existsSync(arquivo)) return normalizeOperationSettings(DEFAULT_OPERATION_SETTINGS);
    return normalizeOperationSettings(JSON.parse(fs.readFileSync(arquivo, 'utf8')));
  } catch (erro) {
    // A malformed country/setting must never silently widen a targeted run.
    throw new Error('As configurações dos envios estão inválidas. Corrija-as no painel antes de iniciar.', { cause: erro });
  }
}

let CONFIGURACOES_OPERACAO = carregarConfiguracoesOperacao();

const PAUSA_RECUPERACAO_PERSISTENCIA_MS = 60000;
const ARQUIVO_ALERTA_PERSISTENCIA = 'ALERTA_PERSISTENCIA.json';
const ARQUIVO_ERROS_EVENTOS = 'erros_eventos.jsonl';
const arquivosCorrompidosPreservados = new Set();

function clonarValorJson(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function erroDePersistencia(arquivo, erroPrincipal, erroBackup) {
  const erro = new Error(
    `Não foi possível recuperar ${arquivo}. Principal: ${erroPrincipal?.message || erroPrincipal}. `
    + `Backup: ${erroBackup?.message || erroBackup}.`,
  );
  erro.code = 'PERSISTENCIA_JSON_IRRECUPERAVEL';
  erro.arquivo = arquivo;
  return erro;
}

function ehErroPersistencia(erro) {
  return erro?.code === 'PERSISTENCIA_JSON_IRRECUPERAVEL'
    || erro?.code === 'PERSISTENCIA_JSON_GRAVACAO';
}

const persistenciaJson = createSenderPersistence({ root: PASTA_DO_SCRIPT, fs, pid: process.pid,
  warn: mensagem => console.warn(mensagem) });
function salvarJsonAtomico(nomeArquivo, dados, opcoes) {
  persistenciaJson.save(nomeArquivo, dados, opcoes);
}

function preservarJsonCorrompido(caminhoArquivo) {
  if (!fs.existsSync(caminhoArquivo) || arquivosCorrompidosPreservados.has(caminhoArquivo)) return;
  const data = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    fs.copyFileSync(caminhoArquivo, `${caminhoArquivo}.corrompido-${data}`);
    arquivosCorrompidosPreservados.add(caminhoArquivo);
  } catch (erro) {
    console.warn(`Não foi possível preservar a cópia corrompida de ${path.basename(caminhoArquivo)}: ${erro.message}`);
  }
}

// Arquivo ausente significa primeira execução e usa o padrão. Arquivo presente
// mas inválido nunca é confundido com vazio: tenta o .bak e, se ele também
// falhar, o chamador decide entre modo protegido (crítico) ou fallback.
function lerJsonSeguro(nomeArquivo, valorPadrao, validar, { critico = true } = {}) {
  const destino = caminho(nomeArquivo);
  const backup = `${destino}.bak`;
  const validarDados = typeof validar === 'function' ? validar : () => true;

  const lerEValidar = (origem) => {
    const dados = JSON.parse(fs.readFileSync(origem, 'utf-8'));
    if (!validarDados(dados)) {
      throw new Error(`estrutura inválida em ${path.basename(origem)}`);
    }
    return dados;
  };

  if (!fs.existsSync(destino) && !fs.existsSync(backup)) {
    return clonarValorJson(valorPadrao);
  }

  let erroPrincipal;
  try {
    if (fs.existsSync(destino)) return lerEValidar(destino);
    throw new Error('arquivo principal ausente');
  } catch (erro) {
    erroPrincipal = erro;
    preservarJsonCorrompido(destino);
  }

  try {
    const dadosBackup = lerEValidar(backup);
    salvarJsonAtomico(nomeArquivo, dadosBackup, { manterBackup: false });
    console.warn(`⚠️  ${nomeArquivo} foi recuperado automaticamente pelo backup válido.`);
    return dadosBackup;
  } catch (erroBackup) {
    preservarJsonCorrompido(backup);
    const erro = erroDePersistencia(nomeArquivo, erroPrincipal, erroBackup);
    if (critico) throw erro;
    console.error(`⚠️  ${erro.message} O arquivo não crítico começará vazio; a cópia corrompida foi preservada.`);
    return clonarValorJson(valorPadrao);
  }
}

function registrarAlertaPersistencia(erro, status = 'aguardando recuperação') {
  persistenciaJson.alert(erro, status);
}

// ======= CONFIGURAÇÕES =======
// Pode apontar para um .csv ou um .xlsx — o script detecta sozinho.
const ARQUIVO_CONTATOS = 'contatos.xlsx';

// Se a planilha tiver várias abas, defina o nome exato da aba com os
// contatos (ex: 'Sem site confirmado'). Deixe null para usar a primeira.
const NOME_ABA_CONTATOS = null;

// Se uma célula de telefone tiver mais de um número (separados por
// ";", "," ou "/"), true = usa só o primeiro; false = cria um contato
// separado para cada número encontrado na célula.
const USAR_APENAS_PRIMEIRO_NUMERO = require('./crm/lib/contact-phone').FIRST_PHONE_ONLY;

// Números que não batem com o padrão internacional esperado são pulados
// e registrados aqui para revisão manual,
// em vez de arriscar mandar mensagem pra alguém errado.
const ARQUIVO_NUMEROS_INVALIDOS = 'numeros_invalidos.json';
const ARQUIVO_COPYS_INTERNACIONAIS = 'copys_internacionais.json';
const ARQUIVO_COPYS_RESPOSTAS_AUTOMATICAS = 'copys_respostas_automaticas.json';

// Variações de mensagem — uma é sorteada aleatoriamente para cada contato.
const MENSAGENS = [
  'Olá, tudo bem? Meu nome é Ronald, sou programador e engenheiro de software. Trabalho com a criação de sites profissionais para empresas e profissionais que desejam fortalecer sua presença digital e conquistar mais clientes. Você teria interesse em conhecer melhor esse serviço?',
  'Olá! Sou Ronald, programador e engenheiro de software. Desenvolvo sites modernos e personalizados para ajudar negócios a apresentar seus serviços, transmitir mais confiança e gerar novos contatos pela internet. Posso te explicar rapidamente como funciona?',
  'Olá! Sou Ronald, programador e engenheiro de software. Desenvolvo sites pensados para apresentar seus serviços e direcionar potenciais clientes diretamente para o WhatsApp. É uma forma de facilitar o atendimento e gerar mais oportunidades de venda. Gostaria de saber mais?',
  'Olá, tudo bem? Meu nome é Ronald. Sou programador e engenheiro de software, especializado na criação de sites profissionais. Posso ajudar você a construir ou melhorar sua presença digital com um site moderno, rápido e adaptado para celulares. Posso te apresentar algumas opções?',
];

// Copys específicas por categoria. As chaves ficam sem acento porque a
// categoria vinda da planilha é normalizada antes da busca.
const MENSAGENS_POR_CATEGORIA = {
  restaurante: [
    'Oi, {nome}! Tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites para restaurantes com cardápio digital, localização, horários e pedidos pelo WhatsApp. É uma forma de transmitir mais profissionalismo e facilitar o pedido dos clientes. Posso te explicar melhor?',
    'Olá, {nome}! Meu nome é Ronald, sou programador e engenheiro de software. Trabalho criando sites que ajudam restaurantes a divulgar seus pratos, conquistar novos clientes e receber pedidos de maneira mais organizada. Gostaria de conhecer o serviço?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Um site profissional pode valorizar seus pratos, fortalecer a credibilidade do restaurante e reunir todas as informações importantes em um só lugar. Posso te apresentar algumas possibilidades?',
    'Olá, {nome}! Tudo bem? Meu nome é Ronald e desenvolvo sites para restaurantes, com opções de cardápio, reservas, localização e atendimento pelo WhatsApp. Isso facilita a experiência do cliente desde o primeiro contato. Teria interesse em receber uma proposta?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Crio sites modernos para restaurantes que desejam divulgar o cardápio, receber mais pedidos e fortalecer sua presença na internet. Posso te enviar mais informações?',
  ],
  'clinica de estetica': [
    'Oi, {nome}! Tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites profissionais para clínicas que desejam transmitir mais credibilidade, apresentar suas especialidades e facilitar o contato dos pacientes. Posso te mostrar como funciona?',
    'Olá, {nome}! Meu nome é Ronald, sou programador e engenheiro de software. Crio sites para clínicas com informações sobre atendimentos, profissionais, localização e agendamento pelo WhatsApp. Teria interesse em conhecer o serviço?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Um site bem estruturado pode ajudar sua clínica a apresentar os serviços com clareza, gerar confiança e ser encontrada com mais facilidade na internet. Posso te enviar uma proposta sem compromisso?',
    'Olá, {nome}! Tudo bem? Trabalho desenvolvendo sites que tornam mais fácil para o paciente conhecer a clínica, encontrar informações e solicitar um agendamento. Sou Ronald, programador e engenheiro de software. Gostaria de receber mais detalhes?',
    'Oi, {nome}! Meu nome é Ronald e sou programador e engenheiro de software. Desenvolvo sites modernos e adaptados para celulares, pensados para fortalecer a imagem de clínicas e facilitar novos agendamentos. Podemos conversar rapidamente sobre essa possibilidade?',
  ],
  'salao de beleza': [
    'Oi, {nome}! Tudo bem? Sou Ronald, programador e engenheiro de software. Crio sites para salões de beleza apresentarem seus serviços, trabalhos realizados e formas de agendamento. Posso te mostrar algumas possibilidades?',
    'Olá, {nome}! Meu nome é Ronald, sou programador e engenheiro de software. Desenvolvo sites que ajudam salões a divulgar seus serviços, transmitir mais profissionalismo e conquistar novos clientes pela internet. Gostaria de conhecer o serviço?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Posso criar um site moderno para seu salão, com serviços, galeria de resultados, localização e botão de agendamento pelo WhatsApp. Teria interesse em receber uma proposta?',
    'Olá, {nome}! Tudo bem? Acredito que um site profissional pode valorizar ainda mais o trabalho do seu salão e facilitar o contato de pessoas interessadas nos seus serviços. Sou Ronald, programador e engenheiro de software. Posso te explicar como funcionaria?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Desenvolvo sites personalizados para salões que desejam mostrar seus resultados, atrair novos clientes e facilitar os agendamentos. Posso te enviar mais informações?',
  ],
  'loja de roupa': [
    'Oi, {nome}! Tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites para lojas de roupas exibirem suas peças em um catálogo digital e receberem pedidos diretamente pelo WhatsApp. Gostaria de conhecer o serviço?',
    'Olá, {nome}! Meu nome é Ronald, sou programador e engenheiro de software. Crio sites modernos para lojas que desejam apresentar seus produtos de forma profissional, fortalecer a marca e conquistar novos clientes. Posso te enviar mais detalhes?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Posso criar um site para sua loja divulgar coleções, lançamentos e promoções, facilitando as vendas pela internet. Teria interesse em receber uma proposta sem compromisso?',
    'Olá, {nome}! Tudo bem? Trabalho criando sites com catálogo de produtos, informações da loja e integração com o WhatsApp. Sou Ronald, programador e engenheiro de software. É uma solução prática para ampliar sua presença digital e gerar novas oportunidades de venda. Posso te explicar melhor?',
    'Oi, {nome}! Sou Ronald, programador e engenheiro de software. Desenvolvo sites personalizados para lojas de roupas que desejam divulgar seus produtos, valorizar a marca e vender mais pela internet. Posso te mostrar como funciona?',
  ],
  barbearia: [
    'Oi, {nome}, tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites profissionais e acredito que uma página apresentando os serviços, o estilo da barbearia e as formas de agendamento poderia valorizar ainda mais o trabalho de vocês. Se a ideia fizer sentido, posso te mostrar uma sugestão sem compromisso.',
    'Olá, {nome}! Meu nome é Ronald e trabalho com desenvolvimento de sites. Minha proposta para barbearias é criar um espaço onde o cliente possa conhecer os serviços, conferir os trabalhos realizados e solicitar um horário com facilidade. Caso tenha interesse, posso explicar melhor como funcionaria.',
    'Oi, {nome}, tudo certo? Sou Ronald, programador e engenheiro de software. Pensei que um site moderno poderia facilitar a experiência dos seus clientes, reunindo serviços, preços, localização e agendamento em um só lugar. Se você gostar da ideia, posso compartilhar algumas possibilidades.',
    'Olá, {nome}! Sou Ronald e desenvolvo sites personalizados. A ideia seria criar uma página que combine com a identidade da sua barbearia e apresente seu trabalho de maneira profissional, principalmente para quem está conhecendo o espaço agora. Se fizer sentido, posso preparar uma proposta.',
    'Oi, {nome}, tudo bem? Meu nome é Ronald, sou programador e engenheiro de software. Trabalho criando sites para negócios locais e pensei em uma página para sua barbearia, com fotos dos cortes, serviços e acesso ao agendamento. Caso tenha curiosidade, posso te mostrar como ficaria.',
  ],
  'pet shop': [
    'Oi, {nome}, tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites profissionais e acredito que uma página reunindo os serviços, produtos e formas de atendimento do pet shop poderia facilitar bastante o contato dos clientes. Se fizer sentido, posso te apresentar uma ideia.',
    'Olá, {nome}! Meu nome é Ronald e trabalho com criação de sites. Para pet shops, minha proposta é desenvolver uma página onde o cliente possa conhecer os serviços de banho e tosa, encontrar a localização e solicitar um horário pelo WhatsApp. Caso tenha interesse, posso explicar melhor.',
    'Oi, {nome}, tudo certo? Sou Ronald, programador e engenheiro de software. Um site bem organizado pode ajudar o pet shop a apresentar seus serviços com mais profissionalismo e transmitir confiança para novos clientes. Se você estiver considerando melhorar sua presença digital, posso compartilhar uma sugestão.',
    'Olá, {nome}! Sou Ronald e desenvolvo sites personalizados. Pensei em uma página que apresente os principais produtos e serviços do pet shop, além de facilitar pedidos de informações e agendamentos. Se gostar da ideia, posso te mostrar algumas possibilidades sem compromisso.',
    'Oi, {nome}, tudo bem? Meu nome é Ronald, sou programador e engenheiro de software. Trabalho criando sites para negócios que desejam ter uma presença digital mais completa. Para o seu pet shop, poderíamos reunir serviços, fotos, horários e atendimento pelo WhatsApp em um só lugar. Posso te contar melhor sobre a proposta?',
  ],
  academia: [
    'Oi, {nome}, tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites profissionais e pensei que uma página apresentando a estrutura, as modalidades e os planos da academia poderia ajudar novos alunos a conhecerem melhor o espaço. Se fizer sentido, posso te mostrar uma sugestão.',
    'Olá, {nome}! Meu nome é Ronald e trabalho com desenvolvimento de sites. Minha proposta para academias é criar um espaço digital onde as pessoas possam conhecer as atividades, consultar horários e solicitar uma aula experimental. Caso tenha interesse, posso explicar como funcionaria.',
    'Oi, {nome}, tudo certo? Sou Ronald, programador e engenheiro de software. Um site moderno pode ajudar a apresentar os diferenciais da academia e facilitar o primeiro contato de possíveis alunos. Se você estiver considerando algo assim, posso compartilhar algumas ideias sem compromisso.',
    'Olá, {nome}! Sou Ronald e desenvolvo sites personalizados. Pensei em uma página que reúna modalidades, horários, professores, planos e formas de contato, deixando as informações mais acessíveis para quem deseja começar a treinar. Se gostar da proposta, posso te mostrar algumas possibilidades.',
    'Oi, {nome}, tudo bem? Meu nome é Ronald, sou programador e engenheiro de software. Minha proposta seria criar um site que combine com a identidade da academia e apresente a experiência oferecida por vocês de maneira mais profissional. Caso tenha curiosidade, posso preparar uma sugestão inicial.',
  ],
  'clinica odontologica': [
    'Oi, {nome}, tudo bem? Sou Ronald, programador e engenheiro de software. Desenvolvo sites profissionais e acredito que uma página clara e bem organizada pode ajudar a clínica a apresentar seus tratamentos e transmitir mais confiança aos pacientes. Se fizer sentido, posso te mostrar uma sugestão.',
    'Olá, {nome}! Meu nome é Ronald e trabalho com criação de sites. Minha proposta para clínicas odontológicas é reunir informações sobre tratamentos, profissionais e formas de agendamento em um espaço moderno e fácil de acessar. Caso tenha interesse, posso explicar melhor como funcionaria.',
    'Oi, {nome}, tudo certo? Sou Ronald, programador e engenheiro de software. Pensei que um site poderia facilitar o primeiro contato dos pacientes, permitindo que conheçam a clínica e esclareçam as principais dúvidas antes do atendimento. Se você gostar da ideia, posso compartilhar algumas possibilidades.',
    'Olá, {nome}! Sou Ronald e desenvolvo sites personalizados. A proposta seria criar uma página profissional para apresentar a clínica, a equipe, os tratamentos e os canais de atendimento. Se estiver considerando melhorar sua presença digital, posso preparar uma sugestão sem compromisso.',
    'Oi, {nome}, tudo bem? Meu nome é Ronald, sou programador e engenheiro de software. Trabalho criando sites modernos e adaptados para celulares. Para sua clínica, poderíamos desenvolver uma página informativa com acesso simples ao agendamento pelo WhatsApp. Caso faça sentido, fico à disposição para te apresentar a ideia.',
  ],
};

// O arquivo abaixo pode substituir as copys de qualquer país pelo editor do
// painel. Se um mercado ficar sem nenhuma opção, seus contatos são pulados
// com segurança e não recebem uma mensagem no idioma errado.
function carregarCopysInternacionais() {
  try {
    const dados = JSON.parse(fs.readFileSync(caminho(ARQUIVO_COPYS_INTERNACIONAIS), 'utf-8'));
    const normalizadas = {};
    for (const [pais, configuracao] of Object.entries(dados || {})) {
      const categorias = {};
      for (const [categoria, opcoes] of Object.entries(configuracao?.porCategoria || {})) {
        categorias[normalizarTexto(categoria)] = Array.isArray(opcoes) ? opcoes : [];
      }
      normalizadas[normalizarTexto(pais)] = {
        genericas: Array.isArray(configuracao?.genericas) ? configuracao.genericas : [],
        porCategoria: categorias,
      };
    }
    return normalizadas;
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.warn(`Não foi possível ler ${ARQUIVO_COPYS_INTERNACIONAIS}: ${erro.message}`);
    }
    return {};
  }
}

let COPYS_POR_PAIS = {
  brasil: {
    genericas: MENSAGENS,
    porCategoria: MENSAGENS_POR_CATEGORIA,
  },
  portugal: {
    genericas: MENSAGENS,
    porCategoria: MENSAGENS_POR_CATEGORIA,
  },
  ...carregarCopysInternacionais(),
};

const DDI_POR_PAIS = {
  brasil: '55',
  portugal: '351',
  'estados unidos': '1',
  espanha: '34',
};

const IDIOMA_POR_PAIS = {
  brasil: 'pt-BR',
  portugal: 'pt-PT',
  'estados unidos': 'en-US',
  espanha: 'es-ES',
};

const INTERVALO_MIN_MS = 0; // sem pausa adicional: a espera ocorre antes do envio
const INTERVALO_MAX_MS = 0; // sem pausa adicional: a espera ocorre antes do envio

// Espera aleatória antes de mandar a PRIMEIRA mensagem para um contato novo
// (todo contato deste script é "novo", já que quem já recebeu é sempre
// pulado — ver ANTI-DUPLICAÇÃO). INTERVALO_MIN/MAX_MS fica zerado para
// não somar outra espera entre contatos.
let DELAY_CONTATO_NOVO_MIN_MS = CONFIGURACOES_OPERACAO.messages.delayMinSeconds * 1000;
let DELAY_CONTATO_NOVO_MAX_MS = CONFIGURACOES_OPERACAO.messages.delayMaxSeconds * 1000;

// Arquivo que guarda TODOS os números que já receberam alguma mensagem.
// É persistido em disco: mesmo rodando o script de novo (ou com uma
// planilha com números duplicados/repetidos), quem já recebeu não
// recebe de novo.
const ARQUIVO_ENVIADOS = 'numeros_enviados.json';

// Guarda envios cujo resultado ficou incerto (por exemplo, a conexão caiu
// depois que o WhatsApp recebeu a chamada, mas antes de confirmar). Esses
// números não são reenviados automaticamente, evitando mensagens duplicadas.
const ARQUIVO_ENVIOS_PENDENTES = 'envios_pendentes.json';

// Guarda o contato que estava sendo processado para retomar do mesmo ponto
// após reconexão, encerramento manual ou reinício do computador.
const ARQUIVO_PROGRESSO_ENVIOS = 'progresso_envios.json';
const ARQUIVO_ANDAMENTO_ENVIOS = 'andamento_envios.json';

// Arquivo que guarda os números que pediram para não receber mais mensagens
// (opt-out via resposta). Continua separado de ARQUIVO_ENVIADOS porque tem
// outro motivo: aqui é "não enviei ainda", lá é "pediram pra parar".
const ARQUIVO_BLOQUEADOS = 'bloqueados.json';

// Arquivo com o histórico de todas as respostas recebidas dos contatos.
const ARQUIVO_RESPOSTAS = 'respostas_recebidas.json';

// Arquivo com o histórico de respostas automáticas que O SCRIPT enviou
// de volta pro contato (ver CATEGORIAS_RESPOSTA_AUTOMATICA abaixo).
const ARQUIVO_RESPOSTAS_AUTOMATICAS = 'respostas_automaticas_enviadas.json';

// Categorias usadas para identificar o TIPO da resposta que um contato
// mandou, e reagir com uma resposta automática específica pra cada tipo.
// A primeira categoria identificada é usada. Por isso o opt-out vem antes da
// detecção de robôs: uma recusa explícita sempre tem prioridade.
const IDIOMAS_RESPOSTAS_AUTOMATICAS = ['pt-BR', 'pt-PT', 'en-US', 'es-ES'];

const CATEGORIAS_RESPOSTA_AUTOMATICA_PADRAO = [
  {
    nome: 'agradecimento',
    gatilhos: [
      'não quero', 'nao quero',
      'não tenho interesse', 'nao tenho interesse',
      'não temos interesse', 'nao temos interesse',
      'sem interesse',
      'não obrigado', 'nao obrigado',
      'não obrigada', 'nao obrigada',
      'valeu mas não', 'valeu mas nao',
      'agradeço mas não', 'agradeco mas nao',
      'obrigado mas não', 'obrigado mas nao',
      'por favor não entre em contato', 'por favor nao entre em contato',
      'não me contacte', 'nao me contacte',
      'não nos contacte', 'nao nos contacte',
      'não estamos buscando novas propostas', 'nao estamos buscando novas propostas',
      'não buscamos novas propostas', 'nao buscamos novas propostas',
      'já fechamos com', 'ja fechamos com', 'fechamos com',
      'não precisamos', 'nao precisamos',
      'not interested', 'no thank you', 'no thanks', 'please stop',
      'do not contact', "don't contact", 'we are not interested', 'i am not interested',
      'we already have someone', 'we already hired',
      'no me interesa', 'no nos interesa', 'no estamos interesados',
      'no gracias', 'por favor no contactes', 'no volváis a contactar',
      'no volvais a contactar', 'no queremos', 'ya tenemos a alguien',
    ],
    respostasPorIdioma: {
      'pt-BR': [
        'Entendido! Agradeço pelo retorno. Não entrarei mais em contato por aqui. Desejo sucesso ao negócio!',
        'Sem problema, obrigado por responder. Vou respeitar sua decisão e encerrar o contato. Tudo de bom para vocês!',
        'Certo, agradeço pela sinceridade. Seu número não receberá novas mensagens de prospecção. Sucesso!',
      ],
      'pt-PT': [
        'Compreendido! Obrigado pela resposta. Não voltarei a contactar por aqui. Desejo muito sucesso ao negócio!',
        'Sem problema, agradeço a resposta. Respeitarei a sua decisão e darei o contacto por encerrado. Tudo de bom!',
        'Está bem, obrigado pela sinceridade. Este número não receberá novas mensagens de prospeção. Muito sucesso!',
      ],
      'en-US': [
        "Understood. Thank you for letting me know. I won't contact you here again. Wishing your business every success!",
        "No problem, and thanks for replying. I'll respect your decision and close the conversation. All the best!",
        "Of course. I appreciate the clear response. This number won't receive any further outreach messages from me.",
      ],
      'es-ES': [
        'Entendido. Gracias por responder. No volveré a contactar por aquí. ¡Mucho éxito con el negocio!',
        'No hay problema, gracias por avisarme. Respetaré vuestra decisión y daré el contacto por finalizado. ¡Todo lo mejor!',
        'De acuerdo, agradezco la sinceridad. Este número no recibirá más mensajes de prospección por mi parte.',
      ],
    },
    bloquear: true,
  },
  {
    nome: 'bot-atendimento',
    detector: 'mensagem-automatica',
    respostasPorIdioma: {
      'pt-BR': [
        'Olá! Sou Ronald, programador e engenheiro de software. Gostaria de apresentar uma proposta para desenvolver um site profissional para o negócio. Você poderia encaminhar minha mensagem ao responsável ou informar o melhor canal para falar com essa pessoa?',
        'Oi! Meu nome é Ronald, sou programador e engenheiro de software. Tenho uma ideia de site para fortalecer a presença digital do negócio e gostaria de conversar com o responsável. Pode repassar meu contato ou pedir que ele me responda por aqui?',
        'Olá! Sou Ronald, programador e engenheiro de software. Quero apresentar ao responsável uma proposta de site pensada para divulgar os serviços e facilitar o contato dos clientes. Poderia direcionar esta mensagem a quem cuida dessa área?',
        'Oi! Ronald aqui, programador e engenheiro de software. Quero conversar com o responsável sobre a criação de um site para o negócio, sem compromisso. É possível encaminhar minha mensagem ou me indicar com quem devo falar?',
        'Olá! Meu nome é Ronald, sou programador e engenheiro de software. Estou entrando em contato para apresentar uma possibilidade de site profissional para o negócio. Quando alguém da equipe estiver disponível, pode encaminhar esta mensagem ao responsável e pedir que fale comigo por aqui?',
      ],
      'pt-PT': [
        'Olá! Sou o Ronald, programador e engenheiro de software. Gostaria de apresentar uma proposta para desenvolver um website profissional para o negócio. Poderia encaminhar a minha mensagem ao responsável ou indicar-me o canal mais adequado para falar com essa pessoa?',
        'Olá! O meu nome é Ronald, sou programador e engenheiro de software. Tenho uma ideia de website para reforçar a presença digital do negócio e gostaria de falar com o responsável. Pode encaminhar o meu contacto ou pedir que me responda por aqui?',
        'Olá! Sou o Ronald, programador e engenheiro de software. Quero apresentar ao responsável uma proposta de website pensada para divulgar os serviços e facilitar o contacto com os clientes. Poderia encaminhar esta mensagem a quem trata desta área?',
        'Olá! Ronald aqui, programador e engenheiro de software. Gostaria de falar com o responsável sobre a criação de um website para o negócio, sem compromisso. É possível encaminhar a minha mensagem ou indicar-me com quem devo falar?',
        'Olá! O meu nome é Ronald, sou programador e engenheiro de software. Estou a contactar para apresentar uma possibilidade de website profissional para o negócio. Quando alguém da equipa estiver disponível, pode encaminhar esta mensagem ao responsável e pedir que fale comigo por aqui?',
      ],
      'en-US': [
        "Hi! I'm Ronald, a software developer and engineer. I'd like to present a proposal to build a professional website for the business. Could you forward my message to the person in charge or let me know the best way to reach them?",
        "Hello! My name is Ronald, and I'm a software developer and engineer. I have a website idea to strengthen the business's online presence and would like to speak with the person in charge. Could you forward my contact or ask them to reply to me here?",
        "Hi! I'm Ronald, a software developer and engineer. I'd like to present the person in charge with a website proposal designed to showcase the services and make it easier for customers to get in touch. Could you direct this message to whoever handles this area?",
        "Hello! Ronald here, software developer and engineer. I'd like to speak with the person in charge about creating a website for the business, with no obligation. Could you forward my message or tell me who I should contact?",
        "Hi! My name is Ronald, and I'm a software developer and engineer. I'm reaching out to present the possibility of a professional website for the business. When someone from the team is available, could you forward this message to the person in charge and ask them to contact me here?",
      ],
      'es-ES': [
        '¡Hola! Soy Ronald, programador e ingeniero de software. Me gustaría presentar una propuesta para desarrollar una página web profesional para el negocio. ¿Podríais reenviar mi mensaje al responsable o indicarme el mejor canal para hablar con esa persona?',
        '¡Hola! Me llamo Ronald, soy programador e ingeniero de software. Tengo una idea de página web para reforzar la presencia digital del negocio y me gustaría hablar con el responsable. ¿Podríais reenviar mi contacto o pedirle que me responda por aquí?',
        '¡Hola! Soy Ronald, programador e ingeniero de software. Quiero presentar al responsable una propuesta de página web pensada para mostrar los servicios y facilitar el contacto de los clientes. ¿Podríais dirigir este mensaje a quien se ocupa de esta área?',
        '¡Hola! Soy Ronald, programador e ingeniero de software. Me gustaría hablar con el responsable sobre la creación de una página web para el negocio, sin compromiso. ¿Podríais reenviar mi mensaje o indicarme con quién debo hablar?',
        '¡Hola! Me llamo Ronald, soy programador e ingeniero de software. Me pongo en contacto para presentar la posibilidad de crear una página web profesional para el negocio. Cuando alguien del equipo esté disponible, ¿podríais reenviar este mensaje al responsable y pedirle que hable conmigo por aquí?',
      ],
    },
    bloquear: false,
  },
];

function carregarCopysRespostasAutomaticas(categoriasPadrao) {
  const individual=fs.existsSync(caminho('.ploa-account.json'));
  const empty=()=>categoriasPadrao.map(categoria=>({...categoria,respostasPorIdioma:Object.fromEntries(IDIOMAS_RESPOSTAS_AUTOMATICAS.map(idioma=>[idioma,[]]))}));
  try {
    const dados = JSON.parse(fs.readFileSync(caminho(ARQUIVO_COPYS_RESPOSTAS_AUTOMATICAS), 'utf-8'));
    const configuradas = dados?.categorias;
    if (!configuradas || typeof configuradas !== 'object' || Array.isArray(configuradas)) {
      throw new Error('o campo "categorias" não é um objeto válido');
    }

    return categoriasPadrao.map((categoria) => {
      const porIdioma = configuradas[categoria.nome]?.porIdioma;
      if (!porIdioma || typeof porIdioma !== 'object' || Array.isArray(porIdioma)) return individual?empty().find(item=>item.nome===categoria.nome):categoria;

      const respostasPorIdioma = Object.fromEntries(IDIOMAS_RESPOSTAS_AUTOMATICAS.map((idioma) => {
        const opcoes = Array.isArray(porIdioma[idioma])
          ? porIdioma[idioma].map((texto) => String(texto || '').trim()).filter(Boolean)
          : [];
        return [idioma, opcoes.length > 0||individual ? opcoes : categoria.respostasPorIdioma[idioma]];
      }));

      return { ...categoria, respostasPorIdioma };
    });
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.warn(`Não foi possível ler ${ARQUIVO_COPYS_RESPOSTAS_AUTOMATICAS}: ${erro.message}`);
    }
    return individual?empty():categoriasPadrao;
  }
}

let CATEGORIAS_RESPOSTA_AUTOMATICA = carregarCopysRespostasAutomaticas(
  CATEGORIAS_RESPOSTA_AUTOMATICA_PADRAO,
);

// Limite de mensagens ENVIADAS COM SUCESSO por dia. Ao atingir o limite,
// o script para e você roda de novo amanhã — ele retoma sozinho de onde
// parou (números já enviados são pulados). Use 0 ou null para não ter limite.
let LIMITE_DIARIO_ENVIOS = CONFIGURACOES_OPERACAO.messages.dailyLimit;
function recarregarConfiguracoesPloa(){
  CONFIGURACOES_OPERACAO=carregarConfiguracoesOperacao();
  DELAY_CONTATO_NOVO_MIN_MS=CONFIGURACOES_OPERACAO.messages.delayMinSeconds*1000;
  DELAY_CONTATO_NOVO_MAX_MS=CONFIGURACOES_OPERACAO.messages.delayMaxSeconds*1000;
  LIMITE_DIARIO_ENVIOS=CONFIGURACOES_OPERACAO.messages.dailyLimit;
  COPYS_POR_PAIS={brasil:{genericas:MENSAGENS,porCategoria:MENSAGENS_POR_CATEGORIA},portugal:{genericas:MENSAGENS,porCategoria:MENSAGENS_POR_CATEGORIA},...carregarCopysInternacionais()};
  CATEGORIAS_RESPOSTA_AUTOMATICA=carregarCopysRespostasAutomaticas(CATEGORIAS_RESPOSTA_AUTOMATICA_PADRAO);
}
const ARQUIVO_CONTADOR_DIARIO = 'contador_diario.json';

// Repetição automática (retry) só para operações seguras de repetir, como a
// verificação do número. Espera com backoff exponencial entre tentativas:
// 3s, 9s, 27s (para MAX_TENTATIVAS_ENVIO = 3).
const MAX_TENTATIVAS_ENVIO = 3;
const BACKOFF_BASE_MS = 3000;

// "Disjuntor": quando várias mensagens SEGUIDAS falham mesmo depois do
// retry acima, o problema quase sempre não é o contato — é a conexão
// (WhatsApp Web caiu, internet oscilando, etc.). Nesse caso, em vez de
// marcar cada contato como erro e seguir perdendo lead atrás de lead, o
// script PAUSA por um tempo maior e depois tenta DE NOVO o mesmo contato
// (não pula pro próximo, não marca como falho).
const MAX_FALHAS_CONSECUTIVAS = 3;
const PAUSA_DISJUNTOR_MS = 30000; // 30 segundos
const MAX_ACIONAMENTOS_DISJUNTOR = 3; // depois disso, reinicia a conexão

// PREPARADO PARA USO FUTURO: caminho de um arquivo de mídia (imagem, PDF,
// áudio) para anexar em toda mensagem enviada. Deixe null para não anexar
// nada (comportamento atual). Quando quiser ativar, é só apontar pra um
// arquivo, ex: './catalogo.pdf' ou './promocao.jpg'.
const CAMINHO_MIDIA_PADRAO = null;

// Arquivo que guarda um registro por contato único — base de dados que o
// futuro dashboard vai consumir (leads frio/quente/comprou, contagem de
// mensagens enviadas/respostas recebidas, datas de contato, etc.). É
// atualizado a cada envio e a cada resposta recebida, em tempo real.
const ARQUIVO_LEADS = 'leads.json';
// Liga os identificadores privados @lid do WhatsApp ao número usado na
// prospecção. O painel CRM usa este mapa para não duplicar o mesmo contato.
const ARQUIVO_MAPEAMENTO_CONTATOS = 'mapeamento_contatos.json';
// ==============================

function delayAleatorio() {
  const ms = Math.floor(Math.random() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS + 1)) + INTERVALO_MIN_MS;
  atualizarAndamentoEnvios({ proximoEnvioEm: new Date(Date.now()+ms).toISOString(), esperaTipo:'intervalo' });
  return new Promise(resolve => setTimeout(resolve, ms)).then(()=>atualizarAndamentoEnvios({proximoEnvioEm:null}));
}

// Sorteia uma copy do país e da categoria do contato. Um mercado sem copy
// retorna null para que o loop pule o contato sem usar o idioma errado.
function mensagemAleatoria(contato = {}) {
  const chavePais = normalizarTexto(require('./crm/lib/outreach-scope').countryOf(contato));
  const chaveCategoria = normalizarTexto(contato.categoria || '');
  const copysDoPais = COPYS_POR_PAIS[chavePais];
  if (!copysDoPais) return null;

  const mensagensDaCategoria = copysDoPais.porCategoria[chaveCategoria];
  const opcoes = Array.isArray(mensagensDaCategoria) && mensagensDaCategoria.length > 0
    ? mensagensDaCategoria
    : copysDoPais.genericas;
  if (!Array.isArray(opcoes) || opcoes.length === 0) return null;
  const indice = Math.floor(Math.random() * opcoes.length);
  contato.ploaCopyId = require('node:crypto').createHash('sha256')
    .update(chavePais + '|' + chaveCategoria + '|' + opcoes[indice]).digest('hex');
  contato.ploaCopyPreview = opcoes[indice];
  return opcoes[indice]
    .replaceAll('{nome}', contato.nome || '')
    .replaceAll('{categoria}', contato.categoria || '');
}

// Mantém uma fila de índices ainda não usados para cada categoria. Assim o
// sorteio continua aleatório, mas uma variação só volta a aparecer depois que
// todas as outras também tiverem sido escolhidas nesta execução.
const FILAS_RESPOSTAS_AUTOMATICAS = new Map();

function opcoesDeRespostaAutomatica(categoria, idioma = 'pt-BR') {
  if (categoria.respostasPorIdioma) {
    const localizadas = categoria.respostasPorIdioma[idioma]
      || categoria.respostasPorIdioma['pt-BR'];
    return (Array.isArray(localizadas) ? localizadas : [localizadas])
      .map(texto => String(texto || '').trim())
      .filter(Boolean);
  }

  const configuradas = Array.isArray(categoria.respostas)
    ? categoria.respostas
    : [categoria.resposta];

  return configuradas
    .map(texto => String(texto || '').trim())
    .filter(Boolean);
}

function validarCategoriasRespostasAutomaticas(categorias,{allowEmpty=false}={}) {
  for (const categoria of categorias) {
    const idiomas = categoria.respostasPorIdioma
      ? IDIOMAS_RESPOSTAS_AUTOMATICAS
      : ['pt-BR'];

    for (const idioma of idiomas) {
      const opcoes = opcoesDeRespostaAutomatica(categoria, idioma);
      if (opcoes.length === 0) {
        if(allowEmpty)continue;
        throw new Error(`A categoria de resposta automática "${categoria.nome}" não possui resposta em ${idioma}.`);
      }

      if (new Set(opcoes).size !== opcoes.length) {
        throw new Error(`A categoria de resposta automática "${categoria.nome}" possui mensagens duplicadas em ${idioma}.`);
      }
    }
  }
}

function sortearRespostaAutomatica(categoria, variaveis = {}, idioma = 'pt-BR', random = Math.random) {
  // Mantém compatibilidade com chamadas/testes antigos cujo terceiro argumento
  // era diretamente a função aleatória.
  if (typeof idioma === 'function') {
    random = idioma;
    idioma = 'pt-BR';
  }

  const opcoes = opcoesDeRespostaAutomatica(categoria, idioma);
  if(!opcoes.length)return null;
  const assinatura = JSON.stringify(opcoes);
  const chaveFila = `${categoria.nome}|${idioma}`;
  let fila = FILAS_RESPOSTAS_AUTOMATICAS.get(chaveFila);

  if (!fila || fila.assinatura !== assinatura || fila.indices.length === 0) {
    fila = {
      assinatura,
      indices: opcoes.map((_, indice) => indice),
    };
    FILAS_RESPOSTAS_AUTOMATICAS.set(chaveFila, fila);
  }

  const posicaoSorteada = Math.floor(random() * fila.indices.length);
  const [indiceSorteado] = fila.indices.splice(posicaoSorteada, 1);

  return Object.entries(variaveis).reduce(
    (texto, [chave, valor]) => texto.replaceAll(`{${chave}}`, String(valor || '')),
    opcoes[indiceSorteado]
  );
}

validarCategoriasRespostasAutomaticas(CATEGORIAS_RESPOSTA_AUTOMATICA,{allowEmpty:fs.existsSync(caminho('.ploa-account.json'))});

// Separa uma célula que pode ter mais de um telefone (";", "," ou "/").
const {extrairNumerosDaCelula,limparNumero,detectarColunaTelefonePorConteudo}=require('./crm/lib/contact-phone');

// Lê a lista de contatos, aceitando .csv ou .xlsx/.xls (detecta pela extensão)
function carregarContatos() {
  const extensao = path.extname(ARQUIVO_CONTATOS).toLowerCase();

  if (extensao === '.xlsx' || extensao === '.xls') {
    const planilha = XLSX.readFile(caminho(ARQUIVO_CONTATOS));
    const nomeAba = NOME_ABA_CONTATOS || planilha.SheetNames[0];
    const aba = planilha.Sheets[nomeAba];
    if (!aba) {
      throw new Error(`Aba "${nomeAba}" não encontrada. Abas disponíveis: ${planilha.SheetNames.join(', ')}`);
    }
    // defval garante que células vazias virem string vazia, não undefined
    const linhasCruas = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });

    // 1ª passada: normaliza os nomes de coluna (minúsculo, sem espaço nas pontas)
    const linhasNormalizadas = linhasCruas.map(linha => {
      const chaves = {};
      for (const chave of Object.keys(linha)) {
        chaves[chave.trim().toLowerCase()] = linha[chave];
      }
      return chaves;
    });

    // 2ª passada: decide qual chave usar como telefone
    const temColunaNomeada = linhasNormalizadas.some(l => l['numero'] || l['telefone']);
    let chaveTelefone = null;
    if (temColunaNomeada) {
      chaveTelefone = linhasNormalizadas.some(l => l['numero']) ? 'numero' : 'telefone';
    } else {
      chaveTelefone = detectarColunaTelefonePorConteudo(linhasNormalizadas);
      if (chaveTelefone) {
        console.log(`Aviso: não encontrei coluna chamada "numero"/"telefone" na aba "${nomeAba}" — detectei automaticamente pelo conteúdo (coluna "${chaveTelefone}"). Confira se o resultado bateu certo.`);
      }
    }

    if (!chaveTelefone) {
      throw new Error(`Não consegui identificar a coluna de telefone na aba "${nomeAba}". Verifique se existe uma coluna "numero" ou "telefone" com cabeçalho preenchido.`);
    }

    // 3ª passada: monta os contatos usando a coluna identificada
    const contatos = [];
    const invalidos = [];

    for (const chaves of linhasNormalizadas) {
      const nome = String(chaves['nome'] || '').trim();
      const categoria = String(chaves['categoria'] || '').trim();
      const pais = String(chaves['país'] || chaves['pais'] || 'Brasil').trim();
      const ddi = String(chaves['ddi'] || DDI_POR_PAIS[normalizarTexto(pais)] || '').trim();
      const idioma = String(chaves['idioma'] || IDIOMA_POR_PAIS[normalizarTexto(pais)] || '').trim();
      const celulaTelefone = String(chaves[chaveTelefone] || '').trim();
      if (!celulaTelefone) continue;

      const brutos = extrairNumerosDaCelula(celulaTelefone);
      const candidatos = USAR_APENAS_PRIMEIRO_NUMERO ? brutos.slice(0, 1) : brutos;

      for (const bruto of candidatos) {
        const resultado = limparNumero(bruto, ddi);
        if (resultado.valido) {
          contatos.push({ numero: resultado.numero, nome, categoria, pais, ddi, idioma });
        } else {
          invalidos.push({ nome, pais, valorOriginal: bruto, motivo: resultado.motivo });
        }
      }
    }

    if (invalidos.length > 0) {
      salvarJsonAtomico(ARQUIVO_NUMEROS_INVALIDOS, invalidos);
      console.log(`Aviso: ${invalidos.length} número(s) em formato inesperado foram pulados (revise em ${ARQUIVO_NUMEROS_INVALIDOS}).`);
    }

    return contatos;
  }

  // CSV (comportamento original)
  const conteudo = fs.readFileSync(caminho(ARQUIVO_CONTATOS), 'utf-8');
  return parse(conteudo, { columns: true, skip_empty_lines: true, trim: true });
}

// Carrega a lista de números bloqueados (opt-out) do disco, se existir.
function carregarBloqueados() {
  return new Set(lerJsonSeguro(ARQUIVO_BLOQUEADOS, [], Array.isArray));
}

// Salva a lista de bloqueados no disco.
function salvarBloqueados(bloqueados) {
  salvarJsonAtomico(ARQUIVO_BLOQUEADOS, [...bloqueados]);
}

// Carrega a lista de números que já receberam mensagem, do disco.
function carregarEnviados() {
  return new Set(lerJsonSeguro(ARQUIVO_ENVIADOS, [], Array.isArray));
}

// Salva a lista de números já enviados no disco.
function salvarEnviados(enviados) {
  salvarJsonAtomico(ARQUIVO_ENVIADOS, [...enviados]);
}

function carregarEnviosPendentes() {
  return lerJsonSeguro(
    ARQUIVO_ENVIOS_PENDENTES,
    {},
    registros => registros && typeof registros === 'object' && !Array.isArray(registros),
  );
}

function salvarEnviosPendentes(enviosPendentes) {
  salvarJsonAtomico(ARQUIVO_ENVIOS_PENDENTES, enviosPendentes);
}

function ehErroNoLid(erro) {
  return String(erro?.message || erro || '').includes('No LID for user');
}

function criarRegistroNoLidNaoRepetivel({ numero, nome = '', categoria = '', mensagem = '', erro, origem = '', anterior = {} }) {
  const registro = {
    ...anterior,
    numero,
    nome,
    categoria,
    mensagem,
    erro: String(erro?.message || erro || 'No LID for user'),
    atualizadoEm: new Date().toISOString(),
    naoRepetirAutomaticamente: true,
  };

  if (origem) registro.origem = origem;
  return registro;
}

// Versões anteriores liberavam estas falhas para uma execução futura. Ao
// atualizar o script, preserva também as ocorrências do último log para que
// elas não voltem à fila automática.
function preservarFalhasNoLidDoUltimoLog() {
  const registros = lerJsonSeguro('log_envios.json', [], Array.isArray, { critico: false });
  let preservados = 0;

  for (const registro of registros) {
    const numero = String(registro?.numero || '').replace(/\D/g, '');
    const status = String(registro?.status || '');
    const falhaNoLid = ehErroNoLid(status) || status.includes('falha de resolução LID');

    if (!numero || !falhaNoLid || enviados.has(numero) || enviosPendentes[numero]) continue;

    enviosPendentes[numero] = criarRegistroNoLidNaoRepetivel({
      numero,
      nome: registro?.nome || '',
      mensagem: registro?.mensagem || '',
      erro: status,
      origem: 'log_envios.json',
    });
    preservados += 1;
  }

  if (preservados > 0) {
    salvarEnviosPendentes(enviosPendentes);
    console.log(`${preservados} falha(s) No LID anterior(es) foram mantidas fora da fila automática.`);
  }
}

function encontrarIndiceDoNumero(contatos, numero) {
  const numeroNormalizado = String(numero || '').replace(/\D/g, '');
  if (!numeroNormalizado) return -1;
  return contatos.findIndex(contato =>
    String(contato.numero || '').replace(/\D/g, '') === numeroNormalizado
  );
}

function carregarIndiceDeRetomada(contatos, escopo) {
  try {
    const progresso = lerJsonSeguro(
      escopo.progressFile,
      null,
      dados => dados === null || (typeof dados === 'object' && !Array.isArray(dados)),
      { critico: false },
    );
    if (!progresso) throw new Error('Ainda não existe progresso salvo.');
    return require('./crm/lib/outreach-scope').resumeIndex(contatos, progresso, escopo, ARQUIVO_CONTATOS);
  } catch {
    // Ainda não existe progresso salvo; tenta recuperar pelo último log abaixo.
  }

  if (escopo.key !== 'all') return 0;
  try {
    const registros = lerJsonSeguro('log_envios.json', [], Array.isArray, { critico: false });
    const ultimoRegistro = Array.isArray(registros) ? registros.at(-1) : null;
    const foiInterrompidoPorConexao = String(ultimoRegistro?.status || '')
      .startsWith('erro de conexão antes da reinicialização:');

    if (foiInterrompidoPorConexao && (!ultimoRegistro.audience || ultimoRegistro.audience.key === 'all')) {
      const indiceDoNumero = encontrarIndiceDoNumero(contatos, ultimoRegistro.numero);
      if (indiceDoNumero >= 0) return indiceDoNumero;
    }
  } catch {
    // Sem um log de interrupção válido, começa normalmente pelo início.
  }

  return 0;
}

function salvarProgressoEnvios(indice, contatos, escopo) {
  const contato = contatos[indice];
  if (!contato) return;

  salvarJsonAtomico(escopo.progressFile, {
    audience: { key: escopo.key, targetCountry: escopo.targetCountry, label: escopo.label },
    arquivoContatos: ARQUIVO_CONTATOS,
    indice,
    numero: String(contato.numero || '').replace(/\D/g, ''),
    totalContatos: contatos.length,
    atualizadoEm: new Date().toISOString(),
  });
}

let andamentoExecucaoEnvios = null;
let resultadosExecucao = createOutreachResults();
let logResultadosAtual = [], cursorResultados = 0;
const gravarAndamentoDoPainel = createProgressWriter({
  save: dados => salvarJsonAtomico(ARQUIVO_ANDAMENTO_ENVIOS, dados),
  warn: erro => console.warn('Ploa: não foi possível atualizar o andamento visual. A fila mantém as travas de enviados e limite diário:', erro.message),
});

function salvarAndamentoEnvios() {
  if (!andamentoExecucaoEnvios) return;
  for(;cursorResultados<logResultadosAtual.length;cursorResultados++)resultadosExecucao.record(logResultadosAtual[cursorResultados]);
  andamentoExecucaoEnvios.resultados = resultadosExecucao.snapshot();
  andamentoExecucaoEnvios.atualizadoEm = new Date().toISOString();
  gravarAndamentoDoPainel(andamentoExecucaoEnvios);
}

function iniciarAndamentoEnvios(contatos, indiceInicial, contadorDiario, escopo) {
  const candidatos = contatos.slice(indiceInicial).filter((contato) => {
    const numero = String(contato.numero || '').replace(/\D/g, '');
    return numero
      && !enviados.has(numero)
      && !enviosPendentes[numero]
      && !bloqueados.has(numero)
      && Boolean(mensagemAleatoria(contato));
  }).length;
  const limiteRestante = LIMITE_DIARIO_ENVIOS
    ? Math.max(0, LIMITE_DIARIO_ENVIOS - contadorDiario.enviados)
    : candidatos;

  andamentoExecucaoEnvios = {
    audience: { key: escopo.key, targetCountry: escopo.targetCountry, label: escopo.label },
    id: `${process.pid}-${Date.now()}`,
    status: 'em_execucao',
    iniciadaEm: new Date().toISOString(),
    indiceInicial,
    indiceAtual: indiceInicial,
    processados: 0,
    totalContatos: contatos.length,
    metaMensagens: Math.min(candidatos, limiteRestante),
    enviadas: 0,
    faltantes: Math.min(candidatos, limiteRestante),
    contatoAtual: '',
    proximoEnvioEm: null,
  };
  salvarAndamentoEnvios();
}

function atualizarAndamentoEnvios(atualizacao = {}) {
  if (!andamentoExecucaoEnvios) return;
  Object.assign(andamentoExecucaoEnvios, atualizacao);
  if(atualizacao.status&&!['em_execucao','pausada'].includes(atualizacao.status))andamentoExecucaoEnvios.proximoEnvioEm=null;
  andamentoExecucaoEnvios.faltantes = Math.max(
    0,
    andamentoExecucaoEnvios.listaPercorrida?0:andamentoExecucaoEnvios.metaMensagens - andamentoExecucaoEnvios.enviadas,
  );
  salvarAndamentoEnvios();
}

function limparProgressoEnvios(escopo) {
  try {
    fs.unlinkSync(caminho(escopo.progressFile));
  } catch {
    // O arquivo ainda não existe ou já foi removido.
  }
}

// Remove contatos com número duplicado dentro da própria planilha/csv,
// mantendo apenas a primeira ocorrência de cada número.
function removerDuplicados(contatos) {
  const vistos = new Set();
  return contatos.filter((contato) => {
    const numero = contato.numero.replace(/\D/g, '');
    if (vistos.has(numero)) return false;
    vistos.add(numero);
    return true;
  });
}

function idEstavelDaMensagem(msg) {
  return String(msg.id?._serialized || `${msg.from}|${msg.timestamp}|${msg.body || ''}`);
}

function carregarIdsRespostasRegistradas() {
  const respostas = lerJsonSeguro(
    ARQUIVO_RESPOSTAS,
    [],
    Array.isArray,
    { critico: false },
  );
  return new Set(
    respostas
      .map(resposta => resposta.mensagemId)
      .filter(Boolean)
  );
}

function chaveRespostaAutomaticaUnica(categoria, numero) {
  return `${categoria}|${String(numero || '').replace(/\D/g, '')}`;
}

function reservarRespostaAutomatica(reservas, chaveOuChaves) {
  const chaves = [...new Set(
    (Array.isArray(chaveOuChaves) ? chaveOuChaves : [chaveOuChaves]).filter(Boolean)
  )];
  if (chaves.some(chave => reservas.has(chave))) return false;
  for (const chave of chaves) reservas.add(chave);
  return true;
}

function carregarRespostasAutomaticasUnicas() {
  const registros = lerJsonSeguro(
    ARQUIVO_RESPOSTAS_AUTOMATICAS,
    [],
    Array.isArray,
  );
  return new Set(
    registros
      // O nome antigo "opt-out" era usado para mensagens de bot. A
      // equivalência evita responder novamente aos contatos já atendidos.
      .map(registro => ({
        ...registro,
        categoria: registro.categoria === 'opt-out'
          ? 'bot-atendimento'
          : registro.categoria,
      }))
      .map(registro => chaveRespostaAutomaticaUnica(registro.categoria, registro.numero))
      .filter(chave => !chave.endsWith('|'))
  );
}

// Adiciona uma resposta recebida ao histórico em disco.
function registrarResposta({ numero, texto, mensagemId }) {
  const respostas = lerJsonSeguro(
    ARQUIVO_RESPOSTAS,
    [],
    Array.isArray,
    { critico: false },
  );
  respostas.push({ numero, texto, mensagemId, data: new Date().toISOString() });
  salvarJsonAtomico(ARQUIVO_RESPOSTAS, respostas);
}

// Registra no disco uma resposta automática que O SCRIPT mandou pro contato.
function registrarRespostaAutomatica({ numero, categoria, texto, mensagemId }) {
  const registros = lerJsonSeguro(
    ARQUIVO_RESPOSTAS_AUTOMATICAS,
    [],
    Array.isArray,
  );
  registros.push({ numero, categoria, texto, mensagemId, data: new Date().toISOString() });
  salvarJsonAtomico(ARQUIVO_RESPOSTAS_AUTOMATICAS, registros);
}

// Remove acentos e caixa alta/baixa para comparar texto de forma tolerante.
function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const {pareceMensagemAutomaticaDeBot}=require('./crm/lib/bot-detector');
const {idiomaRespostaAutomatica}=require('./crm/lib/automatic-reply-language');

function idiomaDaRespostaAutomatica(numero, texto = '') {
  return idiomaRespostaAutomatica(texto, numero);
}

// Verifica o texto de uma resposta contra CATEGORIAS_RESPOSTA_AUTOMATICA e
// retorna a primeira categoria que der match (ou null se nenhuma bater).
function identificarCategoriaDaResposta(texto) {
  const normalizado = normalizarTexto(texto);
  return CATEGORIAS_RESPOSTA_AUTOMATICA.find(categoria => {
    if (categoria.detector === 'mensagem-automatica') {
      return pareceMensagemAutomaticaDeBot(texto);
    }

    return (categoria.gatilhos || []).some(gatilho =>
      normalizado.includes(normalizarTexto(gatilho))
    );
  }) || null;
}

// --- Limite diário (#1) ---------------------------------------------------

function dataDeHoje() {
  // Usa a data LOCAL da máquina, não UTC — com UTC, o "dia" viraria umas
  // 3 horas mais cedo no horário de Brasília, resetando o contador na
  // hora errada.
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`; // 'YYYY-MM-DD'
}

// Carrega o contador de envios do dia. Se o arquivo for de outro dia,
// reinicia zerado automaticamente.
function lerContadorDiarioPersistido() {
  return lerJsonSeguro(ARQUIVO_CONTADOR_DIARIO,
    { data: dataDeHoje(), enviados: 0 }, validCounter);
}
function salvarContadorDiario(contador) {
  salvarJsonAtomico(ARQUIVO_CONTADOR_DIARIO, contador);
}
const diarioEnvios = createDailySendLedger({ root: PASTA_DO_SCRIPT, fs, day: dataDeHoje,
  readCounter: lerContadorDiarioPersistido, saveCounter: salvarContadorDiario,
  onSaved: nome => persistenciaJson.resolve(nome) });
function carregarContadorDiario() {
  return diarioEnvios.recover();
}

// --- Retry com backoff exponencial (#4) -----------------------------------

// Executa operações que são seguras de repetir (como verificar um número) e
// tenta de novo com espera crescente se houver uma falha passageira.
async function comRetry(operacao, contexto) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_ENVIO; tentativa++) {
    try {
      return await operacao();
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa < MAX_TENTATIVAS_ENVIO) {
        const espera = BACKOFF_BASE_MS * Math.pow(3, tentativa - 1); // 3s, 9s, 27s...
        console.log(`  [${contexto}] tentativa ${tentativa}/${MAX_TENTATIVAS_ENVIO} falhou (${erro.message}). Tentando de novo em ${Math.round(espera / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, espera));
      }
    }
  }
  throw ultimoErro; // esgotou as tentativas, propaga o erro pra ser tratado no loop principal
}

// Envio não é repetido automaticamente: uma falha pode acontecer depois de
// o WhatsApp já ter recebido a mensagem, e repetir aqui causaria duplicidade.
function enviarUmaVez(chatId, texto, midia, cliente = client, onReceipt) {
  return confirmacaoEnvios.send(() => pontePloa.trackSend(chatId, texto, () => midia
    ? cliente.sendMessage(chatId, midia, { caption: texto, waitUntilMsgSent: true })
    : cliente.sendMessage(chatId, texto, { waitUntilMsgSent: true })), { onReceipt });
}

// Contatos novos podem existir no WhatsApp, mas ainda não ter o vínculo
// telefone (PN) <-> identificador privado (LID) sincronizado nesta sessão.
// A primeira tentativa falha antes do envio; sincronizamos somente nesse caso
// e repetimos com o mesmo número e, se necessário, com o LID retornado.
async function enviarComRecuperacaoNoLid(chatId, texto, midia, cliente = client, onReceipt) {
  try {
    return await enviarUmaVez(chatId, texto, midia, cliente, onReceipt);
  } catch (erroInicial) {
    if (!ehErroNoLid(erroInicial)) throw erroInicial;

    let vinculo;
    try {
      [vinculo] = await cliente.getContactLidAndPhone([chatId]);
    } catch (erroResolucao) {
      const erro = new Error(
        `Falha ao sincronizar o LID antes do envio: ${erroResolucao?.message || erroResolucao}`,
      );
      erro.envioNaoRealizado = true;
      throw erro;
    }

    const destinos = [chatId, vinculo?.lid]
      .filter((destino, indice, todos) => destino && todos.indexOf(destino) === indice);
    let ultimoErro = erroInicial;

    for (const destino of destinos) {
      try {
        console.log(`  [resolução LID] vínculo sincronizado; tentando enviar por ${destino}.`);
        return await enviarUmaVez(destino, texto, midia, cliente, onReceipt);
      } catch (erro) {
        if (!ehErroNoLid(erro)) throw erro;
        ultimoErro = erro;
      }
    }

    const erroFinal = ultimoErro instanceof Error
      ? ultimoErro
      : new Error(String(ultimoErro));
    erroFinal.envioNaoRealizado = true;
    throw erroFinal;
  }
}

// --- Leads / groundwork para o futuro dashboard (#6) ----------------------

function carregarLeads() {
  return lerJsonSeguro(
    ARQUIVO_LEADS,
    {},
    dados => dados && typeof dados === 'object' && !Array.isArray(dados),
    { critico: false },
  );
}

function salvarLeads(leads) {
  salvarJsonAtomico(ARQUIVO_LEADS, leads);
}

function carregarMapeamentoContatos() {
  return lerJsonSeguro(
    ARQUIVO_MAPEAMENTO_CONTATOS,
    {},
    dados => dados && typeof dados === 'object' && !Array.isArray(dados),
    { critico: false },
  );
}

function salvarMapeamentoContatos(mapeamento) {
  salvarJsonAtomico(ARQUIVO_MAPEAMENTO_CONTATOS, mapeamento);
}

// Desde a adoção dos IDs privados (LID), uma resposta pode chegar como
// 123...@lid enquanto o envio foi salvo como 55...@c.us. A biblioteca já
// oferece a resolução oficial entre os dois identificadores; persistimos essa
// ligação para o CRM também conseguir unir o histórico anterior do contato.
async function resolverIdentidadeContato(msg) {
  const identificadorOriginal = String(msg.from || '');
  let numero = identificadorOriginal.replace(/@c\.us$/, '');
  let nome = '';

  try {
    const contato = await msg.getContact();
    nome = contato?.name || contato?.verifiedName || contato?.pushname || '';
  } catch (erro) {
    console.warn('Não foi possível obter o nome exibido do contato:', erro.message);
  }

  try {
    const [vinculo] = await client.getContactLidAndPhone([identificadorOriginal]);
    const numeroResolvido = String(vinculo?.pn || '').replace(/@c\.us$/, '');
    const lid = vinculo?.lid || (identificadorOriginal.endsWith('@lid') ? identificadorOriginal : '');

    if (numeroResolvido) numero = numeroResolvido;

    if (lid && numeroResolvido) {
      const mapeamento = carregarMapeamentoContatos();
      const atual = mapeamento[lid] || {};
      if (atual.numero !== numeroResolvido || (nome && atual.nome !== nome)) {
        mapeamento[lid] = {
          numero: numeroResolvido,
          nome: nome || atual.nome || '',
          atualizado_em: new Date().toISOString(),
        };
        salvarMapeamentoContatos(mapeamento);
      }
    }
  } catch (erro) {
    // Mantém o identificador original se o WhatsApp não conseguir resolver o
    // vínculo naquele momento. Uma mensagem futura pode completar o mapa.
    console.warn('Não foi possível ligar o identificador privado ao telefone:', erro.message);
  }

  return { numero, nome };
}

// Cria ou atualiza o registro do lead sempre que uma mensagem é enviada.
// status começa em 'frio' — o dashboard (ou você, manualmente) que vai
// avançar pra 'quente' ou 'comprou' conforme a conversa evolui.
function registrarEnvioNoLead(numero, nome, contato = {}) {
  const leads = carregarLeads();
  const agora = new Date().toISOString();

  if (!leads[numero]) {
    leads[numero] = {
      numero,
      nome,
      status: 'frio', // frio | quente | comprou
      primeiro_contato: agora,
      ultimo_contato: agora,
      mensagens_enviadas: 1,
      respostas_recebidas: 0,
    };
  } else {
    leads[numero].ultimo_contato = agora;
    leads[numero].mensagens_enviadas = (leads[numero].mensagens_enviadas || 0) + 1;
    if (nome) leads[numero].nome = nome;
  }

  for (const campo of ['pais', 'categoria', 'cidade']) {
    if (contato[campo]) leads[numero][campo] = contato[campo];
  }
  salvarLeads(leads);
}

// Atualiza o lead sempre que uma resposta chega (mesmo que ainda não
// tenha sido feito nenhum envio para esse número, por segurança).
function registrarRespostaNoLead(numero, nome = '') {
  const leads = carregarLeads();
  const agora = new Date().toISOString();

  if (!leads[numero]) {
    leads[numero] = {
      numero,
      nome: '',
      status: 'frio',
      primeiro_contato: agora,
      ultimo_contato: agora,
      mensagens_enviadas: 0,
      respostas_recebidas: 0,
    };
  }

  leads[numero].respostas_recebidas = (leads[numero].respostas_recebidas || 0) + 1;
  leads[numero].ultima_resposta = agora;
  if (nome && !leads[numero].nome) leads[numero].nome = nome;
  salvarLeads(leads);
}

// O estado só é liberado depois que todos os arquivos críticos foram lidos.
// Se principal e backup estiverem inválidos, o processo continua conectado e
// tenta recuperar novamente, sem assumir listas vazias e reenviar contatos.
let bloqueados = new Set();
let enviados = new Set();
let enviosPendentes = {};
let mensagensRecebidasProcessadas = new Set();
let respostasAutomaticasEnviadasOuEmAndamento = new Set();
let respostasAutomaticasLiberadas = false;
let timestampMinimoParaRespostaAutomatica = Number.POSITIVE_INFINITY;
let whatsappPronto = false;

function carregarEstadoOperacional() {
  const estado = {
    bloqueados: carregarBloqueados(),
    enviados: carregarEnviados(),
    enviosPendentes: carregarEnviosPendentes(),
    mensagensRecebidasProcessadas: carregarIdsRespostasRegistradas(),
    respostasAutomaticasEnviadasOuEmAndamento: carregarRespostasAutomaticasUnicas(),
  };
  // Confirmações sincronizadas sobrevivem à falha do contador ou da lista de enviados.
  // Recupera o total antes de liberar a fila e nunca remove pendências incertas.
  const contadorRecuperado = diarioEnvios.recover();
  for (const [numero, pending] of Object.entries(estado.enviosPendentes)) {
    if (pending.confirmationTracked === true && pending.messageId && Number.isInteger(pending.ack) && pending.ack >= 1 && pending.ack <= 4) {
      diarioEnvios.confirm(numero, contadorRecuperado, { runId: pending.runId, receipt: pending });
      diarioEnvios.apply(contadorRecuperado);
    }
  }
  const confirmados = diarioEnvios.confirmedNumbers();
  let enviadosAlterados = false, pendentesAlterados = false;
  for (const numero of confirmados) {
    if (!estado.enviados.has(numero)) { estado.enviados.add(numero); enviadosAlterados = true; }
  }
  if (enviadosAlterados) salvarEnviados(estado.enviados);
  for (const numero of confirmados) {
    if (estado.enviosPendentes[numero]) { delete estado.enviosPendentes[numero]; pendentesAlterados = true; }
  }
  if (pendentesAlterados) salvarEnviosPendentes(estado.enviosPendentes);
  return estado;
}

async function aguardarEstadoOperacionalSeguro() {
  let tentativa = 0;

  while (true) {
    try {
      const estado = carregarEstadoOperacional();
      bloqueados = estado.bloqueados;
      enviados = estado.enviados;
      enviosPendentes = estado.enviosPendentes;
      mensagensRecebidasProcessadas = estado.mensagensRecebidasProcessadas;
      respostasAutomaticasEnviadasOuEmAndamento = estado.respostasAutomaticasEnviadasOuEmAndamento;

      if (tentativa > 0) {
        console.log('✅ Arquivos operacionais recuperados. A execução continuará normalmente.');
      }
      return;
    } catch (erro) {
      tentativa += 1;
      console.error(
        `\n⚠️  [Persistência ${tentativa}] ${erro.message}`,
      );
      console.error(
        'O WhatsApp continuará conectado, mas novos envios e respostas automáticas ficarão protegidos até a recuperação.',
      );
      console.error(
        `Uma nova tentativa será feita em ${PAUSA_RECUPERACAO_PERSISTENCIA_MS / 1000}s. Consulte ${ARQUIVO_ALERTA_PERSISTENCIA}.\n`,
      );
      registrarAlertaPersistencia(erro);
      await new Promise(resolve => setTimeout(resolve, PAUSA_RECUPERACAO_PERSISTENCIA_MS));
    }
  }
}

// --- Trava contra execução duplicada ---------------------------------
// Se duas instâncias deste script rodarem ao mesmo tempo (ex: rodou na
// mão enquanto o agendador também disparava), as duas carregariam a
// MESMA lista de "já enviados" e mandariam mensagem pros mesmos
// contatos antes de uma saber da outra — resultado: gente recebendo
// mensagem duplicada. Essa trava impede isso.
const ARQUIVO_LOCK = '.enviando.lock';
const LOCK_EXPIRA_MS = 6 * 60 * 60 * 1000; // 6h — trava mais velha que isso é considerada travada/de uma execução que quebrou, e é ignorada
let travaAdquiridaPorEsteProcesso = false;

function processoEstaAtivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro?.code === 'EPERM';
  }
}

function adquirirTravaDeExecucao() {
  const caminhoLock = caminho(ARQUIVO_LOCK);
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const descritor = fs.openSync(caminhoLock, 'wx');
      try {
        fs.writeFileSync(descritor, JSON.stringify({
          pid: process.pid,
          iniciadoEm: new Date().toISOString(),
        }, null, 2));
      } finally {
        fs.closeSync(descritor);
      }
      travaAdquiridaPorEsteProcesso = true;
      return;
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro;

      let conteudo = '';
      let dadosLock = null;
      try {
        conteudo = fs.readFileSync(caminhoLock, 'utf-8').trim();
        dadosLock = JSON.parse(conteudo);
      } catch {
        // Compatibilidade com a trava antiga, que guardava só a data.
      }

      const pidExistente = Number(dadosLock?.pid);
      const inicioExistente = dadosLock?.iniciadoEm || conteudo;
      const idadeMs = Date.now() - new Date(inicioExistente).getTime();
      const travaAtiva = processoEstaAtivo(pidExistente)
        || (!pidExistente && !Number.isNaN(idadeMs) && idadeMs < LOCK_EXPIRA_MS);

      if (travaAtiva) {
        console.log('❌ Já existe uma execução deste script em andamento.');
        if (pidExistente) console.log(`   Processo: ${pidExistente}`);
        if (inicioExistente) console.log(`   Início registrado: ${inicioExistente}`);
        process.exit(1);
      }

      try {
        fs.unlinkSync(caminhoLock);
        console.log('Encontrei uma trava de uma execução encerrada — removendo e seguindo.');
      } catch (erroRemocao) {
        if (erroRemocao?.code !== 'ENOENT') throw erroRemocao;
      }
    }
  }

  throw new Error('Não foi possível adquirir a trava exclusiva de execução. Tente iniciar novamente.');
}

function liberarTravaDeExecucao() {
  if (!travaAdquiridaPorEsteProcesso) return;
  try {
    const caminhoLock = caminho(ARQUIVO_LOCK);
    const dadosLock = JSON.parse(fs.readFileSync(caminhoLock, 'utf-8'));
    if (Number(dadosLock?.pid) === process.pid) {
      fs.unlinkSync(caminhoLock);
    }
  } catch {
    // já não existe / já foi removida — sem problema
  } finally {
    travaAdquiridaPorEsteProcesso = false;
  }
}

adquirirTravaDeExecucao();
// Libera a trava não importa como o processo termine (sucesso, erro,
// Ctrl+C, etc.) — 'exit' roda de forma síncrona bem antes do fim.
process.on('exit', liberarTravaDeExecucao);

const LocalAuthSeguro = require('./crm/lib/whatsapp-session-auth').preservingLocalAuth(LocalAuth);
const authStrategy = new LocalAuthSeguro({ dataPath: caminho('.wwebjs_auth') });

const client = new Client({
  authStrategy, // sessão salva num caminho fixo, não depende de onde o comando foi rodado
  // Flags de estabilidade do Chromium por trás da lib — reduzem trava e
  // fechamento inesperado da página, que é uma causa comum das falhas
  // que forçam o retry/disjuntor acima.
  puppeteer: require('./crm/lib/whatsapp-browser-options').whatsappBrowserOptions(),
});

require('./crm/lib/whatsapp-browser-lifecycle').protectBrowserLifecycle(client);
const registrarConexao = require('./crm/lib/whatsapp-connection-diagnostics').createConnectionDiagnostics(PASTA_DO_SCRIPT);
require('./crm/lib/whatsapp-navigation-lifecycle').protectNavigationLifecycle(client, {
  report: reason => {
    registrarConexao('reconnecting', reason);
    if (reason === 'navigation_error') client.emit('disconnected', 'NAVIGATION_ERROR');
  },
});
const confirmacaoEnvios = require('./crm/lib/whatsapp-send-confirmation').createSendConfirmation(client);
const diagnosticoEnvios = require('./crm/lib/whatsapp-send-diagnostics');
diagnosticoEnvios.attachSendDiagnostics(client, {
  record: diagnosticoEnvios.createSendDiagnostics(PASTA_DO_SCRIPT),
});
for (const [event, state] of [['ready','ready'],['qr','qr'],['authenticated','authenticating'],['auth_failure','auth_failure'],['disconnected','disconnected']]) {
  client.on(event, reason => registrarConexao(state, event === 'disconnected' ? reason : ''));
}
const autorizarContaPloa=require('./crm/lib/account-authorization').createAccountAuthorization();
require('./crm/lib/account-authorization').protectAccountSends(client,autorizarContaPloa);

client.on('authenticated',()=>{
  if(whatsappPronto)return;
  avisarPloa('ploa-whatsapp-state',{connection:'authenticating'});
  console.log('Sessão reconhecida. Sincronizando o atendimento do WhatsApp.');
});
client.on('loading_screen',percent=>{
  if(whatsappPronto)return;
  avisarPloa('ploa-whatsapp-state',{connection:'authenticating'});
  if(Number.isFinite(Number(percent)))console.log(`Sincronizando WhatsApp: ${Math.max(0,Math.min(100,Number(percent)))}%.`);
});

const pareamentoPloa=ATENDIMENTO_CONTINUO_PLOA
  ?require('./crm/lib/whatsapp-pairing-agent').attachPairingAgent(client,{isReady:()=>whatsappPronto})
  :null;

client.on('qr', (qr) => {
  if(pareamentoPloa?.usesCode())return;
  avisarPloa('ploa-whatsapp-state',{connection:'qr'});
  console.log('Escaneie o QR Code abaixo com o WhatsApp do celular:');
  if (!EXECUCAO_PELO_PAINEL_PLOA) {
    qrcode.generate(qr, { small: true });
    return;
  }
  qrcode.generate(qr, { small: true }, (qrCode) => {
    console.log('[[PLOA_QR_START]]');
    process.stdout.write(`${qrCode}\n`);
    console.log('[[PLOA_QR_END]]');
  });
});

function registrarErroEventoMensagem(msg, erro) {
  const registro = {
    mensagemId: idEstavelDaMensagem(msg),
    origem: String(msg?.from || ''),
    erro: String(erro?.message || erro),
    data: new Date().toISOString(),
  };

  console.error(
    `>> Falha isolada ao processar a mensagem ${registro.mensagemId}:`,
    registro.erro,
  );

  try {
    // JSONL mantém cada falha independente; uma última linha incompleta não
    // inutiliza todos os registros anteriores.
    fs.appendFileSync(
      caminho(ARQUIVO_ERROS_EVENTOS),
      `${JSON.stringify(registro)}\n`,
      'utf-8',
    );
  } catch (erroLog) {
    console.error('Também não foi possível registrar o erro do evento:', erroLog.message);
  }
}

// Escuta as respostas recebidas dos contatos.
async function processarMensagemRecebida(msg) {
  // ignora mensagens de grupo e mensagens enviadas pelo próprio número
  if (msg.from.endsWith('@g.us') || msg.fromMe) return;

  // Ao abrir o WhatsApp Web, a biblioteca pode sincronizar mensagens antigas e
  // disparar o evento "message" para elas. Só processa mensagens que chegaram
  // depois que esta sessão atingiu o evento "ready".
  const timestampMensagem = Number(msg.timestamp);
  const mensagemAnteriorAoReady = Number.isFinite(timestampMensagem)
    && timestampMensagem < timestampMinimoParaRespostaAutomatica;
  if (!respostasAutomaticasLiberadas || mensagemAnteriorAoReady) return;

  const texto = msg.body || '';
  const mensagemId = idEstavelDaMensagem(msg);

  if (mensagensRecebidasProcessadas.has(mensagemId)) {
    console.log(`Evento repetido da mensagem ${mensagemId} ignorado para evitar resposta automática duplicada.`);
    return;
  }
  mensagensRecebidasProcessadas.add(mensagemId);

  const { numero, nome: nomeContatoResolvido } = await resolverIdentidadeContato(msg);

  console.log(`Resposta recebida de ${numero}: ${texto}`);
  registrarResposta({ numero, texto, mensagemId });
  registrarRespostaNoLead(numero, nomeContatoResolvido);

  const categoria = identificarCategoriaDaResposta(texto);
  await pontePloa.event({ contact: numero,contactName:nomeContatoResolvido, messageId: mensagemId, direction: 'in', text: texto,
    actor: categoria && !categoria.bloquear ? 'bot' : 'contact',
    eligible: !categoria && !bloqueados.has(numero) && (ATENDIMENTO_CONTINUO_PLOA || pontePloa.control() === 'resume'),
    at: new Date(timestampMensagem * 1000).toISOString() });
  if (!categoria) return;

  if (categoria.bloquear && !bloqueados.has(numero)) {
    bloqueados.add(numero);
    salvarBloqueados(bloqueados);
    console.log(`>> ${numero} pediu para não receber mais mensagens. Adicionado a ${ARQUIVO_BLOQUEADOS}.`);
  }
  if (!ATENDIMENTO_CONTINUO_PLOA && pontePloa.control() !== 'resume') return;

  // Um robô pode dividir a saudação em várias mensagens e duas delas podem
  // chegar quase juntas. A chave entra no Set antes do await para garantir uma
  // única resposta desta categoria por contato, inclusive entre execuções.
  const chavesRespostaUnica = [...new Set(
    [numero, msg.from].map(identificador =>
      chaveRespostaAutomaticaUnica(categoria.nome, identificador)
    )
  )];
  if (!reservarRespostaAutomatica(respostasAutomaticasEnviadasOuEmAndamento, chavesRespostaUnica)) {
    console.log(`>> ${numero} já recebeu a resposta automática da categoria ${categoria.nome}. Nova resposta ignorada.`);
    return;
  }

  const nomeContato = (carregarLeads()[numero] || {}).nome || nomeContatoResolvido;
  const idiomaResposta = idiomaDaRespostaAutomatica(numero, texto);
  const textoResposta = sortearRespostaAutomatica(
    categoria,
    { nome: nomeContato },
    idiomaResposta,
  );
  if(!textoResposta){for(const chave of chavesRespostaUnica)respostasAutomaticasEnviadasOuEmAndamento.delete(chave);return;}

  try {
    await enviarComRecuperacaoNoLid(msg.from, textoResposta, null);
  } catch (erro) {
    for (const chave of chavesRespostaUnica) {
      respostasAutomaticasEnviadasOuEmAndamento.delete(chave);
    }
    console.error(`>> Falha ao enviar resposta automática (${categoria.nome}) para ${numero}:`, erro.message);
    return;
  }

  console.log(`>> Resposta automática (${categoria.nome}) enviada para ${numero}.`);
  try {
    registrarRespostaAutomatica({ numero, categoria: categoria.nome, texto: textoResposta, mensagemId });
  } catch (erroRegistro) {
    // O envio já foi concluído; mantém a chave protegida em memória para não
    // duplicar a resposta só porque houve uma falha ao gravar o histórico.
    console.error(`>> A resposta foi enviada, mas não foi possível registrar o histórico de ${numero}:`, erroRegistro.message);
  }
}

client.on('message', (msg) => {
  // EventEmitter não captura rejeições de callbacks async. O invólucro impede
  // que uma mensagem problemática encerre o processo ou afete as próximas.
  void processarMensagemRecebida(msg).catch(erro => {
    registrarErroEventoMensagem(msg, erro);
  });
});

let reinicializacaoEmAndamento = false;
let sequenciaExecucoesDeEnvio = 0;
let execucaoDeEnvioAtivaId = null;
let timerNovaTentativaFila = null;

function agendarNovaTentativaFila() {
  if (timerNovaTentativaFila) return;

  timerNovaTentativaFila = setTimeout(() => {
    timerNovaTentativaFila = null;
    if (!whatsappPronto) {
      console.log('A nova tentativa da fila aguardará o próximo evento ready do WhatsApp.');
      return;
    }
    void executarFilaAoFicarPronto();
  }, PAUSA_RECUPERACAO_PERSISTENCIA_MS);
}

async function executarFilaAoFicarPronto() {
  if(ATENDIMENTO_CONTINUO_PLOA&&!campanhaPloa)return;
  if (execucaoDeEnvioAtivaId !== null) {
    console.log('Evento ready repetido ignorado: a fila de envios já está em execução.');
    return;
  }

  const execucaoAtualId = ++sequenciaExecucoesDeEnvio;
  execucaoDeEnvioAtivaId = execucaoAtualId;

  try {
  console.log('Conectado ao WhatsApp com sucesso!\n');

  await aguardarEstadoOperacionalSeguro();
  if (!whatsappPronto) {
    console.log('Os arquivos foram recuperados, mas o WhatsApp desconectou durante a espera. A fila aguardará a reconexão.');
    return;
  }
  if (!respostasAutomaticasLiberadas) {
    timestampMinimoParaRespostaAutomatica = Math.floor(Date.now() / 1000);
    respostasAutomaticasLiberadas = true;
  }

  const { outreachScope, selectContacts } = require('./crm/lib/outreach-scope');
  const escopo = outreachScope(CONFIGURACOES_OPERACAO.messages.targetCountry);
  const contatos = selectContacts(removerDuplicados(carregarContatos()), escopo);
  console.log(`Destino dos envios: ${escopo.label}.`);
  console.log(`Encontrados ${contatos.length} contatos únicos em ${ARQUIVO_CONTATOS}.\n`);

  const contadorDiario = carregarContadorDiario();
  if (LIMITE_DIARIO_ENVIOS) {
    console.log(`Limite diário: ${LIMITE_DIARIO_ENVIOS} mensagens (${contadorDiario.enviados} já enviadas hoje).\n`);
  }

  const log = [];
  if(!andamentoExecucaoEnvios)resultadosExecucao=createOutreachResults();
  logResultadosAtual=log;cursorResultados=0;
  let falhasConsecutivas = 0;
  let acionamentosDisjuntor = 0;
  let reiniciarAposErroDeConexao = false;
  let limiteDiarioAtingido = false;
  preservarFalhasNoLidDoUltimoLog();
  const indiceInicial = carregarIndiceDeRetomada(contatos, escopo);

  if (!andamentoExecucaoEnvios) {
    iniciarAndamentoEnvios(contatos, indiceInicial, contadorDiario, escopo);
  } else {
    atualizarAndamentoEnvios({ status: 'em_execucao',
      enviadas: Math.max(andamentoExecucaoEnvios.enviadas, diarioEnvios.campaignCount(andamentoExecucaoEnvios.id)) });
  }

  if (indiceInicial > 0) {
    console.log(`Retomando a execução no contato ${indiceInicial + 1}/${contatos.length}.\n`);
  }

  const encerrarSeAtingiuLimite = () => {
    const reservados = require('./crm/lib/whatsapp-send-confirmation').pendingReservations(enviosPendentes, dataDeHoje(), numero => diarioEnvios.has(numero));
    if (!reachedDailyLimit(LIMITE_DIARIO_ENVIOS, contadorDiario.enviados + reservados)) return false;
    limiteDiarioAtingido = true;
    console.log(`\nLimite diário de ${LIMITE_DIARIO_ENVIOS} contatos atingido (${reservados} aguardando confirmação). Disparos encerrados por hoje.`);
    console.log('A próxima execução continuará dos contatos ainda não enviados.');
    atualizarAndamentoEnvios({ status: 'limite_diario', contatoAtual: '', proximoEnvioEm: null });
    return true;
  };

  // Uso um índice manual (em vez de for-of) porque, quando o disjuntor
  // aciona, preciso "ficar no mesmo contato" (não avançar pro próximo)
  // depois da pausa — isso não dá pra fazer direito com for-of/continue.
  for (let indice = indiceInicial; indice < contatos.length; indice++) {
    if (encerrarSeAtingiuLimite()) break;
    await autorizarContaPloa(['messages']);
    await aguardarControlePloa();
    const contato = contatos[indice];
    const numero = contato.numero.replace(/\D/g, '');
    const nome = contato.nome || '';
    const chatId = `${numero}@c.us`;
    const texto = mensagemAleatoria(contato);

    atualizarAndamentoEnvios({
      status: 'em_execucao',
      indiceAtual: indice,
      processados: Math.max(0, indice - andamentoExecucaoEnvios.indiceInicial),
      contatoAtual: nome || numero,
    });

    // Salva antes de qualquer espera/operação assíncrona. Se o processo cair,
    // este mesmo contato será retomado; se ele já tiver recebido, a lista de
    // enviados fará o script pulá-lo com segurança.
    salvarProgressoEnvios(indice, contatos, escopo);

    if (!texto) {
      const pais = contato.pais || 'país não informado';
      console.log(`[${indice + 1}/${contatos.length}] ${numero} pertence a ${pais}, mas ainda não há copy configurada para essa categoria. Pulando sem enviar.`);
      log.push({ numero, nome, status: `não enviado (sem copy para ${pais})` });
      continue;
    }

    if (enviados.has(numero)) {
      console.log(`[${indice + 1}/${contatos.length}] ${numero} já recebeu mensagem anteriormente. Pulando.`);
      log.push({ numero, nome, status: 'já enviado anteriormente' });
      continue;
    }

    if (enviosPendentes[numero]) {
      console.log(`[${indice + 1}/${contatos.length}] ${numero} tem um envio anterior aguardando confirmação. Pulando para não enviar em duplicidade.`);
      log.push({ numero, nome, status: 'envio pendente de confirmação (não reenviado automaticamente)' });
      continue;
    }

    if (bloqueados.has(numero)) {
      console.log(`[${indice + 1}/${contatos.length}] ${numero} está na lista de opt-out. Pulando.`);
      log.push({ numero, nome, status: 'bloqueado (opt-out)' });
      continue;
    }

    let envioFoiIniciado = false;

    try {
      // A verificação de número também passa pelo retry — antes só o
      // envio tinha essa proteção, e uma falha aqui já custava o contato.
      const existe = await comRetry(() => client.isRegisteredUser(chatId), 'verificação de número');
      if (!existe) {
        console.log(`[${indice + 1}/${contatos.length}] ${numero} não está no WhatsApp. Pulando.`);
        log.push({ numero, nome, status: 'não encontrado' });
        continue;
      }

      // #5 preparado para uso futuro: se CAMINHO_MIDIA_PADRAO for definido,
      // toda mensagem sai com esse anexo (imagem/PDF/áudio) + a legenda.
      const midia = CAMINHO_MIDIA_PADRAO ? MessageMedia.fromFilePath(CAMINHO_MIDIA_PADRAO) : null;

      // Sorteia uma espera dentro da faixa salva no painel antes de mandar a
      // mensagem para este contato novo (nunca recebeu mensagem antes).
      const esperaContatoNovoMs = Math.floor(Math.random() * (DELAY_CONTATO_NOVO_MAX_MS - DELAY_CONTATO_NOVO_MIN_MS + 1)) + DELAY_CONTATO_NOVO_MIN_MS;
      console.log(`[${indice + 1}/${contatos.length}] Aguardando ${esperaContatoNovoMs / 1000}s antes de enviar para ${nome || numero} (contato novo)...`);
      atualizarAndamentoEnvios({proximoEnvioEm:new Date(Date.now()+esperaContatoNovoMs).toISOString(),esperaTipo:'contato'});
      await new Promise(resolve => setTimeout(resolve, esperaContatoNovoMs));
      await aguardarControlePloa();
      atualizarAndamentoEnvios({proximoEnvioEm:null});
      await autorizarContaPloa(['messages']);

      enviosPendentes[numero] = {
        numero,
        nome,
        categoria: contato.categoria || '',
        mensagem: texto,
        iniciadoEm: new Date().toISOString(),
        confirmationTracked: true,
        attemptDay: dataDeHoje(),
        runId: andamentoExecucaoEnvios.id,
      };
      salvarEnviosPendentes(enviosPendentes);
      envioFoiIniciado = true;

      const mensagemConfirmada = await enviarComRecuperacaoNoLid(chatId, texto, midia, client, receipt => {
        // Keep the stable ID even after a timeout/disconnect. Never resend it.
        if (!enviosPendentes[numero]) return;
        enviosPendentes[numero] = { ...enviosPendentes[numero], ...receipt };
        salvarEnviosPendentes(enviosPendentes);
      });
      const confirmacao = confirmacaoEnvios.receipt(mensagemConfirmada);
      if (!confirmacao || confirmacao.ack < 1) throw Object.assign(new Error('O servidor do WhatsApp não confirmou o envio.'), { code: 'PLOA_SEND_UNCONFIRMED' });
      // Registra a confirmação antes de alterar os demais arquivos. A recuperação
      // reaplica este total de forma idempotente, sem repetir o envio.
      diarioEnvios.confirm(numero, contadorDiario, { runId: andamentoExecucaoEnvios.id, receipt: confirmacao });
      void pontePloa.event({
        contact: numero, direction: 'note', actor: 'script', kind: 'copy',
        copyId: contato.ploaCopyId, copyPreview: contato.ploaCopyPreview,
        country: contato.pais || '', category: contato.categoria || '',
        text: 'Primeiro contato enviado. Variação registrada para acompanhamento.',
      });
      console.log(`[${indice + 1}/${contatos.length}] Envio confirmado pelo servidor do WhatsApp para ${nome} (${numero})`);
      log.push({ numero, nome, status: 'enviado', confirmation: confirmacao, mensagem: texto, pais: contato.pais || '', categoria: contato.categoria || '', data: new Date().toISOString() });

      enviados.add(numero);
      salvarEnviados(enviados);
      diarioEnvios.apply(contadorDiario);
      delete enviosPendentes[numero];
      salvarEnviosPendentes(enviosPendentes);
      atualizarAndamentoEnvios({
        enviadas: andamentoExecucaoEnvios.enviadas + 1,
        processados: Math.max(0, indice - andamentoExecucaoEnvios.indiceInicial + 1),
      });
      registrarEnvioNoLead(numero, nome, contato);
      falhasConsecutivas = 0; // sucesso zera o contador do disjuntor
      acionamentosDisjuntor = 0;
      if (encerrarSeAtingiuLimite()) break;

    } catch (erro) {
      const mensagemErro = String(erro?.message || erro);
      if(erro?.code==='PLOA_CAMPAIGN_STOP')throw erro;
      if(erro?.code==='PLOA_ACCOUNT_ACCESS'){
        if(envioFoiIniciado){delete enviosPendentes[numero];salvarEnviosPendentes(enviosPendentes);}
        throw erro;
      }

      if (ehErroPersistencia(erro)) {
        console.error(
          `[${indice + 1}/${contatos.length}] Falha de persistência ao processar ${numero}. `
          + 'A fila não avançará nem contará isso como falha de conexão.',
        );
        registrarAlertaPersistencia(erro);
        throw erro;
      }

      if (envioFoiIniciado && (erro?.envioNaoRealizado || ehErroNoLid(erro))) {
        enviosPendentes[numero] = criarRegistroNoLidNaoRepetivel({
          numero,
          nome,
          categoria: contato.categoria || '',
          mensagem: texto,
          erro: mensagemErro,
          anterior: enviosPendentes[numero],
        });
        salvarEnviosPendentes(enviosPendentes);
        console.error(
          `[${indice + 1}/${contatos.length}] A mensagem para ${numero} não chegou à etapa de envio e não será tentada novamente automaticamente:`,
          mensagemErro,
        );
        log.push({
          numero,
          nome,
          status: `não enviado (falha de resolução LID; não repetir automaticamente): ${mensagemErro}`,
        });
        falhasConsecutivas = 0;
        acionamentosDisjuntor = 0;
        continue;
      }

      if (envioFoiIniciado) {
        enviosPendentes[numero] = {
          ...enviosPendentes[numero],
          erro: mensagemErro,
          atualizadoEm: new Date().toISOString(),
        };
        salvarEnviosPendentes(enviosPendentes);
        console.error(`[${indice + 1}/${contatos.length}] O resultado do envio para ${numero} ficou incerto. Ele não será reenviado automaticamente para evitar duplicidade:`, mensagemErro);
        log.push({
          numero,
          nome,
          messageId: enviosPendentes[numero]?.messageId || '',
          status: `envio pendente de confirmação (não será reenviado automaticamente): ${mensagemErro}`,
        });
        // Stop instead of approaching more contacts while a send is uncertain.
        salvarJsonAtomico('log_envios.json', log);
        atualizarAndamentoEnvios({ status: 'aguardando_confirmacao', proximoEnvioEm: null, erro: 'Há um envio sem confirmação. Confira o WhatsApp antes de continuar.' });
        if (ATENDIMENTO_CONTINUO_PLOA) concluirCampanhaPloa('error', 'Envio sem confirmação do servidor. A fila foi interrompida sem reenviar.');
        return;
      }

      // "No LID for user" é uma falha de identificação deste contato no
      // WhatsApp Web, não uma queda da conexão inteira. Registra e segue
      // sem alimentar o disjuntor global.
      if (!envioFoiIniciado && mensagemErro.includes('No LID for user')) {
        enviosPendentes[numero] = criarRegistroNoLidNaoRepetivel({
          numero,
          nome,
          categoria: contato.categoria || '',
          mensagem: texto,
          erro: mensagemErro,
        });
        salvarEnviosPendentes(enviosPendentes);
        console.error(`[${indice + 1}/${contatos.length}] O WhatsApp não conseguiu identificar ${numero} (No LID for user). Pulando sem acionar o disjuntor e sem repetir em outra execução.`);
        log.push({ numero, nome, status: `erro No LID (não repetir automaticamente): ${mensagemErro}` });
        falhasConsecutivas = 0;
        acionamentosDisjuntor = 0;
        continue;
      }

      falhasConsecutivas += 1;
      if (!envioFoiIniciado) {
        console.error(`[${indice + 1}/${contatos.length}] Falha ao processar ${numero}:`, mensagemErro);
      }

      if (falhasConsecutivas >= MAX_FALHAS_CONSECUTIVAS) {
        acionamentosDisjuntor += 1;

        if (acionamentosDisjuntor > MAX_ACIONAMENTOS_DISJUNTOR) {
          console.log(`\n❌ Disjuntor acionado ${acionamentosDisjuntor} vezes seguidas — isso não parece mais instabilidade passageira.`);
          console.log('Provavelmente o WhatsApp Web desconectou de verdade (sessão encerrada no celular, etc).');
          console.log('O navegador será reiniciado automaticamente e o script retomará sem repetir quem já recebeu.\n');
          log.push({ numero, nome, audience: { key: escopo.key }, status: `erro de conexão antes da reinicialização: ${mensagemErro}` });
          reiniciarAposErroDeConexao = true;
          break;
        }

        console.log(`\n⚠️  ${falhasConsecutivas} falhas seguidas — provavelmente é a conexão, não os contatos.`);
        console.log(`Pausando por ${PAUSA_DISJUNTOR_MS / 1000}s antes de tentar de novo o mesmo contato (${nome || numero})...\n`);
        await new Promise(resolve => setTimeout(resolve, PAUSA_DISJUNTOR_MS));
        falhasConsecutivas = 0;
        indice -= 1; // não avança: tenta este mesmo contato de novo após a pausa
        continue;
      }

      if (!envioFoiIniciado) {
        log.push({ numero, nome, status: `erro: ${mensagemErro}` });
      }
    }

    // espera antes do próximo envio (exceto no último)
    if (indice < contatos.length - 1) {
      await delayAleatorio();
    }
  }

  try { salvarJsonAtomico('log_envios.json', log); }
  catch (erro) {
    if (!limiteDiarioAtingido) throw erro;
    console.error('Os envios já atingiram o limite e foram registrados. Não foi possível atualizar o log auxiliar:', erro.message);
  }

  if (reiniciarAposErroDeConexao) {
    atualizarAndamentoEnvios({ status: 'reconectando' });
    if (execucaoDeEnvioAtivaId === execucaoAtualId) {
      execucaoDeEnvioAtivaId = null;
    }
    await reiniciarWhatsAppAposErroDeConexao();
    return;
  }

  if (!limiteDiarioAtingido) {
    limparProgressoEnvios(escopo);
    atualizarAndamentoEnvios({
      status: 'concluida',
      listaPercorrida: true,
      processados: contatos.length - andamentoExecucaoEnvios.indiceInicial,
      contatoAtual: '',
    });
  }

  console.log('\nConcluído! Veja o resultado em log_envios.json');
  if(ATENDIMENTO_CONTINUO_PLOA){
    filaInicialConcluida=true;concluirCampanhaPloa('completed');
    console.log('Disparos concluídos. Atendimento contínuo permanece ligado.');return;
  }
  filaInicialConcluida = true;
  pontePloa.close();
  try { await client.destroy(); } catch (erro) { console.warn('Falha ao fechar o navegador após concluir os disparos:', erro.message); }
  process.exit(0);
  } catch (erro) {
    if(erro.code==='PLOA_ACCOUNT_ACCESS'){
      atualizarAndamentoEnvios({status:'interrompida',erro:erro.message});
      if(ATENDIMENTO_CONTINUO_PLOA)concluirCampanhaPloa('stopped');
      console.error(erro.message);return;
    }
    if(erro.code==='PLOA_CAMPAIGN_STOP'){
      atualizarAndamentoEnvios({status:'interrompida'});if(ATENDIMENTO_CONTINUO_PLOA)concluirCampanhaPloa('stopped');return;
    }
    atualizarAndamentoEnvios({
      status: ehErroPersistencia(erro) ? 'aguardando_persistencia' : 'erro',
      erro: String(erro?.message || erro),
    });
    console.error('Falha inesperada durante a fila de envios:', erro);
    if (ehErroPersistencia(erro)) registrarAlertaPersistencia(erro);
    console.error(
      `O processo continuará ativo e a fila tentará novamente em ${PAUSA_RECUPERACAO_PERSISTENCIA_MS / 1000}s.`,
    );
    agendarNovaTentativaFila();
  } finally {
    if (execucaoDeEnvioAtivaId === execucaoAtualId) {
      execucaoDeEnvioAtivaId = null;
    }
  }
}

client.on('ready', () => {
  whatsappPronto = true;
  if(ATENDIMENTO_CONTINUO_PLOA){
    timestampMinimoParaRespostaAutomatica=Math.floor(Date.now()/1000);
    respostasAutomaticasLiberadas=false;
    void aguardarEstadoOperacionalSeguro().then(()=>{if(whatsappPronto)respostasAutomaticasLiberadas=true;}).catch(error=>console.error('Ploa: falha ao recuperar o atendimento:',error.message));
    avisarPloa('ploa-whatsapp-state',{connection:'ready'});
  }
  pontePloa.start(client, () => whatsappPronto && !encerrandoPeloPainel,
    (destino, texto) => enviarComRecuperacaoNoLid(destino, texto, null));
  if (EXECUCAO_PELO_PAINEL_PLOA) console.log('[[PLOA_QR_CLEAR]]');
  if (timerNovaTentativaFila) {
    clearTimeout(timerNovaTentativaFila);
    timerNovaTentativaFila = null;
  }
  if (ATENDIMENTO_CONTINUO_PLOA&&!campanhaPloa) return;
  if (!ATENDIMENTO_CONTINUO_PLOA&&filaInicialConcluida) return;
  void executarFilaAoFicarPronto().catch(erro => {
    console.error('Falha não tratada ao iniciar a fila de envios:', erro);
    agendarNovaTentativaFila();
  });
});

if (pontePloa.enabled&&!ATENDIMENTO_CONTINUO_PLOA) setInterval(() => {
  if (pontePloa.control() === 'stop' && !encerrandoPeloPainel && !pontePloa.isBusy()) {
    void aguardarControlePloa().catch(error => console.error('Ploa: falha ao encerrar:', error.message));
  }
}, 1500);

client.on('auth_failure', (msg) => {
  avisarPloa('ploa-whatsapp-state',{connection:'auth_failure'});
  console.error('Falha na autenticação:', msg);
  atualizarAndamentoEnvios({ status: 'erro_autenticacao', erro: String(msg || '') });
  process.exit(1);
});

client.on('disconnected', (motivo) => {
  if (encerrandoPeloPainel) return;
  avisarPloa('ploa-whatsapp-state',{connection:'reconnecting',reason:String(motivo||'').slice(0,120)});
  whatsappPronto = false;
  respostasAutomaticasLiberadas = false;
  timestampMinimoParaRespostaAutomatica = Number.POSITIVE_INFINITY;
  console.log(`\n❌ WhatsApp Web desconectou (motivo: ${motivo}).`);
  if (String(motivo).toUpperCase() === 'LOGOUT') {
    filaSuspensaPorLogout = true;
    if (ATENDIMENTO_CONTINUO_PLOA) concluirCampanhaPloa('stopped', 'A sessão do WhatsApp foi encerrada. Conecte novamente antes de iniciar outra fila.');
    atualizarAndamentoEnvios({ status: 'reconectando' });
    console.log('Sessão encerrada pelo WhatsApp. A fila foi interrompida; os arquivos locais serão preservados.');
    setTimeout(() => {
      void reiniciarWhatsAppAposErroDeConexao().catch(erro => console.error('Falha ao recuperar a conexão:', erro.message));
    }, 0);
    return;
  }
  if(ATENDIMENTO_CONTINUO_PLOA&&execucaoDeEnvioAtivaId===null){
    void reiniciarWhatsAppAposErroDeConexao().catch(error=>console.error('Ploa: falha na reconexão:',error.message));
  }else console.log('Se isso aconteceu durante os envios, o disjuntor fará a reinicialização automática.');
});

if(ATENDIMENTO_CONTINUO_PLOA){
  const encerrarAtendimento=async()=>{
    if(encerrandoPeloPainel)return;encerrandoPeloPainel=true;whatsappPronto=false;
    clearTimeout(timerNovaTentativaFila);pontePloa.close();pareamentoPloa?.close();
    concluirCampanhaPloa('stopped');
    try{await client.destroy();}catch{}
    process.exit(0);
  };
  process.on('message',(command)=>{
    if(command?.type==='ploa-attendance-stop'){void encerrarAtendimento();return;}
    if(command?.type==='ploa-campaign-stop'){
      if(command.runId===campanhaPloa&&execucaoDeEnvioAtivaId===null){clearTimeout(timerNovaTentativaFila);timerNovaTentativaFila=null;concluirCampanhaPloa('stopped');}
      return;
    }
    if(command?.type==='ploa-reload-settings'&&!campanhaPloa){try{recarregarConfiguracoesPloa();}catch(error){console.error('Ploa: configurações não atualizadas:',error.message);}return;}
    if(command?.type!=='ploa-campaign-start'||typeof command.runId!=='string'||command.runId.length>100)return;
    if(campanhasPloaConhecidas.has(command.runId))return;
    if(campanhaPloa){avisarPloa('ploa-campaign-finished',{runId:command.runId,status:'error',error:'Já existe uma fila de disparos ativa.'});return;}
    campanhaPloa=command.runId;filaSuspensaPorLogout=false;campanhasPloaConhecidas.add(command.runId);
    if(campanhasPloaConhecidas.size>1000)campanhasPloaConhecidas.delete(campanhasPloaConhecidas.values().next().value);
    filaInicialConcluida=false;andamentoExecucaoEnvios=null;
    try{recarregarConfiguracoesPloa();}catch(error){concluirCampanhaPloa('error',error.message);return;}
    if(whatsappPronto)void executarFilaAoFicarPronto();
  });
  process.once('disconnect',()=>void encerrarAtendimento());
  setInterval(()=>{
    if(encerrandoPeloPainel||!whatsappPronto||reinicializacaoEmAndamento||execucaoDeEnvioAtivaId!==null)return;
    if(client.pupBrowser?.isConnected&&!client.pupBrowser.isConnected()){
      whatsappPronto=false;respostasAutomaticasLiberadas=false;
      timestampMinimoParaRespostaAutomatica=Number.POSITIVE_INFINITY;
      avisarPloa('ploa-whatsapp-state',{connection:'reconnecting'});
      void reiniciarWhatsAppAposErroDeConexao().catch(error=>console.error('Ploa: falha ao recuperar o navegador:',error.message));
    }
  },30000);
}

async function inicializarWhatsApp() {
  const maxTentativasInicializacao = 3;
  let chegouAoReady = false;
  const marcarReady = () => { chegouAoReady = true; };
  client.once('ready', marcarReady);

  try {
    for (let tentativa = 1; tentativa <= maxTentativasInicializacao; tentativa++) {
      try {
        await require('./crm/lib/whatsapp-startup').initializeWithDeadline(client);
        return;
      } catch (erro) {
        const contextoDestruido = String(erro?.message || erro)
          .includes('Execution context was destroyed');

        if (chegouAoReady || !contextoDestruido || tentativa === maxTentativasInicializacao) {
          throw erro;
        }

        console.error(
          `[Inicialização ${tentativa}/${maxTentativasInicializacao}] O contexto da página foi destruído. Reiniciando o navegador:`,
          erro
        );
        await client.destroy();
      }
    }
  } finally {
    client.removeListener('ready', marcarReady);
  }
}

async function reiniciarWhatsAppAposErroDeConexao() {
  if (reinicializacaoEmAndamento || encerrandoPeloPainel) return;
  reinicializacaoEmAndamento = true;
  registrarConexao('reconnecting');
  respostasAutomaticasLiberadas = false;
  timestampMinimoParaRespostaAutomatica = Number.POSITIVE_INFINITY;

  try {
    while (!encerrandoPeloPainel) {
      let navegadorEncerrado = false;
      try {
        await client.destroy();
        navegadorEncerrado = true;
      } catch (erroEncerramento) {
        console.error('Falha ao encerrar o navegador antes da reinicialização:', erroEncerramento);
      }

      // No Windows, o Chrome pode levar alguns instantes para liberar os
      // arquivos Crashpad da sessão depois de fechar. A limpeza acontece só
      // depois desse intervalo e é repetida se o arquivo ainda estiver ocupado.
      await new Promise(resolve => setTimeout(resolve, 750));
      if (encerrandoPeloPainel) return;
      // The profile is preserved; revoked sessions must be paired in WhatsApp.

      console.log(`Nova tentativa de conexão em ${PAUSA_DISJUNTOR_MS / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, PAUSA_DISJUNTOR_MS));
      if (encerrandoPeloPainel) return;
      // Do not launch over a profile whose previous browser is still alive.
      if (!navegadorEncerrado) continue;

      try {
        await inicializarWhatsApp();
        return;
      } catch (erroInicializacao) {
        console.error('A reinicialização do WhatsApp Web falhou. Uma nova tentativa será feita:', erroInicializacao);
      }
    }
  } finally {
    reinicializacaoEmAndamento = false;
  }
}

registrarConexao('starting');
inicializarWhatsApp().catch(async (erro) => {
  console.error('Falha ao inicializar o WhatsApp Web:', erro);
  try {
    await client.destroy();
  } catch (erroEncerramento) {
    console.error('Falha ao encerrar o navegador após o erro de inicialização:', erroEncerramento);
  }
  process.exit(1);
});
