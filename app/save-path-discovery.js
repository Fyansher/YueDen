'use strict';

const fsDefault = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MANIFEST_URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';
const MAX_MANIFEST_BYTES = 40 * 1024 * 1024;

function stripComment(value) {
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote === '"' && char === '\\') { i += 1; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) { quote = quote ? '' : char; continue; }
    if (char === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function scalar(value) {
  const text = stripComment(String(value || '').trim());
  if (!text) return '';
  if (text.startsWith('"')) { try { return JSON.parse(text); } catch { return text.slice(1, text.lastIndexOf('"')); } }
  if (text.startsWith("'")) return text.slice(1, text.lastIndexOf("'")).replaceAll("''", "'");
  return text;
}

function mapping(line) {
  const clean = stripComment(line.trim());
  if (!clean || clean.startsWith('- ') || clean === '-') return null;
  if (clean.startsWith('"') || clean.startsWith("'")) {
    const quote = clean[0]; let end = 1;
    for (; end < clean.length; end += 1) {
      if (quote === '"' && clean[end] === '\\') { end += 1; continue; }
      if (clean[end] === quote && (quote !== "'" || clean[end + 1] !== "'")) break;
      if (quote === "'" && clean[end] === "'" && clean[end + 1] === "'") end += 1;
    }
    if (clean[end + 1] !== ':') return null;
    return { key: scalar(clean.slice(0, end + 1)), value: clean.slice(end + 2).trim() };
  }
  const colon = clean.indexOf(':');
  if (colon < 0) return null;
  return { key: clean.slice(0, colon).trim(), value: clean.slice(colon + 1).trim() };
}

function indentation(line) { return (line.match(/^ */) || [''])[0].length; }

function parseManifestGame(text, steamAppId) {
  const wanted = String(steamAppId || '').trim();
  if (!/^\d+$/.test(wanted)) return null;
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let blockStart = -1, gameName = '';
  for (let i = 0; i < lines.length; i += 1) {
    if (indentation(lines[i]) !== 0) continue;
    const row = mapping(lines[i]);
    if (!row) continue;
    if (blockStart >= 0) {
      const entry = inspectEntry(lines, blockStart, i, gameName, wanted);
      if (entry) return entry;
    }
    blockStart = i; gameName = row.key;
  }
  return blockStart >= 0 ? inspectEntry(lines, blockStart, lines.length, gameName, wanted) : null;
}

function inspectEntry(lines, start, end, gameName, wanted) {
  let steamId = '', alias = '', filesIndent = -1, installIndent = -1, installDirs = [];
  const savePatterns = [];
  for (let i = start + 1; i < end; i += 1) {
    const indent = indentation(lines[i]), row = mapping(lines[i]);
    if (indent === 2 && row) {
      if (row.key === 'steam' && !row.value) {
        for (let j = i + 1; j < end && indentation(lines[j]) > 2; j += 1) {
          const field = mapping(lines[j]);
          if (indentation(lines[j]) === 4 && field?.key === 'id') steamId = scalar(field.value);
        }
      } else if (row.key === 'alias') alias = scalar(row.value);
      else if (row.key === 'installDir' && !row.value) {
        installIndent = 2; installDirs = [];
        for (let j = i + 1; j < end && indentation(lines[j]) > 2; j += 1) {
          const field = mapping(lines[j]);
          if (indentation(lines[j]) === 4 && field) installDirs.push(field.key);
        }
      } else if (row.key === 'files' && !row.value) {
        filesIndent = 2;
        const fileRows = [];
        for (let j = i + 1; j < end;) {
          if (indentation(lines[j]) <= filesIndent) break;
          if (indentation(lines[j]) === 4) {
            const file = mapping(lines[j]);
            if (file) {
              const first = j; j += 1;
              while (j < end && indentation(lines[j]) > 4) j += 1;
              fileRows.push({ pattern: file.key, rows: lines.slice(first + 1, j) });
              continue;
            }
          }
          j += 1;
        }
        for (const file of fileRows) {
          const attributes = fileAttributes(file.rows);
          if (attributes.tags.includes('save') && windowsSteamConstraint(attributes.when)) savePatterns.push(file.pattern);
        }
      }
    }
  }
  if (steamId !== wanted) return null;
  return { gameName, installDirs: installDirs.filter(Boolean), savePatterns, alias };
}

function fileAttributes(rows) {
  const tags = [], when = [];
  for (let i = 0; i < rows.length; i += 1) {
    const indent = indentation(rows[i]), row = mapping(rows[i]);
    if (indent !== 6 || !row) continue;
    if (row.key === 'tags') {
      if (row.value.startsWith('[')) tags.push(...row.value.slice(1, row.value.indexOf(']') < 0 ? undefined : row.value.indexOf(']')).split(',').map(scalar));
      else {
        for (let j = i + 1; j < rows.length && indentation(rows[j]) > 6; j += 1) {
          const match = rows[j].match(/^\s+-\s+(.+?)\s*$/);
          if (match) tags.push(scalar(match[1]));
        }
      }
    } else if (row.key === 'when') {
      for (let j = i + 1; j < rows.length && indentation(rows[j]) > 6; j += 1) {
        const match = rows[j].match(/^\s+-\s*(?:([\w-]+)\s*:\s*(.+))?\s*$/);
        if (match) when.push(match[1] ? { [match[1]]: scalar(match[2]) } : {});
        else {
          const field = rows[j].match(/^\s+([\w-]+)\s*:\s*(.+?)\s*$/);
          if (field && when.length) when[when.length - 1][field[1]] = scalar(field[2]);
        }
      }
    }
  }
  return { tags, when };
}

function windowsSteamConstraint(conditions) {
  if (!conditions.length) return true;
  return conditions.some(condition => (!condition.os || String(condition.os).toLowerCase() === 'windows') && (!condition.store || String(condition.store).toLowerCase() === 'steam'));
}

function parseSteamLibraryPaths(vdf) {
  const result = [];
  for (const match of String(vdf || '').matchAll(/"path"\s+"((?:\\.|[^"])*)"/gmi)) {
    const value = match[1].replaceAll('\\\\', '\\').replaceAll('\\"', '"');
    if (path.isAbsolute(value)) result.push(path.normalize(value));
  }
  return result;
}

function steamLibraries({ env = process.env, fs = fsDefault, knownRoots = [], registryRoots = [] } = {}) {
  const candidates = [
    ...knownRoots,
    ...registryRoots,
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Steam'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Steam'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Steam')
  ].filter(Boolean).map(value => path.resolve(value));
  const all = new Map();
  for (const root of candidates) {
    const rootKey = root.toLowerCase();
    if (!all.has(rootKey)) all.set(rootKey, root);
    const folders = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try { for (const library of parseSteamLibraryPaths(fs.readFileSync(folders, 'utf8'))) all.set(library.toLowerCase(), library); } catch {}
  }
  return [...all.values()];
}

function steamRegistryRoots({ platform = process.platform, env = process.env, execFileSync = require('node:child_process').execFileSync } = {}) {
  if(platform!=='win32')return [];
  const result=[];
  for(const key of ['HKCU\\Software\\Valve\\Steam','HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam','HKLM\\SOFTWARE\\Valve\\Steam']){
    try{
      const text=execFileSync(env.SystemRoot?path.join(env.SystemRoot,'System32','reg.exe'):'reg.exe',['query',key,'/v','SteamPath'],{encoding:'utf8',timeout:2000,windowsHide:true});
      const value=text.match(/SteamPath\s+REG_SZ\s+(.+?)\s*$/mi)?.[1];if(value&&path.isAbsolute(value))result.push(path.normalize(value));
    }catch{}
  }
  return [...new Set(result)];
}

function findSteamGameRoots(appId, manifestEntry, options = {}) {
  const fs = options.fs || fsDefault, roots = steamLibraries(options), result = [], installDirs = manifestEntry?.installDirs?.length ? manifestEntry.installDirs : [manifestEntry?.gameName].filter(Boolean);
  for (const library of roots) {
    let installedDir = '';
    const appManifest = path.join(library, 'steamapps', `appmanifest_${appId}.acf`);
    try { installedDir = fs.readFileSync(appManifest, 'utf8').match(/^\s*"installdir"\s+"([^"]+)"/mi)?.[1] || ''; } catch {}
    const folderNames = [...new Set([installedDir, ...installDirs].filter(Boolean))];
    for (const folder of folderNames) {
      const base = path.join(library, 'steamapps', 'common', folder);
      try { if (fs.statSync(base).isDirectory()) { result.push({ library, base, game: path.basename(base) }); break; } } catch {}
    }
  }
  return result;
}

function globRegex(segment) {
  let expression = '^';
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (char === '*') expression += '.*';
    else if (char === '?') expression += '.';
    else if (char === '[') { const close = segment.indexOf(']', i + 1); if (close > i) { expression += segment.slice(i, close + 1); i = close; } else expression += '\\['; }
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression + '$', 'i');
}

function expandGlob(pattern, fs = fsDefault, maxResults = 200) {
  const normalized = path.resolve(pattern), root = path.parse(normalized).root, relative = path.relative(root,normalized), parts = relative.split(path.sep).filter(Boolean);
  let output = [root];
  for (const segment of parts) {
    const next = [];
    for (const current of output) {
      if (segment === '**') {
        next.push(current);
        const visit = (folder, depth) => {
          if (depth > 8 || next.length >= maxResults) return;
          let entries; try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) if (entry.isDirectory()) { const child = path.join(folder, entry.name); next.push(child); visit(child, depth + 1); }
        };
        visit(current, 0); continue;
      }
      if (/[?*[]/.test(segment)) {
        let entries; try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        const regex = globRegex(segment);
        for (const entry of entries) if (regex.test(entry.name)) next.push(path.join(current, entry.name));
      } else next.push(path.join(current, segment));
      if (next.length >= maxResults) break;
    }
    output = next.slice(0, maxResults);
    if (!output.length) break;
  }
  return output.filter(value => { try { const stat = fs.lstatSync(value); return stat.isDirectory() || stat.isFile(); } catch { return false; } });
}

function resolveSavePaths(item, options = {}) {
  const fs = options.fs || fsDefault, env = options.env || process.env, appId = String(item?.steamAppId || item?.identifiers?.steam || '').trim();
  if (item?.type !== 'game') return { ok: false, status: 'unsupported', message: '存档路径识别仅适用于游戏条目' };
  if (!/^\d+$/.test(appId)) return { ok: false, status: 'missing-appid', message: '请先填写 Steam AppID，再自动识别存档位置' };
  if (Array.isArray(item.savePaths) && item.savePaths.some(value => typeof value === 'string' && value.trim())) return { ok: true, status: 'manual-preserved', paths: [...new Set(item.savePaths.filter(Boolean))], message: '已保留手动设置的存档位置' };
  const entry = parseManifestGame(options.manifestText || '', appId);
  if (!entry) return { ok: false, status: 'not-in-manifest', message: '存档资料库中没有此 Steam AppID 的记录' };
  if (!entry.savePatterns.length) return { ok: false, status: 'no-save-path', message: '资料库没有提供可识别的 Windows 存档路径' };
  const gameRoots = findSteamGameRoots(appId, entry, { ...options, fs, env });
  const documents = options.documents || path.join(env.USERPROFILE || os.homedir(), 'Documents');
  const placeholders = {
    home: options.home || os.homedir(), osusername: env.USERNAME || path.basename(os.homedir()),
    winappdata: env.APPDATA || path.join(env.USERPROFILE || os.homedir(), 'AppData', 'Roaming'),
    winlocalappdata: env.LOCALAPPDATA || path.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
    winlocalappdatalow: path.join(env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow'),
    windocuments: documents, winpublic: env.PUBLIC || 'C:\\Users\\Public',
    winprogramdata: env.ProgramData || 'C:\\ProgramData', windir: env.WINDIR || 'C:\\Windows'
  };
  const candidates = [];
  for (const pattern of entry.savePatterns) {
    if (/<(?:storeUserId|xdgData|xdgConfig)>/i.test(pattern)) continue;
    const roots = /<(?:base|game|root)>/i.test(pattern) ? gameRoots : [null];
    for (const root of roots) {
      let expanded = pattern.replace(/<([A-Za-z]+)>/g, (all, token) => {
        const key = token.toLowerCase();
        if (key === 'appid' || key === 'storegameid') return appId;
        if (key === 'base') return root?.base || '';
        if (key === 'game') return root?.game || entry.installDirs[0] || entry.gameName;
        if (key === 'root') return root?.library || '';
        return placeholders[key] || all;
      });
      if (/<[A-Za-z]+>/.test(expanded)) continue;
      expanded = expanded.replaceAll('/', path.sep);
      if (!path.isAbsolute(expanded)) continue;
      for (const found of expandGlob(expanded, fs)) candidates.push(path.resolve(found));
    }
  }
  const unique = [...new Set(candidates)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const filtered = unique.filter((value, index) => !unique.slice(0, index).some(parent => {
    const relative = path.relative(parent, value);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && fs.statSync(parent).isDirectory();
  }));
  return filtered.length ? { ok: true, status: 'detected', paths: filtered, gameName: entry.gameName, source: 'Ludusavi Manifest' } : { ok: false, status: 'not-found', message: '已查到该游戏的路径规则，但这些存档位置在本机不存在' };
}

async function loadManifest(cacheDirectory, { fetchImpl = globalThis.fetch, timeoutMs = 18000, maxBytes = MAX_MANIFEST_BYTES } = {}) {
  const fs = fsDefault, file = path.join(cacheDirectory, 'ludusavi-manifest.yaml'), etagFile = file + '.etag';
  let cached = '', etag = '';
  try { cached = fs.readFileSync(file, 'utf8'); if (Buffer.byteLength(cached) > maxBytes) cached = ''; } catch {}
  try { etag = fs.readFileSync(etagFile, 'utf8').trim(); } catch {}
  if (typeof fetchImpl !== 'function') { if (cached) return cached; throw Error('当前运行环境不支持联网获取存档路径资料库'); }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = etag && cached ? { 'If-None-Match': etag } : {};
    const response = await fetchImpl(MANIFEST_URL, { headers, signal: controller.signal, redirect: 'follow' });
    if (response.status === 304 && cached) return cached;
    if (!response.ok) throw Error('存档路径资料库请求失败（HTTP ' + response.status + '）');
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > maxBytes) throw Error('存档路径资料库超过安全大小限制');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw Error('存档路径资料库内容为空或超过安全大小限制');
    const text = bytes.toString('utf8');
    if (!/^\s*[^#\s][^\r\n]*:\s*$/m.test(text)) throw Error('存档路径资料库格式无法识别');
    fs.mkdirSync(cacheDirectory, { recursive: true });
    const temporary = file + '.tmp-' + process.pid;
    fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file);
    const newEtag = response.headers?.get?.('etag') || '';
    if (newEtag) fs.writeFileSync(etagFile, newEtag, 'utf8');
    return text;
  } catch (error) {
    if (cached) return cached;
    if (error?.name === 'AbortError') throw Error('获取存档路径资料库超时（' + timeoutMs + ' 毫秒）');
    throw error;
  } finally { clearTimeout(timer); }
}

module.exports = { MANIFEST_URL, MAX_MANIFEST_BYTES, parseManifestGame, parseSteamLibraryPaths, steamLibraries, steamRegistryRoots, findSteamGameRoots, expandGlob, resolveSavePaths, loadManifest };
