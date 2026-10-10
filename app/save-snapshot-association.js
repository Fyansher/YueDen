(function(root) {
'use strict';

function stableIdentity(item = {}) {
  const identifiers = {};
  if (item.identifiers && typeof item.identifiers === 'object' && !Array.isArray(item.identifiers)) {
    for (const [key, value] of Object.entries(item.identifiers)) {
      const id = (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
      if (id && id.length <= 300 && /^[\w.-]{1,80}$/u.test(key)) identifiers[key] = id;
    }
  }
  const steamAppId = /^\d{1,12}$/.test(String(item.steamAppId || '')) ? String(item.steamAppId) : '';
  return { ...(steamAppId ? { steamAppId } : {}), ...(Object.keys(identifiers).length ? { identifiers } : {}) };
}

function normalizeTitle(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]+/gu, '');
}

function sameIdentity(left = {}, right = {}) {
  if (left.steamAppId && right.steamAppId && String(left.steamAppId) === String(right.steamAppId)) return true;
  const a = left.identifiers && typeof left.identifiers === 'object' ? left.identifiers : {};
  const b = right.identifiers && typeof right.identifiers === 'object' ? right.identifiers : {};
  return Object.entries(a).some(([key, value]) => value && b[key] && String(value) === String(b[key]));
}

function candidate(snapshot, item) {
  if (!snapshot || !item || item.type !== 'game') return false;
  const saved = snapshot.resourceIdentity || {};
  const current = stableIdentity(item);
  if (sameIdentity(saved, current)) return true;
  const savedPaths = new Set((snapshot.paths || snapshot.entries?.flatMap(entry => [entry.source, ...Object.values(entry.sourceByDevice || {})]) || []).filter(Boolean).map(value => String(value).toLocaleLowerCase()));
  if ((item.savePaths || []).some(value => savedPaths.has(String(value).toLocaleLowerCase()))) return true;
  const oldTitle = normalizeTitle(snapshot.gameName), currentTitle = normalizeTitle(item.name);
  return Boolean(oldTitle && oldTitle === currentTitle);
}

const api = { stableIdentity, normalizeTitle, sameIdentity, candidate };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.SaveSnapshotAssociation = api;
})(typeof window !== 'undefined' ? window : globalThis);
