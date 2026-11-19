'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkReadiness}=require('../cloud/check-readiness');
const config={url:'https://vucwevapknncmmnumuja.supabase.co',key:'sb_publishable_fixture',serverKey:'sb_secret_private_fixture',production:false,origin:'http://127.0.0.1:4311',stateMode:'local'};

test('readiness never claims publication ready when the shared database is incomplete',async()=>{
  const result=await checkReadiness({config,mailerReady:true,fetch:async url=>new Response(JSON.stringify(url.includes('/settings')?{external:{google:false,email:true}}:{paths:{}}))});
  assert.equal(result.authenticationReachable,true);assert.equal(result.googleConfigured,false);
  assert.equal(result.sharedDatabase.missingFunctions.length,12);assert.equal(result.infrastructureReady,false);assert.equal(result.publicationReady,false);
  assert.equal(JSON.stringify(result).includes(config.serverKey),false);
});

test('provider failures expose only availability and cannot fall through to a ready state',async()=>{
  const result=await checkReadiness({config,mailerReady:true,fetch:async()=>{throw Error('private '+config.serverKey);}});
  assert.equal(result.authenticationReachable,false);assert.equal(result.sharedDatabase.verified,false);assert.equal(result.infrastructureReady,false);
  assert.equal(JSON.stringify(result).includes(config.serverKey),false);
});

test('a configured host remains pending personal validation instead of being declared published',async()=>{
  const names=['state_read','state_put','state_take','state_lease','state_write','state_release','state_remove_user','limit_hit','state_cleanup','account_access','admin_accounts','admin_set_feature'];
  const paths=Object.fromEntries(names.map(name=>['/rpc/ploa_'+name,{}]));
  const online={...config,production:true,origin:'https://ploa.example.invalid',stateMode:'shared',stateKey:Buffer.alloc(32,1).toString('base64')};
  const result=await checkReadiness({config:online,mailerReady:true,fetch:async url=>new Response(JSON.stringify(url.includes('/settings')?{external:{google:true,email:true}}:{paths}))});
  assert.equal(result.infrastructureReady,true);assert.equal(result.googleConfigured,true);assert.equal(result.publicationReady,false);
  assert.equal(result.deliveryAndLoginValidation,'requires-owner-validation');
});
