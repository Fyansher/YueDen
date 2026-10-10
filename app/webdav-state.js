const crypto = require('node:crypto');

const SYNC_SCHEMA_VERSION = 4;
const MERGE_ONLY_FIELDS = new Set([
  'updatedAt', 'deletedAt', 'settingsUpdatedAt', 'audioConnectionsUpdatedAt',
  'autoMetadataAt', 'lastWebdavSyncAt', 'lastSyncAt', 'syncedAt'
]);
const SET_FIELDS = new Set(['categories', 'genres', 'platforms', 'customCovers', 'aliases', 'lockedFields']);
const KEYED_UNORDERED_COLLECTIONS = new Set(['items', 'deletedItems', 'deletedSaveSnapshots']);
const LOCAL_PATH_FIELDS = ['localPath', 'localFiles', 'savePaths'];
const COVER_FIELDS = new Set(['cover', 'coverPortrait', 'coverLandscape']);
const LOCAL_ONLY_FIELDS = new Set([
  'localPath', 'localFiles', 'savePaths', 'absolutePath', 'deviceLocations',
  'deviceSettings', 'localDeviceId', 'deviceId', 'backupSecrets',
  'webdavUrl', 'webdavUsername', 'webdavPassword', 'webdavRemotePath',
  'credentialRefs', 'credentialsUnavailable', 'lastWebdavSyncAt', 'lastSyncAt',
  'obsidianRoot', 'localScanPaths', 'localResourceRoots', 'refreshWhitelist', 'windowBounds',
  'playerWindowBounds', 'readerWindowBounds', 'uiState', 'windowState',
  'steamApiKey', 'googleBooksApiKey'
]);
const SYNC_META_FIELDS = new Set([
  'syncFormat', 'syncVersion', 'syncSchemaVersion', 'syncRevision',
  'contentRevision', 'lineage', 'localDeviceId', 'backupSecrets'
]);
const LIBRARY_FIELDS = [
  'schemaVersion', 'items', 'categories', 'deletedItems', 'deletedSaveSnapshots',
  'playlists', 'referenceRedirects', 'organizationHistory'
];
const SYNC_FIELDS = [...LIBRARY_FIELDS, 'settings', 'audioConnections'];
const MISSING = Symbol('missing');

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function coverIdentity(value) {
  const raw = String(value || '');
  const reference = raw.match(/^um-cover:\/\/image\/([a-f0-9]{64})\.jpg$/i);
  if (reference) return 'sha256:' + reference[1].toLowerCase();
  const data = raw.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  if (data) {
    try { return 'sha256:' + hash(Buffer.from(data[1].replace(/\s/g, ''), 'base64')); }
    catch { return raw; }
  }
  return raw;
}
function assertNoInlineCovers(value, depth = 0) {
  if (depth > 80) throw Error('同步数据嵌套过深');
  if (Array.isArray(value)) { for (const row of value) assertNoInlineCovers(row, depth + 1); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (COVER_FIELDS.has(key) && typeof child === 'string' && /^data:image\//i.test(child)) throw Error('同步状态不能包含内嵌封面，请先转换为封面引用');
    assertNoInlineCovers(child, depth + 1);
  }
}
function empty(value) {
  return value === undefined || value === null || value === '' || Array.isArray(value) && !value.length || value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length;
}
function canonicalize(value, key = '', depth = 0) {
  if (depth > 80) throw Error('同步数据嵌套过深');
  if (value === undefined || LOCAL_ONLY_FIELDS.has(key) || MERGE_ONLY_FIELDS.has(key) || SYNC_META_FIELDS.has(key)) return undefined;
  if (COVER_FIELDS.has(key) && typeof value === 'string') return coverIdentity(value);
  if (Array.isArray(value)) {
    const rows = value.map(row => canonicalize(row, '', depth + 1)).filter(row => row !== undefined);
    if (SET_FIELDS.has(key)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    else if (KEYED_UNORDERED_COLLECTIONS.has(key)) rows.sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
    return rows.length ? rows : undefined;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const name of Object.keys(value).sort()) {
      const next = canonicalize(value[name], name, depth + 1);
      if (next !== undefined && !empty(next)) result[name] = next;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return value;
}
function stableStringify(value) { return JSON.stringify(canonicalize(value)) ?? 'null'; }

function pickFields(value, fields) {
  const result = {};
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(value || {}, field)) result[field] = clone(value[field]);
  return result;
}
function contentProjection(value) {
  return canonicalize(pickFields(value, LIBRARY_FIELDS));
}
function syncProjection(value) {
  return canonicalize(pickFields(value, SYNC_FIELDS));
}
function contentRevision(value) { return hash(JSON.stringify(contentProjection(value)) ?? 'null'); }
function syncRevision(value) { return hash(JSON.stringify(syncProjection(value)) ?? 'null'); }
function contentHash(value) { return syncRevision(value); }
function same(a, b) { return syncRevision(a) === syncRevision(b); }
function sameContent(a, b) { return contentRevision(a) === contentRevision(b); }
function sourceKey(source, index) { return String(source?.id || 'source-' + index); }
function projectItem(item, deviceId) {
  const next = clone(item || {}), known = next.deviceLocations && typeof next.deviceLocations === 'object' ? next.deviceLocations : {};
  const location = { ...(known[deviceId] || {}) };
  let hasLocalData = false;
  for (const field of LOCAL_PATH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(next, field)) { location[field] = clone(next[field]); hasLocalData = true; delete next[field]; }
  }
  if (next.audio && Array.isArray(next.audio.sources)) {
    const sources = { ...(location.audioSourcePaths || {}) };
    next.audio.sources = next.audio.sources.map((source, index) => {
      const row = { ...source };
      if (row.kind === 'local' && row.localPath) { sources[sourceKey(row, index)] = row.localPath; hasLocalData = true; delete row.localPath; }
      return row;
    });
    if (Object.keys(sources).length) location.audioSourcePaths = sources;
  }
  const deviceLocations = { ...known };
  if (hasLocalData || Object.keys(location).length) deviceLocations[deviceId] = location;
  if (Object.keys(deviceLocations).length) next.deviceLocations = deviceLocations;
  else delete next.deviceLocations;
  return next;
}
function stripRemoteLocalData(value, depth = 0) {
  if (depth > 80) throw Error('同步数据嵌套过深');
  if (Array.isArray(value)) return value.map(row => stripRemoteLocalData(row, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (LOCAL_ONLY_FIELDS.has(key)) continue;
    result[key] = stripRemoteLocalData(child, depth + 1);
  }
  return result;
}
function normalizeIncoming(value) {
  if (!value || typeof value !== 'object') return value;
  const next = stripRemoteLocalData(value);
  // Version 4 snapshots may still carry the unused organizer undo history.
  // It remains part of legacy checksum validation, then is discarded on import.
  delete next.organizationHistory;
  next.items = (value.items || []).map(item => stripRemoteLocalData(item));
  next.syncFormat = 'yueden-sync-state';
  next.syncVersion = SYNC_SCHEMA_VERSION;
  next.syncSchemaVersion = SYNC_SCHEMA_VERSION;
  const lineage = compactLineage(value.lineage);
  if (lineage) next.lineage = lineage; else delete next.lineage;
  next.contentRevision = contentRevision(next);
  next.syncRevision = syncRevision(next);
  return next;
}
function prepareLocalState(value, deviceId) {
  const next = clone(value || {});
  delete next.organizationHistory;
  next.items = (value?.items || []).map(item => projectItem(item, deviceId));
  next.localDeviceId = deviceId;
  next.syncFormat = 'yueden-sync-state';
  next.syncVersion = SYNC_SCHEMA_VERSION;
  next.syncSchemaVersion = SYNC_SCHEMA_VERSION;
  next.contentRevision = contentRevision(next);
  next.syncRevision = syncRevision(next);
  return next;
}
function toBaseState(value) {
  const result = pickFields(value, SYNC_FIELDS);
  delete result.organizationHistory;
  return stripRemoteLocalData(result);
}
function compactCoverPayloads(value, depth = 0) {
  if (depth > 80) throw Error('同步数据嵌套过深');
  if (Array.isArray(value)) return value.map(row => compactCoverPayloads(row, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = COVER_FIELDS.has(key) && typeof child === 'string' ? coverIdentity(child) : compactCoverPayloads(child, depth + 1);
  return result;
}
function compactLineage(value) {
  if (!value || value.schemaVersion !== 2 || !/^[a-f0-9]{64}$/i.test(value.endpointKey || '') || typeof value.baseRevision !== 'string' || !value.baseState || typeof value.baseState !== 'object') return null;
  const legacyBase = compactCoverPayloads(pickFields(value.baseState, SYNC_FIELDS));
  const legacyValid = syncRevision(legacyBase) === value.baseRevision;
  const baseState = compactCoverPayloads(toBaseState(value.baseState));
  const baseRevision = syncRevision(baseState);
  if (!legacyValid && baseRevision !== value.baseRevision) return null;
  return { schemaVersion: 2, endpointKey: value.endpointKey, baseRevision, baseState };
}
function toRemoteState(value) {
  assertNoInlineCovers(value);
  const next = toBaseState(value), lineage = compactLineage(value?.lineage);
  if (lineage) next.lineage = lineage;
  next.syncFormat = 'yueden-sync-state';
  next.syncVersion = SYNC_SCHEMA_VERSION;
  next.syncSchemaVersion = SYNC_SCHEMA_VERSION;
  next.contentRevision = contentRevision(next);
  next.syncRevision = syncRevision(next);
  return next;
}
function restoreItemPaths(item, deviceId, current) {
  const next = clone(item || {}), location = next.deviceLocations?.[deviceId] || {};
  for (const field of LOCAL_PATH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(location, field)) next[field] = clone(location[field]);
    else if (Object.prototype.hasOwnProperty.call(current || {}, field)) next[field] = clone(current[field]);
    else if (field === 'localPath') next[field] = '';
    else next[field] = [];
  }
  if (next.audio && Array.isArray(next.audio.sources)) {
    const oldSources = new Map((current?.audio?.sources || []).map((source, index) => [sourceKey(source, index), source]));
    next.audio.sources = next.audio.sources.map((source, index) => {
      const row = { ...source }, key = sourceKey(row, index), path = location.audioSourcePaths?.[key] || oldSources.get(key)?.localPath;
      if (row.kind === 'local' && path) row.localPath = path;
      else if (row.kind === 'local') delete row.localPath;
      return row;
    });
  }
  return next;
}
function restoreLocalLibrary(value, deviceId, currentLibrary = { items: [] }) {
  const current = new Map((currentLibrary.items || []).map(item => [item.id, item]));
  const deleted = new Set((value.deletedItems || []).map(row => row.id));
  const result = { ...value, items: (value.items || []).filter(item => !deleted.has(item.id)).map(item => restoreItemPaths(item, deviceId, current.get(item.id))) };
  for (const key of ['syncFormat', 'syncVersion', 'syncSchemaVersion', 'syncRevision', 'contentRevision', 'localDeviceId', 'lineage', 'backupSecrets', 'settings', 'settingsUpdatedAt', 'audioConnections', 'audioConnectionsUpdatedAt']) delete result[key];
  return result;
}

function restoreDeviceSettings(imported, current, deviceId, fields = ['obsidianRoot', 'localScanPaths', 'refreshWhitelist']) {
  const next = clone(imported || {}), currentSettings = current || {}, devices = { ...(next.deviceSettings || {}) };
  const savedForDevice = devices[deviceId] || {}, restoredForDevice = { ...savedForDevice };
  for (const field of fields) {
    const value = Object.prototype.hasOwnProperty.call(savedForDevice, field) ? savedForDevice[field] : currentSettings[field];
    if (value !== undefined) { next[field] = clone(value); restoredForDevice[field] = clone(value); }
    else delete next[field];
  }
  devices[deviceId] = restoredForDevice;
  next.deviceSettings = devices;
  return next;
}

module.exports = {
  SYNC_SCHEMA_VERSION, LIBRARY_FIELDS, SYNC_FIELDS, MERGE_ONLY_FIELDS, LOCAL_ONLY_FIELDS,
  canonicalize, stableStringify, contentHash, contentRevision, syncRevision, same, sameContent, assertNoInlineCovers,
  normalizeIncoming, prepareLocalState, toRemoteState, toBaseState, compactLineage,
  restoreLocalLibrary, restoreDeviceSettings, LOCAL_PATH_FIELDS, MISSING, clone
};
