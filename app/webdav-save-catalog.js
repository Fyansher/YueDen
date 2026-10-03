'use strict';

const crypto = require('node:crypto');

function objectRefs(entries = []) {
  const refs = new Map();
  for (const entry of entries || []) for (const file of entry?.files || []) {
    if (!file?.object) continue;
    const object = String(file.object).replaceAll('\\', '/');
    if (!/^objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:gz|bin)$/i.test(object)) throw Error('存档清单包含无效对象路径');
    const ref = { object, sha256: String(file.sha256 || ''), size: Number(file.size), storedSize: Number(file.storedSize), encoding: String(file.encoding || '') };
    if (!/^[a-f0-9]{64}$/i.test(ref.sha256) || object !== `objects/${ref.sha256.slice(0, 2)}/${ref.sha256}.${ref.encoding === 'gzip' ? 'gz' : 'bin'}` || !Number.isFinite(ref.size) || ref.size < 0 || !Number.isFinite(ref.storedSize) || ref.storedSize < 0 || !['gzip', 'raw'].includes(ref.encoding)) throw Error('存档清单包含无效对象校验信息');
    const previous = refs.get(object);
    if (previous && JSON.stringify(previous) !== JSON.stringify(ref)) throw Error('存档清单对同一对象记录了不同校验信息');
    refs.set(object, ref);
  }
  return [...refs.values()].sort((a, b) => a.object.localeCompare(b.object));
}

function normalizeEntry(row) {
  const manifestRevision = row?.manifestHash || row?.manifestRevision;
  if (!row?.id || !manifestRevision) throw Error('存档索引包含缺少标识或修订号的条目');
  const id = String(row.id).replaceAll('\\', '/');
  if (!id || id.split('/').some(part => !part || part === '.' || part === '..')) throw Error('存档索引包含无效快照路径');
  const objects = Array.isArray(row.objects) ? row.objects.map(ref => ({ object: String(ref.object || '').replaceAll('\\', '/'), sha256: String(ref.sha256 || ''), size: Number(ref.size), storedSize: Number(ref.storedSize), encoding: String(ref.encoding || '') })).sort((a, b) => a.object.localeCompare(b.object)) : [];
  for (const ref of objects) {
    if (!/^objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:gz|bin)$/i.test(ref.object) || !/^[a-f0-9]{64}$/i.test(ref.sha256) || ref.object !== `objects/${ref.sha256.slice(0, 2)}/${ref.sha256}.${ref.encoding === 'gzip' ? 'gz' : 'bin'}` || !Number.isFinite(ref.size) || !Number.isFinite(ref.storedSize) || !['gzip', 'raw'].includes(ref.encoding)) throw Error('存档索引包含无效对象引用');
  }
  return { id, manifestRevision: String(manifestRevision), objects };
}

function revision(entries, tombstones) {
  return crypto.createHash('sha256').update(JSON.stringify({ entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)), tombstones: [...new Set(tombstones)].sort() })).digest('hex');
}

function create(localEntries = [], deletedSaveSnapshots = []) {
  const entries = [...new Map(localEntries.filter(row => row?.id && (row.manifestHash || row.manifestRevision)).map(row => { const normalized = normalizeEntry(row); return [normalized.id, normalized]; })).values()];
  const tombstones = [...new Set((deletedSaveSnapshots || []).map(row => String(row?.id || row?.snapshotId || '')).filter(Boolean))];
  const removed = new Set(tombstones);
  const live = entries.filter(row => !removed.has(row.id)).sort((a, b) => a.id.localeCompare(b.id));
  const normalizedTombstones = tombstones.sort();
  return { schemaVersion: 2, entries: live, tombstones: normalizedTombstones, revision: revision(live, normalizedTombstones) };
}

function parse(value) {
  if (!value || value.schemaVersion !== 2 || !Array.isArray(value.entries) || !Array.isArray(value.tombstones) || typeof value.revision !== 'string') throw Error('云端存档索引格式无效，请检查 WebDAV 远程目录中的存档数据');
  const normalized = create(value.entries, value.tombstones.map(id => ({ id })));
  if (normalized.revision !== value.revision) throw Error('云端存档索引校验失败');
  return normalized;
}

function merge(remote, local, direction = 'bidirectional') {
  if (!['upload', 'download', 'bidirectional'].includes(direction)) throw Error('无效存档同步方向');
  if (direction === 'download') return parse(remote);
  const remoteState = remote ? parse(remote) : create();
  const localState = parse(local), tombstones = new Set([...remoteState.tombstones, ...localState.tombstones]);
  const entries = new Map(remoteState.entries.map(row => [row.id, row]));
  for (const row of localState.entries) {
    const prior = entries.get(row.id);
    if (prior && prior.manifestRevision !== row.manifestRevision && direction === 'bidirectional') throw Error('同一存档快照在本地与云端均有变化：' + row.id);
    entries.set(row.id, row);
  }
  return create([...entries.values()], [...tombstones].map(id => ({ id })));
}

function canSkip({ localRevision, cached, remote }) {
  return Boolean(localRevision && cached?.localRevision === localRevision && cached.remoteRevision === localRevision && cached.etag && !/^W\//i.test(cached.etag) && remote?.exists && remote.etag === cached.etag && Number.isFinite(remote.contentLength) && remote.contentLength === cached.remoteLength);
}

function canSkipByContent(localRevision, remoteCatalog) {
  return Boolean(localRevision && remoteCatalog?.revision === localRevision);
}

module.exports = { create, parse, merge, canSkip, canSkipByContent, objectRefs, normalizeEntry };
