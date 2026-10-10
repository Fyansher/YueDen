const FIELDS = ['webdavUrl', 'webdavUsername', 'webdavRemotePath'];
const DEVICE_FIELDS = ['obsidianRoot', 'localScanPaths', 'localResourceRoots', 'refreshWhitelist'];
const MAX_LENGTH = 8192;
const INVALID_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function exportLocalWebdavSettings(settings = {}) {
  return Object.fromEntries(FIELDS.map(key => [key, typeof settings[key] === 'string' ? settings[key] : '']));
}

function restoreLocalWebdavSettings(settings = {}, value) {
  const result = { ...settings };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of FIELDS) {
    if (typeof value[key] === 'string' && value[key].length <= MAX_LENGTH) result[key] = value[key];
  }
  return result;
}

function exportLocalDeviceSettings(settings = {}) {
  const result={};
  for(const key of DEVICE_FIELDS){
    if(key==='localResourceRoots'&&settings[key]&&typeof settings[key]==='object'&&!Array.isArray(settings[key])){
      result[key]=Object.fromEntries(Object.entries(settings[key]).filter(([type,rows])=>/^[\w-]{1,80}$/.test(type)&&!INVALID_OBJECT_KEYS.has(type)&&Array.isArray(rows)).slice(0,30).map(([type,rows])=>[type,rows.slice(0,1000).filter(value=>typeof value==='string').map(value=>value.slice(0,MAX_LENGTH))]));
    }else if(Array.isArray(settings[key]))result[key]=settings[key].slice(0,1000).filter(value=>typeof value==='string').map(value=>value.slice(0,MAX_LENGTH));
    else if(typeof settings[key]==='string')result[key]=settings[key].slice(0,MAX_LENGTH);
    else result[key]=key==='obsidianRoot'?'':key==='localResourceRoots'?{}:[];
  }
  return result;
}

function restoreLocalDeviceSettings(settings = {}, value) {
  const result = { ...settings };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (typeof value.obsidianRoot === 'string' && value.obsidianRoot.length <= MAX_LENGTH) result.obsidianRoot = value.obsidianRoot;
  if(value.localResourceRoots&&typeof value.localResourceRoots==='object'&&!Array.isArray(value.localResourceRoots)){
    const roots={};for(const [type,rows]of Object.entries(value.localResourceRoots).slice(0,30))if(/^[\w-]{1,80}$/.test(type)&&!INVALID_OBJECT_KEYS.has(type)&&Array.isArray(rows)&&rows.length<=1000&&rows.every(row=>typeof row==='string'&&row.length<=MAX_LENGTH))roots[type]=[...rows];
    result.localResourceRoots=roots;
  }
  for (const key of ['localScanPaths', 'refreshWhitelist']) {
    if (Array.isArray(value[key]) && value[key].length <= 1000 && value[key].every(row => typeof row === 'string' && row.length <= MAX_LENGTH)) result[key] = [...value[key]];
  }
  return result;
}

module.exports = { exportLocalWebdavSettings, restoreLocalWebdavSettings, exportLocalDeviceSettings, restoreLocalDeviceSettings };
