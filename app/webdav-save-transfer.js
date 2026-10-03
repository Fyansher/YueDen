'use strict';

function proofMatches(proof, info) {
  return Boolean(proof && info
    && String(proof.sha256 || '') === String(info.sha256 || '')
    && Number(proof.size) === Number(info.size)
    && Number(proof.storedSize) === Number(info.storedSize)
    && String(proof.encoding || '') === String(info.encoding || ''));
}

async function uploadSnapshotFiles(files, transfer) {
  const objects = (files || []).filter(file => file?.immutable === true);
  const manifests = (files || []).filter(file => file?.immutable !== true);
  if (manifests.length !== 1) throw Error('存档快照必须恰好包含一个清单');
  for (const file of objects) await transfer(file);
  for (const file of manifests) await transfer(file);
}

async function uploadImmutableObject(options) {
  const {
    target, info, sharedProof, readLocalBytes,
    verifyObjectBytes, request, ensureDirectory, rememberRemoteObject = () => {}, failure = (method, status) => `${method} HTTP ${status}`
  } = options;
  if (sharedProof && String(sharedProof.sha256 || '') === String(info?.sha256 || '')) {
    rememberRemoteObject(sharedProof);
    return { uploaded: false, proof: sharedProof, reason: 'session-cache' };
  }

  const localBytes = await readLocalBytes();
  if (!await verifyObjectBytes(info, localBytes)) throw Error('本地存档数据块校验失败，未上传：' + target);

  const readRemoteProof = async () => {
    const response = await request('GET', target);
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      const message = failure('GET', response.status);
      await response.body?.cancel();
      throw Error('无法核对云端存档数据块：' + message);
    }
    const etag = response.headers.get('etag') || '';
    const bytes = Buffer.from(await response.arrayBuffer());
    return await verifyObjectBytes(info, bytes) ? { sha256: info.sha256, etag: !etag.startsWith('W/') ? etag : '' } : false;
  };

  const existing = await request('GET', target);
  let conditions = { 'If-None-Match': '*' }, etag = '', lastModified = '';
  if (existing.status === 404) await existing.body?.cancel();
  else {
    if (!existing.ok) {
      const message = failure('GET', existing.status);
      await existing.body?.cancel();
      throw Error('无法核对云端存档数据块：' + message);
    }
    etag = existing.headers.get('etag') || '';
    lastModified = existing.headers.get('last-modified') || '';
    const bytes = Buffer.from(await existing.arrayBuffer());
    if (await verifyObjectBytes(info, bytes)) {
      const proof = { sha256: info.sha256, etag: !etag.startsWith('W/') ? etag : '' };
      rememberRemoteObject(proof);
      return { uploaded: false, proof, reason: 'remote-verified' };
    }
    if (etag && !etag.startsWith('W/')) conditions = { 'If-Match': etag };
    else if (lastModified) conditions = { 'If-Unmodified-Since': lastModified };
    else throw Error('云端存档数据块内容损坏且缺少条件写入标识，未覆盖云端');
  }

  await ensureDirectory();
  let put;
  try { put = await request('PUT', target, localBytes, conditions); }
  catch (cause) {
    const confirmed = await readRemoteProof().catch(() => false);
    if (confirmed) { rememberRemoteObject(confirmed); return { uploaded: true, proof: confirmed, reason: 'confirmed-after-interruption' }; }
    throw Error('存档数据块上传中断，远端内容校验未确认：' + target, { cause });
  }
  if (put.status === 412) {
    await put.body?.cancel();
    const confirmed = await readRemoteProof();
    if (confirmed) { rememberRemoteObject(confirmed); return { uploaded: false, proof: confirmed, reason: 'already-present-after-412' }; }
    throw Error('云端存档数据块在写入期间发生变化，校验后仍不一致，已停止覆盖');
  }
  if (!put.ok) {
    const message = failure('PUT', put.status);
    await put.body?.cancel();
    throw Error('上传存档数据块失败：' + message);
  }
  const responseEtag = put.headers.get('etag') || '';
  await put.body?.cancel();
  const stored = await readRemoteProof();
  if (!stored) throw Error('存档数据块上传后回读校验失败，未继续写入清单：' + target);
  const proof = { ...stored, etag: stored.etag || (!responseEtag.startsWith('W/') ? responseEtag : '') };
  rememberRemoteObject(proof);
  return { uploaded: true, proof, reason: 'put-verified' };
}

module.exports = { proofMatches, uploadImmutableObject, uploadSnapshotFiles };
