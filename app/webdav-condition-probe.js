const { randomBytes } = require('node:crypto');

async function discard(response) { try { await response?.body?.cancel(); } catch {} }

async function probe({ settings, request, signal, token = randomBytes(16).toString('hex'), diagnostic = () => {} }) {
  const relative = `.yueden-write-check-${token}.tmp`;
  const expected = `yueden-write-check:${token}`;
  const send = (method, body = null) => request(settings, method, relative, body, 'text/plain; charset=utf-8', {}, signal);
  const report = row => { try { diagnostic({ resource: 'connection-check', operation: 'connection-test', ...row }); } catch {} };
  let failure = null, cleanupFailure = '';
  try {
    let putError = null;
    try {
      const response = await send('PUT', expected);
      if (!response.ok) { const status = response.status; await discard(response); throw Error(`无法写入临时验证文件（HTTP ${status}）`); }
      await discard(response);
    } catch (error) { putError = error; }

    const read = await send('GET');
    if (!read.ok) {
      const status = read.status; await discard(read);
      throw putError || Error(`无法读取临时验证文件（HTTP ${status}）`);
    }
    const actual = await read.text();
    if (actual !== expected) throw putError || Error('临时验证文件写入后内容不一致');
    if (putError) report({ event: 'connection-test.put-confirmed-after-interruption', error: putError });
  } catch (error) {
    failure = error;
    report({ event: 'connection-test.failed', error });
  } finally {
    try {
      const cleanupSignal = AbortSignal.timeout(3000);
      const removed = await request(settings, 'DELETE', relative, null, '', {}, cleanupSignal);
      if (!removed.ok && removed.status !== 404) cleanupFailure = `临时验证文件清理失败（HTTP ${removed.status}）`;
      await discard(removed);
    } catch (error) {
      cleanupFailure = '临时验证文件清理失败：' + (error?.message || '网络连接中断');
      report({ event: 'connection-test.cleanup-failed', error });
    }
  }
  if (failure) throw Error(failure.message + (cleanupFailure ? `；${cleanupFailure}` : ''), { cause: failure });
  if (cleanupFailure) throw Error(cleanupFailure);
  return { ok: true, message: '连接正常，目标目录可读写' };
}

module.exports = { probe };
