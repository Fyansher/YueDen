'use strict';

function safeValidator(row) {
  if (row?.etag && !/^W\//i.test(String(row.etag))) return { 'If-Match': String(row.etag) };
  if (row?.lastModified) return { 'If-Unmodified-Since': String(row.lastModified) };
  return null;
}

function sameValidator(left, right) {
  const leftCondition = safeValidator(left), rightCondition = safeValidator(right);
  if (!leftCondition || !rightCondition) return false;
  const leftKey = Object.keys(leftCondition)[0], rightKey = Object.keys(rightCondition)[0];
  return leftKey === rightKey && leftCondition[leftKey] === rightCondition[rightKey];
}

async function refreshCurrent({ stat, read, onDiagnostic = () => {} }) {
  let before = null;
  try { before = await stat(); }
  catch (error) { onDiagnostic({ event: 'validator-stat-before-failed', error }); }
  const fresh = await read();
  if (!fresh) return null;
  if (safeValidator(fresh)) return fresh;
  let after = null;
  try { after = await stat(); }
  catch (error) { onDiagnostic({ event: 'validator-stat-after-failed', error }); }
  if (before?.exists !== false && after?.exists !== false && sameValidator(before, after)) {
    return { ...fresh, etag: after.etag || '', lastModified: after.lastModified || '', byteLength: after.contentLength ?? fresh.byteLength };
  }
  throw Error('云端存档索引缺少安全写入标识，重新读取后仍无法确认当前版本，未覆盖');
}

async function publish({
  current,
  localCatalog,
  direction,
  merge,
  refreshCurrent,
  put,
  verify,
  maxConflicts = 2,
  onDiagnostic = () => {}
}) {
  const verifyRevision = target => require('./webdav-verification').retryRead(
    async () => { const observed = await verify(target); return observed?.catalog?.revision === target.revision ? observed : null; }
  );
  let remote = current || null, conflicts = 0;
  for (;;) {
    const target = merge(remote?.catalog || null, localCatalog, direction);
    if (remote?.catalog?.revision === target.revision) {
      return { catalog: target, etag: remote.etag || '', lastModified: remote.lastModified || '', byteLength: remote.byteLength ?? null, uploaded: 0 };
    }

    let conditions = remote ? safeValidator(remote) : { 'If-None-Match': '*' };
    if (remote && !conditions) {
      remote = await refreshCurrent(remote);
      if (remote && !safeValidator(remote)) throw Error('云端存档索引缺少安全写入标识，未覆盖');
      continue;
    }

    let response;
    try { response = await put(target, conditions); }
    catch (error) {
      const observed = await verifyRevision(target).catch(() => null);
      if (observed) {
        onDiagnostic({ event: 'webdav.save-catalog.write-confirmed-after-interruption', error });
        return { ...observed, catalog: target, uploaded: 1 };
      }
      throw Error('云端存档索引写入结果无法确认；未更新本地验证记录', { cause: error });
    }

    if (response.status === 412) {
      await response.body?.cancel();
      if (conflicts++ >= maxConflicts) throw Error('云端存档索引连续发生条件写入冲突，已停止覆盖');
      remote = await refreshCurrent(remote);
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      throw Error('更新云端存档索引失败（HTTP ' + status + '）');
    }

    const etag = response.headers.get('etag') || '';
    const lastModified = response.headers.get('last-modified') || '';
    await response.body?.cancel();
    const observed = await verifyRevision(target);
    if (!observed?.catalog) {
      throw Error('云端存档索引写入后回读校验不一致；快照仍保持待同步');
    }
    return {
      ...observed,
      catalog: target,
      etag: observed.etag || etag,
      lastModified: observed.lastModified || lastModified,
      byteLength: observed.byteLength ?? null,
      uploaded: 1
    };
  }
}

module.exports = { safeValidator, sameValidator, refreshCurrent, publish };
