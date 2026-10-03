'use strict';

const CONTEXT = Object.freeze({
  IMMEDIATE_BACKUP: 'immediate-backup',
  ITEM_RETRY: 'item-retry',
  SETTINGS_SYNC: 'settings-sync'
});

async function createLocalSnapshot(backup, onLocalSnapshot = async () => {}) {
  const snapshot = await backup();
  if (!snapshot?.ok) return snapshot;
  await onLocalSnapshot(snapshot);
  return snapshot;
}

async function retrySnapshot(id, { load, sync, context = CONTEXT.ITEM_RETRY }) {
  const entry = await load(id);
  if (!entry) return { ok: false, message: '存档快照不存在或不属于当前游戏' };
  return sync(entry, context);
}

function hasPendingSnapshots(entries, syncIndex = {}) {
  return (entries || []).some(entry => syncIndex[entry.id]?.manifestHash !== (entry.manifestHash || entry.manifestRevision));
}

async function transferSnapshotBatch(entries, transfer, { concurrency = 3, context = CONTEXT.SETTINGS_SYNC } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  const results = new Array(rows.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(rows.length, Math.max(1, Math.floor(concurrency) || 1)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      try { results[index] = { ok: true, entry: rows[index], result: await transfer(rows[index], context) }; }
      catch (error) { results[index] = { ok: false, entry: rows[index], error }; }
    }
  });
  await Promise.all(workers);
  return {
    ok: results.every(row => row.ok),
    results,
    successes: results.filter(row => row.ok),
    failures: results.filter(row => !row.ok)
  };
}

async function confirmSnapshotUploads(rows, { publishCatalog, markSynced, markSyncedBatch }) {
  const confirmed = Array.isArray(rows) ? rows : [];
  const publication = await publishCatalog(confirmed);
  await markSnapshotUploads(confirmed,{markSynced,markSyncedBatch});
  return publication;
}

async function publishSnapshotCatalog(rows,publishCatalog){return publishCatalog(Array.isArray(rows)?rows:[]);}

async function markSnapshotUploads(rows,{markSynced,markSyncedBatch}={}){
  const confirmed=Array.isArray(rows)?rows:[];
  const normalized=confirmed.map(row=>({snapshot:row.entry||row,verification:row.result?.verification||row.verification||{}}));
  if(markSyncedBatch)return markSyncedBatch(normalized);
  for(const row of normalized)await markSynced(row.snapshot,row.verification);
}

module.exports = { CONTEXT, createLocalSnapshot, retrySnapshot, hasPendingSnapshots, transferSnapshotBatch, publishSnapshotCatalog, markSnapshotUploads, confirmSnapshotUploads };
