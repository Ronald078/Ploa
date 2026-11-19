'use strict';
const { gzip, constants } = require('node:zlib');

function acceptsGzip(header = '') {
  const encodings = String(header).split(',').map(value => {
    const [name, ...parameters] = value.trim().toLowerCase().split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='));
    return { name, quality: quality === undefined ? 1 : Number(quality.trim().slice(2)) };
  });
  const gzip = encodings.find(item => item.name === 'gzip');
  return (gzip || encodings.find(item => item.name === '*'))?.quality > 0;
}

// Large snapshots stay identical after decompression. Nothing is cached on disk,
// and asynchronous, low-cost compression leaves the event loop available.
function endJson(response, status, payload) {
  const content = Buffer.from(JSON.stringify(payload));
  const finish = (body, compressed = false) => {
    if (response.destroyed || response.writableEnded) return;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length };
    if (compressed) headers['Content-Encoding'] = 'gzip';
    response.writeHead(status, headers);
    response.end(body);
  };
  response.setHeader('Vary', 'Accept-Encoding');
  if (status !== 200 || content.length < 32768 || !acceptsGzip(response.req?.headers['accept-encoding'])) {
    finish(content);
    return;
  }
  gzip(content, { level: constants.Z_BEST_SPEED }, (error, compressed) => {
    const useCompressed = !error && compressed.length < content.length;
    finish(useCompressed ? compressed : content, useCompressed);
  });
}

module.exports = { acceptsGzip, endJson };
