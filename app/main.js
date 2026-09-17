const { app, BrowserWindow, Menu, dialog: rawDialog, ipcMain: rawIpcMain, shell, globalShortcut, nativeImage, protocol, net, screen } = require('electron');
const path = require('path');
const ipcMain=require('./ipc-guard').create(rawIpcMain,__dirname);
const fs = require('fs');
const {randomBytes}=require('node:crypto');
const webdavClient=require('./webdav-client').create();
const dialog=require('./dialog-memory').wrap(rawDialog,()=>app.getPath('userData'));
const https = require('https');
const MetadataText = require('./metadata-text');
const StatusModel = require('./status-model');
const CoverStore = require('./cover-store');
const createFileDialogs = require('./file-dialogs');
const steamTime = require('./steam-playtime').createSteamPlaytime({json:(...args)=>fetchJson(...args),settings:loadSettings});
const { refreshMatch } = require('./metadata-enrichment');
const { createSourceSearch } = require('./metadata-sources');
const RatingModel = require('./rating-model');
const PlatformModel = require('./platform-model');
const MetadataRuntime = require('./metadata-runtime');
const { createGameSources, gameTerms } = require('./game-sources');
const gameSources = createGameSources({json:(...args)=>fetchJson(...args),text:(...args)=>fetchText(...args),steam:(query,emit)=>metadataSearchSteam('game',query,emit),aliases:query=>gameSearchTerms(query).map(term=>term.replace(/ WINDOWS EDITION$/i,''))});
const sourceSearch = createSourceSearch({ json: (...args) => fetchJson(...args), text: (...args) => fetchText(...args), settings: loadSettings });
const { pathToFileURL } = require('node:url');
protocol?.registerSchemesAsPrivileged([{ scheme: 'um-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },{scheme:'um-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}},{scheme:'um-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
const coverStore = new CoverStore(() => path.join(app.getPath('userData'), 'cover-cache'), nativeImage);
const coverUrlCache=require('./cover-url-cache').createCoverUrlCache(coverStore);
const candidateCoverCache = require('./candidate-covers').createCandidateCovers({request:requestImageOverHttps,compact:value=>coverStore.compact(value),...coverUrlCache});

// Unified Manager is intentionally portable: data lives beside the executable.
const executableRoot = path.dirname(process.execPath);
const portableRoot = path.basename(executableRoot)==='程序' && ['YueDen.exe','Unified Manager.exe'].some(name=>fs.existsSync(path.join(executableRoot,'..',name))) ? path.dirname(executableRoot) : executableRoot;
app.setPath('userData', path.join(portableRoot, 'user-data'));
app.setName('悦森盒 YueDen');
process.title='悦森盒 YueDen';
app.setAppUserModelId('com.unifiedmanager.redesign');
Menu.setApplicationMenu(null);

const dataFile = () => path.join(app.getPath('userData'), 'library.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const legacyDataFile = () => path.join(portableRoot, 'data.json');
const legacySettingsFile = () => path.join(portableRoot, 'settings.json');
const initialState = { items: [], categories: ['PC', '主机', '掌机', '独立游戏', '科幻', '待读', '年度候选'] };
const initialSettings = {
  obsidianRoot: '', steamApiKey: '', steamId: '',
  webdavUrl: '', webdavUsername: '', webdavPassword: '', webdavRemotePath: 'UnifiedManager', lastWebdavSyncAt: '',
  appearance: { theme: 'ocean', accent: '#65d8b0', density: 'comfortable', animations: true, defaultView: 'dashboard' },
  disguiseEnabled: false, disguiseProfile: 'course', disguiseVideoUrl: 'https://www.bilibili.com/video/BV1jR4y1M78W/?p=17&t=466', confirmBeforeDelete: true,
  localScanPaths: [], refreshWhitelist: [], autoRefreshMetadata: true,
};
const DISGUISE_PROFILES = {
  course: { label: '课程播放器', title: '在线视频课程 - 学习中心' },
  reader: { label: '资料阅读器', title: '资料阅读器 - 学习中心' },
  notes: { label: '课堂笔记', title: '课堂笔记 - 学习中心' },
};
async function openDisguiseVideo(query, index = 0) {
  const payload = await fetchJson(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query || '学习资料')}&page=1&page_size=10`, 7000);
  const first = (payload?.data?.result || []).find((entry) => entry?.bvid || entry?.arcurl);
  const bvid = first?.bvid;
  const url = bvid ? `https://www.bilibili.com/video/${bvid}/?t=${360 + (Number(index) % 6) * 73}` : (first?.arcurl || `https://search.bilibili.com/all?keyword=${encodeURIComponent(query || '学习资料')}`);
  return shell.openExternal(url);
}
let mainWindow = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normaliseItem(item, index = 0) {
  const value = coverStore.compactItem(item && typeof item === 'object' ? item : {});
  return {
    ...require('./library-relations').itemFields(value),
    id: value.id || `item-${Date.now()}-${index}`,
    type: value.type || 'game',
    ...(value.type==='audio'?{audio:require('./audio-model').normalize(value.audio)}:{}),
    name: String(value.name || '').trim(),
    status: StatusModel.normalize(value.status, value.type || 'game'),
    completedDate: value.completedDate || value.completedAt || '',
    rating: value.rating!=null&&value.rating!==''&&Number.isFinite(Number(value.rating)) ? Math.max(0, Math.min(5, Number(value.rating))) : null,
    review: value.review || '',
    description: value.description || '',
    cover: coverStore.compact(value.cover || ''),
    coverPortrait: coverStore.compact(value.coverPortrait || ''),
    coverLandscape: coverStore.compact(value.coverLandscape || ''),
    networkCovers: Object.fromEntries(['cover', 'coverPortrait', 'coverLandscape'].map(key => [key, /^https?:\/\//i.test(value.networkCovers?.[key] || '') ? value.networkCovers[key] : /^https?:\/\//i.test(value[key] || '') ? value[key] : ''])),
    customCovers: Array.isArray(value.customCovers) ? value.customCovers.filter(key => ['cover', 'coverPortrait', 'coverLandscape'].includes(key)) : [],
    genres: Array.isArray(value.genres) ? value.genres.filter(Boolean) : [],
    developer: value.developer || value.creator || '',
    cast: Array.isArray(value.cast) ? value.cast.filter(Boolean) : [],
    seasons: value.seasons === '' || value.seasons === null || value.seasons === undefined ? null : Number(value.seasons),
    episodes: value.episodes === '' || value.episodes === null || value.episodes === undefined ? null : Number(value.episodes),
    isbn: value.isbn || '',
    pages: value.pages === '' || value.pages === null || value.pages === undefined ? null : Number(value.pages),
    translator: value.translator || '',
    publisher: value.publisher || '',
    releaseDate: value.releaseDate || '',
    storeUrl: value.storeUrl || '',
    steamAppId: value.steamAppId || value.appid || '',
    playtime: value.playtime === null || value.playtime === undefined || value.playtime === '' ? null : Number(value.playtime),
    steamPlaytime: value.steamPlaytime==null?null:Number(value.steamPlaytime),steamPlaytimeAt:value.steamPlaytimeAt||'',playtimeSource:value.playtimeSource||'',
    steamRating: value.steamRating || '',
    externalRating: value.externalRating || value.steamRating || '',
    ratingSource: value.ratingSource || RatingModel.source(value, value.type),
    ratingValue: value.ratingValue !== null && value.ratingValue !== undefined && value.ratingValue !== '' && Number.isFinite(Number(value.ratingValue)) ? Number(value.ratingValue) : null,
    ratingMax: Number(value.ratingMax) > 0 ? Number(value.ratingMax) : null,
    ratingEdited: Boolean(value.ratingEdited), platforms: PlatformModel.detect(value), platformsManual: Boolean(value.platformsManual), platformLinks: value.platformLinks || {},
    categories: Array.isArray(value.categories) ? value.categories.filter(Boolean) : [],
    noteUrl: value.noteUrl || value.obsidianUri || '',
    resourceUrl: value.resourceUrl || value.watchUrl || value.readUrl || '',
    localPath: value.localPath || value.filePath || '',
    localFiles: Array.isArray(value.localFiles)?value.localFiles.filter(f=>f&&typeof f.path==='string').slice(0,30000).map(f=>({path:f.path,name:String(f.name||path.basename(f.path)),size:Number(f.size)||0,mtimeMs:Number(f.mtimeMs)||0,season:f.season??null,episode:f.episode??null,volume:f.volume??null,archiveKind:f.archiveKind||''})):[],
    originalName: value.originalName||'',aliases:Array.isArray(value.aliases)?value.aliases.filter(v=>typeof v==='string'):[],identifiers:value.identifiers||{},
    scanInfo:require('./scan-state').track(value),
    savePaths: Array.isArray(value.savePaths) ? value.savePaths.filter(Boolean) : [],
    backupCount: Number(value.backupCount || 0),
    lastBackupAt: value.lastBackupAt || '',
    createdAt: value.createdAt || '',
    updatedAt: value.updatedAt || value.createdAt || '',
    sortOrder: Number.isFinite(Number(value.sortOrder)) ? Number(value.sortOrder) : index,
    autoMetadataAt: value.autoMetadataAt || '',
    metadataSource: value.metadataSource || '',
    editionKind: ['系列','单行本'].includes(value.editionKind) ? value.editionKind : '',
    fieldSources: value.fieldSources && typeof value.fieldSources === 'object' ? value.fieldSources : {},
  };
}

function readCoverImage(file) {
  try {
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' }[path.extname(file).toLowerCase()];
    if (!mime) return { ok: false, message: '请选择 JPG、PNG、WebP、GIF 或 BMP 图片' };
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return { ok: false, message: '图片需要小于 10 MB' };
    return { ok: true, reference: coverStore.saveBuffer(fs.readFileSync(file)) };
  } catch { return { ok: false, message: '图片读取失败，请检查文件是否存在或被占用' }; }
}

function ensureFolder() {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return clone(fallback);
  }
}

function writeJson(file, value) {
  if(file===dataFile()){require('./library-integrity').guard(file);require('./library-integrity').validate(value);}
  if(file===settingsFile())value=secretSettings().prepare(value);
  ensureFolder();
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, file);if(file===dataFile())require('./library-events').changed();
}

function loadLibrary() {
  if (fs.existsSync(dataFile())) {
    const saved = require('./library-schema').migrate(dataFile());
    const next = { ...require('./library-relations').fields(saved,normaliseItem),schemaVersion:4, items: (saved.items || []).map(normaliseItem), categories: saved.categories || initialState.categories };
    const migrated = next.items.some((item, i) => ['cover', 'coverPortrait', 'coverLandscape'].some(key => String(saved.items[i]?.[key] || '').startsWith('data:image/') && item[key].startsWith('um-cover:')));
    if (migrated) {
      // Keep the original library intact in a timestamped recovery copy.
      fs.copyFileSync(dataFile(), dataFile() + '.before-cover-cache-' + Date.now() + '.bak');
      writeJson(dataFile(), next);
    }
    return next;
  }

  // Migrate the first version of Unified Manager and preserve existing entries.
  if (fs.existsSync(legacyDataFile())) {
    const legacy = readJson(legacyDataFile(), []);
    const migrated = { items: (Array.isArray(legacy) ? legacy : legacy.items || []).map(normaliseItem), categories: initialState.categories };
    writeJson(dataFile(), migrated);
    return migrated;
  }
  return clone(initialState);
}

// Only player status snapshots reuse this value; commands keep loadLibrary semantics.
let playerLibraryCache=null,playerLibraryRevision=-1,playerLibraryFile='';
function playerSnapshotLibrary(){
  const changes=require('./library-events'),file=dataFile();
  if(playerLibraryCache&&playerLibraryFile===file&&playerLibraryRevision===changes.revision())return playerLibraryCache;
  const library=loadLibrary();
  // Loading can migrate an old library and emit a successful-write notification.
  playerLibraryCache=library;playerLibraryFile=file;playerLibraryRevision=changes.revision();
  return library;
}

let secretSettingsInstance;
function secretSettings(){return secretSettingsInstance||(secretSettingsInstance=require('./secure-settings').create({directory:()=>app.getPath('userData'),safeStorage:require('electron').safeStorage}));}
function loadSettings() {
  if (fs.existsSync(settingsFile())) {
    const saved = secretSettings().migrate(JSON.parse(fs.readFileSync(settingsFile(),'utf8')),settingsFile());
    return { ...initialSettings, ...saved, appearance: { ...initialSettings.appearance, ...(saved.appearance || {}) } };
  }
  if (fs.existsSync(legacySettingsFile())) {
    const legacy = readJson(legacySettingsFile(), initialSettings);
    const migrated = { ...initialSettings, ...legacy, appearance: { ...initialSettings.appearance, ...(legacy.appearance || {}) } };
    writeJson(settingsFile(), migrated);
    return migrated;
  }
  return clone(initialSettings);
}

async function requestImageOverHttps(url, timeoutMs = 6000, signal) {
  let target; try { target = new URL(url); } catch { return null; }
  if (target.protocol !== 'https:') return null;
  const referer = /doubanio\.com/i.test(target.hostname) ? 'https://book.douban.com/' : /bgm\.tv/i.test(target.hostname)?'https://bgm.tv/':target.origin+'/';
  try {
    const response = await net.fetch(url, { headers: { 'User-Agent':'UnifiedManager/2.0', Referer:referer }, signal:MetadataRuntime.combine(signal,AbortSignal.timeout(timeoutMs)) });
    const mime = (response.headers.get('content-type') || '').split(';')[0];
    if (!response.ok || !/^image\/(jpeg|png|webp|gif|bmp)$/i.test(mime) || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) return null;
    const reader=response.body.getReader(),chunks=[];let size=0;
    while (true) { const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>2*1024*1024){await reader.cancel();return null;}chunks.push(Buffer.from(chunk.value)); }
    return 'data:'+mime+';base64,'+Buffer.concat(chunks).toString('base64');
  } catch { return null; }
}
async function materializeCover(url) {
  if(candidateCoverCache.cached(url))return candidateCoverCache.cached(url);
  if (!url || String(url).startsWith('data:') || !/https?:\/\//i.test(url)) return url || '';
  if (!/(doubanio\.com|lain\.bgm\.tv)/i.test(url)) return url;
  return coverStore.compact((await requestImageOverHttps(url)) || url);
}

async function materializeCandidateCovers(entry, raw = '', index = 0, cache = new Map()) {
  const base = entry.cover || entry.coverPortrait || entry.coverLandscape || generatedCover(entry.name || raw, index);
  const urls = { cover: base, coverPortrait: entry.coverPortrait || base, coverLandscape: entry.coverLandscape || base };
  const images = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([key, url]) => {
    if (!cache.has(url)) cache.set(url, materializeCover(url));
    return [key, (await cache.get(url)) || base];
  })));
  return { ...images, hasOnlineCover: [entry.cover, entry.coverPortrait, entry.coverLandscape].some(value => /^(https?:\/\/|data:image\/(?!svg))/i.test(value || '')), networkCovers: Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, /^https?:\/\//i.test(url) ? url : ''])) };
}

const MetadataNetwork = require('./metadata-network');
async function fetchJson(url, timeoutMs = 10000, options = {}) {
  return MetadataRuntime.cached('json:'+url+':'+(options.body||''),()=>require('./steam-request-policy').run(url,()=>fetchJsonUncached(url,timeoutMs,options)),{accept:value=>value!==null&&!value?.errors&&!value?.error});
}
async function fetchJsonUncached(url, timeoutMs = 10000, options = {}) {
  // Storefronts use Chromium's Windows proxy/trust path directly. Do not spend
  // half the timeout on a Node connection before sending the useful request.
  if (/(?:^|\.)(?:playstation\.com|egdata\.app|nintendo\.(?:com|jp)|nintendo-europe\.com|bgm\.tv|douban\.com|tvmaze\.com|jikan\.moe|openlibrary\.org|anilist\.co|itunes\.apple\.com|wikidata\.org|kitsu\.io|googleapis\.com)$/.test(new URL(url).hostname)) {
    return require('./native-json').nativeJson((...args)=>net.fetch(...args),url,timeoutMs,options);
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Math.floor(timeoutMs * .55)));
  try {
    const response = await fetch(url, { signal: MetadataRuntime.combine(controller.signal,MetadataRuntime.signal(),options.signal), method: options.method || 'GET', body: options.body, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Unified Manager/2.0', Accept: 'application/json,text/plain,*/*', ...options.headers } });
    return await MetadataNetwork.readResponse(response,url);
  } catch {
    MetadataRuntime.check();
    // Chromium honors Windows' system trust and proxy, and follows edition redirects.
    const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));
    if (remaining() < 100) return null;
    try { const response = await net.fetch(url, { method: options.method || 'GET', body: options.body, headers: { 'Accept': 'application/json', 'User-Agent': 'UnifiedManager/2.0', ...options.headers }, signal: MetadataRuntime.combine(AbortSignal.timeout(remaining()),MetadataRuntime.signal(),options.signal) }); return await MetadataNetwork.readResponse(response,url); } catch {}
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 10000) {
  return MetadataRuntime.cached('text:'+url,()=>require('./steam-request-policy').run(url,()=>fetchTextUncached(url,timeoutMs),''),{accept:value=>Boolean(value)&&!/cf-chl-|Just a moment|机器人验证|访问异常/i.test(value)});
}
async function fetchTextUncached(url, timeoutMs = 10000) {
  if (/(?:^|\.)(?:playstation\.com|dlsite\.com|nintendo\.com|douban\.com|seedog\.cc)$/.test(new URL(url).hostname)) {
    try {const response=await net.fetch(url,{headers:{Accept:'text/html,*/*'},signal:MetadataRuntime.combine(AbortSignal.timeout(timeoutMs),MetadataRuntime.signal())});return await MetadataNetwork.readResponse(response,url,true);}catch(error) {MetadataRuntime.check();MetadataNetwork.transportFailure(error,url);return '';}
  }
  const started=Date.now(),headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UnifiedManager/2.0',Accept:'text/html,*/*'};
  try {
    const response=await fetch(url,{signal:MetadataRuntime.combine(AbortSignal.timeout(Math.max(100,Math.floor(timeoutMs*.55))),MetadataRuntime.signal()),headers});
    return await MetadataNetwork.readResponse(response,url,true);
  } catch {
    MetadataRuntime.check();const remaining=timeoutMs-(Date.now()-started);if(remaining<100)return '';
    try {const response=await net.fetch(url,{headers,signal:MetadataRuntime.combine(AbortSignal.timeout(remaining),MetadataRuntime.signal())});return await MetadataNetwork.readResponse(response,url,true);}catch{return '';}
  }
}

const STEAM_REVIEW_LABELS = {
  'Overwhelmingly Positive': '好评如潮', 'Very Positive': '特别好评',
  'Mostly Positive': '多半好评', Positive: '好评', Mixed: '褒贬不一',
  'Mostly Negative': '多半差评', Negative: '差评',
  'Very Negative': '特别差评', 'Overwhelmingly Negative': '差评如潮',
};
async function steamReviewData(appid) {
  const payload=await fetchJson('https://store.steampowered.com/appreviews/'+encodeURIComponent(appid)+'?json=1&language=all&purchase_type=all',6000);
  const summary=payload?.query_summary||{},raw=summary.review_score_desc||'';
  const label=STEAM_REVIEW_LABELS[raw] || (raw && /好评|差评|褒贬/.test(raw)?raw:'');
  const total=Number(summary.total_reviews),positive=Number(summary.total_positive);
  return { label, ratingSource:'Steam', ratingMax:100, ratingValue:total>0&&summary.total_positive!=null&&positive>=0&&positive<=total?positive/total*100:null };
}
async function steamReviewLabel(appid) { return (await steamReviewData(appid)).label; }
async function steamPlaytime(appid) { return steamTime.hours(appid); }

const steamGameCache = new Map();
let steamCacheRevision=0;
const networkCache=require('./network-cache').create({session:()=>require('electron').session.defaultSession,metadata:MetadataRuntime,steam:{size:()=>Buffer.byteLength(JSON.stringify([...steamGameCache])),clear:()=>{steamCacheRevision++;steamGameCache.clear();}}});
async function mapConcurrent(values, limit, work) {
  const result = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { MetadataRuntime.check(); const index = cursor++; result[index] = await work(values[index]); }
  }));
  return result;
}
async function cachedSteamGame(appid) {
  MetadataRuntime.check();const revision=steamCacheRevision,key=String(appid),previous=steamGameCache.get(key);
  if(previous&&Date.now()-previous.time<300000)return structuredClone(previous.result);
  const result=await MetadataRuntime.memo('steam:'+key,()=>steamByAppId(key));MetadataRuntime.check();
  if(revision===steamCacheRevision&&result.length)steamGameCache.set(key,{time:Date.now(),result});
  if(steamGameCache.size>600)steamGameCache.delete(steamGameCache.keys().next().value);
  return result;
}
async function steamPagedSearch(query, country = 'cn') {
  const found = [];
  for (let start = 0; start < 200; start += 50) {
    const page = await fetchJson('https://store.steampowered.com/search/results/?term=' + encodeURIComponent(query) +
      '&category1=998&start=' + start + '&count=50&infinite=1&l=schinese&cc=' + country, 9000);
    const html = page?.results_html || '';
    const rows = [...html.matchAll(/<a\b[^>]*data-ds-appid="(\d+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const records=rows.map(match=>({id:match[1],name:MetadataText.text(match[2].match(/<span[^>]*class="title"[^>]*>([\s\S]*?)<\/span>/)?.[1]||'')}));
    if (!rows.length) break;
    found.push(...records);
    if (start + 50 >= Number(page.total_count || 0)) break;
  }
  return found;
}
async function steamSearch(query,emit=()=>{}) {
  const encoded = encodeURIComponent(query);
  const [paged, community, suggested, store, international] = await Promise.all([
    steamPagedSearch(query),
    fetchJson('https://steamcommunity.com/actions/SearchApps/' + encoded, 7000),
    steamSuggestSearch(query),
    fetchJson('https://store.steampowered.com/api/storesearch/?term=' + encoded + '&l=schinese&cc=cn', 7000),
    steamPagedSearch(query, 'us')
  ]);
  const list = [...(Array.isArray(community) ? community.map(item => ({ id: item.appid,name:item.name })) : []), ...suggested, ...(store?.items || []), ...paged, ...international];
  const ids = [...new Set(list.map(item => String(item.id || item.appid || '')).filter(id => /^\d+$/.test(id)))].slice(0, 200);
  const partial=[];
  const results = await mapConcurrent(ids, 5, async id=>{
    // These are online titles attached to this exact AppID, not the raw query.
    // Keep original/localized names before appdetails replaces the display title.
    const sourceNames=list.filter(item=>String(item.id||item.appid)===id).map(item=>MetadataText.text(item.name||'')).filter(Boolean);
    const entries=(await cachedSteamGame(id)).map(entry=>({...entry,aliases:[...new Set([...(entry.aliases||[]),...sourceNames])]}));
    if(/[a-z]{3}/i.test(query)&&entries.some(entry=>/[\u3400-\u9fff]/.test(entry.name)&&steamRelevance(entry,query)<=0)){
      const payload=await fetchJson('https://store.steampowered.com/api/appdetails?appids='+encodeURIComponent(id)+'&l=english&cc=us',7000);
      const original=payload?.[id]?.success&&payload[id].data?.type==='game'?MetadataText.text(payload[id].data.name||''):'';
      if(original)for(const entry of entries){entry.originalName=original;entry.aliases=[...new Set([...entry.aliases,original])];}
    }
    partial.push(...entries);if(entries.length)emit(partial);return entries;
  });
  return results.flat();
}

function decodeSteamHtml(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
async function steamSuggestSearch(query) {
  const html = await fetchText(`https://store.steampowered.com/search/suggest?term=${encodeURIComponent(query)}&f=games&cc=CN&l=schinese`, 7000).catch(() => '');
  if (!html) return [];
  const list = []; const re = /<a[^>]*data-ds-appid="(\d+)"[^>]*>[\s\S]*?<div class="match_name">([\s\S]*?)<\/div>[\s\S]*?<img[^>]*src="([^"]+)/gi; let match;
  while ((match = re.exec(html)) && list.length < 10) list.push({ id: match[1], name: decodeSteamHtml(match[2].replace(/<[^>]+>/g, '').trim()), tiny_image: match[3] });
  return list;
}

async function steamByAppId(appid) {
  let details = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=schinese&cc=cn`, 7000);
  if (!details?.[appid]?.success) details = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=schinese&cc=us`, 7000);
  const detail = details?.[appid]?.success ? details[appid].data : null;
  if (!detail || detail.type !== 'game' || /\b(dlc|demo|soundtrack|season pass|expansion pass|mod organizer|resolution pack|benchmark)\b|扩充通票|原声带|试玩版/i.test(detail.name || '')) return [];
  const [review,hours] = await Promise.all([steamReviewData(appid),steamPlaytime(appid)]); const reviewLabel = review.label;
  return [{
    id: appid, steamAppId:String(appid), platforms:['steam'],
    name: detail.name || `Steam ${appid}`,
    cover: detail.header_image || '',
    coverLandscape: detail.header_image || '',
    coverPortrait: `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(appid)}/library_600x900.jpg`,
    genres: (detail.genres || []).map((genre) => genre.description),
    developer: (detail.developers || []).join('、'),
    publisher: (detail.publishers || []).join('、'),
    releaseDate: detail.release_date?.date || '',
    steamRating: reviewLabel,
    externalRating: reviewLabel,
    ratingSource: review.ratingSource, ratingValue: review.ratingValue, ratingMax: review.ratingMax,
    fieldSources: { externalRating:'Steam' },
    playtime: hours,steamPlaytime:hours,playtimeSource:hours===null?'':'Steam',
    metadataSource: 'Steam',
    storeUrl: `https://store.steampowered.com/app/${appid}/`,
    description: detail.short_description || '',
  }];
}

function normaliseLookup(value) { return String(value || '').toLowerCase().replace(/[\s\-_:：·.（）()'"™®]/g, ''); }
function generatedCover(name, index = 0) { const palettes = [['#153d4d','#65d8b0'],['#322557','#b69cff'],['#4e2b24','#f3a26e'],['#20345d','#67a6ff'],['#304520','#a8d867']]; const colors = palettes[index % palettes.length]; const title = String(name || '悦森盒 YueDen').slice(0, 18).replace(/[&<>]/g, ''); const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + colors[0] + '"/><stop offset="1" stop-color="' + colors[1] + '"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="760" cy="80" r="180" fill="white" opacity=".08"/><circle cx="120" cy="380" r="220" fill="black" opacity=".12"/><text x="58" y="226" fill="white" font-size="54" font-family="Microsoft YaHei,Segoe UI" font-weight="700">' + title + '</text><text x="60" y="278" fill="white" opacity=".72" font-size="22" font-family="Segoe UI">悦森盒 YueDen</text></svg>'; return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
const OFFLINE_GAME_METADATA = [
  { keys: ['hades', '哈迪斯'], id: '1145360', name: 'Hades', genres: ['动作', '独立', 'RPG'], developer: 'Supergiant Games', publisher: 'Supergiant Games', releaseDate: '2020-09-17', externalRating: '好评如潮', storeUrl: 'https://store.steampowered.com/app/1145360/Hades/', description: '挑战冥界、击败众神与怪物，探索不断变化的地下世界。' },
  { keys: ['hollowknight', '空洞骑士'], id: '367520', name: 'Hollow Knight', genres: ['动作', '冒险', '独立'], developer: 'Team Cherry', publisher: 'Team Cherry', releaseDate: '2017-02-24', externalRating: '好评如潮', storeUrl: 'https://store.steampowered.com/app/367520/Hollow_Knight/', description: '在广阔的地下王国中展开一场手绘风格的冒险。' },
  { keys: ['oneshot'], id: '420530', name: 'OneShot', genres: ['冒险', '独立'], developer: 'Future Cat', publisher: 'Degica', releaseDate: '2016-12-08', externalRating: '特别好评', storeUrl: 'https://store.steampowered.com/app/420530/OneShot/', description: '帮助一位小小的灯泡孩子完成拯救世界的旅程。' },
  { keys: ['stardewvalley', '星露谷物语', '星露谷'], id: '413150', name: 'Stardew Valley', genres: ['模拟', 'RPG', '独立'], developer: 'ConcernedApe', publisher: 'ConcernedApe', releaseDate: '2016-02-27', externalRating: '好评如潮', storeUrl: 'https://store.steampowered.com/app/413150/Stardew_Valley/', description: '继承农场，种植、钓鱼、探索并建立自己的社区。' },
  { keys: ['celeste', '蔚蓝'], id: '504230', name: 'Celeste', genres: ['动作', '平台', '独立'], developer: 'Maddy Makes Games', publisher: 'Maddy Makes Games', releaseDate: '2018-01-25', externalRating: '好评如潮', storeUrl: 'https://store.steampowered.com/app/504230/Celeste/', description: '攀登塞莱斯特山，克服挑战并面对内心。' },
  { keys: ['deadcells', '死亡细胞'], id: '588650', name: 'Dead Cells', genres: ['动作', '独立', 'Roguelike'], developer: 'Motion Twin', publisher: 'Motion Twin', releaseDate: '2018-08-07', externalRating: '特别好评', storeUrl: 'https://store.steampowered.com/app/588650/Dead_Cells/', description: '在不断变化的城堡中战斗、探索和成长。' },
  { keys: ['eldenring', '艾尔登法环', '老头环'], id: '1245620', name: 'ELDEN RING', genres: ['动作', 'RPG', '冒险'], developer: 'FromSoftware', publisher: 'Bandai Namco Entertainment', releaseDate: '2022-02-25', externalRating: '特别好评', storeUrl: 'https://store.steampowered.com/app/1245620/ELDEN_RING/', description: '探索交界地，挑战强敌并寻找成为艾尔登之王的道路。' },
  { keys: ['monsterhunterworld', '怪物猎人世界', '怪猎世界', 'mhw'], id: '582010', name: 'Monster Hunter: World', genres: ['动作', 'RPG', '多人'], developer: 'CAPCOM Co., Ltd.', publisher: 'CAPCOM Co., Ltd.', releaseDate: '2018-08-10', externalRating: '特别好评', storeUrl: 'https://store.steampowered.com/app/582010/Monster_Hunter_World/', description: '在新大陆调查生态、狩猎大型怪物并制作更强装备。' },
  { keys: ['monsterhunterrise', '怪物猎人崛起', '怪猎崛起', 'mhr', 'mhrise'], id: '1446780', name: 'MONSTER HUNTER RISE', genres: ['动作', 'RPG', '多人'], developer: 'CAPCOM Co., Ltd.', publisher: 'CAPCOM Co., Ltd.', releaseDate: '2022-01-13', externalRating: '特别好评', storeUrl: 'https://store.steampowered.com/app/1446780/MONSTER_HUNTER_RISE/', description: '运用翔虫与随从，在炎火村周边展开高速狩猎。' },
  { keys: ['monsterhunterwilds', '怪物猎人荒野', '怪猎荒野', 'mhwilds'], id: '2246340', name: 'Monster Hunter Wilds', genres: ['动作', 'RPG', '多人'], developer: 'CAPCOM Co., Ltd.', publisher: 'CAPCOM Co., Ltd.', releaseDate: '2025-02-28', externalRating: '褒贬不一', storeUrl: 'https://store.steampowered.com/app/2246340/Monster_Hunter_Wilds/', description: '前往环境不断变化的禁忌之地，体验全新的狩猎与生态。' },
  { keys: ['factorio', '异星工厂'], id: '427520', name: 'Factorio', genres: ['自动化', '模拟', '策略'], developer: 'Wube Software LTD.', publisher: 'Wube Software LTD.', releaseDate: '2020-08-14', externalRating: '好评如潮', storeUrl: 'https://store.steampowered.com/app/427520/Factorio/', description: '建造并优化自动化生产线，在异星世界发展庞大工厂。' },
  { keys: ['persona5royal', '女神异闻录5皇家版', '女神异闻录5', 'p5r', 'p5'], id: '1687950', name: 'Persona 5 Royal', genres: ['JRPG', '剧情', '回合制'], developer: 'ATLUS', publisher: 'SEGA', releaseDate: '2022-10-21', externalRating: '好评如潮', storeUrl: 'https://store.steampowered.com/app/1687950/Persona_5_Royal/', description: '扮演怪盗团成员，在东京生活与异世界冒险之间作出选择。' },
  { keys: ['finalfantasyxvwindowsedition', 'finalfantasy15', '最终幻想15', 'ff15', 'ffxv'], id: '637650', name: 'FINAL FANTASY XV WINDOWS EDITION', genres: ['RPG', '动作', '开放世界'], developer: 'Square Enix', publisher: 'Square Enix', releaseDate: '2018-03-07', externalRating: '特别好评', storeUrl: 'https://store.steampowered.com/app/637650/FINAL_FANTASY_XV_WINDOWS_EDITION/', description: '与伙伴踏上旅程，在开放世界中体验战斗、探索与友情。' },
];
function gameSearchTerms(raw) {
  const normalized = normaliseLookup(raw);
  if (['最终幻想', 'finalfantasy', 'ff'].includes(normalized)) return ['FINAL FANTASY', raw];
  const exact = OFFLINE_GAME_METADATA.filter(entry=>entry.keys.some(key=>normaliseLookup(key)===normalized));
  const matches = exact.length?exact:OFFLINE_GAME_METADATA.filter(entry=>normalized.length>=2&&entry.keys.some(key=>normaliseLookup(key).includes(normalized)));
  const commonAliases = {
    '只狼': ['Sekiro: Shadows Die Twice', 'Sekiro'], '黑魂3': ['DARK SOULS III', 'Dark Souls 3'], '魂3': ['DARK SOULS III'],
    '巫师3': ['The Witcher 3: Wild Hunt', 'Witcher 3'], '赛博朋克': ['Cyberpunk 2077'], '2077': ['Cyberpunk 2077'],
    '大表哥2': ['Red Dead Redemption 2'], '荒野大镖客2': ['Red Dead Redemption 2'], 'rdr2': ['Red Dead Redemption 2'],
    'gta5': ['Grand Theft Auto V'], 'gta5豪华版': ['Grand Theft Auto V'], 'csgo': ['Counter-Strike 2'], 'cs2': ['Counter-Strike 2'],
    'pubg': ['PUBG: BATTLEGROUNDS'], '绝地求生': ['PUBG: BATTLEGROUNDS'], 'apex': ['Apex Legends'], 'apex英雄': ['Apex Legends'],
    '博德3': ['Baldur’s Gate 3', 'Baldurs Gate 3'],
    '博德之门3': ['Baldur’s Gate 3'], '法环': ['ELDEN RING'], '老头环': ['ELDEN RING'], '星露谷': ['Stardew Valley'],
    '空洞': ['Hollow Knight'], '死亡细胞': ['Dead Cells'], '哈迪斯': ['Hades'],
    '最终幻想': ['FINAL FANTASY', 'Final Fantasy'], '最终幻想7': ['FINAL FANTASY VII', 'FINAL FANTASY VII REMAKE'], '最终幻想7重制版': ['FINAL FANTASY VII REMAKE'],
    '最终幻想7重生': ['FINAL FANTASY VII REBIRTH'], '最终幻想8': ['FINAL FANTASY VIII'], '最终幻想9': ['FINAL FANTASY IX'],
    '最终幻想10': ['FINAL FANTASY X', 'FINAL FANTASY X/X-2 HD Remaster'], '最终幻想10-2': ['FINAL FANTASY X/X-2 HD Remaster'],
    '最终幻想12': ['FINAL FANTASY XII THE ZODIAC AGE'], '最终幻想13': ['FINAL FANTASY XIII'], '最终幻想14': ['FINAL FANTASY XIV Online'],
    '最终幻想15': ['FINAL FANTASY XV WINDOWS EDITION'], 'ff15': ['FINAL FANTASY XV WINDOWS EDITION'],
    '最终幻想16': ['FINAL FANTASY XVI'], '最终幻想十六': ['FINAL FANTASY XVI'], 'ff16': ['FINAL FANTASY XVI'], 'ffxvi': ['FINAL FANTASY XVI'],
  };
  const exactAliases=Object.entries(commonAliases).filter(([alias])=>normaliseLookup(alias)===normalized);
  const aliasTerms=(exactAliases.length?exactAliases:Object.entries(commonAliases).filter(([alias])=>normalized.length>=2&&normaliseLookup(alias).includes(normalized))).flatMap(([,terms])=>terms);
  if (normalized === '最终幻想') aliasTerms.push('FINAL FANTASY');
  const ffNumber = normalized.match(/^最终幻想(16|15|14|13|12|10|9|8|7|十六|十五|十四|十三|十二|十|九|八|七)(?!\d)/);
  if (ffNumber) {
    const roman = { '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X', '12': 'XII', '13': 'XIII', '14': 'XIV', '15': 'XV', '16': 'XVI', '七': 'VII', '八': 'VIII', '九': 'IX', '十': 'X', '十二': 'XII', '十三': 'XIII', '十四': 'XIV', '十五': 'XV', '十六': 'XVI' }[ffNumber[1]];
    if (roman) aliasTerms.push(`FINAL FANTASY ${roman}`);
  }
  // A spelling suggestion supplies a query only; every resulting item is still
  // fetched online and checked against the original typo by the source broker.
  const suggested=!aliasTerms.length&&!matches.length&&/^[a-z]{5,}$/i.test(raw)?OFFLINE_GAME_METADATA.filter(entry=>entry.keys.some(key=>/^[a-z]{5,}$/i.test(key)&&require('./game-sources').score({name:key},[raw])===35)):[];
  const corrections=suggested.length===1?[suggested[0].name]:[];
  const terms = [raw, ...aliasTerms, ...gameTerms(raw).slice(1), ...matches.map((entry) => entry.name), ...matches.flatMap((entry) => entry.keys.slice(0, 3)),...corrections];
  return Array.from(new Set(terms.map((term) => String(term).trim()).filter(Boolean))).slice(0, 6);
}
function steamRelevance(entry, query) { return require('./game-sources').score(entry,gameSearchTerms(query)); }

async function metadataSearchSteam(type, query, emit=()=>{}) {
  if (!query?.trim()) return [];
  const raw = query.trim();
  try {
    if (type !== 'game') return [];
    let results = [];
    if (type === 'game') {
      const appid = raw.match(/^appid:(\d+)$/i)?.[1];
      if (appid) {
        results = await steamByAppId(appid);
      } else {
        const terms = gameSearchTerms(raw);
        const partial=new Map();const publish=entries=>{for(const entry of entries)if(steamRelevance(entry,raw)>0)partial.set(String(entry.id),entry);emit([...partial.values()]);};
        const responses = await mapConcurrent(terms, 2, term => steamSearch(term,publish).catch(error => {MetadataRuntime.check();return [];}));
        const unique = new Map();
        responses.flat().forEach((entry) => { if (entry?.id && !unique.has(String(entry.id))) unique.set(String(entry.id), entry); });
        results = Array.from(unique.values()).filter(entry => steamRelevance(entry, raw) > 0).sort((a, b) => steamRelevance(b, raw) - steamRelevance(a, raw)).slice(0, 200);
      }
    }
    if (!results.length) return [];
    return results.map(entry=>({...MetadataText.candidate(entry),platforms:['steam'],steamAppId:String(entry.id),metadataSource:'Steam'}));
  } catch {
    MetadataRuntime.check();return [];
  }
}

async function metadataSearch(type,query){return (await metadataSearchSources(type,query)).integrated;}
async function metadataSearchSources(type,query,options={}) {
  MetadataRuntime.check();query=String(query||'').trim().slice(0,240);
  if(!query)return {integrated:[],sources:[],loading:false};
  if(type==='game'&&/^appid:\d+$/i.test(query)){const items=await metadataSearchSteam(type,query);return {integrated:items,sources:[{id:'steam',label:'Steam',items,state:items.length?'ok':'empty'}],loading:false};}
  return type==='game'?gameSources.search(query,options):sourceSearch.search(type,query,options);
}
async function prepareMetadataCandidate(candidate) {
  if(!candidate||typeof candidate!=='object')return null;
  return {...MetadataText.candidate(candidate),...await materializeCandidateCovers(candidate)};
}

// Legacy bridge uses the same read-only pipeline; no separate EXE-first scanner.
async function scanLocalGames(paths) {
  const result=await require('./local-scanner').scan((paths||[]).filter(p=>typeof p==='string'&&path.isAbsolute(p)).slice(0,80),'game',{existingItems:loadLibrary().items,online:false,rules:require('./scan-rules').read(app.getPath('userData'))});
  return [...result.items,...result.pending];
}

async function refreshItemMetadata(item) {
  if(!['game','movie','anime','manga','book'].includes(item.type||'game'))return item;
  const candidates=await metadataSearch(item.type||'game',item.type==='game'&&/^\d+$/.test(String(item.steamAppId||''))?'appid:'+item.steamAppId:item.name||'');
  const candidate=refreshMatch(item,candidates);if(!candidate)return item;
  const next=require('./local-model').fillMissing(item,candidate);for(const key of ['steamRating','externalRating','steamPositivePercent','ratingSource','ratingValue','ratingMax'])if(candidate[key]!==undefined&&candidate[key]!==null&&candidate[key]!=='')next[key]=candidate[key];
  const changed=Object.keys(next).filter(key=>JSON.stringify(next[key])!==JSON.stringify(item[key]));
  if(!changed.length)return item;next.fieldSources={...item.fieldSources};
  for(const key of changed)next.fieldSources[key]=candidate.fieldSources?.[key]||candidate.metadataSource||'';
  next.autoMetadataAt=new Date().toISOString();return normaliseItem(next);
}

function backupRoot() { return path.join(app.getPath('userData'), 'save-backups'); }
function safeName(value) { return String(value || 'item').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 80); }
function copySaveEntry(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) fs.cpSync(source, destination, { recursive: true, force: true });
  else { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); }
}
function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full)); else result.push(full);
  }
  return result;
}
function folderSize(root) { return listFiles(root).reduce((sum, file) => { try { return sum + fs.statSync(file).size; } catch { return sum; } }, 0); }
function backupSaves(itemId, paths) {
  const valid = (paths || []).filter((entry) => typeof entry === 'string' && fs.existsSync(entry));
  if (!valid.length) return { ok: false, message: '没有找到可备份的文件或文件夹' };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(backupRoot(), safeName(itemId), stamp);
  fs.mkdirSync(folder, { recursive: true });
  const manifest = { itemId, createdAt: new Date().toISOString(), entries: [] };
  valid.forEach((source, index) => {
    const targetName = `${String(index + 1).padStart(2, '0')}-${safeName(path.basename(source))}`;
    const destination = path.join(folder, targetName);
    copySaveEntry(source, destination);
    manifest.entries.push({ source, target: targetName });
  });
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { ok: true, folder, createdAt: manifest.createdAt, files: listFiles(folder).filter((file) => !file.endsWith('manifest.json')).length };
}
function listBackups(itemId) {
  const folder = path.join(backupRoot(), safeName(itemId));
  if (!fs.existsSync(folder)) return [];
  const stored = loadSettings();
  return fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const backupFolder = path.join(folder, entry.name);
    const manifest = readJson(path.join(backupFolder, 'manifest.json'), { createdAt: entry.name, entries: [] });
    const size = folderSize(backupFolder); const synced = stored.lastWebdavSyncAt && new Date(stored.lastWebdavSyncAt) >= new Date(manifest.createdAt);
    return { id: entry.name, folder: backupFolder, createdAt: manifest.createdAt, entries: manifest.entries, files: listFiles(backupFolder).filter((file) => !file.endsWith('manifest.json')).length, size, syncStatus: synced ? '已同步' : (stored.webdavUrl ? '待同步' : '未配置云同步') };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function restoreBackup(itemId, backupId) {
  const backupFolder = path.join(backupRoot(), safeName(itemId), safeName(backupId));
  const manifest = readJson(path.join(backupFolder, 'manifest.json'), null);
  if (!manifest?.entries?.length) return { ok: false, message: '备份清单不存在或为空' };
  let restored = 0;
  for (const entry of manifest.entries) {
    const source = path.join(backupFolder, entry.target);
    if (!fs.existsSync(source) || !entry.source) continue;
    copySaveEntry(source, entry.source);
    restored += 1;
  }
  return { ok: true, restored };
}
function deleteBackup(itemId, backupId) {
  if (!itemId || !backupId || path.basename(String(backupId)) !== backupId || ['.', '..'].includes(backupId)) return { ok: false, message: '无效的备份标识' };
  const base = path.resolve(backupRoot(), safeName(itemId));
  const target = path.resolve(base, backupId);
  if (path.dirname(target) !== base) return { ok: false, message: '备份路径无效' };
  try {
    if (!fs.existsSync(target)) return { ok: false, message: '备份不存在，请刷新列表' };
    fs.rmSync(target, { recursive: true, force: false });
    return fs.existsSync(target) ? { ok: false, message: '备份未删除，请检查文件占用' } : { ok: true };
  } catch (error) { return { ok: false, message: '删除失败：' + error.message }; }
}

const webdavRequest=(...args)=>webdavClient.request(...args);
const ensureWebdavPath=settings=>webdavClient.ensurePath(settings);
const ensureWebdavDirectories=(settings,relative)=>webdavClient.ensureDirectories(settings,relative);
const listWebdavFiles=(settings,relative='saves')=>webdavClient.listFiles(settings,relative);
function mergeStates(local, remote) {
  const byId = new Map((local.items || []).map((item) => [item.id, item]));
  for (const item of (remote.items || [])) {
    const existing = byId.get(item.id);
    if (!existing || new Date(item.updatedAt || item.createdAt || 0) > new Date(existing.updatedAt || existing.createdAt || 0)) byId.set(item.id, item);
  }
  return { items: Array.from(byId.values()), categories: Array.from(new Set([...(local.categories || []), ...(remote.categories || [])])) };
}
async function syncWebdav(settings, direction) {
  let uploaded = 0; let downloaded = 0;let skippedFiles=0;
  let localState = loadLibrary();
  await ensureWebdavPath(settings);
  const prepared=await require('./webdav-library-sync').plan({local:localState,direction,get:()=>webdavRequest(settings,'GET','library.json'),backup:async snapshots=>{const folder=path.join(app.getPath('userData'),'sync-recovery');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,Date.now()+'-'+randomBytes(4).toString('hex')+'.json'),JSON.stringify(snapshots));}});
  const upload = async (relative, content, conditions={}) => { await ensureWebdavDirectories(settings, relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''); const response = await webdavRequest(settings, 'PUT', relative, content,'',conditions); if (!response.ok) throw require('./webdav-client').failure('PUT',response.status); uploaded += 1; };
  const download = async (relative) => { const response = await webdavRequest(settings, 'GET', relative); if (response.status===404) return null; if(!response.ok)throw require('./webdav-client').failure('GET',response.status); downloaded += 1; return response; };
  if (direction === 'upload' || direction === 'bidirectional') {
    await upload('library.json', JSON.stringify(coverStore.exportLibrary(prepared.state), null, 2),prepared.headers);
    if(direction==='upload')await upload('settings.json', JSON.stringify(secretSettings().publicSettings(settings), null, 2));
    for (const file of listFiles(backupRoot())) {
      const relative = path.relative(backupRoot(), file).split(path.sep).join('/');
      const exists=await webdavRequest(settings,'HEAD',`saves/${relative}`);if(exists.status!==404){if(!exists.ok)throw Error('无法核对远端存档，停止覆盖');skippedFiles++;continue;}await upload(`saves/${relative}`, fs.readFileSync(file),{'If-None-Match':'*'});
    }
    const syncStamp = new Date().toISOString(); writeJson(settingsFile(), { ...initialSettings, ...settings, lastWebdavSyncAt: syncStamp, appearance: { ...initialSettings.appearance, ...(settings.appearance || {}) } });
  }
  if (direction === 'download' || direction === 'bidirectional') {
    writeJson(dataFile(), {...prepared.state,items:prepared.state.items.map(normaliseItem)});
    const remoteSettings = await download('settings.json');
    if (remoteSettings && direction === 'download') { const remote = secretSettings().publicSettings(await remoteSettings.json());for(const key of require('./secure-settings').KEYS)delete remote[key]; writeJson(settingsFile(), { ...loadSettings(), appearance: { ...initialSettings.appearance, ...(remote.appearance || {}) } }); }
    try {
      const remoteFiles = await listWebdavFiles(settings);
      for (const relative of remoteFiles) {
        const target = path.join(backupRoot(), relative.slice('saves/'.length).split('/').join(path.sep));
        if(fs.existsSync(target)){skippedFiles++;continue;}const response=await download(relative);if(!response)continue;fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()),{flag:'wx'});
      }
    } catch(error){throw Error('资源库已同步；存档下载未完成：'+error.message+'。已有文件未覆盖，可重试。');}
  }
  return { ok: true, uploaded, downloaded, skippedFiles, message: direction === 'upload' ? `已上传 ${uploaded} 个文件` : direction === 'download' ? `已下载 ${downloaded} 个文件` : `双向同步完成：上传 ${uploaded} 个，下载 ${downloaded} 个；保留 ${skippedFiles} 个同名已有存档。删除不会跨端传播` };
}

function currentDisguiseState() {
  const stored = loadSettings();
  return { enabled: Boolean(stored.disguiseEnabled), profile: stored.disguiseProfile || 'course', ...(DISGUISE_PROFILES[stored.disguiseProfile] || DISGUISE_PROFILES.course) };
}

let readerWindows=null,audioService=null,audioDisplay=null,unifiedPlayer=null,usageService=null,playerQuitting=false;
async function finishMediaSessions(){try{await unifiedPlayer?.close();}finally{readerWindows?.closeAll();await usageService?.stop();}}
app.on('before-quit',event=>{if(unifiedPlayer&&!playerQuitting){event.preventDefault();playerQuitting=true;finishMediaSessions().catch(error=>console.error('退出时保存失败：',error)).finally(()=>app.quit());}});
function setDisguiseState(enabled, profile = 'course') {
  if(enabled){readerWindows?.closeAll();audioDisplay?.hide();}
  const nextProfile = DISGUISE_PROFILES[profile] ? profile : 'course';
  const stored = loadSettings();
  const next = { ...stored, disguiseEnabled: Boolean(enabled), disguiseProfile: nextProfile };
  writeJson(settingsFile(), next);
  const state = { enabled: next.disguiseEnabled, profile: nextProfile, ...DISGUISE_PROFILES[nextProfile] };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(state.enabled ? state.title : '悦森盒 YueDen');
    mainWindow.webContents.send('disguise:state', state);
  }
  return state;
}

const quickDisguise=require('./quick-disguise').create({windows:()=>BrowserWindow.getAllWindows(),setState:()=>setDisguiseState(true,loadSettings().disguiseProfile),closePlayer:()=>unifiedPlayer?.conceal(),openExternal:url=>shell.openExternal(url),report:error=>console.error('快速伪装未完成：'+error.message)});
app.on('browser-window-created',(_,win)=>{win.webContents.on('before-input-event',(event,input)=>{let file;try{file=require('node:url').fileURLToPath(win.webContents.getURL());}catch{return;}if(!['index.html','reader.html','audio-window.html',path.join('player','window.html')].some(p=>path.resolve(file)===path.join(__dirname,p)))return;if(quickDisguise.input(input))event.preventDefault();});});
function createWindow() {
  const Bounds=require('./window-bounds'),windowFile=path.join(app.getPath('userData'),'window-state.json');
  let savedBounds;try{savedBounds=JSON.parse(fs.readFileSync(windowFile,'utf8'));}catch{}
  const restored=Bounds.restore(savedBounds,screen.getAllDisplays());
  const win = new BrowserWindow({
    show: process.env.UM_SMOKE_HIDE !== '1',
    x:restored.x,y:restored.y,width:restored.width,height:restored.height,minWidth:restored.minWidth,minHeight:restored.minHeight,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0c121b',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  Bounds.install(win,{screen,write:value=>writeJson(windowFile,value)});
  if(restored.maximized)win.maximize();
  win.on('close',event=>{if(unifiedPlayer&&!playerQuitting){event.preventDefault();playerQuitting=true;finishMediaSessions().catch(error=>console.error('退出时保存失败：',error)).finally(()=>{if(!win.isDestroyed())win.destroy();app.quit();});}});
  win.on('closed',()=>{readerWindows?.closeAll();audioDisplay?.close();audioService?.stop();});
  const sendWindowState=()=>{if(!win.webContents.isDestroyed())win.webContents.send('window:state',{maximized:win.isMaximized()});};
  win.on('maximize',sendWindowState);win.on('unmaximize',sendWindowState);win.webContents.on('did-finish-load',sendWindowState);
  const metadataOwnerId=win.webContents.id;
  win.webContents.once('destroyed',()=>{MetadataRuntime.cancelOwner(metadataOwnerId);MetadataRuntime.cancelOwner('refresh:'+metadataOwnerId);candidateCoverCache.cancel(metadataOwnerId);candidateCoverCache.cancel('library:'+metadataOwnerId);});
  win.setTitle('悦森盒 YueDen');
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('context-menu', (event) => event.preventDefault());
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('did-finish-load', () => win.webContents.send('disguise:state', currentDisguiseState()));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|obsidian:|file:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.UM_DEVTOOLS !== '1') {
    win.webContents.on('before-input-event', (event, input) => {
      if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') event.preventDefault();
    });
  }
  return win;
}

function registerIpc() {
 const usage=usageService=require('./usage-service').install({ipcMain,dataRoot:()=>app.getPath('userData'),loadLibrary});
 const pauseOthers=kind=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('media:pause',kind);};
 ipcMain.on('audio:playing',()=>pauseOthers('video'));
 ipcMain.on('reader:playing',event=>{pauseOthers('audio');for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&win.webContents.id!==event.sender.id)win.webContents.send('media:pause','video');});
  const localServices=require('./local-services').createLocalServices({ipcMain,protocol,dialog,windowFor:event=>BrowserWindow.fromWebContents(event.sender)||mainWindow,loadLibrary,dataRoot:()=>app.getPath('userData'),metadataSearch:require('./import-metadata').createImportSearch({steam:query=>metadataSearchSteam('game',query),search:metadataSearchSources}),prepareCandidate:prepareMetadataCandidate,metadataRuntime:MetadataRuntime,shell});localServices.install();
  unifiedPlayer=require('./player/dist/service').createPlayerService({electron:require('electron'),ipcMain:rawIpcMain,loadLibrary,localServices,audioLyrics:()=>audioService?.lyrics,audioPlayback:()=>audioService?.resolvePlayer,appearance:()=>loadSettings().appearance,dataRoot:()=>app.getPath('userData'),disguised:()=>loadSettings().disguiseEnabled,quickEscape:()=>quickDisguise.escape(),usage,snapshotLibrary:playerSnapshotLibrary});
  readerWindows=require('./reader-windows').createReaderWindows({BrowserWindow,ipcMain,loadLibrary,loadSettings,localServices,player:unifiedPlayer,usage});
  audioDisplay={hide(){},close(){}};ipcMain.handle('audio:windowOpen',()=>unifiedPlayer.show());
  audioService=require('./audio-service').create({safeStorage:require('electron').safeStorage,coverStore,ipcMain,protocol,dialog,windowFor:event=>BrowserWindow.fromWebContents(event.sender)||mainWindow,loadLibrary,saveLibrary:state=>{const next={...state,...require('./library-relations').fields(state,normaliseItem),schemaVersion:4,items:state.items.map(normaliseItem)};writeJson(dataFile(),next);return next;},dataRoot:()=>app.getPath('userData'),disguised:()=>loadSettings().disguiseEnabled});
  const fileDialogs = createFileDialogs({ dialog, windowFor: event => BrowserWindow.fromWebContents(event.sender) || mainWindow, settings: loadSettings });
  const pathPicker=require('./path-picker').createPathPicker({BrowserWindow,ipcMain,app,settings:loadSettings});
  ipcMain.handle('local:reveal',async(event,file)=>{if(typeof file!=='string'||file.length>32768||!path.isAbsolute(file)||!fs.existsSync(file))throw Error('文件位置不存在');if(fs.statSync(file).isDirectory()){const error=await shell.openPath(file);if(error)throw Error(error);}else shell.showItemInFolder(file);return {ok:true};});
  ipcMain.handle('resource:pickPath', (event, kind, initial) => kind==='resource'?pathPicker.show(BrowserWindow.fromWebContents(event.sender)||mainWindow,typeof initial==='string'&&path.isAbsolute(initial)&&fs.existsSync(initial)?(fs.statSync(initial).isDirectory()?initial:path.dirname(initial)):undefined):fileDialogs.resource(event, kind, initial));
  ipcMain.handle('library:load', async () => {await usage.flush();return usage.decorate(loadLibrary());});
  ipcMain.handle('library:save', async (_, state) => {
    await usage.flush();
    const safe = { ...require('./library-relations').fields(state,normaliseItem),schemaVersion:4, items: (state?.items || []).map(normaliseItem), categories: Array.from(new Set(state?.categories || [])) };
    writeJson(dataFile(), safe);
    return usage.decorate(safe);
  });
  ipcMain.handle('cache:size',()=>networkCache.size());
  ipcMain.handle('cache:clear',()=>networkCache.clear());
  ipcMain.handle('settings:load', () => secretSettings().publicSettings(loadSettings(),true));
  ipcMain.handle('settings:save', (_, settings) => {
    const safe = { ...initialSettings, ...secretSettings().resolve(settings||{},loadSettings()), appearance: { ...initialSettings.appearance, ...(settings?.appearance || {}) } };
    writeJson(settingsFile(), safe);
    readerWindows?.appearance();unifiedPlayer?.appearance();
    return secretSettings().publicSettings(loadSettings(),true);
  });
  ipcMain.handle('metadata:libraryCover',(event,urls)=>candidateCoverCache.resolve(urls,{owner:'library:'+event.sender.id,id:'library-covers'}));
  ipcMain.handle('metadata:prepareCandidate',(_,candidate)=>prepareMetadataCandidate(candidate));
  ipcMain.handle('metadata:previewCover',(event,urls,id)=>candidateCoverCache.resolve(urls,{owner:event.sender.id,id:typeof id==='string'?id.slice(0,100):'preview'}));
  ipcMain.handle('metadata:start',async(event,id,type,query)=>{
    if(typeof id!=='string'||id.length>100||!['game','movie','anime','manga','book','other'].includes(type))throw Error('无效的检索请求');
    const owner=event.sender.id;candidateCoverCache.cancel(owner);
    try{return await MetadataRuntime.run(owner,id,()=>metadataSearchSources(type,query,{onProgress:bundle=>{if(!event.sender.isDestroyed())event.sender.send('metadata:progress',{id,bundle});}}));}
    catch(error){if(error.name==='AbortError')return {canceled:true};throw error;}
  });
  ipcMain.on('metadata:cancel',(event,id)=>{MetadataRuntime.cancel(event.sender.id,id);candidateCoverCache.cancel(event.sender.id,id);});
  ipcMain.handle('metadata:search', (_, type, query) => metadataSearch(type, query));
  ipcMain.handle('metadata:searchSources', (_, type, query) => metadataSearchSources(type, query));
  ipcMain.handle('metadata:refreshCovers', async (_, type, name, appid) => {
    if (type === 'game') steamGameCache.clear();
    const candidates=await metadataSearch(type, type === 'game' && /^\d+$/.test(String(appid || '')) ? 'appid:' + appid : name);
    // Explicit image refresh revalidates the originals, not a permanently sticky cache.
    for(const item of candidates)for(const key of ['cover','coverPortrait','coverLandscape']){const url=item.networkCovers?.[key]||item[key];if(/^https?:\/\//i.test(url||'')){candidateCoverCache.forget(url);item[key]=url;}}
    return candidates;
  });
  ipcMain.handle('reader:fonts',event=>{const url=event.sender.getURL();if(!url.startsWith('file:')||!/(?:reader|index)\.html$/.test(url))throw Error('无效阅读窗口');return require('./reader-fonts')();});
  ipcMain.handle('cover:pick', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)||mainWindow,{ title: '选择自定义封面图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] },{name:'所有文件（All Files）',extensions:['*']}] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return readCoverImage(result.filePaths[0]);
  });
  ipcMain.handle('disguise:openVideo', (_, query, index) => openDisguiseVideo(query, index));
  ipcMain.handle('external:open', (_, url) => {
    if (typeof url === 'string' && (/^[A-Za-z]:[\\/]/.test(url) || /^\\\\[^\\]+\\[^\\]+/.test(url))) return shell.openPath(url);
    if (typeof url === 'string' && /^(https?:|obsidian:|file:)/i.test(url)) return shell.openExternal(url);
    return false;
  });
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:state',event=>({maximized:BrowserWindow.fromWebContents(event.sender)?.isMaximized()||false}));
  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
    return win?.isMaximized() || false;
  });
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('local:pickPaths', event => fileDialogs.scan(event));
  ipcMain.handle('local:scan', (_, paths) => scanLocalGames(paths));
  ipcMain.handle('steam:syncPlaytime', () => steamTime.sync(true));
  const refreshJobs=require('./metadata-refresh-job').create({refresh:refreshItemMetadata});
  ipcMain.handle('metadata:refreshItem',(event,item,jobId)=>jobId?refreshJobs.run(event.sender.id,jobId,item):MetadataRuntime.run('refresh:'+event.sender.id,'legacy',()=>refreshItemMetadata(item)));
  ipcMain.on('metadata:refreshCancel',(event,id)=>refreshJobs.cancel(event.sender.id,id));
  ipcMain.handle('saves:pickPaths', async () => {
    const result = await pathPicker.show(mainWindow,undefined,true);result.filePaths=result.paths;
    if(result.ok===false)throw Error(result.message);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('saves:backup', (_, itemId, paths) => backupSaves(itemId, paths));
  ipcMain.handle('saves:list', (_, itemId) => listBackups(itemId));
  ipcMain.handle('saves:restore', (_, itemId, backupId) => restoreBackup(itemId, backupId));
  ipcMain.handle('saves:delete', (_, itemId, backupId) => deleteBackup(itemId, backupId));
  ipcMain.handle('saves:openFolder', (_, itemId) => { const folder = path.join(backupRoot(), safeName(itemId)); fs.mkdirSync(folder, { recursive: true }); return shell.openPath(folder); });
  ipcMain.handle('webdav:test', async (_, settings) => {
    try { await ensureWebdavPath(secretSettings().resolve(settings||{},loadSettings())); return { ok: true, message: 'WebDAV 连接成功' }; } catch (error) { return { ok: false, message: require('./webdav-client').describe(error) }; }
  });
  ipcMain.handle('webdav:sync', async (_, settings, direction) => {
    try { return await syncWebdav(secretSettings().resolve(settings||{},loadSettings()), direction || 'bidirectional'); } catch (error) { return { ok: false, message: require('./webdav-client').describe(error) }; }
  });
  ipcMain.handle('disguise:set', (_, enabled, profile) => setDisguiseState(enabled, profile));
  ipcMain.handle('data:export', async (_, state) => {
    const result = await dialog.showSaveDialog({ title: '导出 悦森盒 YueDen 数据', defaultPath: 'YueDen-backup.json', filters: [{ name: 'JSON 数据', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(coverStore.exportLibrary({...require('./library-relations').fields(state,normaliseItem),schemaVersion:4,items:(state?.items||[]).map(normaliseItem),categories:state?.categories||[]}), null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('data:import', async () => {
    const result = await dialog.showOpenDialog({ title: '导入 悦森盒 YueDen 数据', properties: ['openFile'], filters: [{ name: 'JSON 数据', extensions: ['json'] },{name:'所有文件（All Files）',extensions:['*']}] });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const imported = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));if(!Array.isArray(imported))require('./library-schema').validate(imported);
      return { ...require('./library-relations').fields(imported,normaliseItem),schemaVersion:4,items: (imported.items || imported || []).map(normaliseItem), categories: imported.categories || initialState.categories };
    } catch {
      return null;
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.whenReady().then(() => {
    protocol.handle('um-cover', request => {
      const file = coverStore.fileFor(request.url);
      return file && fs.existsSync(file) ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    });
    registerIpc();
    createWindow();
    globalShortcut.register('CommandOrControl+Shift+U', () => {
      const current = currentDisguiseState();
      setDisguiseState(!current.enabled, current.profile);
    });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
