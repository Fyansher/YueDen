function normalizedRelative(value) {
  const raw = String(value || '').replaceAll('\\', '/');
  const parts = raw.split('/');
  if (!raw || raw.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) throw Error('存档快照路径无效');
  return parts.join('/');
}
function referencedObjects(manifest) {
  const result = new Set();
  for (const entry of manifest?.entries || []) for (const file of entry.files || []) {
    const object = String(file.object || '').replaceAll('\\', '/');
    if (object.startsWith('objects/') && !object.split('/').some(part => part === '..')) result.add(object);
  }
  return result;
}
function create({ listFiles, request, maxManifests = 1000 }) {
  async function deleteSnapshots(settings, snapshotIds) {
    const ids = [...new Set((snapshotIds || []).map(normalizedRelative))];
    if (!ids.length) return { ok: true, snapshotFound: false, deletedSnapshots: 0, deletedFiles: 0, cleanedObjects: 0 };
    const prefixes = ids.map(id => `saves/${id}/`);
    const files = await listFiles(settings, 'saves');
    const targetFiles = files.filter(file => prefixes.some(prefix => file.startsWith(prefix)));
    if (!targetFiles.length) return { ok: true, snapshotFound: false, deletedSnapshots: 0, deletedFiles: 0, cleanedObjects: 0 };
    const manifestFiles = files.filter(file => file.startsWith('saves/') && file.endsWith('/manifest.json'));
    if (manifestFiles.length > maxManifests) throw Error(`远端存档清单超过安全核对上限（${maxManifests}），为避免误删共用数据，本次未删除`);
    const targetManifestPaths = new Set(manifestFiles.filter(file => prefixes.some(prefix => file.startsWith(prefix))));
    const targetRefs = new Set();
    const remainingRefs = new Set();
    async function readManifest(relative) {
      const response = await request(settings, 'GET', relative.slice('saves/'.length));
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw Error(`无法读取远端存档清单（HTTP ${response.status}），未删除本地快照`); }
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw Error('远端存档清单超过读取上限，本次未删除');
      try { return JSON.parse(text); } catch { throw Error('远端存档清单格式无效，本次未删除'); }
    }
    for (const file of manifestFiles) {
      const manifest = await readManifest(file);
      if (!manifest) continue;
      const refs = referencedObjects(manifest);
      for (const ref of refs) (targetManifestPaths.has(file) ? targetRefs : remainingRefs).add(ref);
    }
    let deletedFiles = 0;
    const ordered = [...targetFiles.filter(file => !targetManifestPaths.has(file)), ...targetFiles.filter(file => targetManifestPaths.has(file))];
    for (const file of ordered) {
      const response = await request(settings, 'DELETE', file.slice('saves/'.length));
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw Error(`删除远端存档失败（HTTP ${response.status}），本地快照已保留，可重试`);
      if (response.status !== 404) deletedFiles += 1;
    }
    let cleanedObjects = 0, cleanupFailed = false;
    for (const object of targetRefs) {
      if (remainingRefs.has(object)) continue;
      const remote = `saves/${object}`;
      if (!files.includes(remote)) continue;
      try {
        const response = await request(settings, 'DELETE', object);
        await response.body?.cancel();
        if (!response.ok && response.status !== 404) cleanupFailed = true;
        else if (response.status !== 404) cleanedObjects += 1;
      } catch { cleanupFailed = true; }
    }
    return { ok: true, snapshotFound: true, deletedSnapshots: new Set(ordered.filter(file => targetManifestPaths.has(file)).map(file => file.slice('saves/'.length).replace(/\/manifest\.json$/, ''))).size, deletedFiles, cleanedObjects, cleanupFailed };
  }
  const deleteSnapshot = async (settings, snapshotId) => deleteSnapshots(settings, [snapshotId]);
  return Object.assign(deleteSnapshot, { deleteSnapshots });
}
module.exports = { create, normalizedRelative, referencedObjects };
