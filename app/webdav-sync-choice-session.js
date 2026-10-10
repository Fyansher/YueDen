(function(root) {
'use strict';

function create(scope = '') {
  return { scope: String(scope), mode: null, active: new Map(), decisions: new Map() };
}

function update(session, units = []) {
  const active = new Map();
  for (const unit of units || []) {
    const key = String(unit?.key || ''), signature = String(unit?.signature || '');
    if (key) active.set(key, signature);
  }
  for (const [key, choice] of session.decisions) {
    if (!active.has(key) || active.get(key) !== choice.signature) session.decisions.delete(key);
  }
  session.active = active;
  return session;
}

function remember(session, key, signature, value) {
  key = String(key || ''); signature = String(signature || '');
  if (!key || !signature || session.active.get(key) !== signature) return false;
  if (value === '') { session.decisions.delete(key); return true; }
  if (!['local', 'remote'].includes(value)) return false;
  session.decisions.set(key, { signature, value });
  return true;
}

function restore(session, unit) {
  const choice = session.decisions.get(String(unit?.key || ''));
  return choice && choice.signature === String(unit?.signature || '') ? choice.value : '';
}

function values(session, units = []) {
  const result = {};
  for (const unit of units || []) {
    const value = restore(session, unit);
    if (value) result[unit.key] = value;
  }
  return result;
}

function setMode(session, value) {
  if (['local', 'remote', 'merge'].includes(value)) session.mode = value;
  return session.mode;
}

function clear(session) {
  session.mode = null;
  session.active.clear();
  session.decisions.clear();
}

const api = { create, update, remember, restore, values, setMode, clear };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.WebdavSyncChoiceSession = api;
})(typeof window !== 'undefined' ? window : globalThis);
