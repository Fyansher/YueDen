const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const State = require('../app/webdav-state');
const Sync = require('../app/webdav-library-sync');

function library(items = []) {
  return { syncFormat: 'yueden-sync-state', syncVersion: 4, syncSchemaVersion:4, schemaVersion: 4, items, categories: [], deletedItems: [], deletedSaveSnapshots: [], playlists:[],referenceRedirects:[],organizationHistory:[], settings: {}, audioConnections: [] };
}
function encoded(value){return JSON.stringify(State.toRemoteState(value));}
function baseLineage(baseState,endpointKey='a'.repeat(64)){return {schemaVersion:2,endpointKey,baseRevision:Sync.contentHash(baseState),baseState};}

test('local comparison recognizes cover bytes, while sync rejects inline cover payloads', async () => {
  const bytes = Buffer.from('same cover bytes'), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const local = library([{ id: 'resource', coverLandscape: `um-cover://image/${hash}.jpg`, updatedAt: '2026-09-29T08:00:00Z' }]);
  const cloud = library([{ coverLandscape: `data:image/jpeg;base64,${bytes.toString('base64')}`, id: 'resource', updatedAt: '2026-09-30T08:00:00Z' }]);
  assert.equal(State.same(local, cloud), true);
  const inline={...cloud,contentRevision:State.contentRevision(cloud),syncRevision:State.syncRevision(cloud)};
  await assert.rejects(Sync.snapshot(new Response(JSON.stringify(inline),{status:200})),/内嵌封面/);
});

test('local paths stay per device and incoming backups keep the current device paths', () => {
  const local = library([{ id: 'game', localPath: 'D:/Games/Local', localFiles: [{ path: 'D:/Games/Local/game.exe' }], savePaths: ['D:/Saves/game'], audio: { sources: [{ id: 'src', kind: 'local', localPath: 'D:/Music' }] } }]);
  const prepared = State.prepareLocalState(local, 'device-a');
  assert.equal(prepared.items[0].localPath, undefined);
  assert.equal(prepared.items[0].deviceLocations['device-a'].localPath, 'D:/Games/Local');
  assert.equal(prepared.items[0].audio.sources[0].localPath, undefined);
  const restored = State.restoreLocalLibrary(prepared, 'device-b', { items: [{ id: 'game', localPath: 'E:/Games/Local', savePaths: ['E:/Saves/game'] }] });
  assert.equal(restored.items[0].localPath, 'E:/Games/Local');
  assert.deepEqual(restored.items[0].savePaths, ['E:/Saves/game']);
  assert.equal(restored.items[0].audio.sources[0].localPath, undefined);
  const imported = State.restoreDeviceSettings({ deviceSettings: { 'device-a': { obsidianRoot: 'D:/Notes' } }, obsidianRoot: 'D:/Notes' }, { obsidianRoot: 'E:/Notes', localScanPaths: ['E:/Games'] }, 'device-b');
  assert.equal(imported.obsidianRoot, 'E:/Notes');
  assert.deepEqual(imported.localScanPaths, ['E:/Games']);
});

test('resource deletion without a common base is an unknown conflict instead of silently winning', () => {
  const base = library([{ id: 'gone', name: 'Deleted game' }]);
  const local = { ...base, items: [], deletedItems: [{ id: 'gone', deletedAt: '2026-09-30T00:00:00Z' }] };
  const remote = { ...base, items: [{ id: 'gone', name: 'Deleted game' }] };
  const comparison = Sync.compare(local, remote);
  assert.equal(comparison.unknownItems.length, 1);
  assert.equal(comparison.unknownItems[0].id, 'gone');
  assert.throws(() => Sync.merge(local, remote), /无法无歧义合并/);
});

test('a recorded one-sided deletion waits for a sync choice, then merges when selected', async () => {
  const base = library([{ id: 'gone', name: 'Deleted game' }]), baseState = State.toBaseState(base);
  const lineage = baseLineage(baseState);
  const local = { ...base, items: [], deletedItems: [{ id: 'gone', deletedAt: '2026-09-30T00:00:00Z' }], lineage };
  const remote = { ...base, lineage };
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"7"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const options={local,direction:'bidirectional',get:async()=>response(),backup:async()=>{}};
  const first=await Sync.plan(options);
  assert.equal(first.needsDecision,true);
  const prepared=await Sync.plan({...options,resolution:'merge',expectedVersion:first.preview.version});
  assert.equal(prepared.needsDecision,undefined);
  assert.deepEqual(prepared.state.items, []);
  assert.equal(prepared.state.deletedItems[0].id, 'gone');
});

test('remote sync state retains a verifiable common base but strips local backup-only settings and secrets', () => {
  const base = library([{ id: 'game', name: 'Game' }]);
  const baseState = State.toBaseState(base);
  const remote = State.toRemoteState({ ...base, localDeviceId: 'device-a', backupSecrets: { password: 'private', localWebdavSettings: { webdavUrl: 'https://private.example.test/', webdavUsername: 'private-user' } }, lineage: baseLineage(baseState) });
  assert.equal(remote.localDeviceId, undefined);
  assert.equal(remote.backupSecrets, undefined);
  assert.equal(Sync.hasLineage(remote).items[0].id, 'game');
  assert.equal(Sync.sameSyncedDocument(remote, { ...remote, lineage: undefined }), false);
  assert.equal(Sync.sameSyncedDocument(remote, { ...remote, lineage: { ...remote.lineage } }), true);
});

test('lineage without an endpoint identity is discarded instead of migrated', () => {
  const bytes = Buffer.from('shared cover'), cover = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const baseState = State.toBaseState(library([{ id: 'game', name: 'Game', coverLandscape: cover }]));
  const revision = Sync.contentHash(baseState), lineage = State.compactLineage({ schemaVersion: 1, baseRevision: revision, baseState });
  assert.equal(lineage,null);
});

test('confirmation token changes when content changes even if WebDAV validators do not', async () => {
  const first = library([{ id: 'game', name: 'Old name' }]), second = library([{ id: 'game', name: 'New name' }]);
  const response = state => new Response(encoded(state), { status: 200, headers: { etag: '"same"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const a = await Sync.snapshot(response(first)), b = await Sync.snapshot(response(second));
  assert.notEqual(a.version, b.version);
});

test('comparison separates identical, one-sided, and unknown resources without using timestamps', () => {
  const local = library([{ id: 'same', name: 'Same' }, { id: 'local', name: 'Local only' }, { id: 'conflict', name: 'Local title' }]);
  const remote = library([{ id: 'same', name: 'Same' }, { id: 'cloud', name: 'Cloud only' }, { id: 'conflict', name: 'Cloud title' }]);
  const result = Sync.compare(local, remote);
  assert.equal(result.sameCount, 1);
  assert.equal(result.localNewer, 1);
  assert.equal(result.remoteNewer, 1);
  assert.equal(result.unknownItems.length, 1);
  assert.equal(result.unknownItems[0].label, 'Local title');
  assert.deepEqual(result.unknownItems[0].fields, [{ name: 'name', local: 'Local title', remote: 'Cloud title' }]);
});

test('comparison includes all resource data fields instead of targeting progress alone', () => {
  const baseItem = { id: 'resource', name: 'Title', status: 'In progress', rating: 2, review: 'Old review', description: 'Old description', genres: ['Drama'], platforms: ['pc'], resourceUrl: 'https://example.invalid/old', coverLandscape: 'old-cover' };
  for (const [field, value] of [
    ['name', 'New title'], ['status', 'Completed'], ['rating', 5], ['review', 'New review'],
    ['description', 'New description'], ['genres', ['Action']], ['platforms', ['console']],
    ['resourceUrl', 'https://example.invalid/new'], ['coverLandscape', 'new-cover']
  ]) {
    const local = library([{ ...baseItem, [field]: value }]), remote = library([baseItem]);
    assert.equal(Sync.compare(local, remote).equal, false, `field ${field} must participate in comparison`);
  }
});

test('A/B/C are classified independently while D alone waits for the user', async () => {
  const base = library([
    { id: 'A', name: 'Same' },
    { id: 'B', name: 'Local newer', rating: 1 },
    { id: 'C', name: 'Cloud older' },
    { id: 'D', name: 'Original D' }
  ]);
  const baseState = State.toBaseState(base), lineage = baseLineage(baseState);
  const local = { ...base, items: [base.items[0], { ...base.items[1], rating: 5 }, base.items[2], { ...base.items[3], name: 'Local D' }], lineage };
  const remote = { ...base, items: [base.items[0], base.items[1], { ...base.items[2], description: 'Cloud change' }, { ...base.items[3], name: 'Cloud D' }], lineage };
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"6"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const options = { local, direction: 'bidirectional',endpointKey:'a'.repeat(64), get: async () => response(), backup: async () => {} };
  const first = await Sync.plan(options), comparison = first.preview.comparison;
  assert.equal(comparison.sameCount, 1);
  assert.equal(comparison.localNewer, 1);
  assert.equal(comparison.remoteNewer, 1);
  assert.deepEqual(comparison.unknownItems.map(row => row.id), ['D']);
  const prepared = await Sync.plan({ ...options, resolution: { decisions: { [comparison.unknownItems[0].key]: 'remote' } }, expectedVersion: first.remoteSnapshot.version });
  assert.equal(prepared.state.items.find(row => row.id === 'B').rating, 5);
  assert.equal(prepared.state.items.find(row => row.id === 'C').description, 'Cloud change');
  assert.equal(prepared.state.items.find(row => row.id === 'D').name, 'Cloud D');
});

test('bidirectional sync asks for a whole-library choice before resolving unknown resources', async () => {
  const local = library([{ id: 'same', name: 'Same' }, { id: 'local', name: 'Local only' }, { id: 'conflict', name: 'Local title' }]);
  const remote = library([{ id: 'same', name: 'Same' }, { id: 'cloud', name: 'Cloud only' }, { id: 'conflict', name: 'Cloud title' }]);
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"1"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const options = { local, direction: 'bidirectional',endpointKey:'b'.repeat(64), get: async () => response(), backup: async () => {} };
  const first = await Sync.plan(options);
  assert.equal(first.needsDecision, true);
  assert.equal(first.preview.comparison.unknownItems.length, 1);
  const second = await Sync.plan({ ...options, resolution: { decisions: { [first.preview.comparison.unknownItems[0].key]: 'local' } }, expectedVersion: first.remoteSnapshot.version });
  assert.equal(second.needsDecision, undefined);
  assert.deepEqual(new Set(second.state.items.map(row => row.id)), new Set(['same', 'local', 'cloud', 'conflict']));
  assert.equal(second.state.items.find(row => row.id === 'conflict').name, 'Local title');
  assert.equal(Sync.hasLineage(second.state).items.length, 4);
});

test('a recorded common base identifies one-sided edits and merge applies them after confirmation', async () => {
  const base = library([{ id: 'game', name: 'Game', rating: 1 }]);
  const baseState = State.toBaseState(base), lineage = baseLineage(baseState);
  const local = { ...base, items: [{ ...base.items[0], rating: 4 }], lineage };
  const remote = { ...base, lineage };
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"2"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const options={local,direction:'bidirectional',endpointKey:'a'.repeat(64),get:async()=>response(),backup:async()=>{}};
  const first=await Sync.plan(options);
  assert.equal(first.needsDecision,true);
  const prepared=await Sync.plan({...options,resolution:'merge',expectedVersion:first.preview.version});
  assert.equal(prepared.needsDecision, undefined);
  assert.equal(prepared.comparison.localNewer, 1);
  assert.equal(prepared.state.items[0].rating, 4);
});

test('changes to separate fields of the same resource merge after the user chooses merge', async () => {
  const base = library([{ id: 'game', name: 'Game', rating: 1, review: 'old' }]);
  const baseState = State.toBaseState(base), lineage = baseLineage(baseState);
  const local = { ...base, items: [{ ...base.items[0], rating: 4 }], lineage };
  const remote = { ...base, items: [{ ...base.items[0], review: 'new' }], lineage };
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"3"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const options={local,direction:'bidirectional',endpointKey:'a'.repeat(64),get:async()=>response(),backup:async()=>{}};
  const first=await Sync.plan(options);
  assert.equal(first.needsDecision,true);
  const prepared=await Sync.plan({...options,resolution:'merge',expectedVersion:first.preview.version});
  assert.equal(prepared.needsDecision, undefined);
  assert.equal(prepared.comparison.autoMerged, 1);
  assert.equal(prepared.state.items[0].rating, 4);
  assert.equal(prepared.state.items[0].review, 'new');
});

test('first sync records the shared state even when both sides already match', async () => {
  const local = library([{ id: 'game', name: 'Game' }]), remote = library([{ id: 'game', name: 'Game' }]);
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"4"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const prepared = await Sync.plan({ local, direction: 'bidirectional',endpointKey:'b'.repeat(64), get: async () => response(), backup: async () => {} });
  assert.equal(prepared.comparison.equal, true);
  assert.equal(Sync.hasLineage(prepared.state).items[0].id, 'game');
  assert.equal(Sync.sameSyncedDocument(prepared.state, remote), false);
});

test('choosing a conflicting setting preserves unrelated changes from both sides', async () => {
  const local = { ...library(), settings: { appearance: { theme: 'paper', density: 'comfortable' }, localOnly: true } };
  const remote = { ...library(), settings: { appearance: { theme: 'ocean', accent: '#65d8b0' }, cloudOnly: true } };
  const response = () => new Response(encoded(remote), { status: 200, headers: { etag: '"5"', 'last-modified': 'Wed, 30 Sep 2026 00:00:00 GMT' } });
  const options = { local, direction: 'bidirectional', get: async () => response(), backup: async () => {} };
  const first = await Sync.plan(options), unit = first.preview.comparison.unknownItems[0];
  assert.equal(unit.path, 'settings.appearance.theme');
  const prepared = await Sync.plan({ ...options, resolution: { decisions: { [unit.key]: 'remote' } }, expectedVersion: first.remoteSnapshot.version });
  assert.equal(prepared.state.settings.appearance.theme, 'ocean');
  assert.equal(prepared.state.settings.appearance.density, 'comfortable');
  assert.equal(prepared.state.settings.appearance.accent, '#65d8b0');
  assert.equal(prepared.state.settings.localOnly, true);
  assert.equal(prepared.state.settings.cloudOnly, true);
});
