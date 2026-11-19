'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { workspaceFixture } = require('./fixture-helpers');

test('mensagem manual repetida após resposta perdida produz uma única solicitação de envio', async t => {
  const {workspace,contact} = workspaceFixture(t);
  const request = {action:'message',text:'Mensagem fictícia para revisão.',requestId:'browser-request-1'};
  await workspace.command(contact,request);
  const first = workspace.read().jobs.find(job => job.requestId === request.requestId);
  await workspace.command(contact,request);
  let jobs = workspace.read().jobs.filter(job => job.requestId === request.requestId);
  assert.equal(jobs.length,1); assert.equal(jobs[0].id,first.id); assert.equal(jobs[0].status,'ready');
  await assert.rejects(workspace.command(contact,{...request,text:'Outra mensagem.'}),/outra mensagem/);
  await workspace.command(contact,{...request,requestId:'browser-request-2'});
  jobs = workspace.read().jobs.filter(job => job.kind === 'human'); assert.equal(jobs.length,2);
  assert.equal(jobs[0].status,'cancelled'); assert.equal(jobs[1].status,'ready');
});
