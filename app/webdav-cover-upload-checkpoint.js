const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function create(file, { now = Date.now, maxAgeMs = MAX_AGE_MS } = {}) {
  let active = null;
  const resolveFile = () => typeof file === 'function' ? file() : file;

  function serialize() {
    if (!active) return '';
    const rows = [JSON.stringify({ version: 1, endpointKey: active.endpointKey, createdAt: active.createdAt })];
    for (const entry of active.completed.values()) rows.push(JSON.stringify(entry));
    return rows.join('\n') + '\n';
  }

  function rewrite() {
    if (!active) return false;
    let target, temporary, descriptor;
    try {
      target = resolveFile();
      if (!target) return false;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      descriptor = fs.openSync(temporary, 'w');
      fs.writeFileSync(descriptor, serialize(), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      try { fs.renameSync(temporary, target); }
      catch (error) {
        if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
        fs.copyFileSync(temporary, target);
        fs.rmSync(temporary, { force: true });
      }
      return true;
    } catch {
      if (descriptor != null) { try { fs.closeSync(descriptor); } catch {} }
      if (temporary) { try { fs.rmSync(temporary, { force: true }); } catch {} }
      return false;
    }
  }

  function begin({ endpointKey, hashes = [] } = {}) {
    const required = new Set(hashes.map(value => String(value || '').toLowerCase()).filter(value => HASH_PATTERN.test(value)));
    const endpoint = String(endpointKey || '');
    const completed = new Map();
    let createdAt = now();
    try {
      const target = resolveFile();
      const lines = target && fs.existsSync(target) ? fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean) : [];
      const header = lines.length ? JSON.parse(lines[0]) : null;
      if (header?.version === 1 && header.endpointKey === endpoint && Number.isFinite(header.createdAt) && now() - header.createdAt <= maxAgeMs) {
        createdAt = header.createdAt;
        for (const line of lines.slice(1)) {
          try {
            const entry = JSON.parse(line), hash = String(entry.hash || '').toLowerCase();
            if (!required.has(hash) || !HASH_PATTERN.test(hash)) continue;
            const size = Number(entry.size);
            completed.set(hash, { hash, size: Number.isSafeInteger(size) && size >= 0 ? size : null, etag: String(entry.etag || '').slice(0, 300) });
          } catch {}
        }
      }
    } catch {}

    active = { endpointKey: endpoint, createdAt, required, completed, enabled: false };
    active.enabled = rewrite();
    return { resumed: completed.size, enabled: active.enabled };
  }

  function get(hash) {
    return active?.completed.get(String(hash || '').toLowerCase()) || null;
  }

  function mark(hash, details = {}) {
    const normalized = String(hash || '').toLowerCase();
    if (!active || !active.required.has(normalized) || !HASH_PATTERN.test(normalized)) return false;
    const size = Number(details.size);
    const entry = { hash: normalized, size: Number.isSafeInteger(size) && size >= 0 ? size : null, etag: String(details.etag || '').slice(0, 300) };
    active.completed.set(normalized, entry);
    if (!active.enabled) return false;
    let descriptor;
    try {
      descriptor = fs.openSync(resolveFile(), 'a');
      fs.writeSync(descriptor, JSON.stringify(entry) + '\n', null, 'utf8');
      fs.fsyncSync(descriptor);
      return true;
    } catch {
      active.enabled = false;
      return false;
    } finally { if (descriptor != null) { try { fs.closeSync(descriptor); } catch {} } }
  }

  function forget(hash) {
    const normalized = String(hash || '').toLowerCase();
    if (!active?.completed.delete(normalized)) return false;
    if (active.enabled && !rewrite()) active.enabled = false;
    return true;
  }

  function completedCount() { return active?.completed.size || 0; }

  function clear() {
    const target = resolveFile();
    active = null;
    try { if (target) fs.rmSync(target, { force: true }); } catch {}
  }

  return { begin, get, mark, forget, completedCount, clear };
}

module.exports = { create, MAX_AGE_MS };
