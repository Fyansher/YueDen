'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const HEADER_NAMES = ['server', 'dav', 'allow', 'etag', 'last-modified', 'date', 'content-type', 'content-length'];
const CONDITION_NAMES = ['if-match', 'if-none-match', 'if-unmodified-since', 'if-modified-since', 'if-range', 'range', 'depth'];

function cleanText(value, limit = 1200) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/\b(?:authorization|proxy-authorization|username|user name|password|passwd|token|access[_ -]?token|refresh[_ -]?token|secret)\b(\s*[:=]\s*)(?:basic\s+)?[^\s,;<>"']+/gi, '$1[REDACTED]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/g, 'Basic [REDACTED]')
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=\r\n]+/gi, '[IMAGE_DATA_REDACTED]')
    .replace(/[A-Za-z0-9+/]{160,}={0,2}/g, '[BASE64_REDACTED]')
    .replace(/([A-Za-z]:\\[^)\r\n]*?[/\\])([^/\\)\r\n]+\.js:\d+:\d+)/g, '<app>/$2')
    .replace(/[A-Za-z]:\\[^\s<>"']+/g, '[LOCAL_PATH]')
    .replace(/\\\\[^\\\s]+\\[^\s<>"']+/g, '[LOCAL_PATH]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function pickHeaders(input, allowedNames) {
  const result = {};
  if (!input) return result;
  const entries = typeof input.entries === 'function' ? [...input.entries()] : Object.entries(input);
  const normalized = Object.fromEntries(entries.map(([key, value]) => [String(key).toLowerCase(), value]));
  for (const name of allowedNames) {
    let value = normalized[name];
    if (value == null && typeof input.get === 'function') { try { value = input.get(name); } catch {} }
    if (value != null && String(value)) result[name] = cleanText(value, 300);
  }
  return result;
}

function errorFields(error) {
  if (!error) return {};
  const stack = String(error.stack || '').split('\n').slice(0, 14).join('\n');
  const cause = error.cause?.code || error.cause?.message || 'none';
  const chain=[];for(let current=error,depth=0;current&&depth<8;current=current.cause,depth++)chain.push({name:cleanText(current.name||'Error',100),code:cleanText(current.code||'',100),message:cleanText(current.message||current,600)});
  return { errorName: cleanText(error.name || 'Error', 100), errorMessage: cleanText(error.message || error, 1800), errorCause: cleanText(cause, 400), errorCauseChain: chain, errorStack: cleanText(stack, 4000) };
}

function fastPathRecord(fields = {}) {
  const libraryUnchanged = typeof fields.libraryUnchanged === 'boolean' ? fields.libraryUnchanged : null;
  const savesUnchanged = typeof fields.savesUnchanged === 'boolean' ? fields.savesUnchanged : null;
  const archivesUnchanged = typeof fields.archivesUnchanged === 'boolean' ? fields.archivesUnchanged : null;
  const values = [libraryUnchanged, savesUnchanged, archivesUnchanged];
  return {
    ...fields,
    event: 'webdav.sync.FAST_PATH', operation: 'sync', phase: 'fast-path',
    libraryUnchanged, savesUnchanged, archivesUnchanged,
    overallUnchanged: values.every(value => typeof value === 'boolean') ? values.every(Boolean) : null
  };
}

function create(directory, identity = () => ({})) {
  function write(record = {}) {
    try {
      const base = typeof directory === 'function' ? directory() : directory;
      if (!base) return false;
      const folder = path.join(base, 'logs'), file = path.join(folder, 'webdav-diagnostics.jsonl');
      fs.mkdirSync(folder, { recursive: true });
      let defaults={};try{defaults=identity()||{};}catch{}
      const row = {
        time: new Date().toISOString(), event: cleanText(record.event || 'webdav.diagnostic', 120),
        appVersion:cleanText(record.appVersion||defaults.appVersion||'',80),buildId:cleanText(record.buildId||defaults.buildId||'',120),schemaVersion:Number.isFinite(Number(record.schemaVersion??defaults.schemaVersion))?Number(record.schemaVersion??defaults.schemaVersion):undefined,
        operation: cleanText(record.operation || '', 80), phase: cleanText(record.phase || '', 120),
        method: cleanText(record.method || '', 20), resource: cleanText(record.resource || '', 80),
        status: Number.isFinite(Number(record.status)) ? Number(record.status) : undefined,
        statusText: cleanText(record.statusText || '', 160), durationMs: Number.isFinite(Number(record.durationMs)) ? Number(record.durationMs) : undefined,
        requestConditions: pickHeaders(record.requestConditions, CONDITION_NAMES),
        responseHeaders: pickHeaders(record.responseHeaders, HEADER_NAMES), body: cleanText(record.body || '', 1200),
        unchanged: typeof record.unchanged === 'boolean' ? record.unchanged : undefined,
        libraryUnchanged: typeof record.libraryUnchanged === 'boolean' ? record.libraryUnchanged : undefined,
        savesUnchanged: typeof record.savesUnchanged === 'boolean' ? record.savesUnchanged : undefined,
        archivesUnchanged: typeof record.archivesUnchanged === 'boolean' ? record.archivesUnchanged : undefined,
        overallUnchanged: typeof record.overallUnchanged === 'boolean' ? record.overallUnchanged : undefined,
        libraryStatCacheHit: typeof record.libraryStatCacheHit === 'boolean' ? record.libraryStatCacheHit : undefined,
        localRevision: cleanText(record.localRevision || '', 80),
        remoteRevision: cleanText(record.remoteRevision || '', 80),
        localCount: Number.isFinite(Number(record.localCount)) ? Number(record.localCount) : undefined,
        remoteCount: Number.isFinite(Number(record.remoteCount)) ? Number(record.remoteCount) : undefined,
        changedCount: Number.isFinite(Number(record.changedCount)) ? Number(record.changedCount) : undefined,
        localNewer: Number.isFinite(Number(record.localNewer)) ? Number(record.localNewer) : undefined,
        remoteNewer: Number.isFinite(Number(record.remoteNewer)) ? Number(record.remoteNewer) : undefined,
        unknownCount: Number.isFinite(Number(record.unknownCount)) ? Number(record.unknownCount) : undefined,
        attempt: Number.isFinite(Number(record.attempt)) ? Number(record.attempt) : undefined,
        bytesReceived: Number.isFinite(Number(record.bytesReceived)) ? Number(record.bytesReceived) : undefined,
        stateBytes:Number.isFinite(Number(record.stateBytes))?Number(record.stateBytes):undefined,
        saveCount:Number.isFinite(Number(record.saveCount))?Number(record.saveCount):undefined,
        manifestCount:Number.isFinite(Number(record.manifestCount))?Number(record.manifestCount):undefined,
        objectCount:Number.isFinite(Number(record.objectCount))?Number(record.objectCount):undefined,
        localContentRevision:cleanText(record.localContentRevision||'',80),remoteContentRevision:cleanText(record.remoteContentRevision||'',80),syncRevision:cleanText(record.syncRevision||'',80),
        expectedBytes: Number.isFinite(Number(record.expectedBytes)) ? Number(record.expectedBytes) : undefined,
        requestedBytes: Number.isFinite(Number(record.requestedBytes)) ? Number(record.requestedBytes) : undefined,
        mode: cleanText(record.mode || '', 40),
        ...errorFields(record.error)
      };
      for (const key of Object.keys(row)) if (row[key] === '' || row[key] === undefined || (key.endsWith('Headers') && !Object.keys(row[key]).length)) delete row[key];
      const line = JSON.stringify(row) + '\n';
      let currentSize = 0;
      try { currentSize = fs.statSync(file).size; } catch {}
      if (currentSize + Buffer.byteLength(line) > MAX_LOG_BYTES) {
        const previous = file + '.1';
        try { fs.rmSync(previous, { force: true }); } catch {}
        try { fs.renameSync(file, previous); } catch {}
      }
      fs.appendFileSync(file, line, 'utf8');
      return true;
    } catch { return false; }
  }
  return { write };
}

module.exports = { create, cleanText, fastPathRecord };
