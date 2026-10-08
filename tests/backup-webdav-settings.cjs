const test = require('node:test');
const assert = require('node:assert/strict');
const Backup = require('../app/backup-webdav-settings');
const Secrets = require('../app/secure-settings');

test('full local backups retain WebDAV address, username and remote directory', () => {
  const source = { webdavUrl: 'https://dav.example.test/user/', webdavUsername: 'backup-user', webdavPassword: 'secret', webdavRemotePath: 'YueDen/library' };
  const exported = Backup.exportLocalWebdavSettings(source);
  assert.deepEqual(exported, { webdavUrl: source.webdavUrl, webdavUsername: source.webdavUsername, webdavRemotePath: source.webdavRemotePath });
  assert.equal(Object.hasOwn(exported, 'webdavPassword'), false);
  const imported = Backup.restoreLocalWebdavSettings({ appearance: { theme: 'paper' } }, exported);
  assert.deepEqual(imported, { appearance: { theme: 'paper' }, webdavUrl: source.webdavUrl, webdavUsername: source.webdavUsername, webdavRemotePath: source.webdavRemotePath });
});

test('old backups without local WebDAV fields preserve the importing device settings', () => {
  const current = { webdavUrl: 'https://current.example.test/dav/', webdavUsername: 'current-user', webdavPassword: 'current-password', webdavRemotePath: 'CurrentFolder' };
  const oldBackupSettings = { appearance: { theme: 'paper' } };
  const imported = Backup.restoreLocalWebdavSettings(oldBackupSettings, undefined);
  const resolved = Secrets.create({ directory: () => '' }).resolve(imported, current);
  assert.deepEqual({ webdavUrl: resolved.webdavUrl, webdavUsername: resolved.webdavUsername, webdavPassword: resolved.webdavPassword, webdavRemotePath: resolved.webdavRemotePath }, current);
});

test('malformed optional local WebDAV backup fields do not replace existing settings', () => {
  const current = { webdavUrl: 'https://current.example.test/dav/', webdavUsername: 'current-user', webdavRemotePath: 'CurrentFolder' };
  const imported = Backup.restoreLocalWebdavSettings({}, { webdavUrl: { invalid: true }, webdavUsername: 'new-user', webdavRemotePath: 'x'.repeat(8193) });
  const resolved = Secrets.create({ directory: () => '' }).resolve(imported, current);
  assert.equal(resolved.webdavUrl, current.webdavUrl);
  assert.equal(resolved.webdavUsername, 'new-user');
  assert.equal(resolved.webdavRemotePath, current.webdavRemotePath);
});
