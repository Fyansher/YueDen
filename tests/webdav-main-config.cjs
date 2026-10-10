const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Webdav=require('../app/webdav-client');

test('main settings use the module-level configured remote path helper',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');
  assert.equal(typeof Webdav.configuredRemotePath,'function');
  assert.equal(typeof Webdav.create().configuredRemotePath,'undefined');
  assert.equal((main.match(/webdavProtocol\.configuredRemotePath\(/g)||[]).length,3);
  assert.doesNotMatch(main,/webdavClient\.configuredRemotePath\(/);
});

test('immediate save upload aborts an incidental remote snapshot listing before taking the write lock',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');
  assert.match(main,/webdavOperationSignal=AbortSignal\.any\(\[controller\.signal,AbortSignal\.timeout\(60000\)\]\)/);
  assert.match(main,/if\(webdavNetworkOperation==='save-list'\)\{\s*const pending=webdavOperationDone;\s*webdavDiagnosticLog\.write\([\s\S]{0,180}?webdavOperationController\?\.abort\(\);\s*await pending;/);
  const renderer=fs.readFileSync(path.join(__dirname,'../app/renderer.js'),'utf8');
  assert.match(renderer,/refreshSnapshotIndex\(true,true,false\);await renderBackupList\(\{includeRemote:false\}\)/);
  assert.match(renderer,/remoteSnapshotListRequests\.get\(key\)/);
});
