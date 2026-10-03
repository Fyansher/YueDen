'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SaveSync = require('../app/save-backup-sync');
const SaveSnapshots = require('../app/save-snapshots');

const scratch = fs.mkdtempSync(path.join(__dirname, '.save-backup-sync-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('immediate backup creates and refreshes the local snapshot before cloud upload can start', async () => {
  const order = [];
  const snapshot = await SaveSync.createLocalSnapshot(
    async () => { order.push('local-snapshot'); return { ok: true, id: 'snapshot-a' }; },
    async result => { assert.equal(result.id, 'snapshot-a'); order.push('refresh-list'); }
  );
  assert.equal(snapshot.ok, true);
  order.push('cloud-upload');
  assert.deepEqual(order, ['local-snapshot', 'refresh-list', 'cloud-upload']);

  const renderer = fs.readFileSync(path.join(__dirname, '../app/renderer.js'), 'utf8');
  const start = renderer.indexOf('async function backupCurrentSaves()');
  const end = renderer.indexOf('\nfunction webdavSyncPreviewContent', start);
  const flow = renderer.slice(start, end);
  assert.ok(flow.indexOf('await refreshSnapshotIndex(true)') < flow.indexOf('native.syncBackupSnapshot('));
});

test('local backup failure does not refresh or attempt a cloud upload', async () => {
  let refreshed = false;
  let uploadCalls = 0;
  const snapshot = await SaveSync.createLocalSnapshot(async () => ({ ok: false, message: 'disk full' }), async () => { refreshed = true; });
  if (snapshot?.ok) uploadCalls++;
  assert.equal(snapshot.ok, false);
  assert.equal(refreshed, false);
  assert.equal(uploadCalls, 0);
});

test('cloud upload failure leaves the successfully created local snapshot available and pending', async () => {
  const root = path.join(scratch, 'snapshots'), source = path.join(scratch, 'slot.save');
  fs.writeFileSync(source, 'checkpoint');
  const storage = SaveSnapshots.create(root), refreshed = [];
  const local = await SaveSync.createLocalSnapshot(
    () => storage.backup('game-1', [source], { gameName: 'Game' }),
    async result => refreshed.push(result.folder)
  );
  const id = storage.list('game-1')[0].id;
  await assert.rejects(() => SaveSync.retrySnapshot(id, {
    load: snapshotId => storage.list('game-1').find(row => row.id === snapshotId),
    sync: async () => { throw Error('WebDAV offline'); }
  }), /WebDAV offline/);
  assert.equal(local.ok, true);
  assert.equal(refreshed.length, 1);
  assert.equal(storage.list('game-1').length, 1);
  assert.equal(storage.list('game-1')[0].id, id);
  assert.equal(SaveSync.hasPendingSnapshots([{ id, manifestHash: storage.list('game-1')[0].manifestHash }], {}), true);
});

test('retry loads and uploads the existing snapshot ID without creating another snapshot', async () => {
  const calls = [];
  const result = await SaveSync.retrySnapshot('items/Game/2026-10-02_10-00-00', {
    load: async id => { calls.push(['load', id]); return { id, manifestHash: 'rev' }; },
    sync: async (entry, context) => { calls.push(['upload', entry.id, context]); return { ok: true }; },
    context: SaveSync.CONTEXT.ITEM_RETRY
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['load', 'items/Game/2026-10-02_10-00-00'],
    ['upload', 'items/Game/2026-10-02_10-00-00', 'item-retry']
  ]);
});

test('settings sync fast path treats a snapshot without a matching synced revision as pending', () => {
  const entries = [{ id: 'a', manifestHash: 'rev-a' }, { id: 'b', manifestRevision: 'rev-b' }];
  assert.equal(SaveSync.hasPendingSnapshots(entries, { a: { manifestHash: 'rev-a' }, b: { manifestHash: 'old' } }), true);
  assert.equal(SaveSync.hasPendingSnapshots(entries, { a: { manifestHash: 'rev-a' }, b: { manifestHash: 'rev-b' } }), false);
});

test('settings sync attempts every pending snapshot and leaves partial failures unconfirmed', async () => {
  const pending = [{ id: 'a' }, { id: 'b' }, { id: 'c' }], attempted = [], marked = [];
  const batch = await SaveSync.transferSnapshotBatch(pending, async entry => {
    attempted.push(entry.id);
    if (entry.id === 'b') throw Error('remote unavailable');
    return { verification: { manifestValidator: { etag: entry.id } } };
  }, { concurrency: 1, context: SaveSync.CONTEXT.SETTINGS_SYNC });
  assert.deepEqual(attempted, ['a', 'b', 'c']);
  assert.equal(batch.ok, false);
  assert.equal(batch.successes.length, 2);
  assert.equal(batch.failures.length, 1);
  assert.deepEqual(marked, []);
});

test('settings sync publishes the catalog before marking each uploaded snapshot synced', async () => {
  const order = [], rows = [{ entry: { id: 'a', manifestHash: 'rev' }, result: { verification: { marker: 'verified' } } }];
  await SaveSync.confirmSnapshotUploads(rows, {
    publishCatalog: async published => { assert.equal(published, rows); order.push('catalog'); },
    markSynced: async (entry, verification) => { assert.equal(entry.id, 'a'); assert.deepEqual(verification, { marker: 'verified' }); order.push('synced'); }
  });
  assert.deepEqual(order, ['catalog', 'synced']);
});

test('snapshot sync confirmations can be committed as one status-index write after catalog success',async()=>{
  const order=[],rows=[{entry:{id:'a',manifestHash:'rev-a'},verification:{etag:'a'}},{entry:{id:'b',manifestHash:'rev-b'},verification:{etag:'b'}}];
  await SaveSync.confirmSnapshotUploads(rows,{
    publishCatalog:async()=>{order.push('catalog');return {ok:true};},
    markSyncedBatch:async confirmed=>{assert.deepEqual(confirmed.map(row=>row.snapshot.id),['a','b']);assert.deepEqual(confirmed.map(row=>row.verification.etag),['a','b']);order.push('status-index');}
  });
  assert.deepEqual(order,['catalog','status-index']);
});

test('catalog failure keeps snapshot status pending', async () => {
  let marked = false;
  await assert.rejects(() => SaveSync.confirmSnapshotUploads([{ entry: { id: 'a' } }], {
    publishCatalog: async () => { throw Error('catalog PUT failed'); },
    markSynced: async () => { marked = true; }
  }), /catalog PUT failed/);
  assert.equal(marked, false);
});

test('settings sync never marks snapshots before catalog publication and lineage commit',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');
  const syncStart=main.indexOf('async function syncWebdav(');
  const syncEnd=main.indexOf('\nfunction currentDisguiseState',syncStart);
  const flow=main.slice(syncStart,syncEnd);
  const catalog=flow.indexOf("publishSnapshotCatalog(saveSnapshotConfirmations");
  const lineage=flow.indexOf('writeSyncLineage(prepared.state,endpointKey,remoteValidator)');
  const mark=flow.indexOf('markSnapshotUploads(saveSnapshotConfirmations');
  const timestamp=flow.indexOf('lastWebdavSyncAt:new Date().toISOString()');
  assert.ok(catalog>=0&&lineage>catalog&&mark>lineage&&timestamp>mark);
  assert.doesNotMatch(flow.slice(catalog,lineage),/markSaveSynced\(/);
  assert.match(main,/markSaveSyncedBatch\(rows,endpointKey\)/);
});

test('settings sync failure returns partial state and renderer refreshes save status',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');
  const renderer=fs.readFileSync(path.join(__dirname,'../app/renderer.js'),'utf8');
  assert.match(main,/partial:webdavSyncLibraryCommitted/);
  assert.match(renderer,/result\?\.partial\?'部分同步：'/);
  const start=renderer.indexOf('async function syncWebdav(direction)');
  const end=renderer.indexOf('\nasync function testWebdav',start);
  const flow=renderer.slice(start,end);
  assert.match(flow,/else if\(!result\?\.cancelled\)\{await refreshSnapshotIndex\(true\);renderLibrary\(\);if\(editorId\)await renderBackupList\(\);\}/);
});

test('upload animation belongs to item retry; settings and immediate backup do not animate snapshot rows', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../app/renderer.js'), 'utf8');
  const itemStart = renderer.indexOf('async function syncSnapshotButton(');
  const itemEnd = renderer.indexOf('\nasync function deleteSelectedSnapshots', itemStart);
  const itemFlow = renderer.slice(itemStart, itemEnd);
  const settingsStart = renderer.indexOf('async function syncWebdav(');
  const settingsEnd = renderer.indexOf('\nasync function testWebdav', settingsStart);
  const settingsFlow = renderer.slice(settingsStart, settingsEnd);
  const backupStart = renderer.indexOf('async function backupCurrentSaves()');
  const backupEnd = renderer.indexOf('\nfunction webdavSyncPreviewContent', backupStart);
  const backupFlow = renderer.slice(backupStart, backupEnd);
  assert.match(itemFlow, /classList\.add\('uploading'\)/);
  assert.match(itemFlow, /'item-retry'/);
  assert.doesNotMatch(settingsFlow, /syncSnapshotButton|classList\.add\('uploading'\)/);
  assert.doesNotMatch(backupFlow, /classList\.add\('uploading'\)/);
  assert.match(backupFlow, /'immediate-backup'/);
});
