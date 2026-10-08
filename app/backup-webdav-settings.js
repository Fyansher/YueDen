const FIELDS = ['webdavUrl', 'webdavUsername', 'webdavRemotePath'];
const MAX_LENGTH = 8192;

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

module.exports = { exportLocalWebdavSettings, restoreLocalWebdavSettings };
