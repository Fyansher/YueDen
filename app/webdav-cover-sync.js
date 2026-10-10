const crypto = require('node:crypto');

const RETRYABLE_READ_CODES = new Set([
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'YUEDEN_WEBDAV_HEADER_TIMEOUT',
  'ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN'
]);
const READ_RETRY_DELAYS_MS = [300, 800];

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function discard(response) { try { await response?.body?.cancel(); } catch {} }
async function responseBytes(response) { return Buffer.from(await response.arrayBuffer()); }
function verified(bytes, hash) { return Buffer.isBuffer(bytes) && digest(bytes) === hash; }

function errorCode(error) {
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) {
    if (current.code) return String(current.code);
  }
  return '';
}

function retryableReadError(error) {
  const code = errorCode(error);
  return RETRYABLE_READ_CODES.has(code) && code !== 'YUEDEN_WEBDAV_CANCELLED';
}

async function retryRead(operation, { method, relative, diagnostic = () => {} }) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 3 || !retryableReadError(error)) throw error;
      try {
        diagnostic({ event: 'webdav.request-retry', operation: 'sync', phase: 'cover-object-read-retry', method, resource: 'webdav-resource', attempt: attempt + 1, mode: 'fresh-connection', error });
      } catch {}
      await new Promise(resolve => setTimeout(resolve, READ_RETRY_DELAYS_MS[attempt - 1]));
    }
  }
}

function unconfirmed(hash, cause) {
  const error = Error('封面上传结果无法确认：' + hash, { cause });
  error.code = 'YUEDEN_COVER_UPLOAD_UNCONFIRMED';
  return error;
}

async function ensureRemoteObjects({
  settings, state, previousState = null, store, request, ensureDirectories,
  stat = null, checkpoint = null, checkpointEndpointKey = '', diagnostic = () => {}
}) {
  const allReferences = store.references(state), previousReferences = previousState ? store.references(previousState) : new Map();
  const references = new Map([...allReferences].filter(([hash]) => !previousReferences.has(hash)));
  const result = { uploaded: 0, skipped: allReferences.size - references.size, resumed: 0 };
  const checkpointState = checkpoint?.begin?.({ endpointKey: checkpointEndpointKey, hashes: [...references.keys()] }) || { resumed: 0 };
  let directoriesReady = false;

  if (checkpointState.resumed) {
    try { diagnostic({ event: 'webdav.sync.COVER_CHECKPOINT', operation: 'sync', phase: 'cover-checkpoint-resume', objectCount: checkpointState.resumed }); } catch {}
  }

  const readRemote = (relative, method = 'GET') => retryRead(
    () => method === 'GET'
      ? request(settings, 'GET', relative, null, '', {}, undefined, false, false, 10_000, undefined, { freshConnection: true })
      : stat?.(settings, relative, { freshConnection: true }),
    { method, relative, diagnostic }
  );

  try {
    for (const [hash, reference] of references) {
      const relative = `covers/${hash}.jpg`;
      let bytes;
      try { bytes = store.readObject(reference); }
      catch (localError) {
        const remote = await readRemote(relative);
        if (!remote?.ok) { const status = remote?.status; await discard(remote); throw Error('本地封面缺失且云端封面不可读取（HTTP ' + status + '）', { cause: localError }); }
        bytes = await responseBytes(remote);
        if (!verified(bytes, hash)) throw Error('云端已有封面对象校验失败：' + hash);
        store.storeObject(reference, bytes);
        checkpoint?.mark?.(hash, { size: bytes.length, etag: remote.headers?.get?.('etag') || '' });
        result.skipped++;
        continue;
      }

      const saved = checkpoint?.get?.(hash);
      if (saved && typeof stat === 'function') {
        let remoteStatus;
        try { remoteStatus = await readRemote(relative, 'PROPFIND'); }
        catch (error) { throw Error('封面续传状态无法确认：' + hash, { cause: error }); }
        const sizeMatches = remoteStatus?.contentLength == null || remoteStatus.contentLength === bytes.length;
        const etagMatches = !saved.etag || !remoteStatus?.etag || /^W\//i.test(saved.etag) || /^W\//i.test(remoteStatus.etag) || saved.etag === remoteStatus.etag;
        if (remoteStatus?.exists && sizeMatches && etagMatches) {
          result.skipped++;
          result.resumed++;
          continue;
        }
        checkpoint.forget?.(hash);
      }

      if (!directoriesReady) { await ensureDirectories(settings, 'covers'); directoriesReady = true; }
      try {
        const put = await request(settings, 'PUT', relative, bytes, 'image/jpeg', { 'If-None-Match': '*' });
        if (put.status === 412) {
          await discard(put);
          let existing;
          try { existing = await readRemote(relative); }
          catch (error) { throw unconfirmed(hash, error); }
          if (!existing.ok) {
            const status = existing.status; await discard(existing);
            const error = Error('封面条件创建被拒绝，且云端对象不可读取（HTTP ' + status + '）：' + hash); error.status = status; throw error;
          }
          const existingBytes = await responseBytes(existing);
          if (!verified(existingBytes, hash)) {
            const error = Error('封面条件创建冲突，但云端对象与内容地址不符：' + hash); error.code = 'YUEDEN_COVER_HASH_MISMATCH'; throw error;
          }
          checkpoint?.mark?.(hash, { size: existingBytes.length, etag: existing.headers?.get?.('etag') || '' });
          result.skipped++;
          continue;
        }
        if (!put.ok) { const status = put.status; await discard(put); throw Error('上传封面对象失败（HTTP ' + status + '）'); }
        const etag = put.headers?.get?.('etag') || '';
        await discard(put);
        checkpoint?.mark?.(hash, { size: bytes.length, etag });
        result.uploaded++;
      } catch (error) {
        if (error.status || error.code === 'YUEDEN_WEBDAV_CANCELLED' || error.code === 'YUEDEN_COVER_HASH_MISMATCH' || error.code === 'YUEDEN_COVER_UPLOAD_UNCONFIRMED') throw error;
        let current;
        try { current = await readRemote(relative); }
        catch (readError) { throw unconfirmed(hash, readError); }
        if (current?.ok) {
          const currentBytes = await responseBytes(current);
          if (verified(currentBytes, hash)) {
            checkpoint?.mark?.(hash, { size: currentBytes.length, etag: current.headers?.get?.('etag') || '' });
            result.uploaded++;
            continue;
          }
        }
        await discard(current);
        throw unconfirmed(hash, error);
      }
    }
  } catch (error) {
    try { diagnostic({ event: 'webdav.sync.COVER_CHECKPOINT', operation: 'sync', phase: 'cover-checkpoint-paused', objectCount: checkpoint?.completedCount?.() || 0, error }); } catch {}
    throw error;
  }

  try { diagnostic({ event: 'webdav.sync.OBJECT_UPLOAD', operation: 'sync', phase: 'cover-objects', uploaded: result.uploaded, skipped: result.skipped, objectCount: result.resumed }); } catch {}
  return result;
}

async function ensureLocalObjects({ settings, state, store, request, diagnostic = () => {} }) {
  const references = store.references(state), result = { downloaded: 0, skipped: 0 };
  for (const [hash, reference] of references) {
    try { store.readObject(reference); result.skipped++; continue; } catch {}
    const response = await request(settings, 'GET', `covers/${hash}.jpg`);
    if (!response.ok) { const status = response.status; await discard(response); throw Error('云端缺少资源引用的封面对象（HTTP ' + status + '）：' + hash); }
    const bytes = await responseBytes(response);
    if (!verified(bytes, hash)) throw Error('云端封面对象校验失败，未写入本地：' + hash);
    store.storeObject(reference, bytes); result.downloaded++;
  }
  try { diagnostic({ event: 'webdav.sync.OBJECT_DOWNLOAD', operation: 'sync', phase: 'cover-objects', downloaded: result.downloaded, skipped: result.skipped }); } catch {}
  return result;
}

module.exports = { ensureRemoteObjects, ensureLocalObjects, digest };
