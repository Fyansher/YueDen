function causeChain(error) {
  const rows = [];
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) rows.push(current);
  return rows;
}

function isAmbiguousPutResult(error) {
  if (error?.status) return false;
  const causes = causeChain(error), codes = causes.map(row => String(row.code || ''));
  if (codes.some(code => ['UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'YUEDEN_WEBDAV_BODY_TIMEOUT', 'YUEDEN_WEBDAV_HEADER_TIMEOUT', 'YUEDEN_WEBDAV_OPERATION_TIMEOUT'].includes(code))) return true;
  return causes.some(row => row.name === 'TimeoutError' || /terminated|socket closed|connection reset|response.*interrupted/i.test(String(row.message || '')));
}

function classifySyncStateWrite({ expected, before, after, same }) {
  const expectedRevision = expected?.syncRevision;
  const actualRevision = after?.syncRevision;
  if (expectedRevision && actualRevision && expectedRevision === actualRevision) return 'confirmed';
  if (after && same(expected, after)) return 'confirmed';
  if (same(before ?? null, after ?? null)) return 'unchanged';
  return 'changed';
}

async function writeSyncState({ initial, plan, planOptions, put, refreshLocal, same, diagnostic = () => {}, maxPreconditionRecomputes = 2 }) {
  let prepared = initial, preconditionRecomputes = 0;
  const report = row => { try { diagnostic(row); } catch {} };
  for (;;) {
    const outgoing = require('./webdav-state').toRemoteState(prepared.state);
    const remote = prepared.remoteSnapshot?.state;
    const needsCompression = prepared.actualDirection !== 'download' && remote && prepared.remoteSnapshot?.storageEncoding !== 'gzip';
    const shouldWrite = !remote || !same(outgoing, remote) || needsCompression;
    if (!shouldWrite) return { prepared, outgoing, wrote: false, confirmedAfterInterruption: false, needsDecision: false };
    const began = Date.now();
    try {
      await put(outgoing, prepared.headers, prepared);
      report({ event: 'webdav.sync.STATE_UPLOAD', operation: 'sync', phase: 'state-upload', durationMs: Date.now() - began, bytes: Buffer.byteLength(JSON.stringify(outgoing)), etagBefore: prepared.remoteSnapshot?.etag || '' });
      return { prepared, outgoing, wrote: true, confirmedAfterInterruption: false, needsDecision: false };
    } catch (error) {
      if (error.status === 412) {
        if (preconditionRecomputes >= maxPreconditionRecomputes) throw Error(`云端条件写入连续冲突 ${preconditionRecomputes + 1} 次，已停止覆盖` , { cause: error });
        preconditionRecomputes += 1;
        const local = await refreshLocal();
        const nextOptions = { ...planOptions, local, cachedRemote: null, forceFreshRemote: true, forceDecision: false };
        delete nextOptions.expectedVersion;
        delete nextOptions.resolution;
        report({ event: 'webdav.sync.MERGE', operation: 'sync', phase: 'precondition-recompute', attempt: preconditionRecomputes, cause: error });
        prepared = await plan(nextOptions);
        if (prepared.needsDecision || prepared.cancelled) return { prepared, outgoing: null, wrote: false, confirmedAfterInterruption: false, needsDecision: Boolean(prepared.needsDecision) };
        continue;
      }
      if (!isAmbiguousPutResult(error)) throw error;
      report({ event: 'webdav.sync.STATE_VERIFY', operation: 'sync', phase: 'verify-put', result: 'started', error });
      const local = await refreshLocal();
      if(typeof planOptions.stat==='function'){
        const statStarted=Date.now();
        try{const metadata=await planOptions.stat({forceFresh:true});report({event:'webdav.sync.REMOTE_STAT',operation:'sync',phase:'verify-put-stat',durationMs:Date.now()-statStarted,exists:metadata?.exists,etag:metadata?.etag||'',size:metadata?.contentLength});}
        catch(cause){report({event:'webdav.sync.REMOTE_STAT',operation:'sync',phase:'verify-put-stat',durationMs:Date.now()-statStarted,error:cause});}
      }
      const verifyOptions = { ...planOptions, local, cachedRemote: null, forceFreshRemote: true, forceDecision: true };
      delete verifyOptions.expectedVersion;
      delete verifyOptions.resolution;
      let verified;
      try { verified = await plan(verifyOptions); }
      catch (cause) { throw Error('PUT 响应中断，重新读取远端版本失败，不能确认是否写入', { cause: Error(error.message, { cause }) }); }
      const outcome = classifySyncStateWrite({ expected: outgoing, before: prepared.remoteSnapshot?.state, after: verified.remoteSnapshot?.state, same });
      report({ event: 'webdav.sync.STATE_VERIFY', operation: 'sync', phase: 'verify-put', result: outcome, expectedRevision: outgoing.syncRevision || '', remoteRevision: verified.remoteSnapshot?.state?.syncRevision || '' });
      if (outcome === 'confirmed') return { prepared: { ...prepared, remoteSnapshot: verified.remoteSnapshot }, outgoing, wrote: true, confirmedAfterInterruption: true, needsDecision: false };
      if (outcome === 'unchanged') throw Error('PUT 响应中断；已重新读取确认云端仍为写入前版本，本次未更新同步基线', { cause: error });
      return { prepared: verified, outgoing: null, wrote: false, confirmedAfterInterruption: false, needsDecision: true };
    }
  }
}

module.exports = { causeChain, isAmbiguousPutResult, classifySyncStateWrite, writeSyncState };
