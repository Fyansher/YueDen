const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform, Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function digest(value) { return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex'); }
function parseManifest(value) { return Buffer.isBuffer(value) ? JSON.parse(value.toString('utf8')) : typeof value === 'string' ? JSON.parse(value) : value; }
function manifestContent(value) {
  const manifest = JSON.parse(JSON.stringify(parseManifest(value) || {}));
  delete manifest.updatedAt;
  for (const entry of manifest.entries || []) {
    delete entry.source;
    delete entry.sourceByDevice;
  }
  return manifest;
}
function manifestHash(value) { return digest(require('./webdav-state').stableStringify(manifestContent(value))); }
function toRemoteManifest(value, deviceId) {
  const manifest = JSON.parse(JSON.stringify(parseManifest(value) || {}));
  for (const entry of manifest.entries || []) {
    const locations = { ...(entry.sourceByDevice || {}) };
    if (entry.source) locations[deviceId] = entry.source;
    delete entry.source;
    if (Object.keys(locations).length) entry.sourceByDevice = locations;
    else delete entry.sourceByDevice;
  }
  return manifest;
}
function restoreManifestForDevice(value, deviceId, localManifest = null) {
  const manifest = JSON.parse(JSON.stringify(parseManifest(value) || {}));
  const oldEntries = localManifest?.entries || [];
  for (const [index, entry] of (manifest.entries || []).entries()) {
    const prior = oldEntries[index] || {};
    entry.sourceByDevice = { ...(prior.sourceByDevice || {}), ...(entry.sourceByDevice || {}) };
    const localPath = entry.sourceByDevice?.[deviceId] || oldEntries[index]?.source || '';
    if (localPath) entry.source = localPath;
    else delete entry.source;
    if (!Object.keys(entry.sourceByDevice).length) delete entry.sourceByDevice;
  }
  return manifest;
}
async function verifyObjectBytes(file, bytes) {
  try {
    const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), expectedSize = Number(file?.size);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !/^[a-f0-9]{64}$/i.test(String(file?.sha256 || ''))) return false;
    if (file?.encoding && !['gzip', 'raw'].includes(file.encoding)) return false;
    if (file?.object) {
      const hash = String(file.sha256).toLowerCase(), extension = file.encoding === 'gzip' ? 'gz' : 'bin';
      if (String(file.object).replaceAll('\\', '/') !== `objects/${hash.slice(0, 2)}/${hash}.${extension}`) return false;
    }
    const hash = crypto.createHash('sha256'); let size = 0;
    const tap = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > expectedSize) return callback(Error('存档数据块超过清单标记大小'));
      hash.update(chunk); callback(null, chunk);
    } });
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    await pipeline(Readable.from([source]), file.encoding === 'gzip' ? zlib.createGunzip() : new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } }), tap, sink);
    return size === expectedSize && hash.digest('hex') === String(file.sha256).toLowerCase();
  } catch { return false; }
}
async function verifyObjectFile(file, filename) {
  try {
    const expectedSize = Number(file?.size), storedSize = Number(file?.storedSize);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !Number.isSafeInteger(storedSize) || storedSize < 0 || !/^[a-f0-9]{64}$/i.test(String(file?.sha256 || ''))) return false;
    if (file?.encoding && !['gzip', 'raw'].includes(file.encoding)) return false;
    const stat=fs.statSync(filename);if(stat.size!==storedSize)return false;
    const hash=crypto.createHash('sha256');let size=0;
    const tap=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>expectedSize)return callback(Error('存档数据块超过清单标记大小'));hash.update(chunk);callback(null,chunk);}});
    const sink=new Writable({write(_chunk,_encoding,callback){callback();}});
    await pipeline(fs.createReadStream(filename),file.encoding==='gzip'?zlib.createGunzip():new Transform({transform(chunk,_encoding,callback){callback(null,chunk);}}),tap,sink);
    return size===expectedSize&&hash.digest('hex')===String(file.sha256).toLowerCase();
  }catch{return false;}
}
function readableName(value, fallback = '游戏') {
  const name = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/[. ]+$/g, '').slice(0, 48);
  return name || fallback;
}
function itemFolderName(itemId, name) { return `${readableName(name)}--${digest(itemId).slice(0, 10)}`; }
function localStamp(date) {
  const part = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}
function relativeId(root, folder) { return path.relative(root, folder).split(path.sep).join('/'); }
function safeTarget(root, relative) {
  const parts = String(relative || '').replaceAll('\\', '/').split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..') || path.posix.isAbsolute(String(relative || ''))) throw Error('存档快照路径无效');
  const target = path.resolve(root, ...parts);
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error('存档快照路径无效');
  return target;
}
function safeRelative(value, allowEmpty = false) {
  const raw = String(value ?? '').replaceAll('\\', '/');
  if (!raw && allowEmpty) return '';
  const parts = raw.split('/');
  if (!raw || path.posix.isAbsolute(raw) || parts.some(part => !part || part === '.' || part === '..')) throw Error('存档清单包含无效相对路径');
  return parts.join(path.sep);
}
function readManifest(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw Error(`读取存档清单失败：${error.message}`); }
}
function findManifests(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  function visit(folder, depth = 0) {
    if (depth > 32) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '.staging' || entry.name === 'objects' || entry.name.startsWith('.tmp-')) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && entry.name === 'manifest.json') result.push(full);
    }
  }
  visit(root);
  return result;
}
function collectObjectRefs(root) {
  const refs = new Set();
  let complete = true;
  for (const file of findManifests(root)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const entry of manifest.entries || []) for (const item of entry.files || []) {
        const object = String(item.object || '').replaceAll('\\', '/');
        if (object.startsWith('objects/') && !object.split('/').some(part => part === '..')) refs.add(object);
      }
    } catch { complete = false; }
  }
  return { refs, complete };
}
function collectGarbage(root) {
  const objects = path.join(root, 'objects');
  if (!fs.existsSync(objects)) return { removed: 0 };
  const { refs, complete } = collectObjectRefs(root);
  if (!complete) return { removed: 0, skipped: true };
  let removed = 0;
  for (const file of listFiles(objects)) {
    const relative = relativeId(root, file);
    if (!refs.has(relative)) { fs.rmSync(file, { force: true }); removed += 1; }
  }
  function prune(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) if (entry.isDirectory()) prune(path.join(folder, entry.name));
    if (folder !== objects && fs.readdirSync(folder).length === 0) fs.rmdirSync(folder);
  }
  prune(objects);
  return { removed };
}
function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function create(root) {
  const base = () => path.resolve(root);
  const objectRoot = () => path.join(base(), 'objects');
  let manifestIndexCache = null;
  const manifestIndexKey = file => {
    const full = path.resolve(file), relative = path.relative(base(), full);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('存档清单路径超出存档目录');
    return process.platform === 'win32' ? full.toLocaleLowerCase('en-US') : full;
  };
  function readManifestIndexEntry(file) {
    const manifest = readManifest(file);
    if (!manifest) return null;
    const bytes = fs.readFileSync(file);
    return { file, folder: path.dirname(file), rootName: path.relative(base(), path.dirname(path.dirname(file))).split(path.sep).join('/'), manifest, manifestHash: manifestHash(bytes), rawManifestHash: digest(bytes) };
  }
  function refreshManifestIndex(files = []) {
    if (!manifestIndexCache || !files.length) return;
    const affected = new Map(files.map(file => [manifestIndexKey(file), path.resolve(file)]));
    manifestIndexCache = manifestIndexCache.filter(entry => !affected.has(manifestIndexKey(entry.file)));
    for (const file of affected.values()) {
      const entry = readManifestIndexEntry(file);
      if (entry) manifestIndexCache.push(entry);
    }
  }
  function manifestIndex() {
    if (manifestIndexCache) return manifestIndexCache;
    manifestIndexCache = findManifests(base()).map(readManifestIndexEntry).filter(Boolean);
    return manifestIndexCache;
  }
  async function storeObject(source) {
    const stage = path.join(base(), '.staging');
    fs.mkdirSync(stage, { recursive: true });
    const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const compressedTemp = path.join(stage, `.tmp-${token}.gz`);
    const rawTemp = path.join(stage, `.tmp-${token}.bin`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const tap = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } });
    try {
      await pipeline(fs.createReadStream(source), tap, zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }), fs.createWriteStream(compressedTemp, { flags: 'wx' }));
      const sha256 = hash.digest('hex');
      const compressedSize = fs.statSync(compressedTemp).size;
      let staged = compressedTemp, extension = 'gz';
      if (compressedSize >= size) {
        await pipeline(fs.createReadStream(compressedTemp), zlib.createGunzip(), fs.createWriteStream(rawTemp, { flags: 'wx' }));
        fs.rmSync(compressedTemp, { force: true }); staged = rawTemp; extension = 'bin';
      }
      const relative = `objects/${sha256.slice(0, 2)}/${sha256}.${extension}`;
      const destination = safeTarget(base(), relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination)) fs.rmSync(staged, { force: true });
      else {
        try { fs.renameSync(staged, destination); }
        catch (error) { if (!fs.existsSync(destination)) throw error; fs.rmSync(staged, { force: true }); }
      }
      const storedSize = fs.statSync(destination).size;
      return { object: relative, sha256, size, storedSize, encoding: extension === 'gz' ? 'gzip' : 'raw' };
    } catch (error) {
      fs.rmSync(compressedTemp, { force: true }); fs.rmSync(rawTemp, { force: true });
      throw Error(`压缩存档文件失败（${path.basename(source)}）：${error.message}`);
    } finally { fs.rmSync(compressedTemp, { force: true }); fs.rmSync(rawTemp, { force: true }); }
  }
  function walkSource(source) {
    const rootStat = fs.lstatSync(source);
    if (rootStat.isSymbolicLink()) throw Error(`不支持符号链接存档：${source}`);
    if (!rootStat.isDirectory()) return { kind: 'file', files: [{ source, relative: '' }], directories: [] };
    const files = [], directories = [];
    function visit(folder, relative = '') {
      const rows = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      for (const entry of rows) {
        const full = path.join(folder, entry.name), child = relative ? `${relative}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) throw Error(`不支持符号链接存档：${full}`);
        if (stat.isDirectory()) { directories.push(child); visit(full, child); }
        else if (stat.isFile()) files.push({ source: full, relative: child });
      }
    }
    visit(source);
    return { kind: 'directory', files, directories };
  }
  async function backup(itemId, paths, options = {}) {
    const valid = [...new Set((paths || []).filter(entry => typeof entry === 'string' && path.isAbsolute(entry) && fs.existsSync(entry)))];
    if (!itemId || !valid.length) return { ok: false, message: '没有找到可备份的文件或文件夹' };
    const gameName = String(options.gameName || '').trim() || '未命名游戏';
    const now = new Date(), createdAt = now.toISOString();
    const itemFolder = path.join(base(), 'items', itemFolderName(itemId, gameName));
    const stamp = localStamp(now); let snapshotName = stamp, suffix = 2;
    while (fs.existsSync(path.join(itemFolder, snapshotName))) snapshotName = `${stamp}-${String(suffix++).padStart(2, '0')}`;
    const folder = path.join(itemFolder, snapshotName), stage = path.join(base(), '.staging', `${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(stage, { recursive: true });
    const manifest = { schema: 2, itemId, gameName, note: String(options.note || '').trim().slice(0, 2000), createdAt, entries: [] };
    try {
      for (let index = 0; index < valid.length; index += 1) {
        const source = path.resolve(valid[index]), tree = walkSource(source);
        const entry = { source, target: `${String(index + 1).padStart(2, '0')}-${readableName(path.basename(source), '存档')}`, kind: tree.kind, directories: tree.directories, files: [] };
        for (const file of tree.files) {
          const stored = await storeObject(file.source);
          entry.files.push({ path: file.relative, object: stored.object, sha256: stored.sha256, size: stored.size, storedSize: stored.storedSize, encoding: stored.encoding });
        }
        manifest.entries.push(entry);
      }
      fs.mkdirSync(folder, { recursive: true });
      const temporaryManifest = path.join(stage, 'manifest.json');
      fs.writeFileSync(temporaryManifest, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
      const manifestFile = path.join(folder, 'manifest.json');
      fs.renameSync(temporaryManifest, manifestFile);
      refreshManifestIndex([manifestFile]);
      return { ok: true, folder, createdAt, files: manifest.entries.reduce((count, entry) => count + entry.files.length, 0), size: manifest.entries.reduce((sum, entry) => sum + entry.files.reduce((n, file) => n + file.storedSize, 0), 0), note: manifest.note };
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }
  function itemManifestFolders(itemId) {
    const legacy = readableName(itemId, 'item');
    return manifestIndex().filter(entry => entry.manifest.itemId === itemId || (!entry.manifest.itemId && entry.rootName === legacy));
  }
  function list(itemId) {
    if (!itemId) return [];
    return itemManifestFolders(itemId).map(({ file, folder, manifest, manifestHash }) => {
      const isPacked = manifest.schema >= 2 && Array.isArray(manifest.entries?.[0]?.files);
      const legacyFiles = isPacked ? [] : listFiles(folder).filter(localFile => localFile !== file),
        files = isPacked ? manifest.entries.reduce((sum, entry) => sum + (entry.files?.length || 0), 0) : legacyFiles.length,
        size = isPacked ? manifest.entries.reduce((sum, entry) => sum + (entry.files || []).reduce((n, stored) => n + (Number(stored.storedSize) || 0), 0), 0) : legacyFiles.reduce((sum, localFile) => { try { return sum + fs.statSync(localFile).size; } catch { return sum; } }, 0);
      return { id: relativeId(base(), folder), itemId, folder, createdAt: manifest.createdAt || path.basename(folder), updatedAt: manifest.updatedAt || manifest.createdAt || '', gameName: manifest.gameName || '', note: manifest.note || '', entries: manifest.entries || [], files, size, syncStatus: '', manifestHash };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  function listAll(items = []) {
    const legacyIds = new Map();
    for (const item of items || []) {
      if (!item?.id) continue;
      legacyIds.set(`items/${itemFolderName(item.id, item.name)}`, item.id);
      legacyIds.set(`items/${readableName(item.id, 'item')}`, item.id);
    }
    return manifestIndex().flatMap(({ file, folder, rootName, manifest, manifestHash }) => {
      const itemId = manifest.itemId || legacyIds.get(rootName);
      if (!itemId) return [];
      const isPacked = manifest.schema >= 2 && Array.isArray(manifest.entries?.[0]?.files);
      const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
      const legacyFiles = isPacked ? [] : listFiles(folder).filter(localFile => localFile !== file),
        files = isPacked ? entries.reduce((sum, entry) => sum + (entry.files?.length || 0), 0) : legacyFiles.length,
        size = isPacked ? entries.reduce((sum, entry) => sum + (entry.files || []).reduce((n, entryFile) => n + (Number(entryFile.storedSize) || 0), 0), 0) : legacyFiles.reduce((sum, localFile) => { try { return sum + fs.statSync(localFile).size; } catch { return sum; } }, 0);
      return [{ id: relativeId(base(), folder), itemId, folder, createdAt: manifest.createdAt || path.basename(folder), updatedAt: manifest.updatedAt || manifest.createdAt || '', gameName: manifest.gameName || '', note: manifest.note || '', entries, files, size, syncStatus: '', manifestHash }];
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  function updateNote(itemId, backupId, note) {
    if (!itemId || !list(itemId).some(entry => entry.id === backupId)) return { ok: false, message: '存档快照不存在或不属于当前游戏' };
    const folder = safeTarget(base(), backupId), file = path.join(folder, 'manifest.json');
    const manifest = readManifest(file);
    if (!manifest || (manifest.itemId && manifest.itemId !== itemId)) return { ok: false, message: '存档清单不存在或不属于当前游戏' };
    manifest.note = String(note ?? '').trim().slice(0, 2000);
    manifest.updatedAt = new Date().toISOString();
    const temporary = path.join(folder, `.manifest-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, file);
      refreshManifestIndex([file]);
      return { ok: true, note: manifest.note };
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  async function restore(itemId, backupId) {
    const folder = safeTarget(base(), backupId), manifest = readManifest(path.join(folder, 'manifest.json'));
    if (!manifest || (manifest.itemId && manifest.itemId !== itemId) || !Array.isArray(manifest.entries) || !manifest.entries.length) return { ok: false, message: '备份清单不存在、为空或不属于当前游戏' };
    const isPacked = manifest.schema >= 2 && manifest.entries.every(entry => Array.isArray(entry.files));
    if (!isPacked) {
      let restored = 0;
      for (const entry of manifest.entries) {
        if (!entry.target || !entry.source || !path.isAbsolute(entry.source)) continue;
        const source = safeTarget(folder, entry.target);
        if (!fs.existsSync(source)) continue;
        const stat = fs.statSync(source);
        if (stat.isDirectory()) fs.cpSync(source, entry.source, { recursive: true, force: true });
        else { fs.mkdirSync(path.dirname(entry.source), { recursive: true }); fs.copyFileSync(source, entry.source); }
        restored += 1;
      }
      return { ok: true, restored };
    }
    let restored = 0;
    for (const entry of manifest.entries) {
      if (!entry.source || !path.isAbsolute(entry.source) || !['file', 'directory'].includes(entry.kind)) continue;
      const sourceRoot = path.resolve(entry.source);
      if (entry.kind === 'directory') {
        fs.mkdirSync(sourceRoot, { recursive: true });
        for (const directory of entry.directories || []) fs.mkdirSync(safeTarget(sourceRoot, safeRelative(directory)), { recursive: true });
      }
      for (const file of entry.files) {
        const relative = safeRelative(file.path, true);
        const destination = entry.kind === 'file' ? sourceRoot : safeTarget(sourceRoot, relative);
        const blob = safeTarget(base(), file.object);
        if (!fs.existsSync(blob)) throw Error(`存档数据块缺失：${file.sha256 || path.basename(blob)}`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const temporary = path.join(path.dirname(destination), `.yueden-restore-${crypto.randomBytes(8).toString('hex')}.tmp`);
        const hash = crypto.createHash('sha256'); let size = 0;
        const tap = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } });
        try {
          await pipeline(fs.createReadStream(blob), file.encoding === 'gzip' ? zlib.createGunzip() : new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } }), tap, fs.createWriteStream(temporary, { flags: 'wx' }));
          if (hash.digest('hex') !== file.sha256 || size !== Number(file.size)) throw Error(`存档校验失败：${file.path || path.basename(entry.source)}`);
          fs.renameSync(temporary, destination); restored += 1;
        } finally { fs.rmSync(temporary, { force: true }); }
      }
    }
    return { ok: true, restored };
  }
  function remove(itemId, backupId) {
    if (!itemId || !list(itemId).some(entry => entry.id === backupId)) return { ok: false, message: '存档快照不存在或不属于当前游戏' };
    const target = safeTarget(base(), backupId);
    try {
      fs.rmSync(target, { recursive: true, force: false });
      if (fs.existsSync(target)) return { ok: false, message: '存档快照未删除，请检查文件占用' };
      refreshManifestIndex([path.join(target, 'manifest.json')]);
      collectGarbage(base());
      return { ok: true };
    } catch (error) { return { ok: false, message: '删除失败：' + error.message }; }
  }
  function removeMany(rows = [], items = [], knownEntries = null) {
    const known = new Map((knownEntries || listAll(items)).map(entry => [entry.id, entry.itemId]));
    const removed = [], failed = [], removedManifests = [];
    for (const row of rows) {
      const itemId = String(row?.itemId || ''), id = String(row?.backupId || row?.id || '');
      try {
        if (!itemId || !id || known.get(id) !== itemId) throw Error('存档快照不存在或不属于当前游戏');
        const target = safeTarget(base(), id);
        fs.rmSync(target, { recursive: true, force: false });
        if (fs.existsSync(target)) throw Error('快照仍然存在，请检查文件占用');
        removed.push({ itemId, id });
        removedManifests.push(path.join(target, 'manifest.json'));
        known.delete(id);
      } catch (error) { failed.push({ itemId, id, message: error.message }); }
    }
    if (removedManifests.length) refreshManifestIndex(removedManifests);
    const garbage = collectGarbage(base());
    return { ok: failed.length === 0, removed, failed, garbage };
  }
  function openFolder(itemId, gameName) {
    const found = itemManifestFolders(itemId).sort((a, b) => new Date(b.manifest.createdAt || 0) - new Date(a.manifest.createdAt || 0))[0];
    const folder = found ? path.dirname(found.folder) : path.join(base(), 'items', itemFolderName(itemId, gameName));
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }
  return { backup, list, listAll, refreshManifestIndex, updateNote, restore, remove, removeMany, openFolder, collectGarbage, itemFolderName };
}

module.exports = { create, readableName, itemFolderName, collectGarbage, findManifests, digest, manifestHash, manifestContent, toRemoteManifest, restoreManifestForDevice, verifyObjectBytes, verifyObjectFile };
