const crypto = require('node:crypto');
const WebdavClient = require('./webdav-client');

function normalizedBase(value) {
  const url = WebdavClient.address(value);
  url.hash = '';
  url.search = '';
  const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return url.origin.toLowerCase() + pathname;
}

function normalizedRemotePath(value) {
  const parts = String(WebdavClient.configuredRemotePath({ webdavRemotePath: value }) || '').replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) throw Error('WebDAV 目录不能包含 . 或 ..');
  return parts.map(part => {
    try { return decodeURIComponent(part).normalize('NFC'); }
    catch { return part.normalize('NFC'); }
  }).join('/');
}

function key(settings) {
  const identity = [normalizedBase(settings), String(settings?.webdavUsername || ''), normalizedRemotePath(settings?.webdavRemotePath)];
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

module.exports = { key, normalizedBase, normalizedRemotePath };
