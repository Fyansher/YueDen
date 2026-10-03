const test = require('node:test');
const assert = require('node:assert/strict');
const Delete = require('../app/webdav-save-delete');

function response(status, body = '') {
  return { status, ok: status >= 200 && status < 300, text: async () => body, body: { cancel: async () => {} } };
}

test('remote snapshot deletion keeps shared blobs and removes unreferenced blobs', async () => {
  const target = 'items/星穹纪行--aaaa/2026-09-29_10-00-00';
  const sibling = 'items/星穹纪行--aaaa/2026-09-30_10-00-00';
  const shared = 'objects/11/1111111111111111111111111111111111111111111111111111111111111111.gz';
  const unique = 'objects/22/2222222222222222222222222222222222222222222222222222222222222222.gz';
  const manifest = entries => JSON.stringify({ schema: 2, itemId: 'game', entries: entries.map(object => ({ files: [{ object }] })) });
  const remote = new Map([
    [`saves/${target}/manifest.json`, manifest([shared, unique])],
    [`saves/${sibling}/manifest.json`, manifest([shared])],
    [`saves/${shared}`, 'shared'], [`saves/${unique}`, 'unique'],
  ]);
  const requests = [];
  const remove = Delete.create({
    listFiles: async () => [...remote.keys()],
    request: async (_settings, method, relative) => {
      requests.push([method, relative]); const key = `saves/${relative}`;
      if (method === 'GET') return remote.has(key) ? response(200, remote.get(key)) : response(404);
      if (method === 'DELETE') { if (!remote.has(key)) return response(404); remote.delete(key); return response(204); }
      return response(405);
    },
  });
  const result = await remove({}, target);
  assert.equal(result.ok, true);
  assert.equal(result.cleanedObjects, 1);
  assert.equal(remote.has(`saves/${target}/manifest.json`), false);
  assert.equal(remote.has(`saves/${shared}`), true);
  assert.equal(remote.has(`saves/${unique}`), false);
  assert.ok(requests.some(([method, relative]) => method === 'DELETE' && relative === unique));
  assert.ok(!requests.some(([method, relative]) => method === 'DELETE' && relative === shared));
});

test('unsafe remote snapshot paths and unsupported deletion leave remote files untouched', async () => {
  let deleted = 0;
  const remove = Delete.create({
    listFiles: async () => ['saves/game/snapshot/manifest.json'],
    request: async (_settings, method) => { if (method === 'DELETE') { deleted += 1; return response(403); } return response(200, JSON.stringify({ itemId: 'game', entries: [] })); },
  });
  await assert.rejects(remove({}, '../outside'), /路径无效/);
  await assert.rejects(remove({}, 'game/snapshot'), /HTTP 403/);
  assert.equal(deleted, 1);
});
