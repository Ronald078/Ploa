'use strict';
const { CloudError } = require('./errors');
const { normalizeServerKey, requirePloaProject } = require('./server-key-settings');
const { createStateCrypto } = require('./state-crypto');

function createSharedState({ url, serverKey, stateKey, fetch: fetcher = fetch }) {
  requirePloaProject(url); const key = normalizeServerKey(serverKey), crypto = createStateCrypto(stateKey);
  async function rpc(name, body = {}) {
    let response;
    try {
      response = await fetcher(`${url}/rest/v1/rpc/ploa_${name}`, { method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
        headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:`Bearer ${key}`} : {}),'Content-Type':'application/json'},body:JSON.stringify(body) });
      if (!response.ok) throw new Error();
      if (response.status === 204) return null;
      return await response.json();
    } catch { throw new CloudError(503,'state_unavailable','Não foi possível acessar o estado protegido. Tente novamente.'); }
  }
  function decode(kind,id,row) { return row ? { value:crypto.open(kind,id,row.envelope),version:row.version } : null; }
  return {
    hash: value => crypto.hash(value),
    async get(kind,id) { return decode(kind,id,await rpc('state_read',{p_kind:kind,p_key:id})); },
    async put(kind,id,value,ttl,userId=null) { return await rpc('state_put',{p_kind:kind,p_key:id,p_envelope:crypto.seal(kind,id,value),p_ttl_ms:ttl,p_user:userId}); },
    async take(kind,id,lease=null) { return decode(kind,id,await rpc('state_take',{p_kind:kind,p_key:id,p_lease:lease})); },
    async lease(kind,id,lease) { return decode(kind,id,await rpc('state_lease',{p_kind:kind,p_key:id,p_lease:lease})); },
    async write(kind,id,lease,version,value) { return await rpc('state_write',{p_kind:kind,p_key:id,p_lease:lease,p_version:version,p_envelope:crypto.seal(kind,id,value)}); },
    async release(kind,id,lease) { await rpc('state_release',{p_kind:kind,p_key:id,p_lease:lease}); },
    async removeUser(kind,userId) { await rpc('state_remove_user',{p_kind:kind,p_user:userId}); },
    async hit(scope,identifier,limit,window) { return await rpc('limit_hit',{p_key:crypto.hash(scope+':'+identifier),p_limit:limit,p_window_ms:window}); },
    async cleanup() { await rpc('state_cleanup'); },
  };
}
module.exports = { createSharedState };
