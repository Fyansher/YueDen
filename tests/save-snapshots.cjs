const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snapshots = require('../app/save-snapshots');

const scratch = fs.mkdtempSync(path.join(__dirname, '.save-snapshots-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

test('compressed snapshots have readable names, preserve notes and deduplicate content', async () => {
  const root = path.join(scratch, 'compressed'), source = path.join(scratch, 'source');
  fs.mkdirSync(path.join(source, 'slot'), { recursive: true });
  const save = path.join(source, 'slot', 'progress.save');
  const original = 'progress-state\n'.repeat(50000);
  fs.writeFileSync(save, original);
  const storage = snapshots.create(root);
  const first = await storage.backup('local-1789652090386-2dx9whl', [path.join(source, 'slot')], { gameName: '星穹纪行', note: '刚通过第二章，准备挑战 Boss' });
  const second = await storage.backup('local-1789652090386-2dx9whl', [path.join(source, 'slot')], { gameName: '星穹纪行', note: '再次确认相同进度' });
  assert.equal(first.ok, true);
  const listed = storage.list('local-1789652090386-2dx9whl');
  assert.equal(listed.length, 2);
  assert.match(listed[0].manifestHash, /^[a-f0-9]{64}$/);
  assert.match(listed[0].id, /^items\/星穹纪行--[a-f0-9]{10}\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/);
  assert.equal(listed.find(entry => entry.id === second.folder.slice(root.length + 1).replaceAll(path.sep, '/')).note, '再次确认相同进度');
  assert.ok(first.size < Buffer.byteLength(original) / 8);
  assert.equal(files(path.join(root, 'objects')).length, 1);
  const manifest=JSON.parse(fs.readFileSync(path.join(listed[0].folder,'manifest.json'),'utf8')),object=manifest.entries[0].files[0],objectBytes=fs.readFileSync(path.join(root,object.object));
  assert.equal(await snapshots.verifyObjectBytes(object,objectBytes),true);
  assert.equal(await snapshots.verifyObjectFile(object,path.join(root,object.object)),true,'a downloaded file can be verified without buffering its entire compressed payload');
  assert.equal(await snapshots.verifyObjectBytes(object,Buffer.from('corrupt object')),false);
  const currentManifest=JSON.parse(fs.readFileSync(path.join(listed[0].folder,'manifest.json'),'utf8'));manifest.updatedAt='2030-01-01T00:00:00.000Z';manifest.entries[0].source='X:/other-device/save';
  assert.equal(snapshots.manifestHash(manifest),listed[0].manifestHash,'timestamps and device-specific restore paths do not alter snapshot content identity');
  const remote=snapshots.toRemoteManifest(manifest,'device-b');
  assert.equal(remote.entries[0].source,undefined);
  assert.equal(remote.entries[0].sourceByDevice['device-b'],'X:/other-device/save');
  assert.equal(snapshots.restoreManifestForDevice(remote,'device-a',currentManifest).entries[0].source,currentManifest.entries[0].source,'fallback keeps the current machine source path');
  const previousManifestHash=listed[0].manifestHash;
  assert.equal(storage.updateNote('local-1789652090386-2dx9whl',listed[0].id,'更新进度').ok,true);
  assert.notEqual(storage.list('local-1789652090386-2dx9whl').find(entry=>entry.id===listed[0].id).manifestHash,previousManifestHash,'manifest cache refreshes after a note edit');

  fs.writeFileSync(save, 'newer state');
  const restored = await storage.restore('local-1789652090386-2dx9whl', listed[1].id);
  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(save, 'utf8'), original);
  assert.equal(storage.remove('local-1789652090386-2dx9whl', listed[0].id).ok, true);
  assert.equal(files(path.join(root, 'objects')).length, 1, 'shared content remains while another snapshot references it');
  assert.equal(storage.remove('local-1789652090386-2dx9whl', listed[1].id).ok, true);
  assert.equal(files(path.join(root, 'objects')).length, 0);
});

test('legacy copied snapshots remain listable and restorable', async () => {
  const root = path.join(scratch, 'legacy'), gameId = 'game-legacy-id', source = path.join(scratch, 'legacy-save.dat');
  const folder = path.join(root, gameId, '2026-09-28T09-08-07-123Z');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '01-save.dat'), 'old snapshot');
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ itemId: gameId, createdAt: '2026-09-28T09:08:07.123Z', entries: [{ source, target: '01-save.dat' }] }));
  const storage = snapshots.create(root), listed = storage.list(gameId);
  assert.equal(listed.length, 1);
  fs.writeFileSync(source, 'current state');
  assert.equal((await storage.restore(gameId, listed[0].id)).restored, 1);
  assert.equal(fs.readFileSync(source, 'utf8'), 'old snapshot');
});

test('deleted resource snapshots stay visible, can be associated again, and can be cleaned without a resource row',async()=>{
  const root=path.join(scratch,'unlinked'),source=path.join(scratch,'unlinked-save'),oldId='deleted-game-id',newId='reimported-game-id';
  fs.writeFileSync(source,'save data');const storage=snapshots.create(root),created=await storage.backup(oldId,[source],{gameName:'One'}),id=created.folder.slice(root.length+1).replaceAll(path.sep,'/');
  const orphan=storage.listAll([]).find(row=>row.id===id);assert.ok(orphan);assert.equal(orphan.itemId,oldId);assert.equal(orphan.paths[0],source);
  const associated=storage.reassign(id,oldId,newId,'One',{steamAppId:'12345'});assert.equal(associated.ok,true);assert.equal(storage.list(oldId).length,0);assert.equal(storage.list(newId).some(row=>row.id===id),true);
  const removed=storage.removeMany([{itemId:newId,backupId:id}],[]);assert.equal(removed.ok,true);assert.equal(removed.removed.length,1);assert.deepEqual(storage.listAll([]),[]);
});

test('synced manifests update the warm snapshot index without rescanning other snapshots', async () => {
  const root = path.join(scratch, 'incremental-index'), remoteRoot = path.join(scratch, 'incremental-remote'),
    source = path.join(scratch, 'incremental-save.dat'), gameId = 'incremental-game-id', items = [{ id: gameId, name: 'Incremental Game' }],
    local = snapshots.create(root), remote = snapshots.create(remoteRoot);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'remote save state');
  assert.deepEqual(local.listAll(items), [], 'prime the local cache before the cloud snapshot appears');
  const created = await remote.backup(gameId, [source], { gameName: items[0].name });
  assert.equal(created.ok, true);
  const remoteEntry = remote.listAll(items)[0], relativeFolder = remoteEntry.id.split('/').join(path.sep),
    localFolder = path.join(root, relativeFolder), localManifest = path.join(localFolder, 'manifest.json');
  fs.mkdirSync(localFolder, { recursive: true });
  fs.cpSync(path.join(remoteRoot, 'objects'), path.join(root, 'objects'), { recursive: true });
  fs.copyFileSync(path.join(remoteEntry.folder, 'manifest.json'), localManifest);
  const changedManifests = [localManifest];
  for (let index = 0; index < 99; index += 1) {
    const folder = path.join(root, 'items', 'synced-batch-' + index), manifestFile = path.join(folder, 'manifest.json');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(manifestFile, JSON.stringify({ schema: 2, itemId: gameId, gameName: items[0].name, createdAt: new Date(2020, 0, index + 1).toISOString(), entries: [{ files: [] }] }));
    changedManifests.push(manifestFile);
  }

  const originalReadDir = fs.readdirSync;
  fs.readdirSync = function (folder, ...args) {
    if (path.resolve(String(folder)) === path.resolve(root)) throw Error('full snapshot-directory scan was attempted');
    return originalReadDir.call(this, folder, ...args);
  };
  try {
    local.refreshManifestIndex(changedManifests);
    const synced = local.listAll(items);
    assert.equal(synced.length, 100);
    assert.ok(synced.some(entry => entry.id === remoteEntry.id));
    assert.ok(synced.every(entry => entry.gameName === items[0].name));

    for (const manifestFile of changedManifests) fs.rmSync(path.dirname(manifestFile), { recursive: true, force: true });
    local.refreshManifestIndex(changedManifests);
    assert.deepEqual(local.listAll(items), [], 'removed synced manifests are removed from the warm index');
  } finally {
    fs.readdirSync = originalReadDir;
  }
});
