'use strict';
const path = require('node:path');
const http = require('node:http');
const { startRemoteAccess } = require('../lib/remote-access');
const gateway = startRemoteAccess({ root: path.resolve(__dirname, '../..') });
// Temporary setup helper; subsequent Ploa sessions start the gateway internally.
let failures = 0;
const timer = setInterval(() => {
  const probe = http.get('http://127.0.0.1:4310/', response => { response.resume(); failures = 0; });
  probe.setTimeout(3000, () => probe.destroy());
  probe.on('error', () => { if (++failures >= 6) void stop(); });
}, 15000);
async function stop() { clearInterval(timer); await gateway.close(); process.exit(0); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
gateway.server.once('error', error => { if (error.code === 'EADDRINUSE') { clearInterval(timer); process.exit(0); } });
