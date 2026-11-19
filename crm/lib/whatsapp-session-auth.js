'use strict';
// Server revocation is still enforced by WhatsApp. Retain the browser profile
// instead of recursively deleting it on an automatic SDK LOGOUT callback.
function preservingLocalAuth(LocalAuth) {
  return class PreservingLocalAuth extends LocalAuth {
    async logout() { /* WhatsApp Web will request a new pairing if revoked. */ }
  };
}
module.exports = { preservingLocalAuth };
