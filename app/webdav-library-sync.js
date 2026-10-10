const { validate } = require('./library-integrity');
const SyncState = require('./webdav-state');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// Keep the library limit comfortably above ordinary multi-hundred-item libraries.
// It is applied symmetrically to the serialized JSON and incoming compressed/decompressed data.
const MAX_SYNC_STATE_BYTES = 32 * 1024 * 1024;
const MAX_SYNC_STATE_READ_MS = 15000;
const MAX_SYNC_STATE_BODY_RETRIES = 2;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
function contentLength(response) {
  const raw = response.headers.get('content-length');
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
async function readResponseBytes(response, expectedBytes = null) {
  const chunks = [];
  let bytes = 0;
  const collect = value => {
    bytes += value.byteLength;
    if (bytes > MAX_SYNC_STATE_BYTES) {
      const error = Error('远端资源库超过读取上限'); error.code = 'YUEDEN_SYNC_STATE_TOO_LARGE'; throw error;
    }
    chunks.push(Buffer.from(value));
  };
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const row = await reader.read();
        if (row.done) break;
        collect(row.value);
      }
    } catch (cause) {
      const error = Error('读取云端资源库响应正文失败：' + (cause?.message || '连接中断'), { cause });
      error.code = cause?.code || 'YUEDEN_SYNC_STATE_BODY_READ_FAILED';
      error.bytesReceived = bytes;
      error.expectedBytes = expectedBytes;
      throw error;
    } finally { await reader.cancel().catch(() => {}); }
  } else {
    try { collect(new Uint8Array(await response.arrayBuffer())); }
    catch (cause) {
      const error = Error('读取云端资源库响应正文失败：' + (cause?.message || '连接中断'), { cause });
      error.code = cause?.code || 'YUEDEN_SYNC_STATE_BODY_READ_FAILED';
      error.bytesReceived = bytes;
      error.expectedBytes = expectedBytes;
      throw error;
    }
  }
  if (expectedBytes != null && bytes !== expectedBytes) {
    const error = Error(`WebDAV 响应长度不完整（收到 ${bytes} / ${expectedBytes} 字节）`);
    error.code = 'YUEDEN_SYNC_STATE_INCOMPLETE_BODY';
    error.bytesReceived = bytes;
    error.expectedBytes = expectedBytes;
    throw error;
  }
  return Buffer.concat(chunks, bytes);
}
function decodeSnapshotBytes(bytes) {
  if (bytes.length > MAX_SYNC_STATE_BYTES) throw Error('远端资源库超过读取上限');
  let decoded = bytes, storageEncoding = 'identity';
  if (bytes.length >= 2 && bytes.subarray(0, 2).equals(GZIP_MAGIC)) {
    try { decoded = zlib.gunzipSync(bytes, { maxOutputLength: MAX_SYNC_STATE_BYTES }); }
    catch (cause) { throw Error('云端同步文件压缩数据损坏或解压后超过读取上限', { cause }); }
    storageEncoding = 'gzip';
  }
  if (decoded.length > MAX_SYNC_STATE_BYTES) throw Error('云端同步数据解压后超过读取上限');
  return { bytes: decoded, storageEncoding };
}
function serializeSnapshot(value) {
  const json = Buffer.from(JSON.stringify(SyncState.toRemoteState(value)), 'utf8');
  if (json.length > MAX_SYNC_STATE_BYTES) throw Error('同步资源库超过写入上限');
  return zlib.gzipSync(json, { level: 9, mtime: 0 });
}
function parseSnapshot(response, bytes, options = {}) {
  const decoded = decodeSnapshotBytes(bytes), text = decoded.bytes.toString('utf8');
  let state;
  try {
    state = JSON.parse(text);
    if (state?.syncFormat !== 'yueden-sync-state' || Number(state?.syncVersion) !== SyncState.SYNC_SCHEMA_VERSION || Number(state?.syncSchemaVersion) !== SyncState.SYNC_SCHEMA_VERSION) throw Error('同步文件版本不匹配，请检查 WebDAV 远程目录中的同步数据');
    SyncState.assertNoInlineCovers(state);
    validate(state);
    if (!Array.isArray(state.audioConnections) || !state.settings || typeof state.settings !== 'object') throw Error('同步数据不完整');
    if (state.contentRevision !== SyncState.contentRevision(state) || state.syncRevision !== SyncState.syncRevision(state)) throw Error('同步版本校验失败');
    state = SyncState.normalizeIncoming(state);
    if (typeof options.normalizeRemoteState === 'function') state = options.normalizeRemoteState(state);
  } catch (cause) { throw Error('云端同步文件损坏或版本不支持，未执行上传：'+(cause?.message||'解析失败'), { cause }); }
  const etag = response.headers.get('etag'), lastModified = response.headers.get('last-modified'), contentEncoding = response.headers.get('content-encoding');
  const content = SyncState.contentRevision(state), sync = SyncState.syncRevision(state);
  return { state, sourceSyncVersion: SyncState.SYNC_SCHEMA_VERSION, etag, lastModified, contentEncoding, storageEncoding: decoded.storageEncoding, byteLength: bytes.length, contentRevision: content, syncRevision: sync, version: JSON.stringify({ etag: etag || null, lastModified: lastModified || null, contentEncoding: contentEncoding || null, storageEncoding: decoded.storageEncoding, contentRevision: content, syncRevision: sync, byteLength: bytes.length, sourceSyncVersion: SyncState.SYNC_SCHEMA_VERSION }) };
}
async function snapshot(response, options = {}) {
  if (response.status === 404) return { state: null, etag: null, lastModified: null, contentEncoding: null, version: null };
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(require('./webdav-client').failure('GET', response.status).message + '，未执行上传');
  }
  const length = contentLength(response);
  if (length != null && length > MAX_SYNC_STATE_BYTES) throw Error('远端资源库过大，未执行上传');
  const bytes = await readResponseBytes(response, length);
  return parseSnapshot(response, bytes, options);
}
function errorChain(error) {
  const rows = [];
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) rows.push(current);
  return rows;
}
function retryableBodyReadError(error) {
  const chain = errorChain(error), codes = chain.map(row => String(row.code || '').toUpperCase());
  if (codes.includes('YUEDEN_SYNC_STATE_TOO_LARGE')) return false;
  if (codes.includes('YUEDEN_SYNC_STATE_INCOMPLETE_BODY')) return true;
  if (codes.some(code => ['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(code))) return true;
  return chain.some(row => /terminated|other side closed|socket hang up/i.test(String(row.message || '')));
}
async function readSnapshot(get, diagnostic = () => {}, options = {}) {
  const started = Date.now(), controller = new AbortController();
  const timeoutError = Error(`读取云端资源库超时（${Math.round(MAX_SYNC_STATE_READ_MS / 1000)} 秒）；未写入同步版本记录`);
  timeoutError.name = 'TimeoutError'; timeoutError.code = 'YUEDEN_SYNC_STATE_READ_TIMEOUT';
  const timer = setTimeout(() => controller.abort(timeoutError), MAX_SYNC_STATE_READ_MS);
  const fetch = (headers, requestOptions = {}) => get(headers || {}, controller.signal, requestOptions);
  const finish = result => {
    try { diagnostic({ event: 'webdav.sync.REMOTE_READ', operation: 'sync', phase: 'remote-read', durationMs: Date.now() - started, bytes: result.byteLength || 0, schemaVersion: result.sourceSyncVersion || null }); } catch {}
    return result;
  };
  try {
    let firstEtag = null;
    for (let attempt = 1; attempt <= MAX_SYNC_STATE_BODY_RETRIES + 1; attempt++) {
      const response = await fetch({}, { freshConnection: attempt > 1 });
      if (response.status === 404) {
        await response.body?.cancel();
        if (attempt > 1) throw Error('重读云端资源库时文件已消失，未采用不完整数据');
        return finish({ state: null, etag: null, lastModified: null, contentEncoding: null, storageEncoding: null, version: null });
      }
      if (!response.ok) { await response.body?.cancel(); throw require('./webdav-client').failure('GET', response.status); }
      if (response.status !== 200) { await response.body?.cancel(); throw Error(`WebDAV 返回了意外状态（${response.status}），未读取云端资源库`); }
      const etag = response.headers.get('etag') || null;
      if (attempt === 1) firstEtag = etag;
      else if (!firstEtag || /^W\//i.test(firstEtag) || etag !== firstEtag) {
        await response.body?.cancel();
        try { diagnostic({ event: 'webdav.sync.REMOTE_READ_RETRY_ETAG_MISMATCH', operation: 'sync', phase: 'remote-read', attempt, etag: etag || '', expectedEtag: firstEtag || '' }); } catch {}
        throw Error('重试读取期间云端 ETag 缺失或已变化，未采用不一致的同步文件');
      }
      const total = contentLength(response);
      if (total != null && total > MAX_SYNC_STATE_BYTES) { await response.body?.cancel(); throw Error('远端资源库超过读取上限'); }
      let bytes;
      try {
        bytes = await readResponseBytes(response, total);
      } catch (error) {
        try { diagnostic({ event: 'webdav.sync.REMOTE_BODY_READ_FAILED', operation: 'sync', phase: 'remote-read', attempt, bytesReceived: Number.isFinite(error?.bytesReceived) ? error.bytesReceived : 0, expectedBytes: Number.isFinite(error?.expectedBytes) ? error.expectedBytes : total, etag: etag || '', error }); } catch {}
        if (controller.signal.aborted && controller.signal.reason === timeoutError) throw timeoutError;
        const canRetry = retryableBodyReadError(error) && attempt <= MAX_SYNC_STATE_BODY_RETRIES && etag && !/^W\//i.test(etag);
        if (!canRetry) throw error;
        try { diagnostic({ event: 'webdav.sync.REMOTE_BODY_READ_RETRY', operation: 'sync', phase: 'remote-read', attempt, nextAttempt: attempt + 1, freshConnection: true, bytesReceived: Number.isFinite(error?.bytesReceived) ? error.bytesReceived : 0, expectedBytes: Number.isFinite(error?.expectedBytes) ? error.expectedBytes : total, etag }); } catch {}
        continue;
      }
      return finish(parseSnapshot(response, bytes, options));
    }
    throw Error('读取云端资源库失败，已达到完整重读次数上限');
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally { clearTimeout(timer); }
}
const canonicalize = SyncState.canonicalize;
const stableStringify = SyncState.stableStringify;
const sameState = SyncState.same;
const contentHash = SyncState.contentHash;

function conditionState(conditions, remote) {
  if (conditions?.['If-None-Match'] === '*') return !remote?.state;
  if (conditions?.['If-Match']) return remote?.etag === conditions['If-Match'];
  if (conditions?.['If-Unmodified-Since']) {
    const expected = dateOf(conditions['If-Unmodified-Since']), current = dateOf(remote?.lastModified);
    return expected == null || current == null ? null : current <= expected;
  }
  return null;
}

function diagnosePreconditionFailure(before, after, conditions) {
  const contentChanged = !sameState(before?.state ?? null, after?.state ?? null);
  const conditionStillValid = conditionState(conditions, after);
  return { contentChanged, conditionStillValid, cloudChanged: contentChanged || conditionStillValid === false };
}

function dateOf(value) {
  const date = Date.parse(value || '');
  return Number.isFinite(date) ? date : null;
}

function latestUpdatedAt(state) {
  const rows = [
    ...(state?.items || []).map(item => item.updatedAt || item.createdAt),
    ...(state?.deletedItems || []).map(item => item.deletedAt),
    ...(state?.playlists || []).map(item => item.updatedAt),
    ...(state?.referenceRedirects || []).map(item => item.updatedAt),
    state?.settingsUpdatedAt,
    state?.audioConnectionsUpdatedAt
  ];
  const dates = rows.map(dateOf).filter(Number.isFinite);
  return dates.length ? new Date(dates.reduce((latest, value) => Math.max(latest, value), 0)).toISOString() : '';
}

const MISSING = SyncState.MISSING;
const keyedArrays = new Set(['items', 'deletedItems', 'deletedSaveSnapshots', 'playlists', 'referenceRedirects', 'audioConnections', 'sources', 'tracks', 'entries', 'localFiles']);
const setArrays = new Set(['categories', 'genres', 'platforms', 'customCovers', 'aliases', 'lockedFields']);
const syncMeta = new Set(['syncFormat', 'syncVersion', 'syncRevision', 'lineage', 'localDeviceId']);
const timeFields = new Set(['updatedAt', 'deletedAt', 'settingsUpdatedAt', 'audioConnectionsUpdatedAt', 'autoMetadataAt', 'lastWebdavSyncAt', 'syncedAt']);

function rowKey(row, index, field) {
  if (row && typeof row === 'object') return String(row.id || row.trackId || row.path || row.operationId || row.itemId && row.trackId && row.itemId + ':' + row.trackId || index);
  return String(row);
}
function cleanState(state) { return SyncState.toBaseState(state || {}); }
function hasLineage(local, endpointKey = null) {
  const lineage = local?.lineage;
  if (!lineage || typeof lineage.baseRevision !== 'string' || !lineage.baseState || typeof lineage.baseState !== 'object') return null;
  if (endpointKey && (lineage.schemaVersion !== 2 || lineage.endpointKey !== endpointKey)) return null;
  if (!endpointKey && lineage.schemaVersion === 2 && !/^[a-f0-9]{64}$/i.test(lineage.endpointKey || '')) return null;
  const base = cleanState(lineage.baseState);
  return contentHash(base) === lineage.baseRevision ? base : null;
}
function sameSyncedDocument(local, remote, endpointKey = null) {
  const localBase = hasLineage(local, endpointKey), remoteBase = hasLineage(remote, endpointKey);
  return Boolean(localBase && remoteBase && sameState(local, remote) && sameState(localBase, remoteBase));
}
function formatPath(parts) { return parts.map((part, i) => !i ? String(part) : typeof part === 'number' || keyedArrays.has(String(parts[i - 1])) ? `[${part}]` : '.' + part).join(''); }
function stateEqual(a, b) { return a === MISSING || b === MISSING ? a === b : stableStringify(a) === stableStringify(b); }

function mergeObjectThreeWay(base, local, remote, pathParts, conflicts) {
  const result = {}, keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
  for (const key of [...keys].sort()) {
    if (syncMeta.has(key)) continue;
    const b = Object.prototype.hasOwnProperty.call(base || {}, key) ? base[key] : MISSING;
    const l = Object.prototype.hasOwnProperty.call(local || {}, key) ? local[key] : MISSING;
    const r = Object.prototype.hasOwnProperty.call(remote || {}, key) ? remote[key] : MISSING;
    const value = mergeThreeValue(b, l, r, [...pathParts, key], conflicts);
    if (value !== MISSING) result[key] = value;
  }
  return result;
}
function mergeSetThreeWay(base, local, remote, pathParts, conflicts) {
  const values = new Set([...(base || []), ...(local || []), ...(remote || [])]), result = [];
  for (const value of values) {
    const b = (base || []).some(row => stateEqual(row, value)), l = (local || []).some(row => stateEqual(row, value)), r = (remote || []).some(row => stateEqual(row, value));
    let include;
    if (l === r) include = l;
    else if (l === b) include = r;
    else if (r === b) include = l;
    else { conflicts.push(formatPath(pathParts)); include = l; }
    if (include) result.push(value);
  }
  return result;
}
function mergeKeyedThreeWay(base, local, remote, pathParts, conflicts) {
  const keyOf = (row, i) => rowKey(row, i, pathParts.at(-1));
  const mapRows = rows => new Map((rows || []).map((row, i) => [keyOf(row, i), row]));
  const b = mapRows(base), l = mapRows(local), r = mapRows(remote), keys = [...new Set([...b.keys(), ...l.keys(), ...r.keys()])];
  const result = [];
  for (const key of keys) {
    const value = mergeThreeValue(b.has(key) ? b.get(key) : MISSING, l.has(key) ? l.get(key) : MISSING, r.has(key) ? r.get(key) : MISSING, [...pathParts, key], conflicts);
    if (value !== MISSING) result.push(value);
  }
  return result;
}
function mergeThreeValue(base, local, remote, pathParts, conflicts) {
  if (timeFields.has(String(pathParts.at(-1) || ''))) {
    const values=[local,remote,base].filter(value=>value!==MISSING&&value!=null&&value!=='');
    return values.sort((a,b)=>(dateOf(b)||0)-(dateOf(a)||0))[0]??MISSING;
  }
  if (stateEqual(local, remote)) return local === MISSING ? MISSING : SyncState.clone(local);
  if (stateEqual(local, base)) return remote === MISSING ? MISSING : SyncState.clone(remote);
  if (stateEqual(remote, base)) return local === MISSING ? MISSING : SyncState.clone(local);
  const field = String(pathParts.at(-1) || '');
  if (base !== MISSING && local !== MISSING && remote !== MISSING && [base, local, remote].every(value => value && typeof value === 'object' && !Array.isArray(value))) return mergeObjectThreeWay(base, local, remote, pathParts, conflicts);
  const arr = [base, local, remote].filter(value => value !== MISSING);
  if (arr.every(Array.isArray)) {
    if (setArrays.has(field)) return mergeSetThreeWay(base === MISSING ? [] : base, local === MISSING ? [] : local, remote === MISSING ? [] : remote, pathParts, conflicts);
    if (keyedArrays.has(field)) return mergeKeyedThreeWay(base === MISSING ? [] : base, local === MISSING ? [] : local, remote === MISSING ? [] : remote, pathParts, conflicts);
  }
  conflicts.push(formatPath(pathParts));
  return local === MISSING ? MISSING : SyncState.clone(local);
}

function mergeObjectsWithoutBase(local, remote, pathParts, conflicts) {
  const result = {}, keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  for (const key of [...keys].sort()) {
    if (syncMeta.has(key)) continue;
    const l = Object.prototype.hasOwnProperty.call(local || {}, key) ? local[key] : MISSING;
    const r = Object.prototype.hasOwnProperty.call(remote || {}, key) ? remote[key] : MISSING;
    let value;
    if (timeFields.has(key)) { const values=[l,r].filter(row=>row!==MISSING&&row!=null&&row!=='');value=values.sort((a,b)=>(dateOf(b)||0)-(dateOf(a)||0))[0]??MISSING; }
    else if (stateEqual(l, r)) value = l;
    else if (l === MISSING || r === MISSING) value = l === MISSING ? r : l;
    else if (l && r && !Array.isArray(l) && !Array.isArray(r) && typeof l === 'object' && typeof r === 'object') value = mergeObjectsWithoutBase(l, r, [...pathParts, key], conflicts);
    else if (Array.isArray(l) && Array.isArray(r) && (setArrays.has(key) || keyedArrays.has(key))) {
      const rows = new Map();
      for (const [index, row] of [...l, ...r].entries()) {
        const id = rowKey(row, index, key), old = rows.get(id);
        if (old && !stateEqual(old, row)) conflicts.push(formatPath([...pathParts, key, id]));
        else if (!old) rows.set(id, SyncState.clone(row));
      }
      value = [...rows.values()];
    } else { conflicts.push(formatPath([...pathParts, key])); value = SyncState.clone(l); }
    if (value !== MISSING) result[key] = SyncState.clone(value);
  }
  return result;
}
function mergeWithoutBase(local, remote) {
  const conflicts = [], state = mergeObjectsWithoutBase(cleanState(local), cleanState(remote), [], conflicts);
  if (conflicts.length) return { state, conflicts: [...new Set(conflicts)] };
  resolveTombstones(state, conflicts);
  return { state, conflicts: [...new Set(conflicts)] };
}
function commonBase(local, remote, endpointKey = null) {
  const localBase = hasLineage(local, endpointKey), remoteBase = hasLineage(remote, endpointKey);
  if (localBase && remoteBase && sameState(localBase, remoteBase)) return localBase;
  if (localBase && !remoteBase) return localBase;
  if (localBase && remoteBase && sameState(remote, localBase)) return localBase;
  if (remoteBase && sameState(local, remoteBase)) return remoteBase;
  return null;
}
function mergeDetailed(local, remote, base = commonBase(local, remote)) {
  const result = base ? mergeWithBase(base, local, remote) : mergeWithoutBase(local, remote), conflicts = new Set(result.conflicts);
  const localRows = new Map((local.items || []).map(row => [String(row.id), row]));
  const remoteRows = new Map((remote.items || []).map(row => [String(row.id), row]));
  const baseRows = new Map((base?.items || []).map(row => [String(row.id), row]));
  const localDeleted = new Set((local.deletedItems || []).map(row => String(row.id)));
  const remoteDeleted = new Set((remote.deletedItems || []).map(row => String(row.id)));
  for (const id of new Set([...localRows.keys(), ...remoteRows.keys(), ...localDeleted, ...remoteDeleted])) {
    const localRow = localRows.get(id), remoteRow = remoteRows.get(id), baseRow = baseRows.has(id) ? baseRows.get(id) : MISSING;
    const localDeleteConflict = localDeleted.has(id) && remoteRow !== undefined && (!base || baseRow === MISSING || !stateEqual(remoteRow, baseRow));
    const remoteDeleteConflict = remoteDeleted.has(id) && localRow !== undefined && (!base || baseRow === MISSING || !stateEqual(localRow, baseRow));
    if (localDeleteConflict || remoteDeleteConflict) conflicts.add(formatPath(['items', id]));
  }
  result.conflicts = [...conflicts];
  return result;
}
function conflictUnit(path) {
  const match = /^([^.[\]]+)\[([^\]]+)\]/.exec(path);
  if (match) {
    const collection = match[1], id = match[2];
    return { key: `record:${collection}:${encodeURIComponent(id)}`, collection, id, kind: collection === 'items' ? 'resource' : 'record' };
  }
  const field = /^([^.[\]]+)/.exec(path)?.[1] || 'data';
  return { key: `path:${encodeURIComponent(path)}`, field, path, kind: 'field' };
}
function rowFor(state, collection, id) {
  return (state?.[collection] || []).find((row, index) => rowKey(row, index, collection) === String(id));
}
function pathValue(state, path) {
  const tokens = [...String(path).matchAll(/([^.[\]]+)|\[([^\]]+)\]/g)].map(row => row[1] ?? row[2]);
  let value = state, parentKey = '';
  for (const token of tokens) {
    if (Array.isArray(value)) value = value.find((row, index) => rowKey(row, index, parentKey) === token);
    else value = value && typeof value === 'object' ? value[token] : undefined;
    parentKey = token;
  }
  return value === undefined ? MISSING : value;
}
function setPathValue(state, path, nextValue) {
  const tokens = [...String(path).matchAll(/([^.[\]]+)|\[([^\]]+)\]/g)].map(row => ({ value: row[1] ?? row[2], keyed: row[2] !== undefined }));
  if (!tokens.length) return state;
  let parent = state, parentKey = '';
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i].value;
    if (Array.isArray(parent)) parent = parent.find((row, index) => rowKey(row, index, parentKey) === token);
    else {
      if (!parent || typeof parent !== 'object') return state;
      if (!Object.prototype.hasOwnProperty.call(parent, token)) parent[token] = tokens[i + 1].keyed ? [] : {};
      parent = parent[token];
    }
    if (parent == null) return state;
    parentKey = token;
  }
  const last = tokens.at(-1).value;
  if (Array.isArray(parent)) {
    const index = parent.findIndex((row, i) => rowKey(row, i, parentKey) === last);
    if (nextValue === MISSING) { if (index >= 0) parent.splice(index, 1); }
    else if (index >= 0) parent[index] = SyncState.clone(nextValue);
    else parent.push(SyncState.clone(nextValue));
  } else if (parent && typeof parent === 'object') {
    if (nextValue === MISSING) delete parent[last];
    else parent[last] = SyncState.clone(nextValue);
  }
  return state;
}
function briefValue(value) {
  if (value === MISSING) return '（不存在）';
  if (value === undefined || value === null || value === '') return '（空）';
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { text = String(value); }
  return text.length > 150 ? text.slice(0, 147) + '…' : text;
}
function valueFields(local, remote, unit, paths) {
  const rows = new Map();
  const add = (label, localValue, remoteValue) => {
    if (stateEqual(localValue, remoteValue)) return;
    rows.set(label, { name: label, local: briefValue(localValue), remote: briefValue(remoteValue) });
  };
  for (const path of paths) {
    const prefix = unit.id == null ? '' : `${unit.collection}[${unit.id}]`;
    const relative = prefix ? path.slice(prefix.length).replace(/^\./, '') : path.slice((unit.field || '').length).replace(/^\./, '');
    if (!relative) {
      const left = unit.id == null ? local?.[unit.field] : rowFor(local, unit.collection, unit.id);
      const right = unit.id == null ? remote?.[unit.field] : rowFor(remote, unit.collection, unit.id);
      if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
          if (syncMeta.has(key) || timeFields.has(key)) continue;
          add(key, Object.hasOwn(left, key) ? left[key] : MISSING, Object.hasOwn(right, key) ? right[key] : MISSING);
        }
      } else add('整条记录', left === undefined ? MISSING : left, right === undefined ? MISSING : right);
      continue;
    }
    add(relative, pathValue(local, path), pathValue(remote, path));
  }
  return [...rows.values()].slice(0, 12);
}
const decisionTimeFields = new Set(['updatedAt','createdAt','deletedAt','syncedAt','lastPlayedAt','lastOpenedAt','lastWebdavSyncAt','lastSyncAt']);
function decisionSemantics(value) {
  if (Array.isArray(value)) return value.map(decisionSemantics);
  if (!value || typeof value !== 'object') return value;
  const result={};
  for(const [key,row] of Object.entries(value))if(!decisionTimeFields.has(key)&&!syncMeta.has(key))result[key]=decisionSemantics(row);
  return result;
}
function decisionSignature(localValue,remoteValue) {
  return crypto.createHash('sha256').update(stableStringify({local:{exists:localValue!==undefined,value:decisionSemantics(localValue)},remote:{exists:remoteValue!==undefined,value:decisionSemantics(remoteValue)}})).digest('hex');
}
function decisionUnits(local, remote, conflicts) {
  const groups = new Map();
  for (const path of [...new Set(conflicts || [])]) {
    const unit = conflictUnit(path), row = groups.get(unit.key) || { ...unit, paths: [] };
    row.paths.push(path); groups.set(unit.key, row);
  }
  return [...groups.values()].map(unit => {
    const localRow = unit.id == null ? unit.path ? pathValue(local, unit.path) : local?.[unit.field] : rowFor(local, unit.collection, unit.id);
    const remoteRow = unit.id == null ? unit.path ? pathValue(remote, unit.path) : remote?.[unit.field] : rowFor(remote, unit.collection, unit.id);
    const label = unit.kind === 'resource'
      ? String(localRow?.name || remoteRow?.name || unit.id)
      : unit.id != null ? String(localRow?.name || localRow?.title || remoteRow?.name || remoteRow?.title || unit.id)
        : ({ settings: '设置', audioConnections: '远程音频库', playlists: '播放列表', referenceRedirects: '资源引用', deletedItems: '资源删除记录', deletedSaveSnapshots: '存档删除记录' }[unit.field] || unit.field) + (unit.path && unit.path !== unit.field ? ' · ' + unit.path.slice(unit.field.length).replace(/^\./, '') : '');
    const resourceTimes = unit.kind === 'resource' ? {
      localExists: localRow !== undefined && !(local.deletedItems || []).some(row => String(row.id) === String(unit.id)),
      remoteExists: remoteRow !== undefined && !(remote.deletedItems || []).some(row => String(row.id) === String(unit.id)),
      localUpdatedAt: localRow && !(local.deletedItems || []).some(row => String(row.id) === String(unit.id)) ? localRow.updatedAt || null : null,
      remoteUpdatedAt: remoteRow && !(remote.deletedItems || []).some(row => String(row.id) === String(unit.id)) ? remoteRow.updatedAt || null : null
    } : {};
    const signature=unit.kind==='resource'
      ?decisionSignature({row:localRow,deleted:rowFor(local,'deletedItems',unit.id)},{row:remoteRow,deleted:rowFor(remote,'deletedItems',unit.id)})
      :decisionSignature(localRow,remoteRow);
    return { ...unit, label, fields: valueFields(local, remote, unit, unit.paths), signature, ...resourceTimes };
  });
}
function applyDecisionUnits(state, local, remote, units, decisions) {
  for (const unit of units) {
    const side = decisions?.[unit.key];
    if (side !== 'local' && side !== 'remote') throw Error('尚未选择保留哪一侧：' + unit.label);
    const source = side === 'local' ? local : remote;
    if (unit.id != null) {
      const rows = [...(state[unit.collection] || [])].filter((row, index) => rowKey(row, index, unit.collection) !== String(unit.id));
      const chosen = rowFor(source, unit.collection, unit.id);
      if (chosen !== undefined) rows.push(SyncState.clone(chosen));
      state[unit.collection] = rows;
      if (unit.collection === 'items') {
        const deletedItems = [...(state.deletedItems || [])].filter(row => String(row.id) !== String(unit.id));
        if (chosen === undefined) {
          const tombstone = rowFor(source, 'deletedItems', unit.id) || { id: unit.id, deletedAt: new Date().toISOString() };
          deletedItems.push(SyncState.clone(tombstone));
        }
        state.deletedItems = deletedItems;
      }
    } else if (unit.path) {
      setPathValue(state, unit.path, pathValue(source, unit.path));
    } else if (Object.prototype.hasOwnProperty.call(source || {}, unit.field)) {
      state[unit.field] = SyncState.clone(source[unit.field]);
    } else delete state[unit.field];
  }
  resolveTombstones(state, []);
  return state;
}
function classifyItems(local, remote, base, units) {
  const localRows = new Map((local.items || []).map(row => [String(row.id), row]));
  const remoteRows = new Map((remote.items || []).map(row => [String(row.id), row]));
  const baseRows = new Map((base?.items || []).map(row => [String(row.id), row]));
  const localDeleted = new Set((local.deletedItems || []).map(row => String(row.id)));
  const remoteDeleted = new Set((remote.deletedItems || []).map(row => String(row.id)));
  const conflictKeys = new Set(units.filter(row => row.kind === 'resource').map(row => String(row.id)));
  const counts = { same: 0, localNewer: 0, remoteNewer: 0, unknown: 0, autoMerged: 0 };
  for (const id of new Set([...localRows.keys(), ...remoteRows.keys(), ...baseRows.keys(), ...localDeleted, ...remoteDeleted])) {
    const localRow = localRows.has(id) ? localRows.get(id) : MISSING;
    const remoteRow = remoteRows.has(id) ? remoteRows.get(id) : MISSING;
    const baseRow = baseRows.has(id) ? baseRows.get(id) : MISSING;
    if (stateEqual(localRow, remoteRow) && localDeleted.has(id) === remoteDeleted.has(id)) { counts.same++; continue; }
    if (base) {
      const localAtBase = stateEqual(localRow, baseRow) && localDeleted.has(id) === false;
      const remoteAtBase = stateEqual(remoteRow, baseRow) && remoteDeleted.has(id) === false;
      if (localAtBase && !remoteAtBase) { counts.remoteNewer++; continue; }
      if (remoteAtBase && !localAtBase) { counts.localNewer++; continue; }
      if (localRow !== MISSING && remoteRow !== MISSING && !conflictKeys.has(id)) { counts.autoMerged++; continue; }
      if (conflictKeys.has(id) || localDeleted.has(id) !== remoteDeleted.has(id)) { counts.unknown++; continue; }
    }
    if (conflictKeys.has(id) || localDeleted.has(id) && remoteRow !== MISSING || remoteDeleted.has(id) && localRow !== MISSING) counts.unknown++;
    else if (localRow !== MISSING && remoteRow === MISSING || localDeleted.has(id) && !remoteDeleted.has(id)) counts.localNewer++;
    else if (remoteRow !== MISSING && localRow === MISSING || remoteDeleted.has(id) && !localDeleted.has(id)) counts.remoteNewer++;
    else counts.unknown++;
  }
  return counts;
}
function mergeWithBase(base, local, remote) {
  const conflicts = [], state = mergeThreeValue(cleanState(base), cleanState(local), cleanState(remote), [], conflicts);
  resolveTombstones(state, conflicts);
  return { state, conflicts: [...new Set(conflicts)] };
}
function resolveTombstones(state, conflicts) {
  const unique = rows => [...new Map((rows || []).map(row => [row.id || row.snapshotId, row])).values()];
  state.deletedItems = unique(state.deletedItems);
  state.deletedSaveSnapshots = unique(state.deletedSaveSnapshots);
  const deleted = new Set((state.deletedItems || []).map(row => row.id));
  state.items = (state.items || []).filter(item => !deleted.has(item.id));
  return state;
}
function merge(local, remote, options = {}) {
  validate(local); validate(remote);
  const base = options.baseState || commonBase(local, remote, options.endpointKey || null);
  const result = mergeDetailed(local, remote, base);
  if (result.conflicts.length) throw Error('无法无歧义合并这些数据：' + result.conflicts.slice(0, 12).join('、') + (result.conflicts.length > 12 ? '…' : ''));
  return SyncState.toRemoteState(result.state);
}

function finalizeState(value, endpointKey = null) {
  const state = SyncState.toRemoteState(value), baseState = SyncState.toBaseState(state);
  const lineage=endpointKey&&/^[a-f0-9]{64}$/i.test(endpointKey)?SyncState.compactLineage({schemaVersion:2,endpointKey,baseRevision:SyncState.syncRevision(baseState),baseState}):null;
  if(lineage)state.lineage=lineage;else delete state.lineage;
  state.contentRevision = SyncState.contentRevision(state);
  state.syncRevision = SyncState.syncRevision(state);
  return state;
}

function compare(local, remote, timestamps = {}) {
  local = SyncState.normalizeIncoming(local); remote = SyncState.normalizeIncoming(remote);
  validate(local); validate(remote);
  const localDataLatest = latestUpdatedAt(local), remoteDataLatest = latestUpdatedAt(remote);
  const equal = SyncState.sameContent(local, remote), syncEqual = sameState(local, remote);
  const localHash = SyncState.contentRevision(local), remoteHash = SyncState.contentRevision(remote);
  const localSyncRevision = SyncState.syncRevision(local), remoteSyncRevision = SyncState.syncRevision(remote);
  const base = commonBase(local, remote, timestamps.endpointKey || null);
  const latestSide = syncEqual ? 'same' : base ? 'diverged' : 'unknown';
  const localById = new Map(local.items.map(item => [String(item.id), item])), remoteById = new Map(remote.items.map(item => [String(item.id), item]));
  const result = { localOnly: 0, remoteOnly: 0, changed: 0, localNewer: 0, remoteNewer: 0, sameOrUnknownTime: 0 };
  for (const [id, item] of localById) {
    const other = remoteById.get(id);
    if (!other) { result.localOnly++; continue; }
    if (!stateEqual(item, other)) result.changed++;
  }
  for (const id of remoteById.keys()) if (!localById.has(id)) result.remoteOnly++;
  const localDeleted = Array.isArray(local.deletedItems) ? local.deletedItems.length : 0;
  const remoteDeleted = Array.isArray(remote.deletedItems) ? remote.deletedItems.length : 0;
  const dryMerge = syncEqual ? { state: cleanState(local), conflicts: [] } : mergeDetailed(local, remote, base);
  const unknownItems = decisionUnits(local, remote, dryMerge.conflicts);
  const itemStatus = classifyItems(local, remote, base, unknownItems);
  const conflictResourceIds = new Set(unknownItems.filter(row => row.kind === 'resource').map(row => String(row.id)));
  const localDeletedRows = new Map((local.deletedItems || []).map(row => [String(row.id), row]));
  const remoteDeletedRows = new Map((remote.deletedItems || []).map(row => [String(row.id), row]));
  const resourceComparisons = [];
  for (const id of new Set([...localById.keys(), ...remoteById.keys(), ...localDeletedRows.keys(), ...remoteDeletedRows.keys()].map(String))) {
    const localRow = localById.get(id), remoteRow = remoteById.get(id);
    const localExists = Boolean(localRow) && !localDeletedRows.has(id), remoteExists = Boolean(remoteRow) && !remoteDeletedRows.has(id);
    const localValue = localExists ? localRow : MISSING, remoteValue = remoteExists ? remoteRow : MISSING;
    const localUpdatedAt = localExists ? localRow.updatedAt || null : null, remoteUpdatedAt = remoteExists ? remoteRow.updatedAt || null : null;
    // Timestamps below are presentation-only; they do not affect equality, revisions, or merge decisions.
    const timestampsDiffer = String(localUpdatedAt || '') !== String(remoteUpdatedAt || '');
    if (stateEqual(localValue, remoteValue) && !timestampsDiffer) continue;
    if (!localExists && !remoteExists && !conflictResourceIds.has(id)) continue;
    const localDeleted = localDeletedRows.get(id), remoteDeleted = remoteDeletedRows.get(id);
    resourceComparisons.push({
      id, label: String(localRow?.name || remoteRow?.name || localDeleted?.name || remoteDeleted?.name || id),
      localExists, remoteExists, localUpdatedAt, remoteUpdatedAt, conflict: conflictResourceIds.has(id)
    });
  }
  result.localNewer = itemStatus.localNewer;
  result.remoteNewer = itemStatus.remoteNewer;
  result.sameOrUnknownTime = itemStatus.unknown;
  const resolvedLatestSide = syncEqual ? 'same' : itemStatus.unknown || unknownItems.some(row => row.kind !== 'resource') ? 'unknown'
    : itemStatus.localNewer && !itemStatus.remoteNewer ? 'local'
      : itemStatus.remoteNewer && !itemStatus.localNewer ? 'remote' : 'diverged';
  const possibleMatches = [];
  for (const a of local.items) for (const b of remote.items) {
    if (a.id === b.id || a.type !== b.type) continue;
    const exact = a.identityKey && a.identityKey === b.identityKey || a.scanInfo?.identity && a.scanInfo.identity === b.scanInfo?.identity;
    const paths = item => [item.localPath, ...(item.localFiles || []).map(row => row.path), ...Object.values(item.deviceLocations || {}).flatMap(location => [location.localPath, ...(location.localFiles || []).map(row => row.path)])].filter(Boolean).map(value => String(value).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase());
    const pa = new Set(paths(a)), samePath = paths(b).some(value => pa.has(value));
    if (exact || samePath) possibleMatches.push({ localId: a.id, remoteId: b.id, localName:a.name||a.id, remoteName:b.name||b.id, reason: exact ? '记录身份标识一致' : '本地来源路径一致' });
  }
  return {
    equal, syncEqual, localHash, remoteHash, localContentRevision: localHash, remoteContentRevision: remoteHash,
    localSyncRevision, remoteSyncRevision, localCount: local.items.length, remoteCount: remote.items.length,
    localDeleted, remoteDeleted, localLatest: localDataLatest, remoteLatest: remoteDataLatest,
    localTimestampSource: '共同版本与内容差异', remoteTimestampSource: '共同版本与内容差异',
    localLastModified: timestamps.localLastModified || '', remoteLastModified: timestamps.remoteLastModified || '',
    latestSide: resolvedLatestSide, mergeable: dryMerge.conflicts.length === 0, mergeConflicts: dryMerge.conflicts,
    unknownItems, resourceComparisons, sameCount: itemStatus.same, autoMerged: itemStatus.autoMerged,
    possibleMatches, ...result
  };
}

function preview(remote, comparison, reason = '') { return { version: remote.version, reason, comparison }; }

async function plan(options) {
  const { local, direction, get, stat, localLastModified, backup, resolution, expectedVersion, endpointKey = null, forceDecision = false, diagnostic = () => {} } = options;
  if (!['upload', 'download', 'bidirectional'].includes(direction)) throw Error('无效同步方向');
  validate(local);
  let remote;
  const cached = options.forceFreshRemote ? null : options.cachedRemote;
  if (cached?.state && cached.etag && !/^W\//i.test(cached.etag)) {
    try {
      const state = SyncState.normalizeIncoming(cached.state);
      validate(state);
      remote = {
        state, etag: cached.etag, lastModified: cached.lastModified || null,
        contentEncoding: null, storageEncoding: cached.storageEncoding || null, byteLength: Number.isFinite(cached.byteLength) ? cached.byteLength : null,
        contentRevision: SyncState.contentRevision(state), syncRevision: SyncState.syncRevision(state),
        version: JSON.stringify({ etag: cached.etag, lastModified: cached.lastModified || null, contentEncoding: null, storageEncoding: cached.storageEncoding || null, contentRevision: SyncState.contentRevision(state), syncRevision: SyncState.syncRevision(state), byteLength: Number.isFinite(cached.byteLength) ? cached.byteLength : null, sourceSyncVersion: SyncState.SYNC_SCHEMA_VERSION })
      };
    } catch (error) {
      try { diagnostic({ event: 'webdav.sync-state-read.cache-invalid', operation: 'sync', phase: 'read-sync-state', error }); } catch {}
      remote = await readSnapshot(get, diagnostic, options);
    }
  } else remote = await readSnapshot(get, diagnostic, options);
  if (remote.state && (!remote.etag || !remote.lastModified) && typeof stat === 'function') {
    try {
      const metadata = await stat({ forceFresh: Boolean(options.forceFreshRemote) });
      remote.etag ||= metadata?.etag || null;
      remote.lastModified ||= metadata?.lastModified || null;
      remote.version = JSON.stringify({ etag: remote.etag || null, lastModified: remote.lastModified || null, contentEncoding: remote.contentEncoding || null, contentRevision: SyncState.contentRevision(remote.state), syncRevision: SyncState.syncRevision(remote.state), byteLength: remote.byteLength || null, sourceSyncVersion: remote.sourceSyncVersion || SyncState.SYNC_SCHEMA_VERSION });
    } catch (error) { remote.timestampError = error?.message || String(error); }
  }
  if (!remote.state && direction === 'download') throw Error('远端没有资源库，未修改本地');
  const comparison = remote.state ? compare(local, remote.state, { localLastModified, remoteLastModified: remote.lastModified, remoteTimestampError: remote.timestampError || '', endpointKey }) : null;
  const differs = Boolean(remote.state && !comparison.syncEqual);
  const hasExpectedVersion = Object.prototype.hasOwnProperty.call(options, 'expectedVersion');
  if (hasExpectedVersion && expectedVersion !== remote.version) {
    return { needsDecision: true, preview: preview(remote, comparison, '云端在确认期间发生了变化，请核对新版本后再继续'), remoteSnapshot: remote };
  }
  if ((differs && resolution == null) || forceDecision) {
    return { needsDecision: true, preview: preview(remote, comparison, forceDecision ? '云端文件刚刚发生变化，请核对后重新确认' : ''), remoteSnapshot: remote };
  }

  if (direction === 'download' && resolution === 'local') return { cancelled: true, message: '已保留本地资源库，未执行下载' };
  let actualDirection = direction;
  if (resolution === 'remote' && direction === 'upload') actualDirection = 'download';
  if (resolution === 'remote' && direction === 'bidirectional') actualDirection = 'download';
  if (resolution === 'local' && direction === 'bidirectional') actualDirection = 'upload';

  let state, unknownUnits = [];
  if (actualDirection === 'bidirectional') {
    if (!remote.state) state = local;
    else {
      const base = commonBase(local, remote.state, endpointKey), merged = mergeDetailed(local, remote.state, base);
      unknownUnits = decisionUnits(local, remote.state, merged.conflicts);
      const decisions = resolution && typeof resolution === 'object' && resolution.decisions && typeof resolution.decisions === 'object' ? resolution.decisions : null;
      if (unknownUnits.length && !decisions) return { needsDecision: true, preview: preview(remote, { ...comparison, unknownItems: unknownUnits }, '请逐项选择无法判断的资源或数据保留哪一侧；其他可判断内容会继续双向同步'), remoteSnapshot: remote };
      if (unknownUnits.length) {
        try { state = applyDecisionUnits(merged.state, local, remote.state, unknownUnits, decisions); }
        catch (error) { return { needsDecision: true, preview: preview(remote, { ...comparison, unknownItems: unknownUnits }, error.message), remoteSnapshot: remote }; }
      } else state = merged.state;
    }
  } else if (actualDirection === 'download') state = remote.state;
  else state = local;
  if (!state) throw Error('远端没有资源库，未修改本地');
  state = finalizeState(state, endpointKey);
  let headers = null;
  if (actualDirection !== 'download') {
    if (!remote.state) headers = { 'If-None-Match': '*' };
    else if (remote.etag && !remote.etag.startsWith('W/')) headers = { 'If-Match': remote.etag };
    else if (remote.lastModified) headers = { 'If-Unmodified-Since': remote.lastModified };
    else throw Error('服务器未提供可用于条件写入的 ETag 或修改时间，未覆盖远端；无法保证并发安全');
  }
  const changesLocal = ['download', 'bidirectional'].includes(actualDirection) && !sameState(local, state);
  const changesRemote = actualDirection !== 'download' && (!remote.state || !sameState(state, remote.state));
  if (changesLocal || changesRemote) await backup({ local, remote: remote.state });
  return { state, headers, actualDirection, comparison, expectedVersion: remote.version, remoteSnapshot: remote };
}

module.exports = { snapshot, serializeSnapshot, compare, merge, plan, conditionState, diagnosePreconditionFailure, latestUpdatedAt, stableStringify, sameState, sameSyncedDocument, contentHash, hasLineage, commonBase, decisionUnits, decisionSignature, MAX_SYNC_STATE_BYTES, MAX_SYNC_STATE_BODY_RETRIES, toRemoteState: SyncState.toRemoteState, toBaseState: SyncState.toBaseState };
