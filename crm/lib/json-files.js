'use strict';
const fs = require('node:fs');
async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}
module.exports = { readOptionalJson };

async function readSmallJson(filePath, limit = 65536) {
  let file;
  try {
    file = await fs.promises.open(filePath, 'r');
    if ((await file.stat()).size > limit) return {};
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) return {};
    const value=JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  } catch { return {}; }
  finally { await file?.close().catch(() => {}); }
}
module.exports.readSmallJson = readSmallJson;
