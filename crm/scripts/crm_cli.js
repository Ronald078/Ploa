#!/usr/bin/env node

const path = require('path');
const { createCrmStore } = require('../lib/store');

const projectRoot = path.resolve(__dirname, '..', '..');
const store = createCrmStore(projectRoot);

function parseArguments(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith('--') ? values[++index] : true;
  }
  return parsed;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write([
    'CRM de prospecção',
    '',
    'Comandos:',
    '  resumo',
    '  listar [--status respondeu] [--limite 20]',
    '  ver --id IDENTIFICADOR',
    '  atualizar --id IDENTIFICADOR [--status proposta] [--acao "Enviar proposta"]',
    '            [--retorno AAAA-MM-DD] [--valor 1500] [--nota "Contexto"]',
    '',
  ].join('\n'));
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const command = args._[0];

  if (!command || ['ajuda', 'help', '--help'].includes(command)) {
    help();
    return;
  }

  const dashboard = await store.getDashboard();

  if (command === 'resumo') {
    print(dashboard.resumo);
    return;
  }

  if (command === 'listar') {
    const limit = Math.min(Math.max(Number(args.limite) || 20, 1), 200);
    const leads = dashboard.leads
      .filter((lead) => !args.status || lead.status === args.status)
      .slice(0, limit)
      .map((lead) => ({
        id: lead.id,
        nome: lead.nome,
        contato: lead.numero_mascarado,
        status: lead.status,
        respostas: lead.respostas_recebidas,
        proxima_acao: lead.proxima_acao,
        proximo_contato: lead.proximo_contato,
      }));
    print({ total_encontrado: leads.length, leads });
    return;
  }

  if (command === 'ver') {
    if (!args.id) throw new Error('Informe --id para consultar um lead.');
    const lead = dashboard.leads.find((item) => item.id === args.id);
    if (!lead) throw new Error('Lead não encontrado.');
    print(lead);
    return;
  }

  if (command === 'atualizar') {
    if (!args.id) throw new Error('Informe --id para atualizar um lead.');
    const patch = {};
    if (args.status !== undefined) patch.status = args.status;
    if (args.acao !== undefined) patch.proxima_acao = args.acao;
    if (args.retorno !== undefined) patch.proximo_contato = args.retorno;
    if (args.valor !== undefined) patch.valor_estimado = args.valor;
    if (args.nota !== undefined) patch.nota = args.nota;
    if (!Object.keys(patch).length) throw new Error('Informe pelo menos um campo para atualizar.');
    print(await store.updateLead(args.id, patch));
    return;
  }

  throw new Error(`Comando desconhecido: ${command}.`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
