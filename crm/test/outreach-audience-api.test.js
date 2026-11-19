'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createRequestHandler } = require('../lib/http-routes');
const { createHttpTools } = require('../lib/http-tools');
const { outreachScope } = require('../lib/outreach-scope');
const { modulesFor } = require('../cloud/local-panel');
test('contagem exige permissão mensagens; rota lê público validado sem iniciar qualquer script', async t => {
  assert.deepEqual(modulesFor('/api/messages-audience','GET'), ['messages']);
  let handler, starts = 0, calls = 0;
  const server = http.createServer((req,res) => handler(req,res));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, base = 'http://127.0.0.1:' + port;
  handler = createRequestHandler({ HOST:'127.0.0.1', PORT:port, PROJECT_ROOT:__dirname,
    getMessageAudience: async country => { const scope = outreachScope(country); calls++; return { audience: { ...scope,total:4,available:2 } }; },
    startManagedScript() { starts++; throw Error('Não pode iniciar scripts'); },
    ...createHttpTools({HOST:'127.0.0.1',PORT:port,PUBLIC_ROOT:__dirname}) });
  const good = await fetch(base+'/api/messages-audience?country=Portugal');
  assert.equal(good.status,200); assert.equal((await good.json()).audience.targetCountry,'Portugal');
  assert.equal((await fetch(base+'/api/messages-audience?country=invalid')).status,400);
  assert.equal((await fetch(base+'/api/messages-audience',{headers:{Origin:'https://foreign.invalid'}})).status,403);
  assert.equal(calls,1); assert.equal(starts,0);
});
