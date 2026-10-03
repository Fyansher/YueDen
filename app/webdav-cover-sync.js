const crypto = require('node:crypto');

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function discard(response) { try { await response?.body?.cancel(); } catch {} }
async function responseBytes(response) { return Buffer.from(await response.arrayBuffer()); }
function verified(bytes, hash) { return Buffer.isBuffer(bytes) && digest(bytes) === hash; }

async function ensureRemoteObjects({ settings, state, previousState = null, store, request, ensureDirectories, diagnostic = () => {} }) {
  const allReferences = store.references(state), previousReferences = previousState ? store.references(previousState) : new Map();
  const references = new Map([...allReferences].filter(([hash]) => !previousReferences.has(hash)));
  const result = { uploaded: 0, skipped: allReferences.size - references.size };
  let directoriesReady = false;
  for (const [hash, reference] of references) {
    const relative = `covers/${hash}.jpg`;
    let bytes;
    try { bytes = store.readObject(reference); }
    catch (localError) {
      const remote = await request(settings, 'GET', relative);
      if (!remote.ok) { const status = remote.status; await discard(remote); throw Error('本地封面缺失且云端封面不可读取（HTTP ' + status + '）', { cause: localError }); }
      bytes = await responseBytes(remote);
      if (!verified(bytes, hash)) throw Error('云端已有封面对象校验失败：' + hash);
      store.storeObject(reference, bytes);
      result.skipped++;
      continue;
    }
    if (!directoriesReady) { await ensureDirectories(settings, 'covers'); directoriesReady = true; }
    try {
      const put = await request(settings, 'PUT', relative, bytes, 'image/jpeg', { 'If-None-Match': '*' });
      if (put.status === 412) {
        await discard(put);
        const existing = await request(settings, 'GET', relative);
        if (!existing.ok) {
          const status = existing.status; await discard(existing);
          const error = Error('封面条件创建被拒绝，且云端对象不可读取（HTTP ' + status + '）：' + hash); error.status = status; throw error;
        }
        const existingBytes = await responseBytes(existing);
        if (!verified(existingBytes, hash)) {
          const error = Error('封面条件创建冲突，但云端对象与内容地址不符：' + hash); error.code = 'YUEDEN_COVER_HASH_MISMATCH'; throw error;
        }
        result.skipped++; continue;
      }
      if (!put.ok) { const status = put.status; await discard(put); throw Error('上传封面对象失败（HTTP ' + status + '）'); }
      await discard(put); result.uploaded++;
    } catch (error) {
      if (error.status || error.code === 'YUEDEN_WEBDAV_CANCELLED' || error.code === 'YUEDEN_COVER_HASH_MISMATCH') throw error;
      const current = await request(settings, 'GET', relative).catch(() => null);
      if (current?.ok) {
        const currentBytes = await responseBytes(current);
        if (verified(currentBytes, hash)) { result.uploaded++; continue; }
      }
      await discard(current);
      throw Error('封面上传结果无法确认：' + hash, { cause: error });
    }
  }
  try { diagnostic({ event: 'webdav.sync.OBJECT_UPLOAD', operation: 'sync', phase: 'cover-objects', uploaded: result.uploaded, skipped: result.skipped }); } catch {}
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
