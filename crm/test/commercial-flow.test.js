'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { workspaceFixture } = require('./fixture-helpers');
const { createRequestHandler } = require('../lib/http-routes');
const { createHttpTools } = require('../lib/http-tools');

for (const currency of ['BRL', 'EUR', 'USD']) {
  test(`API: proposta → aceite → entrada → saldo em ${currency}, sem antecipar recebimento`, async t => {
    const f = workspaceFixture(t);
    let handler;
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port, base = 'http://127.0.0.1:' + port;
    handler = createRequestHandler({ HOST: '127.0.0.1', PORT: port, PROJECT_ROOT: f.root,
      store: f.store, workspace: f.workspace,
      scriptProcesses: new Map(), activeProcessStatuses: new Set(),
      ...createHttpTools({ HOST: '127.0.0.1', PORT: port, PUBLIC_ROOT: __dirname }) });
    t.after(() => new Promise(resolve => server.close(resolve)));
    async function command(body, status = 200) {
      const response = await fetch(base + '/api/workspace/leads/' + f.contact, {
        method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      assert.equal(response.status, status, result.erro);
      return result;
    }
    async function check({ stage, contracted, received, outstanding, clients, sales }) {
      const dashboard = await (await fetch(base + '/api/dashboard')).json();
      const lead = dashboard.leads.find(lead => lead.id === f.contact);
      assert.equal(lead.status, stage);
      assert.equal(lead.valor_contratado, contracted);
      assert.equal(lead.valor_recebido, received);
      assert.equal(lead.valor_a_receber, outstanding);
      assert.equal(dashboard.funnel_steps[2].count, clients);
      assert.equal(dashboard.funnel_steps[3].count, sales);
      const report = await (await fetch(base + '/api/reports')).json();
      for (const days of [0, 30, 90, 365]) for (const code of ['BRL', 'EUR', 'USD']) {
        assert.equal(report.financialWindows[days].currencies[code].received, code === currency ? received : 0);
      }
    }
    await f.store.updateLead(f.contact, { moeda: currency });
    await command({ action: 'proposal', requestId: 'flow-proposal', amount: 200, currency,
      title: 'Projeto fictício', scope: 'Apresentação da empresa', terms: '50% de entrada e 50% na entrega' });
    const id = f.workspace.read().records[f.contact].proposals[0].id;
    assert.equal(f.workspace.read().records[f.contact].payments.length, 0);
    await command({ action: 'proposal-status', proposalId: id, status: 'sent' });
    await check({ stage: 'proposta', contracted: 0, received: 0, outstanding: 0, clients: 0, sales: 0 });
    await command({ action: 'proposal-status', proposalId: id, status: 'accepted' });
    await check({ stage: 'ganho', contracted: 200, received: 0, outstanding: 200, clients: 1, sales: 0 });
    const payment = { action: 'payment', requestId: 'entry', amount: 100, currency, description: 'Entrada', confirmed: true };
    await command({ ...payment, confirmed: false }, 400);
    await check({ stage: 'ganho', contracted: 200, received: 0, outstanding: 200, clients: 1, sales: 0 });
    await command(payment);
    await command(payment);
    await check({ stage: 'ganho', contracted: 200, received: 100, outstanding: 100, clients: 1, sales: 1 });
    await command({ ...payment, requestId: 'balance', description: 'Saldo' });
    await check({ stage: 'ganho', contracted: 200, received: 200, outstanding: 0, clients: 1, sales: 1 });
    assert.equal(f.workspace.read().records[f.contact].payments.length, 2);
    assert.equal(f.workspace.read().jobs.length, 0); // No message or AI transport is involved.
  });
}
