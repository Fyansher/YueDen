const { app, BrowserWindow, Menu, dialog: rawDialog, ipcMain: rawIpcMain, shell, globalShortcut, nativeImage, protocol, net, screen, session } = require('electron');
const path = require('path');
const ipcMain=require('./ipc-guard').create(rawIpcMain,__dirname);
const fs = require('fs');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const webdavDiagnosticModule=require('./webdav-diagnostic-log'),webdavDiagnosticLog=webdavDiagnosticModule.create(()=>app.getPath('userData'),()=>{const packageInfo=require('./package.json'),version=app.getVersion?.()||packageInfo.version;return {appVersion:version,buildId:process.env.YUEDEN_BUILD_ID||packageInfo.buildId||version,schemaVersion:require('./webdav-state').SYNC_SCHEMA_VERSION};});
const metadataDiagnosticLog=require('./metadata-diagnostic-log').create({directory:()=>path.join(app.getPath('userData'),'logs'),appVersion:app.getVersion?.()||require('./package.json').version,buildId:process.env.YUEDEN_BUILD_ID||require('./package.json').buildId||require('./package.json').version});
const steamRequestPolicy=require('./steam-request-policy').create({onDiagnostic:row=>metadataDiagnosticLog.write(row)});
let webdavOperationSignal=null;
const webdavProtocol=require('./webdav-client'),webdavClient=webdavProtocol.create({operationSignal:()=>webdavOperationSignal,onDiagnostic:row=>webdavDiagnosticLog.write(row)});
const webdavTestClient=webdavProtocol.create({timeout:4000,onDiagnostic:row=>webdavDiagnosticLog.write(row)});
const dialog=require('./dialog-memory').wrap(rawDialog,()=>app.getPath('userData'));
const https = require('https');
const MetadataText = require('./metadata-text');
const MetadataNetwork = require('./metadata-network');
const SteamSearchResults=require('./steam-search-results');
const SteamCandidateResolution=require('./steam-candidate-resolution');
const METADATA_SESSION_PARTITION = 'persist:yueden-metadata';
const METADATA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UnifiedManager/2.0';
let metadataHttpSession = null;
function getMetadataHttpSession() {
  if (!metadataHttpSession) {
    metadataHttpSession = session.fromPartition(METADATA_SESSION_PARTITION);
    metadataHttpSession.setUserAgent(METADATA_USER_AGENT);
  }
  return metadataHttpSession;
}
const metadataSourceLocations=require('./metadata-source-locations').create({file:()=>path.join(app.getPath('userData'),'metadata-source-locations.json')});
const metadataVerificationWindow = require('./metadata-verification-window').create({BrowserWindow,partition:METADATA_SESSION_PARTITION,userAgent:METADATA_USER_AGENT});
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
const renderMetadataHtml=require('./metadata-render-service').create({readRenderedDom:(...args)=>metadataVerificationWindow.readRenderedDom(...args),sourceLocations:metadataSourceLocations,network:MetadataNetwork,runtime:MetadataRuntime,fetchText:(...args)=>fetchMetadataText(...args)});
const bookSourceEndpoints=require('./book-source-endpoints').create({file:()=>path.join(app.getPath('userData'),'book-source-endpoints.json'),fetchText:(url,timeout)=>fetchMetadataText(url,timeout,'')});
const gameSources = createGameSources({json:(...args)=>fetchMetadataJson(...args),text:(...args)=>fetchMetadataText(...args),steam:(query,emit)=>metadataSearchSteam('game',query,emit),aliases:query=>gameSearchTerms(query).map(term=>term.replace(/ WINDOWS EDITION$/i,'')),settings:loadSettings,diagnostics:row=>metadataDiagnosticLog.write(row),completeCovers:completeMetadataCovers});
const sourceSearch = createSourceSearch({
  json: (url,timeout,options,sourceId) => fetchMetadataJson(url,timeout,options,sourceId),
  text: (url,timeout,sourceId,diagnosticContext) => fetchMetadataText(url,timeout,sourceId,diagnosticContext),
  sourceHome: sourceId => metadataSourceLocations.homeFor(sourceId,({onelib:'https://zh.1lib.sk/',zlibrary:'https://zh.zlib.bz/'}[sourceId]||'')),
  sourceVerified: sourceId => metadataSourceLocations.isVerified(sourceId),
  renderHtml:renderMetadataHtml,
  bookSourceEndpoints,
  settings: loadSettings,
  diagnostics:row=>metadataDiagnosticLog.write(row),
  completeCovers:completeMetadataCovers
});
const { pathToFileURL } = require('node:url');
protocol?.registerSchemesAsPrivileged([{ scheme: 'um-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },{scheme:'um-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}},{scheme:'um-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
const coverStore = new CoverStore(() => path.join(app.getPath('userData'), 'cover-cache'), nativeImage);
const coverUrlCache=require('./cover-url-cache').createCoverUrlCache(coverStore);
const candidateCoverCache = require('./candidate-covers').createCandidateCovers({request:requestImageOverHttps,compact:value=>coverStore.compact(value),dimensions:reference=>coverStore.dimensions(reference),...coverUrlCache});
const steamArtworkCache=new Map();

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
const initialState = { items: [], categories: ['PC', '主机', '掌机', '独立游戏', '科幻', '待读', '年度候选'], deletedItems: [], deletedSaveSnapshots: [] };
const initialSettings = {
  obsidianRoot: '', steamApiKey: '', steamId: '',
  scanGamesRequireExe: false,
  metadataPrimarySourceByType: { game:'steam', movie:'douban', anime:'bangumi', manga:'bangumi', book:'douban' },
  webdavUrl: '', webdavUsername: '', webdavPassword: '', webdavRemotePath: 'YueDen', lastWebdavSyncAt: '',
  appearance: { theme: 'ocean', accent: '#65d8b0', density: 'comfortable', animations: true, defaultView: 'dashboard' },
  disguiseEnabled: false, disguiseVideoUrl: '', positiveEnergyEnabled: false, confirmBeforeDelete: true, deleteCloudSaveWithLocal: true,
  localScanPaths: [], refreshWhitelist: [], autoRefreshMetadata: true,
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
  const coverDimensions=coverStore.dimensions(value.cover),measuredCoverOrientation=require('./cover-classifier').classify(coverDimensions?.width,coverDimensions?.height);
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
    ...(['portrait','landscape','square'].includes(value.coverOrientation||measuredCoverOrientation) ? { coverOrientation:value.coverOrientation||measuredCoverOrientation } : {}),
    ...(typeof value.coverShared === 'boolean' ? { coverShared:value.coverShared } : {}),
    ...(value.coverDisplayDirection === 'portrait' || value.coverDisplayDirection === 'landscape' ? { coverDisplayDirection: value.coverDisplayDirection } : {}),
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
    ratingEdited: Boolean(value.ratingEdited), platforms: PlatformModel.detect(value), playedPlatforms:PlatformModel.normalizeMany(value.playedPlatforms), platformsExplicit:Boolean(value.platformsExplicit), platformsManual: Boolean(value.platformsManual), platformLinks: value.platformLinks || {},
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
    const migrated = { items: (Array.isArray(legacy) ? legacy : legacy.items || []).map(normaliseItem), categories: initialState.categories, deletedItems: [] };
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
    return { ...initialSettings, ...saved, metadataPrimarySourceByType:{...initialSettings.metadataPrimarySourceByType,...(saved.metadataPrimarySourceByType||{})}, appearance: { ...initialSettings.appearance, ...(saved.appearance || {}) } };
  }
  if (fs.existsSync(legacySettingsFile())) {
    const legacy = readJson(legacySettingsFile(), initialSettings);
    const migrated = { ...initialSettings, ...legacy, metadataPrimarySourceByType:{...initialSettings.metadataPrimarySourceByType,...(legacy.metadataPrimarySourceByType||{})}, appearance: { ...initialSettings.appearance, ...(legacy.appearance || {}) } };
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
  const original={cover:entry.cover||'',coverPortrait:entry.coverPortrait||'',coverLandscape:entry.coverLandscape||''};
  const generated=!Object.values(original).some(Boolean),fallback=generated?generatedCover(entry.name||raw,index):'';
  const urls={...original,...(generated?{cover:fallback}:{})};
  const images=Object.fromEntries(await Promise.all(Object.entries(urls).map(async([key,url])=>{
    if(!url)return [key,''];if(!cache.has(url))cache.set(url,materializeCover(url));return [key,(await cache.get(url))||url];
  })));
  const CoverClassifier=require('./cover-classifier');
  const cached=candidateCoverCache.cached(original.cover),dimensions=entry.coverDimensions||coverStore.dimensions(cached);
  const orientation=CoverClassifier.classify(dimensions?.width,dimensions?.height)||(['portrait','landscape','square'].includes(entry.coverOrientation)?entry.coverOrientation:'')||(generated?'landscape':'');
  let cover=images.cover||'',coverPortrait=images.coverPortrait||'',coverLandscape=images.coverLandscape||'';
  if(cover&&['portrait','landscape'].includes(orientation)){
    if(orientation==='portrait'&&!coverPortrait)coverPortrait=cover;
    if(orientation==='landscape'&&!coverLandscape)coverLandscape=cover;
    cover='';
  }
  const networkCovers={cover:/^https?:\/\//i.test(original.cover)?original.cover:'',coverPortrait:/^https?:\/\//i.test(original.coverPortrait)?original.coverPortrait:'',coverLandscape:/^https?:\/\//i.test(original.coverLandscape)?original.coverLandscape:''};
  if(coverPortrait===images.cover&&networkCovers.cover)networkCovers.coverPortrait=networkCovers.cover;
  if(coverLandscape===images.cover&&networkCovers.cover)networkCovers.coverLandscape=networkCovers.cover;
  return {cover,coverPortrait,coverLandscape,...(orientation?{coverOrientation:orientation}:{}),...(typeof entry.coverShared==='boolean'?{coverShared:entry.coverShared}:{}),hasOnlineCover:Object.values(original).some(value=>/^(https?:\/\/|data:image\/(?!svg))/i.test(value||'')),networkCovers};
}

async function inspectMetadataCover(url){
  if(!/^https:\/\//i.test(String(url||'')))return null;
  const cached=candidateCoverCache.cached(url);
  if(cached){const dimensions=coverStore.dimensions(cached);if(dimensions?.width>0&&dimensions?.height>0)return {sourceUrl:url,reference:cached,dimensions};}
  const image=await requestImageOverHttps(url,3200,MetadataRuntime.signal());MetadataRuntime.check();if(!image)return null;
  const reference=coverStore.compact(image),dimensions=coverStore.dimensions(reference);
  if(!(dimensions?.width>0&&dimensions?.height>0))return null;
  coverUrlCache.remember(url,reference);return {sourceUrl:url,reference,dimensions};
}

async function completeMetadataCovers(entry,seed={}){
  if(!entry||typeof entry!=='object')return entry;
  const CoverCompletion=require('./cover-completion'),SteamLibraryArt=require('./steam-library-art'),matches=seed._matchedCandidates||entry._matchedCandidates||[],primaryId=String(seed._sourceId||seed.sourceId||entry._sourceId||''),extras=[];
  const steamMatch=matches.some(match=>match?.sourceId==='steam'||match?.candidate?._sourceId==='steam'),steamRelevant=primaryId==='steam'||steamMatch||/\bSteam\b/i.test(String(entry.metadataSource||''));
  const appid=String(seed.steamAppId||entry.steamAppId||matches.find(match=>match?.sourceId==='steam')?.candidate?.steamAppId||matches.find(match=>match?.sourceId==='steam')?.candidate?.id||'');
  const portraitUrls=steamRelevant&&/^\d+$/.test(appid)?await steamLibraryPortraits(appid):[];
  for(const portrait of portraitUrls)extras.push({coverPortrait:portrait,metadataSource:'Steam',fieldSources:{coverPortrait:'Steam'},_sourceId:'steam'});
  const currentPortrait=String(entry.networkCovers?.coverPortrait||entry.coverPortrait||''),legacyPortrait=/^\d+$/.test(appid)&&SteamLibraryArt.legacyPortraitAppId(currentPortrait)===appid;
  // When a legacy Steam URL is present, let verified current assets compete
  // from an empty slot; keep the old value only if no usable replacement wins.
  const base=legacyPortrait&&portraitUrls.length?{...entry,coverPortrait:'',fieldSources:{...(entry.fieldSources||{})}}:entry;
  const result=await CoverCompletion.complete(base,matches,inspectMetadataCover,extras);
  if(legacyPortrait&&portraitUrls.length&&!result.coverPortrait&&entry.coverPortrait){result.coverPortrait=entry.coverPortrait;result.fieldSources={...(result.fieldSources||{}),...(entry.fieldSources?.coverPortrait?{coverPortrait:entry.fieldSources.coverPortrait}:{})};}
  return result;
}

async function fetchJson(url, timeoutMs = 10000, options = {}) {
  return MetadataRuntime.cached('json:'+url+':'+(options.body||''),()=>steamRequestPolicy.run(url,()=>fetchJsonUncached(url,timeoutMs,options)),{accept:value=>value!==null&&!value?.errors&&!value?.error});
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
  return MetadataRuntime.cached('text:'+url,()=>steamRequestPolicy.run(url,()=>fetchTextUncached(url,timeoutMs),''),{accept:value=>Boolean(value)&&!/cf-chl-|Just a moment|机器人验证|访问异常/i.test(value)});
}
async function fetchTextUncached(url, timeoutMs = 10000) {
  if(new URL(url).hostname.toLowerCase()==='zh.zlib.bz'){
    let current=new URL(url),deadline=Date.now()+timeoutMs;
    for(let redirects=0;redirects<=3;redirects++){
      if(current.protocol!=='https:'||current.hostname.toLowerCase()!=='zh.zlib.bz'||current.username||current.password||current.port){MetadataNetwork.fail(403,'',url);return '';}
      const remaining=deadline-Date.now();if(remaining<100)return '';
      try{
        const response=await fetch(current.href,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UnifiedManager/2.0',Accept:'text/html,*/*'},signal:MetadataRuntime.combine(AbortSignal.timeout(remaining),MetadataRuntime.signal())});
        if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location){MetadataNetwork.fail(response.status,'',url);return '';}const next=new URL(location,current);if(next.protocol!=='https:'||next.hostname.toLowerCase()!=='zh.zlib.bz'||next.username||next.password||next.port){MetadataNetwork.fail(403,'',url);return '';}current=next;continue;}
        return await MetadataNetwork.readResponse(response,url,true);
      }catch(error){MetadataRuntime.check();MetadataNetwork.transportFailure(error,url);return '';}
    }
    MetadataNetwork.fail(0,'',url);return '';
  }
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

async function fetchMetadataJson(url, timeoutMs = 10000, options = {}, sourceId = '') {
  url=metadataSourceLocations.rewrite(sourceId,url);
  const key = 'metadata-json:'+url+':'+(options.method||'GET')+':'+(options.body||'')+':'+JSON.stringify(options.headers||{});
  return MetadataRuntime.cached(key,()=>steamRequestPolicy.run(url,()=>fetchMetadataJsonUncached(url,timeoutMs,options)),{accept:value=>value!==null&&!value?.errors&&!value?.error});
}
async function fetchMetadataJsonUncached(url, timeoutMs = 10000, options = {}) {
  if (/(?:^|\.)(?:playstation\.com|egdata\.app|nintendo\.(?:com|jp)|nintendo-europe\.com|bgm\.tv|douban\.com|tvmaze\.com|jikan\.moe|openlibrary\.org|anilist\.co|itunes\.apple\.com|wikidata\.org|kitsu\.io|googleapis\.com)$/.test(new URL(url).hostname)) {
    return require('./native-json').nativeJson((input,init={})=>getMetadataHttpSession().fetch(input,{...init,credentials:'include'}),url,timeoutMs,options);
  }
  const requestSignal=MetadataRuntime.combine(AbortSignal.timeout(Math.max(100,timeoutMs)),MetadataRuntime.signal(),options.signal);
  try {
    const response=await getMetadataHttpSession().fetch(url,{method:options.method||'GET',...(options.body!==undefined?{body:options.body}:{}),credentials:'include',headers:{Accept:'application/json,text/plain,*/*',...options.headers},signal:requestSignal});
    return await MetadataNetwork.readResponse(response,url);
  } catch(error) {
    if(MetadataRuntime.signal()?.aborted)MetadataRuntime.check();
    if(requestSignal.aborted){MetadataNetwork.transportFailure(requestSignal.reason||error,url);return null;}
    MetadataNetwork.transportFailure(error,url);return null;
  }
}
async function fetchMetadataText(url, timeoutMs = 10000, sourceId = '', diagnosticContext = null) {
  url=metadataSourceLocations.rewrite(sourceId,url);
  return MetadataRuntime.cached('metadata-text:'+url,()=>steamRequestPolicy.run(url,()=>fetchMetadataTextUncached(url,timeoutMs,sourceId,diagnosticContext),''),{accept:value=>Boolean(value)&&!MetadataNetwork.isVerificationPage(value)});
}
async function fetchMetadataTextUncached(url, timeoutMs = 10000, sourceId = '', diagnosticContext = null) {
  const parsed=new URL(url),headers={Accept:'text/html,*/*'};
  const diagnostic=['onelib','zlibrary'].includes(sourceId)&&diagnosticContext?.log,log=(phase,fields={})=>{if(diagnostic)diagnosticContext.log({phase,operation:diagnosticContext.operation||'search',requestUrl:url,verified:Boolean(metadataSourceLocations.isVerified(sourceId)),...fields});};
  const contentType=response=>String(response?.headers?.get?.('content-type')||'').split(';')[0].trim().slice(0,120);
  const verification=(body,title='')=>{const verificationHit=MetadataNetwork.isVerificationPage(body);return {verificationHit,verificationReason:verificationHit?require('./metadata-book-diagnostics').verificationReason(body,title):''};};
  const timeoutError=(error,signal)=>/timeout/i.test(String(error?.name||''))||/timeout/i.test(String(signal?.reason?.name||''))||/timed out/i.test(String(error?.message||''));
  if(sourceId==='onelib'){
    const requestSignal=MetadataRuntime.combine(AbortSignal.timeout(Math.max(100,timeoutMs)),MetadataRuntime.signal());
    const requestStartedAt=Date.now();log('http.start',{requestMode:'electron-session-fetch',method:'GET',timeoutMs});
    try{
      const response=await getMetadataHttpSession().fetch(url,{credentials:'include',headers,signal:requestSignal});
      const finalUrl=response.url||url;metadataSourceLocations.record(sourceId,parsed.hostname,finalUrl);
      const observed={};const body=await MetadataNetwork.readResponse(response,url,true,value=>{Object.assign(observed,value);if(value.verificationHit)metadataSourceLocations.record(sourceId,parsed.hostname,value.finalUrl,{verified:false});});log('http.end',{status:response.status,durationMs:Date.now()-requestStartedAt,finalUrl:observed.finalUrl||finalUrl,contentType:contentType(response),bodyLength:observed.bodyLength??String(body||'').length,verificationHit:Boolean(observed.verificationHit),verificationReason:observed.verificationReason||''});return body;
    }catch(error){const runtimeAborted=Boolean(MetadataRuntime.signal()?.aborted),actual=requestSignal.reason||error,isTimeout=timeoutError(actual,requestSignal),fields={durationMs:Date.now()-requestStartedAt,timeoutMs,errorName:actual?.name||error?.name||'Error',errorMessage:actual?.message||error?.message||''};log(isTimeout?'http.timeout':'http.error',{...fields,...(isTimeout?{timeoutLayer:'http'}:{})});if(runtimeAborted)MetadataRuntime.check();MetadataNetwork.transportFailure(actual,url);return '';}
  }
  if(sourceId==='zlibrary'){
    // The parser has already constrained this request to its selected book
    // source host. Honor that active host when automatically switching from a
    // stale mirror; the Electron session still supplies the matching cookies.
    const allowedOrigin=parsed.origin;
    let current=parsed,deadline=Date.now()+Math.max(100,timeoutMs);
    for(let redirects=0;redirects<=3;redirects++){
      if(current.protocol!=='https:'||current.origin!==allowedOrigin||current.username||current.password||current.port){log('http.error',{durationMs:0,errorName:'UnsafeRedirectError',errorMessage:'请求地址超出书源允许范围'});MetadataNetwork.fail(403,'',url);return '';}
      const remaining=deadline-Date.now();if(remaining<100){log('http.timeout',{durationMs:timeoutMs,timeoutMs,timeoutLayer:'http',errorName:'TimeoutError',errorMessage:'已超过书源请求时间限制'});return '';}
      const requestSignal=MetadataRuntime.combine(AbortSignal.timeout(remaining),MetadataRuntime.signal()),requestStartedAt=Date.now();
      try{
        log('http.start',{requestMode:'electron-session-fetch-manual-redirect',method:'GET',timeoutMs:remaining,redirectIndex:redirects});
        const response=await getMetadataHttpSession().fetch(current.href,{redirect:'manual',credentials:'include',headers,signal:requestSignal});
        if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location){log('http.end',{status:response.status,durationMs:Date.now()-requestStartedAt,finalUrl:current.href,contentType:contentType(response),bodyLength:0});MetadataNetwork.fail(response.status,'',url);return '';}const next=new URL(location,current);log('http.redirect',{redirectIndex:redirects+1,redirectFromUrl:current.href,redirectToUrl:next.href,status:response.status});log('http.end',{status:response.status,durationMs:Date.now()-requestStartedAt,finalUrl:current.href,contentType:contentType(response),bodyLength:0});if(next.protocol!=='https:'||next.origin!==allowedOrigin||next.username||next.password||next.port){log('http.error',{durationMs:0,errorName:'UnsafeRedirectError',errorMessage:'重定向地址超出书源允许范围'});MetadataNetwork.fail(403,'',url);return '';}current=next;continue;}
        metadataSourceLocations.record(sourceId,parsed.hostname,current.href);
        const observed={};const body=await MetadataNetwork.readResponse(response,url,true,value=>{Object.assign(observed,value);if(value.verificationHit)metadataSourceLocations.record(sourceId,parsed.hostname,value.finalUrl,{verified:false});});log('http.end',{status:response.status,durationMs:Date.now()-requestStartedAt,finalUrl:observed.finalUrl||current.href,contentType:contentType(response),bodyLength:observed.bodyLength??String(body||'').length,verificationHit:Boolean(observed.verificationHit),verificationReason:observed.verificationReason||''});return body;
      }catch(error){const runtimeAborted=Boolean(MetadataRuntime.signal()?.aborted),actual=requestSignal.reason||error,isTimeout=timeoutError(actual,requestSignal),fields={durationMs:Date.now()-requestStartedAt,timeoutMs,errorName:actual?.name||error?.name||'Error',errorMessage:actual?.message||error?.message||''};log(isTimeout?'http.timeout':'http.error',{...fields,...(isTimeout?{timeoutLayer:'http'}:{})});if(runtimeAborted)MetadataRuntime.check();MetadataNetwork.transportFailure(actual,url);return '';}
    }
    MetadataNetwork.fail(0,'',url);log('http.error',{durationMs:timeoutMs,errorName:'RedirectLimitError',errorMessage:'重定向次数达到限制'});return '';
  }
  const requestSignal=MetadataRuntime.combine(AbortSignal.timeout(Math.max(100,timeoutMs)),MetadataRuntime.signal());
  try{
    const response=await getMetadataHttpSession().fetch(url,{credentials:'include',headers,signal:requestSignal});
    return await MetadataNetwork.readResponse(response,url,true);
  }catch(error){if(MetadataRuntime.signal()?.aborted)MetadataRuntime.check();MetadataNetwork.transportFailure(requestSignal.reason||error,url);return '';}
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
const steamAppDetailCache=new Map();
let steamCacheRevision=0;
const networkCache=require('./network-cache').create({session:()=>require('electron').session.defaultSession,metadata:MetadataRuntime,steam:{size:()=>Buffer.byteLength(JSON.stringify([...steamGameCache]))+Buffer.byteLength(JSON.stringify([...steamAppDetailCache])),clear:()=>{steamCacheRevision++;steamGameCache.clear();steamAppDetailCache.clear();}}});
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
async function steamPagedSearch(query, country = 'hk', start = 0) {
  const page=await fetchJson('https://store.steampowered.com/search/results/?term='+encodeURIComponent(query)+'&category1=998&start='+Math.max(0,Number(start)||0)+'&count=50&infinite=1&l=schinese&cc='+country,9000);
  const rows=[...(page?.results_html||'').matchAll(/<a\b[^>]*data-ds-appid="(\d+)"[^>]*>([\s\S]*?)<\/a>/g)];
  return rows.map(match=>({id:match[1],name:MetadataText.text(match[2].match(/<span[^>]*class="title"[^>]*>([\s\S]*?)<\/span>/)?.[1]||''),tiny_image:match[2].match(/<img[^>]*src="([^"]+)"/i)?.[1]||''}));
}
async function steamSearch(query,emit=()=>{},usFallbackBudget={used:false}) {
  const found=new Map(),publish=async records=>{
    for(const row of records||[]){const id=String(row.id||row.appid||'');if(!/^\d+$/.test(id)||!row.name)continue;const name=MetadataText.text(row.name),old=found.get(id);found.set(id,old?{...row,...old,id,name:old.name||name,tiny_image:old.tiny_image||row.tiny_image||''}:{...row,id,name});}
    const ordered=SteamSearchResults.preserveCandidateOrder([...found.values()]).map(row=>({id:row.id,steamAppId:row.id,name:row.name,aliases:row.aliases||[],cover:row.tiny_image||'',coverLandscape:row.tiny_image||'',type:'game',platforms:['steam'],storeUrl:'https://store.steampowered.com/app/'+encodeURIComponent(row.id)+'/',metadataSource:'Steam',ratingSource:'Steam'}));
    if(ordered.length)emit(ordered);return ordered;
  };
  const hasRelevant=items=>items.some(entry=>steamRelevance(entry,query)>=80);
  const searchRegion=async country=>{
    const suggestions=await steamSuggestSearch(query,country).catch(()=>[]);
    let ordered=await publish(suggestions);
    // Suggestions are the fast path. Only fetch the region's full results page
    // when suggestions did not return a sufficiently relevant game.
    if(!hasRelevant(ordered)){
      try{ordered=await publish(await steamPagedSearch(query,country));}
      catch{MetadataRuntime.check();}
    }
    return ordered;
  };
  let ordered=await searchRegion('hk');
  if(hasRelevant(ordered)||usFallbackBudget.used)return ordered;
  // Keep HK candidates visible while allowing one US supplement across all
  // title aliases in this search.
  usFallbackBudget.used=true;
  ordered=await searchRegion('us');
  return ordered;
}

function decodeSteamHtml(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
async function steamSuggestSearch(query,country='hk') {
  const html = await fetchText(`https://store.steampowered.com/search/suggest?term=${encodeURIComponent(query)}&f=games&cc=${String(country).toUpperCase()}&l=schinese`, 7000).catch(() => '');
  if (!html) return [];
  const list = []; const re = /<a[^>]*data-ds-appid="(\d+)"[^>]*>[\s\S]*?<div class="match_name">([\s\S]*?)<\/div>[\s\S]*?<img[^>]*src="([^"]+)/gi; let match;
  while ((match = re.exec(html)) && list.length < 10) list.push({ id: match[1], name: decodeSteamHtml(match[2].replace(/<[^>]+>/g, '').trim()), tiny_image: match[3] });
  return list;
}

async function steamAppDetailsBatch(appids) {
  const ids=[...new Set((appids||[]).map(value=>String(value||'')).filter(value=>/^\d+$/.test(value)))],result=new Map(),missing=[];
  for(const id of ids){const cached=steamAppDetailCache.get(id);if(cached&&cached.expires>Date.now())result.set(id,structuredClone(cached.detail));else{steamAppDetailCache.delete(id);missing.push(id);}}
  const remember=(id,detail)=>{steamAppDetailCache.set(id,{detail:structuredClone(detail),expires:Date.now()+300000});while(steamAppDetailCache.size>900)steamAppDetailCache.delete(steamAppDetailCache.keys().next().value);result.set(id,detail);};
  for(let offset=0;offset<missing.length;offset+=40){
    const batch=missing.slice(offset,offset+40),url=(values,country)=>`https://store.steampowered.com/api/appdetails?appids=${values.join(',')}&l=schinese&cc=${country}`;
    let response=await fetchJson(url(batch,'cn'),9000)||{};
    const retry=batch.filter(id=>!response?.[id]?.success);
    if(retry.length){const fallback=await fetchJson(url(retry,'us'),9000);if(fallback)response={...response,...fallback};}
    for(const id of batch)if(response?.[id]?.success&&response[id].data&&typeof response[id].data==='object')remember(id,response[id].data);
  }
  return result;
}
async function steamAppDetails(appid) {
  return (await steamAppDetailsBatch([appid])).get(String(appid))||null;
}
async function steamLibraryPortraits(appid){
  const id=String(appid||'');if(!/^\d{1,12}$/.test(id))return [];
  const cached=steamArtworkCache.get(id);if(cached?.promise)return cached.promise;if(cached&&cached.expires>Date.now())return cached.urls|| (cached.url?[cached.url]:[]);
  const promise=(async()=>{try{
    const SteamLibraryArt=require('./steam-library-art'),url=SteamLibraryArt.requestUrl(id);if(!url)return [];
    const response=await fetchJson(url,6500),urls=SteamLibraryArt.portraitCandidates(response,id).get(id)||[];
    steamArtworkCache.set(id,{url:urls[0]||'',urls,expires:Date.now()+(urls.length?60*60_000:2*60_000)});
    while(steamArtworkCache.size>500)steamArtworkCache.delete(steamArtworkCache.keys().next().value);
    return urls;
  }catch{MetadataRuntime.check();steamArtworkCache.set(id,{url:'',urls:[],expires:Date.now()+2*60_000});return [];}})();
  steamArtworkCache.set(id,{promise,expires:Date.now()+8000});return promise;
}
async function steamByAppId(appid,knownDetail=null) {
  const detail = knownDetail || await steamAppDetails(appid);
  if (!detail || String(detail.type||'').toLowerCase() !== 'game' || /\b(demo|soundtrack|season pass|expansion pass|mod organizer|resolution pack|benchmark)\b|扩充通票|原声带|试玩版/i.test(detail.name || '')) return [];
  const [review,hours] = await Promise.all([steamReviewData(appid),steamPlaytime(appid)]); const reviewLabel = review.label;
  return [{
    id: appid, steamAppId:String(appid), platforms:['steam'],
    name: detail.name || `Steam ${appid}`,
    cover: detail.header_image || '',
    coverLandscape: detail.header_image || '',
    genres: (detail.genres || []).map((genre) => genre.description),
    developer: (detail.developers || []).join('、'),
    publisher: (detail.publishers || []).join('、'),
    releaseDate: detail.release_date?.date || '',
    steamRating: reviewLabel,
    externalRating: reviewLabel,
    ratingSource: review.ratingSource, ratingValue: review.ratingValue, ratingMax: review.ratingMax,
    fieldSources: { name:'Steam',description:'Steam',developer:'Steam',publisher:'Steam',releaseDate:'Steam',genres:'Steam',cover:'Steam',coverLandscape:'Steam',externalRating:'Steam',storeUrl:'Steam',platforms:'Steam',steamAppId:'Steam' },
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
        results=[{id:appid,steamAppId:appid,name:'Steam AppID '+appid,platforms:['steam'],storeUrl:'https://store.steampowered.com/app/'+appid+'/',metadataSource:'Steam',ratingSource:'Steam'}];
        emit(results);
      } else {
        const terms=gameSearchTerms(raw),partial=new Map(),publish=entries=>{for(const entry of entries||[]){const id=String(entry?.id||entry?.steamAppId||'');if(/^\d+$/.test(id)&&entry?.name&&!partial.has(id))partial.set(id,{...entry,id});}emit([...partial.values()]);};
        const usFallbackBudget={used:false};
        for(const term of terms.slice(0,3)){
          const batch=await steamSearch(term,publish,usFallbackBudget).catch(error=>{MetadataRuntime.check();return [];});
          publish(batch);results=[...partial.values()].slice(0,40);
          if(results.length)break;
        }
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
  if(type==='game'&&/^appid:\d+$/i.test(query)&&(!Array.isArray(options.sourceIds)||options.sourceIds.includes('steam'))){
    const context={runId:randomUUID(),sourceId:'steam',mediaType:'game',operation:'search',query,queryLength:query.length},started=Date.now();metadataDiagnosticLog.write({...context,phase:'source.start',verified:false});
     try{const items=await metadataSearchSteam(type,query),bundle={integrated:items,sources:[{id:'steam',label:'Steam',items,state:items.length?'ok':'empty'}],loading:false};options.onProgress?.(bundle);metadataDiagnosticLog.write({...context,phase:items.length?'source.success':'source.empty',status:items.length?'ok':'empty',durationMs:Date.now()-started,requestCount:1,resultCount:items.length,verified:false});return bundle;}
    catch(error){metadataDiagnosticLog.write({...context,phase:'source.failed',status:'failed',durationMs:Date.now()-started,requestCount:1,resultCount:0,errorName:error?.name||'Error',errorMessage:error?.message||''});throw error;}
  }
  return type==='game'?gameSources.search(query,options):sourceSearch.search(type,query,options);
}
async function prepareMetadataCandidate(candidate) {
  if(!candidate||typeof candidate!=='object')return null;
  return {...MetadataText.candidate(candidate),...await materializeCandidateCovers(candidate)};
}
async function resolveMetadataCandidate(candidate) {
  if(!candidate||typeof candidate!=='object')return null;
  if(candidate._sourceId==='steam'||candidate.sourceId==='steam'||/Steam/i.test(candidate.metadataSource||'')&&/^\d+$/.test(String(candidate.steamAppId||candidate.id||''))){
    const id=String(candidate.steamAppId||candidate.id||'');if(!/^\d+$/.test(id))return candidate;
    const context={runId:randomUUID(),sourceId:'steam',mediaType:'game',operation:'resolve',query:candidate.name||'',queryLength:String(candidate.name||'').length},started=Date.now();metadataDiagnosticLog.write({...context,phase:'source.start',verified:false});
    const outcome=await SteamCandidateResolution.resolveOrKeep(candidate,async()=>{
      const storeDetail=await steamAppDetails(id);if(!storeDetail||String(storeDetail.type||'').toLowerCase()!=='game')return null;
      const detail=(await steamByAppId(id,storeDetail))[0];if(!detail)return null;
      return {...candidate,...detail,id,steamAppId:id,platforms:['steam'],metadataSource:candidate.integrated?(candidate.metadataSource||'Steam'):'Steam',fieldSources:{...(candidate.fieldSources||{}),...(detail.fieldSources||{})}};
    });
    const phase=outcome.detailed?'source.success':outcome.error?'source.failed':'source.empty';
    metadataDiagnosticLog.write({...context,phase,status:outcome.detailed?'ok':outcome.error?'partial':'details-unavailable',durationMs:Date.now()-started,requestCount:1,resultCount:1,verified:false,errorName:outcome.error?.name||'',errorMessage:outcome.error?.message||''});
    let resolved=outcome.value;
    if(candidate.integrated&&Array.isArray(candidate._matchedCandidates)&&candidate._matchedCandidates.length){
      const merged=await SteamCandidateResolution.resolveOrKeep(resolved,()=>gameSources.resolveCandidate?.(resolved));
      resolved=merged.value;
    }else resolved=await completeMetadataCovers(resolved,candidate);
    return resolved;
  }
  if(candidate.mediaType==='game'||candidate.type==='game')return await gameSources.resolveCandidate?.(candidate)||candidate;
  return await sourceSearch.resolveCandidate(candidate)||candidate;
}

// Legacy bridge uses the same read-only pipeline; no separate EXE-first scanner.
async function scanLocalGames(paths) {
  const result=await require('./local-scanner').scan((paths||[]).filter(p=>typeof p==='string'&&path.isAbsolute(p)).slice(0,80),'game',{existingItems:loadLibrary().items,requireGameExe:Boolean(loadSettings().scanGamesRequireExe),rules:require('./scan-rules').read(app.getPath('userData'))});
  return [...result.items,...result.pending];
}

async function refreshItemMetadata(item) {
  if(!['game','movie','anime','manga','book'].includes(item.type||'game'))return item;
  const type=item.type||'game',appid=String(item.steamAppId||''),query=String(item.name||'').trim()||(type==='game'&&/^\d+$/.test(appid)?'appid:'+appid:'');
  const settings=loadSettings(),defaults={game:'steam',movie:'douban',anime:'bangumi',manga:'bangumi',book:'douban'},available={game:['steam','bangumi','nintendo','playstation','epic','dlsite'],movie:['douban','bangumi','tvmaze','itunes','seedhub','wikidata'],anime:['bangumi','douban','myanimelist','anilist','kitsu','seedhub'],manga:['douban','bangumi','openlibrary','googlebooks','myanimelist','anilist','kitsu'],book:['douban','bangumi','openlibrary','googlebooks','tstrs','onelib','zlibrary']};
  const configured=String(settings?.metadataPrimarySourceByType?.[type]||defaults[type]),primary=available[type].includes(configured)?configured:defaults[type],sourceIds=[primary];
  if(type==='game'&&!item.platformsManual&&primary!=='bangumi'&&!/^appid:\d+$/i.test(query))sourceIds.push('bangumi');
  const bundle=await metadataSearchSources(type,query,{sourceIds}),candidate=refreshMatch(item,bundle?.integrated||[]);if(!candidate)return item;
  let detail=await resolveMetadataCandidate(candidate);if(!detail)return item;
  if(type==='game'&&!item.platformsManual&&!candidate._matchedCandidates?.some(match=>match?.sourceId==='bangumi')){
    const bangumiCandidate=refreshMatch(item,bundle?.sources?.find(source=>source.id==='bangumi')?.items||[]);
    if(bangumiCandidate){try{const extra=await resolveMetadataCandidate(bangumiCandidate);if(extra){const platforms=[...new Set([...PlatformModel.detect(detail),...PlatformModel.detect(extra)])];if(platforms.length>PlatformModel.detect(detail).length){detail={...detail,platforms,fieldSources:{...(detail.fieldSources||{}),platforms:extra.fieldSources?.platforms||extra.metadataSource||'Bangumi'}};}}}catch{MetadataRuntime.check();}}
  }
  if(type!=='game'){
    const present=value=>Array.isArray(value)?value.length>0:value!==null&&value!==undefined&&value!=='';
    const plans={
      movie:[{id:(detail.scope||item.scope)==='series'?'tvmaze':'itunes',fields:(detail.scope||item.scope)==='series'?['cast','episodes','developer','description']:['description','genres','releaseDate']},{id:'wikidata',fields:['cast','developer','publisher','releaseDate','genres']}],
      anime:[{id:'anilist',fields:['description','developer','cast','episodes','genres','releaseDate']}],
      manga:[{id:'anilist',fields:['description','genres','releaseDate']}],
      book:[{id:'googlebooks',fields:['isbn','pages','publisher','description','releaseDate','genres']}]
    }[type]||[];
    const LocalModel=require('./local-model');
    for(const plan of plans){
      if(plan.id===primary)continue;
      const needed=plan.fields.filter(key=>!present(item[key])&&!present(detail[key]));if(!needed.length)continue;
      try{
        const supplement=await metadataSearchSources(type,query,{sourceIds:[plan.id]}),match=refreshMatch(item,supplement?.integrated||[]);if(!match)continue;
        const extra=await resolveMetadataCandidate(match);if(!extra)continue;
        const before={...detail},merged=LocalModel.fillMissing(detail,extra);merged.fieldSources={...(detail.fieldSources||{})};let filled=false;
        for(const key of needed)if(!present(before[key])&&present(merged[key])){merged.fieldSources[key]=extra.fieldSources?.[key]||extra.metadataSource||plan.id;filled=true;}
        if(filled){merged.metadataSource=[...new Set([...String(detail.metadataSource||'').split(/\s+\+\s+/),...String(extra.metadataSource||'').split(/\s+\+\s+/)].filter(Boolean))].join(' + ');detail=merged;}
      }catch{MetadataRuntime.check();}
    }
  }
  const next=require('./local-model').fillMissing(item,detail),SteamLibraryArt=require('./steam-library-art');
  next.playedPlatforms=PlatformModel.normalizeMany(item.playedPlatforms);
  if((item.type||'game')==='game'&&!item.platformsManual){next.platforms=[...new Set([...PlatformModel.detect(item),...PlatformModel.detect(detail)])];next.platformsExplicit=false;}
  const existingPortrait=String(item.networkCovers?.coverPortrait||item.coverPortrait||''),legacySteamPortrait=/^\d+$/.test(appid)&&SteamLibraryArt.legacyPortraitAppId(existingPortrait)===appid;
  if(legacySteamPortrait&&detail.coverPortrait&&!SteamLibraryArt.legacyPortraitAppId(detail.coverPortrait)){
    next.coverPortrait=detail.coverPortrait;next.networkCovers={...(next.networkCovers||{}),coverPortrait:/^https?:\/\//i.test(detail.networkCovers?.coverPortrait||detail.coverPortrait)?(detail.networkCovers?.coverPortrait||detail.coverPortrait):''};
  }
  for(const key of ['steamRating','externalRating','steamPositivePercent','ratingSource','ratingValue','ratingMax'])if(detail[key]!==undefined&&detail[key]!==null&&detail[key]!=='')next[key]=detail[key];
  const changed=Object.keys(next).filter(key=>JSON.stringify(next[key])!==JSON.stringify(item[key]));
  if(!changed.length)return item;next.fieldSources={...item.fieldSources};
  for(const key of changed)next.fieldSources[key]=detail.fieldSources?.[key]||detail.metadataSource||'';
  next.autoMetadataAt=new Date().toISOString();return normaliseItem(next);
}

function backupRoot() { return path.join(app.getPath('userData'), 'save-backups'); }
const saveSnapshots = require('./save-snapshots').create(backupRoot());
let savePathManifestPromise=null,savePathManifestLoadedAt=0;
const saveSyncIndexFile=()=>path.join(app.getPath('userData'),'save-backup-sync.json');
function readSaveSyncStore(){try{const value=JSON.parse(fs.readFileSync(saveSyncIndexFile(),'utf8'));return value&&typeof value==='object'?value:{schemaVersion:2,endpoints:{}}}catch{return {schemaVersion:2,endpoints:{}}}}
function currentSaveEndpointKey(settings=loadSettings()){try{return webdavSyncEndpointKey(settings)}catch{return ''}}
function readSaveSyncIndex(endpointKey=currentSaveEndpointKey()){if(!/^[a-f0-9]{64}$/i.test(endpointKey||''))return {};const store=readSaveSyncStore();return store.schemaVersion===2&&store.endpoints?.[endpointKey]&&typeof store.endpoints[endpointKey]==='object'?store.endpoints[endpointKey]:{}}
function writeSaveSyncIndex(value,endpointKey=currentSaveEndpointKey()){if(!/^[a-f0-9]{64}$/i.test(endpointKey||''))return;const old=readSaveSyncStore(),endpoints=old.schemaVersion===2&&old.endpoints&&typeof old.endpoints==='object'?{...old.endpoints}:{};endpoints[endpointKey]=value;const file=saveSyncIndexFile(),temporary=file+'.tmp-'+randomBytes(4).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify({schemaVersion:2,endpoints},null,2),'utf8');fs.renameSync(temporary,file);}
function markSaveSyncedBatch(rows=[],endpointKey=currentSaveEndpointKey()){
  if(!endpointKey)return;
  const index=readSaveSyncIndex(endpointKey),at=new Date().toISOString();
  for(const row of rows||[]){const snapshot=row?.snapshot||row?.entry||row,id=String(snapshot?.id||''),manifestHash=snapshot?.manifestHash||snapshot?.manifestRevision;if(!id||!manifestHash)throw Error('无法确认存档同步状态：快照缺少 ID 或修订号');index[id]={...(index[id]||{}),...(row?.verification||row?.result?.verification||{}),manifestHash,at};}
  writeSaveSyncIndex(index,endpointKey);
}
function markSaveSynced(id,manifestHash,verification={},endpointKey=currentSaveEndpointKey()){markSaveSyncedBatch([{snapshot:{id,manifestHash},verification}],endpointKey);}
function clearSaveSynced(id,endpointKey=currentSaveEndpointKey()){if(!endpointKey)return;const index=readSaveSyncIndex(endpointKey);if(!Object.prototype.hasOwnProperty.call(index,id))return;delete index[id];writeSaveSyncIndex(index,endpointKey);}
function forgetSaveSync(ids){const store=readSaveSyncStore(),endpoints=store.schemaVersion===2&&store.endpoints&&typeof store.endpoints==='object'?{...store.endpoints}:{};for(const [key,index] of Object.entries(endpoints))for(const id of ids)delete index[id];const file=saveSyncIndexFile(),temporary=file+'.tmp-'+randomBytes(4).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify({schemaVersion:2,endpoints},null,2),'utf8');fs.renameSync(temporary,file);}
function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full)); else result.push(full);
  }
  return result;
}
async function backupSaves(itemId, paths, options = {}) { return require('./save-backup-sync').createLocalSnapshot(()=>saveSnapshots.backup(itemId,paths,options),async result=>{const entry=saveSnapshots.list(itemId).find(row=>row.folder===result.folder);result.snapshotId=entry?.id||'';try{if(entry)updateCachedLocalSaveCatalog({upsert:[entry]});else invalidateLocalSaveCatalog();}catch(error){webdavDiagnosticLog.write({event:'webdav.save-catalog.local-refresh.failed',operation:'save-backup',phase:'local-snapshot-created',error});}}); }
async function discoverSavePaths(item){
  const detector=require('./save-path-discovery');
  if(Array.isArray(item?.savePaths)&&item.savePaths.some(value=>String(value||'').trim()))return detector.resolveSavePaths(item);
  if(!savePathManifestPromise||Date.now()-savePathManifestLoadedAt>6*60*60*1000){savePathManifestLoadedAt=Date.now();savePathManifestPromise=detector.loadManifest(path.join(app.getPath('userData'),'save-path-database')).catch(error=>{savePathManifestPromise=null;throw error;});}
  const text=await savePathManifestPromise;
  return detector.resolveSavePaths(item,{manifestText:text,documents:app.getPath('documents'),registryRoots:detector.steamRegistryRoots()});
}
const persistSavePaths=require('./save-path-persistence').create({loadLibrary,normaliseItem,writeJson,dataFile});
function decorateBackup(entry,stored,index){const synced=index[entry.id]?.manifestHash===entry.manifestHash;return {...entry,syncStatus:synced?'已同步':(stored.webdavUrl?'待同步':'未配置云同步'),syncedAt:synced?index[entry.id].at:''};}
function listBackups(itemId) {
  const stored=loadSettings(),index=readSaveSyncIndex(currentSaveEndpointKey(stored));
  return saveSnapshots.list(itemId).map(entry=>decorateBackup(entry,stored,index));
}
function listAllBackups(){const stored=loadSettings(),index=readSaveSyncIndex(currentSaveEndpointKey(stored));return saveSnapshots.listAll(loadLibrary().items).map(entry=>decorateBackup(entry,stored,index));}
async function restoreBackup(itemId, backupId) { return saveSnapshots.restore(itemId, backupId); }
async function restoreRemoteBackup(settings,itemId,backupId){
  const catalog=await readRemoteSaveCatalog(settings);if(!catalog)throw Error('云端没有存档索引');
  const row=catalog.catalog.entries.find(entry=>entry.id===backupId);if(!row)throw Error('云端存档不存在或已删除');
  const manifest=await readRemoteSnapshotManifest(settings,row);if(!manifest||String(manifest.itemId||'')!==String(itemId))throw Error('云端存档不属于当前游戏');
  const current=loadLibrary().items.find(item=>item.id===itemId);if(!current)throw Error('游戏条目不存在');
  let paths=Array.isArray(current.savePaths)?current.savePaths.filter(Boolean):[];
  if(!paths.length){const detected=await discoverSavePaths(current);if(!detected.ok)throw Error(detected.message||'此设备尚未设置存档位置');paths=detected.paths;const saved=persistSavePaths(itemId,paths);if(!saved.ok)throw Error(saved.message);}
  const deviceId=syncDeviceId(),entries=manifest.entries||[];
  if(!entries.length)throw Error('云端存档清单没有可恢复内容');
  const mappedTargets=new Array(entries.length),usedTargets=new Set();
  for(let index=0;index<entries.length;index++){
    const devicePath=entries[index].sourceByDevice?.[deviceId];if(devicePath){mappedTargets[index]=devicePath;usedTargets.add(path.resolve(devicePath).toLowerCase());}
  }
  if(paths.length!==entries.length&&mappedTargets.some(value=>!value))throw Error(`此快照包含 ${entries.length} 个存档位置，但本机配置了 ${paths.length} 个；请在游戏条目中调整路径后重试`);
  for(let index=0;index<entries.length;index++){
    if(mappedTargets[index])continue;
    const label=String(entries[index].target||'').replace(/^\d+-/,'').toLocaleLowerCase();
    const matches=paths.filter(value=>!usedTargets.has(path.resolve(value).toLowerCase())&&path.basename(value).toLocaleLowerCase()===label);
    if(matches.length===1)mappedTargets[index]=matches[0];
  }
  for(let index=0;index<entries.length;index++){
    if(mappedTargets[index])continue;
    const remaining=paths.filter(value=>!usedTargets.has(path.resolve(value).toLowerCase()));
    if(entries.filter((_entry,i)=>!mappedTargets[i]).length===1&&remaining.length===1)mappedTargets[index]=remaining[0];
  }
  const mapped=entries.map((entry,index)=>{
    const target=mappedTargets[index];if(!target||!path.isAbsolute(target))throw Error('无法安全匹配此快照的多个存档位置；请在编辑器中按原备份目录名称设置对应位置');
    usedTargets.add(path.resolve(target).toLowerCase());
    return {...entry,source:target,sourceByDevice:{...(entry.sourceByDevice||{}),[deviceId]:target}};
  });
  const refs=require('./webdav-save-catalog').objectRefs(entries),expected=new Map(refs.map(info=>[info.object,info]));
  const rowRefs=Array.isArray(row.objects)?row.objects:[];
  if(JSON.stringify(refs)!==JSON.stringify(rowRefs.map(info=>({object:info.object,sha256:info.sha256,size:Number(info.size),storedSize:Number(info.storedSize),encoding:info.encoding})).sort((a,b)=>a.object.localeCompare(b.object))))throw Error('云端存档索引与文件清单的数据块不一致');
  const snapshotFolder=syncSavePath(backupId),manifestFile=path.join(snapshotFolder,'manifest.json');
  const downloadObject=async(info)=>{
    const target=syncObjectPath(info.object);if(await require('./save-snapshots').verifyObjectFile(info,target))return false;
    const response=await webdavRequest(settings,'GET','saves/'+info.object);
    if(response.status===404){await response.body?.cancel();throw Error('云端缺少存档数据块：'+info.object);}
    if(!response.ok){const status=response.status;await response.body?.cancel();throw Error('下载存档数据块失败（HTTP '+status+'）：'+info.object);}
    const temp=target+'.restore-'+randomBytes(4).toString('hex')+'.tmp';fs.mkdirSync(path.dirname(target),{recursive:true});
    try{
      const stream=response.body?.getReader?Readable.fromWeb(response.body):response.body;
      if(!stream)throw Error('云端返回了空的存档数据块');
      await pipeline(stream,fs.createWriteStream(temp,{flags:'wx'}),...(webdavOperationSignal?[{signal:webdavOperationSignal}]:[]));
      if(!await require('./save-snapshots').verifyObjectFile(info,temp))throw Error('云端存档数据块校验失败，未写入本地：'+info.object);
      fs.renameSync(temp,target);return true;
    }finally{fs.rmSync(temp,{force:true});}
  };
  const transfers=await mapWebdavBatch([...expected.values()],3,async info=>({downloaded:await downloadObject(info)}));
  const downloaded=transfers.filter(row=>row.downloaded).length;
  const localManifest={...manifest,entries:mapped};
  fs.mkdirSync(snapshotFolder,{recursive:true});const temporary=manifestFile+'.download-'+randomBytes(4).toString('hex')+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(localManifest,null,2),'utf8');fs.renameSync(temporary,manifestFile);}finally{fs.rmSync(temporary,{force:true});}
  saveSnapshots.refreshManifestIndex([manifestFile]);
  const result=await saveSnapshots.restore(itemId,backupId);
  return {...result,paths,downloaded,retainedLocally:true};
}
function recordDeletedSaveSnapshots(entries,library=loadLibrary()){
  const deletedAt=new Date().toISOString(),tombstones=new Map((library.deletedSaveSnapshots||[]).map(entry=>[entry.id,entry]));
  for(const entry of entries||[]){const id=String(entry?.id||entry?.backupId||''),itemId=String(entry?.itemId||'');if(id)tombstones.set(id,{id,itemId,deletedAt});}
  const rows=[...tombstones.values()],next={...library,...require('./library-relations').fields({...library,deletedSaveSnapshots:rows},normaliseItem)};
  writeJson(dataFile(),next);
  return {library:next,tombstones:rows};
}
async function publishDeletedSaveSnapshots(settings,entries,remoteState){
  const {library,tombstones}=recordDeletedSaveSnapshots(entries),endpointKey=webdavSyncEndpointKey(settings);
  const local=localSaveCatalog(endpointKey,library.items,tombstones);
  let remote=remoteState===undefined?await readRemoteSaveCatalog(settings):remoteState;
  if(!remote)remote={catalog:require('./webdav-save-catalog').create(),etag:'',byteLength:null};
  const published=await publishRemoteSaveCatalog(settings,local,'upload',remote,row=>webdavDiagnosticLog.write(row));
  const index=readSaveSyncIndex(endpointKey);index.catalog={...(index.catalog||{}),localRevision:local.revision,localCatalog:local,remoteRevision:published.catalog.revision,etag:published.etag||'',remoteLength:published.byteLength??null,lastModified:published.lastModified||''};writeSaveSyncIndex(index,endpointKey);
  return {library,tombstones,local,published};
}
async function deleteRemoteBackup(settings,itemId,backupId){
  const remote=await readRemoteSaveCatalog(settings);if(!remote)throw Error('云端没有存档索引');
  const row=remote.catalog.entries.find(entry=>entry.id===backupId);if(!row)throw Error('云端存档不存在或已删除');
  const manifest=await readRemoteSnapshotManifest(settings,row);if(!manifest||String(manifest.itemId||row.metadata?.itemId||'')!==String(itemId))throw Error('云端存档不属于当前游戏');
  await publishDeletedSaveSnapshots(settings,[{id:backupId,itemId}],remote);
  const remove=require('./webdav-save-delete').create({listFiles:listWebdavFiles,request:(...args)=>webdavRequest(...args)});
  let cleanup;
  try{cleanup=await remove.deleteSnapshots(settings,[backupId]);}
  catch(error){webdavDiagnosticLog.write({event:'webdav.save-delete.cleanup-failed',operation:'delete',phase:'cleanup',snapshotId:backupId,error});return {ok:true,message:'已从云端列表删除；云端文件清理失败，后续同步会重试：'+error.message,deletedSnapshots:0,cleanupFailed:true};}
  return {ok:true,message:cleanup.cleanupFailed?'已从云端列表删除；部分无引用数据块未清理':'已删除云端存档',deletedSnapshots:cleanup.deletedSnapshots,cleanupFailed:cleanup.cleanupFailed};
}
async function deleteBackups(rows=[],syncCloud=false){
  const current=saveSnapshots.listAll(loadLibrary().items),known=new Map(current.map(entry=>[entry.id,entry]));
  const selected=[...new Map(rows.map(row=>{const id=String(row?.backupId||row?.id||'');const backup=known.get(id);return [id,backup&&backup.itemId===String(row?.itemId||'')?backup:null];}).filter(([,entry])=>entry)).values()];
  if(!selected.length)return {ok:false,message:'没有找到所选存档快照'};
  let remote=null,remoteCleanupError=null,cloudConfigured=false;
  if(syncCloud&&loadSettings().webdavUrl){cloudConfigured=true;const stored=loadSettings(),settings=secretSettings().resolve({},stored),remoteState=await readRemoteSaveCatalog(settings);await publishDeletedSaveSnapshots(settings,selected,remoteState);const remove=require('./webdav-save-delete').create({listFiles:listWebdavFiles,request:(...args)=>webdavRequest(...args)});try{remote=await remove.deleteSnapshots(settings,selected.map(entry=>entry.id));}catch(error){remoteCleanupError=error;webdavDiagnosticLog.write({event:'webdav.save-delete.cleanup-failed',operation:'delete',phase:'cleanup',snapshotIds:selected.map(entry=>entry.id),error});}}
  const local=saveSnapshots.removeMany(selected.map(entry=>({itemId:entry.itemId,backupId:entry.id})),loadLibrary().items);
  if(local.removed?.length)forgetSaveSync(local.removed.map(entry=>entry.id));
  if(syncCloud&&!cloudConfigured)recordDeletedSaveSnapshots(selected);
  if(local.removed?.length){try{updateCachedLocalSaveCatalog({allEntries:current.filter(entry=>!local.removed.some(row=>row.id===entry.id)),removeIds:local.removed.map(entry=>entry.id),tombstones:loadLibrary().deletedSaveSnapshots||[]});}catch{invalidateLocalSaveCatalog();}}
  if(!local.ok)return {ok:false,message:'部分本地快照未删除：'+local.failed.map(entry=>entry.message).join('；'),removed:local.removed||[]};
  if(!syncCloud)return {...local,message:'已删除 '+selected.length+' 份本地存档'};
  if(!cloudConfigured)return {...local,message:'未配置 WebDAV，已仅删除本地存档'};
  if(remoteCleanupError)return {...local,cleanupFailed:true,message:'本地与云端列表中的存档已删除；部分云端文件未清理，后续同步会重试：'+remoteCleanupError.message};
  if(!remote?.snapshotFound)return {...local,message:'已删除本地存档；云端目录中没有对应文件'};
  return {...local,message:remote.cleanupFailed?'已删除本地与云端快照；部分无引用数据块未能清理':'已删除本地与云端存档'};
}
async function deleteBackup(itemId,backupId,syncCloud=false){return deleteBackups([{itemId,backupId}],syncCloud);}

const webdavRequest=(...args)=>webdavClient.request(...args);
const ensureWebdavPath=settings=>webdavClient.ensurePath(settings);
const ensureWebdavDirectories=(settings,relative,knownDirectories)=>webdavClient.ensureDirectories(settings,relative,knownDirectories);
const listWebdavFiles=(settings,relative='saves')=>webdavClient.listFiles(settings,relative);
async function strongWebdavValidator(settings,relative){try{const value=await webdavClient.stat(settings,relative),etag=value.etag||'';return etag&&!etag.startsWith('W/')?{etag}:null;}catch{return null;}}
async function mapWebdavBatch(values,limit,work){
  const results=new Array(values.length);let cursor=0,failure=null;
  const workers=Array.from({length:Math.min(values.length,Math.max(1,Math.floor(limit)||1))},async()=>{
    while(!failure){const index=cursor++;if(index>=values.length)return;try{results[index]=await work(values[index],index);}catch(error){failure=failure||error;return;}}
  });
  await Promise.all(workers);if(failure)throw failure;return results;
}
function createSaveSyncContext(settings){
  const validatorRequests=new Map(),remoteObjectProofs=new Map(),localObjectProofs=new Map(),directoryRequests=new Map(),knownDirectories=new Set();
  const normalized=value=>String(value||'').split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).join('/');
  const objectSignature=info=>[info?.sha256,info?.size,info?.storedSize,info?.encoding].map(value=>String(value??'')).join('|');
  return {
    getValidator(relative){const key=normalized(relative);if(!validatorRequests.has(key))validatorRequests.set(key,strongWebdavValidator(settings,key));return validatorRequests.get(key);},
    rememberRemoteObject(object,proof,contentVerified=false){const key=normalized(object),sha256=String(proof?.sha256||''),etag=String(proof?.etag||'');if(!key||!sha256||!etag||etag.startsWith('W/'))return;const value={sha256,etag,contentVerified:Boolean(contentVerified)};remoteObjectProofs.set(key,value);validatorRequests.set('saves/'+key,Promise.resolve({etag}));},
    getRemoteObjectProof(object,sha256){const value=remoteObjectProofs.get(normalized(object));return value?.contentVerified&&value.sha256===String(sha256||'')?value:null;},
    isLocalObjectVerified(object,info){return localObjectProofs.get(normalized(object))===objectSignature(info);},
    rememberLocalObject(object,info){localObjectProofs.set(normalized(object),objectSignature(info));},
    async ensureDirectories(_settings,relative){let current='';for(const part of normalized(relative).split('/').filter(Boolean)){current+=(current?'/':'')+part;let pending=directoryRequests.get(current);if(!pending){pending=ensureWebdavDirectories(settings,current,knownDirectories);directoryRequests.set(current,pending);}await pending;}}
  };
}
async function syncedSnapshotStillValid(settings,entry,indexEntry,syncContext){
  if(indexEntry?.manifestHash!==entry.manifestHash||!indexEntry.manifestValidator?.etag)return false;
  const getValidator=syncContext?.getValidator||((relative)=>strongWebdavValidator(settings,relative));
  const manifest=await getValidator('saves/'+entry.id+'/manifest.json');
  if(!manifest||manifest.etag!==indexEntry.manifestValidator.etag)return false;
  const expected=new Map();for(const row of entry.entries||[])for(const file of row.files||[])if(file.object)expected.set(file.object,String(file.sha256||''));
  const recorded=indexEntry.objects||{};if(expected.size!==Object.keys(recorded).length)return false;
  const checks=await mapWebdavBatch([...expected.entries()],4,async([object,sha256])=>{
    const saved=recorded[object];if(!saved||saved.sha256!==sha256||!saved.etag)return false;
    const current=await getValidator('saves/'+object);if(!current||current.etag!==saved.etag)return false;
    syncContext?.rememberRemoteObject(object,saved);return true;
  });
  return checks.every(Boolean);
}
const SYNC_STATE_FILE='sync-state.json';
const SYNC_STATE_REQUEST_TIMEOUT_MS=6000;
const SYNC_STATE_STAT_TIMEOUT_MS=2500;
const syncDeviceIdFile=()=>path.join(app.getPath('userData'),'sync-device-id.json');
const syncLineageFile=()=>path.join(app.getPath('userData'),'sync-lineage.json');
function syncDeviceId(){const file=syncDeviceIdFile();try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof value?.id==='string'&&value.id.length>=16)return value.id;}catch{}const id=randomUUID();fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify({id}),'utf8');fs.renameSync(temporary,file);return id;}
function webdavSyncEndpointKey(settings){return require('./webdav-endpoint-key').key(settings);}
function readLineageStore(){try{const value=JSON.parse(fs.readFileSync(syncLineageFile(),'utf8'));return value&&typeof value==='object'?value:{schemaVersion:2,endpoints:{}};}catch{return {schemaVersion:2,endpoints:{}};}}
function readSyncLineage(endpointKey){
  if(!/^[a-f0-9]{64}$/i.test(endpointKey||''))return null;
  const store=readLineageStore(),sync=require('./webdav-library-sync'),state=require('./webdav-state');
  let value=store.schemaVersion===2?store.endpoints?.[endpointKey]:store;
  if(!value||value.schemaVersion!==3||typeof value.baseRevision!=='string'||!value.baseState||typeof value.baseState!=='object')return null;
  let baseState=sync.toBaseState(value.baseState),baseRevision=value.baseRevision;
  if(value.endpointKey!==endpointKey||state.syncRevision(baseState)!==baseRevision)return null;
  const source=value.remoteValidator,remoteValidator=source?.endpointKey===endpointKey&&typeof source.etag==='string'&&!/^W\//i.test(source.etag)?{endpointKey,etag:source.etag,contentLength:Number.isFinite(source.contentLength)?source.contentLength:null,lastModified:typeof source.lastModified==='string'?source.lastModified:'',storageEncoding:source.storageEncoding==='gzip'?'gzip':null}:null;
  return {schemaVersion:2,endpointKey,baseRevision,baseState,contentRevision:state.contentRevision(baseState),syncRevision:state.syncRevision(baseState),remoteValidator};
}
function writeLineageStore(store){const file=syncLineageFile(),temporary=file+'.tmp-'+randomBytes(4).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify(store,null,2),'utf8');fs.renameSync(temporary,file);}
function writeSyncLineage(value,endpointKey,remoteValidator=null){
  if(!/^[a-f0-9]{64}$/i.test(endpointKey||''))throw Error('WebDAV 端点标识无效，未更新同步版本记录');
  const state=require('./webdav-state'),baseState=state.toBaseState(value),safeValidator=remoteValidator?.endpointKey===endpointKey&&typeof remoteValidator.etag==='string'&&!/^W\//i.test(remoteValidator.etag)?{endpointKey,etag:remoteValidator.etag}:null;
  const record={schemaVersion:3,endpointKey,baseRevision:state.syncRevision(baseState),contentRevision:state.contentRevision(baseState),syncRevision:state.syncRevision(baseState),baseState,...safeValidator?{remoteValidator:{...safeValidator,contentLength:Number.isFinite(remoteValidator.contentLength)?remoteValidator.contentLength:null,lastModified:String(remoteValidator.lastModified||''),storageEncoding:remoteValidator.storageEncoding==='gzip'?'gzip':null}}:{}};
  const old=readLineageStore(),endpoints=old.schemaVersion===2&&old.endpoints&&typeof old.endpoints==='object'?{...old.endpoints}:{};endpoints[endpointKey]=record;writeLineageStore({schemaVersion:2,endpoints});return record;
}
function restoreSyncLineage(value){
  let endpointKey='';try{endpointKey=webdavSyncEndpointKey(loadSettings());}catch{}
  if(!/^[a-f0-9]{64}$/i.test(endpointKey))return;
  const old=readLineageStore(),endpoints=old.schemaVersion===2&&old.endpoints&&typeof old.endpoints==='object'?{...old.endpoints}:{};
  if(value?.schemaVersion===2&&value.endpointKey===endpointKey&&value.baseState&&value.baseRevision){const state=require('./webdav-state'),baseState=state.toBaseState(value.baseState);if(state.syncRevision(baseState)!==value.baseRevision)throw Error('备份中的同步版本记录校验失败');endpoints[endpointKey]={schemaVersion:3,endpointKey,baseRevision:value.baseRevision,contentRevision:state.contentRevision(baseState),syncRevision:state.syncRevision(baseState),baseState};}
  else delete endpoints[endpointKey];
  writeLineageStore({schemaVersion:2,endpoints});
}
const devicePathSettings=['obsidianRoot','localScanPaths','refreshWhitelist'];
function publicSyncSettings(value){const result=secretSettings().publicSettings(value);for(const key of require('./secure-settings').KEYS)result[key]='';for(const key of ['credentialRefs','credentialsUnavailable','lastWebdavSyncAt','lastSyncAt','webdavUrl','webdavUsername','webdavPassword','webdavRemotePath','deviceSettings','windowBounds','playerWindowBounds','readerWindowBounds','uiState','windowState','steamApiKey','googleBooksApiKey'])delete result[key];return result;}
function syncableSettings(value){const result=publicSyncSettings(value);for(const key of devicePathSettings)delete result[key];return result;}
function localSyncState(library=loadLibrary(),settings=loadSettings(),endpointKey=null){
  const connections=audioService?.exportConnections?.()||[],deviceId=syncDeviceId(),settingsUpdatedAt=Object.prototype.hasOwnProperty.call(settings,'updatedAt')?(settings.updatedAt||''):'',syncedSettings=syncableSettings(settings);
  syncedSettings.updatedAt=settingsUpdatedAt;
  const result={...require('./webdav-state').prepareLocalState(library,deviceId),settings:syncedSettings,settingsUpdatedAt,audioConnections:connections.map(row=>({...row,password:''})),audioConnectionsUpdatedAt:audioService?.connectionsUpdatedAt?.()||'',lineage:require('./webdav-state').compactLineage(readSyncLineage(endpointKey||(()=>{try{return webdavSyncEndpointKey(settings);}catch{return null;}})()))};
  const state=require('./webdav-state');result.contentRevision=state.contentRevision(result);result.syncRevision=state.syncRevision(result);return result;
}
function localLibraryFromSyncState(value){const result={...value};for(const key of ['syncFormat','syncVersion','syncSchemaVersion','syncRevision','contentRevision','localDeviceId','lineage','settings','settingsUpdatedAt','audioConnections','audioConnectionsUpdatedAt'])delete result[key];return result;}
function applySyncedSettings(remote={},settingsUpdatedAt=''){
  const local=loadSettings(),safe={...remote};
  for(const key of [...require('./secure-settings').KEYS,'credentialRefs','credentialsUnavailable','webdavUrl','webdavUsername','webdavPassword','webdavRemotePath','deviceSettings','obsidianRoot','localScanPaths','refreshWhitelist','windowBounds','playerWindowBounds','readerWindowBounds','uiState','windowState','steamApiKey','googleBooksApiKey','lastWebdavSyncAt','lastSyncAt'])delete safe[key];
  const next={...local,...safe,appearance:{...local.appearance,...(safe.appearance||{})},updatedAt:Object.prototype.hasOwnProperty.call(remote,'updatedAt')?(remote.updatedAt||''):(settingsUpdatedAt||local.updatedAt||'')};
  writeJson(settingsFile(),next);
}
function applySyncedAudioConnections(rows=[],updatedAt=''){
  if(!audioService)return;
  const current=new Map((audioService.exportConnections?.()||[]).map(row=>[row.id,row]));
  const restored=(rows||[]).map(row=>{
    const previous=current.get(row.id),oldSources=new Map((previous?.sources||[]).map(source=>[source.id,source]));
    return {...row,password:previous?.password||'',sources:(row.sources||[]).map(source=>source.kind==='local'&&oldSources.get(source.id)?.localPath?{...source,localPath:oldSources.get(source.id).localPath}:source)};
  });
  audioService.validateConnectionBackup?.(restored);
  if(JSON.stringify(restored)!==JSON.stringify(audioService.exportConnections?.()||[])||updatedAt!==(audioService.connectionsUpdatedAt?.()||''))audioService.restoreConnections?.(restored,updatedAt);
}
function applyLocalSyncState(value){
  const current=loadLibrary(),nextLibrary=require('./webdav-state').restoreLocalLibrary(localLibraryFromSyncState(value),syncDeviceId(),current);
  writeJson(dataFile(),{...nextLibrary,schemaVersion:4,items:(nextLibrary.items||[]).map(normaliseItem)});
  applySyncedSettings(value.settings||{},value.settingsUpdatedAt||'');
  applySyncedAudioConnections(value.audioConnections||[],value.audioConnectionsUpdatedAt||'');
}
function syncSavePath(value){
  const raw=String(value||'').replaceAll('\\','/'),parts=raw.split('/');
  if(!raw||parts.some(part=>!part||part==='.'||part==='..'))throw Error('存档快照路径无效');
  const root=path.resolve(backupRoot()),target=path.resolve(root,...parts),relative=path.relative(root,target);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('存档快照路径越界');
  return target;
}
function syncObjectPath(value){
  const raw=String(value||'').replaceAll('\\','/'),parts=raw.split('/');
  if(!raw||!raw.startsWith('objects/')||parts.some(part=>!part||part==='.'||part==='..'))throw Error('存档清单包含无效数据块路径');
  return syncSavePath(raw);
}
async function uploadSnapshotToWebdav(settings,entry,{direction='upload',syncContext=null,context='settings-sync'}={}){
  const saveTools=require('./save-snapshots');
  const endpointKey=webdavSyncEndpointKey(settings);
  const manifestFile=path.join(entry.folder,'manifest.json');
  if(!fs.existsSync(manifestFile))throw Error('存档清单不存在，未上传');
  const manifestBytes=fs.readFileSync(manifestFile),manifest=JSON.parse(manifestBytes.toString('utf8')),deviceId=syncDeviceId();
  const objectFiles=new Map();
  if(manifest.schema!==2||!Array.isArray(manifest.entries))throw Error('本地存档快照格式过旧；请重新备份该存档后再同步');
  for(const row of manifest.entries||[])for(const file of row.files||[]){if(!file.object)throw Error('本地存档快照包含旧格式文件；请重新备份该存档后再同步');const old=objectFiles.get(file.object);if(old&&(old.sha256!==file.sha256||Number(old.size)!==Number(file.size)||old.encoding!==file.encoding))throw Error('存档清单对同一数据块记录了不同校验信息');objectFiles.set(file.object,file);}
  const files=[];
  if(objectFiles.size){for(const [object,info] of objectFiles)files.push({relative:object,local:syncObjectPath(object),info,immutable:true});}
  const remoteManifest=saveTools.toRemoteManifest(manifest,deviceId);
  files.push({relative:entry.id+'/manifest.json',local:manifestFile,content:Buffer.from(JSON.stringify(remoteManifest,null,2)),manifest:remoteManifest,immutable:false});
  const saveTransfer=require('./webdav-save-transfer');
  let uploaded=0,skipped=0,manifestValidator=null;const verifiedObjects={},knownDirectories=new Set();
  const ensureFileDirectory=async relative=>{
    const parent=relative.includes('/')?relative.slice(0,relative.lastIndexOf('/')):'';
    if(!parent)return;
    if(syncContext?.ensureDirectories)return syncContext.ensureDirectories(settings,parent);
    let current='';for(const part of parent.split('/').filter(Boolean)){current+=(current?'/':'')+part;if(knownDirectories.has(current))continue;await ensureWebdavDirectories(settings,current,knownDirectories);}
  };
  await saveTransfer.uploadSnapshotFiles(files,async file=>{
    const target='saves/'+file.relative;
    if(file.immutable){
      if(!fs.existsSync(file.local))throw Error('本地存档数据块缺失，未上传：'+file.relative+'；请先下载云端存档恢复本地文件');
      const transferred=await saveTransfer.uploadImmutableObject({
        target,info:file.info,
        sharedProof:syncContext?.getRemoteObjectProof(file.relative,file.info?.sha256),
        readLocalBytes:()=>fs.readFileSync(file.local),
        localVerified:syncContext?.isLocalObjectVerified(file.relative,file.info),
        verifyObjectBytes:(info,bytes)=>saveTools.verifyObjectBytes(info,bytes),
        request:(method,relative,body,conditions)=>webdavRequest(settings,method,relative,body,'',conditions),
        ensureDirectory:()=>ensureFileDirectory(target),
        rememberRemoteObject:proof=>syncContext?.rememberRemoteObject(file.relative,proof,true),
        failure:(method,status)=>webdavProtocol.failure(method,status).message
      });
      if(transferred.uploaded)uploaded++;else skipped++;
      verifiedObjects[file.relative]=transferred.proof;return;
    }
    let conditions={},remoteParsed=null;
    const remote=await webdavRequest(settings,'GET',target);
    if(remote.status===404){await remote.body?.cancel();conditions={'If-None-Match':'*'};}
    else if(!remote.ok){const message=webdavProtocol.failure('GET',remote.status).message;await remote.body?.cancel();throw Error('无法读取云端存档清单：'+message);}
    else{
      const etag=remote.headers.get('etag'),lastModified=remote.headers.get('last-modified'),remoteBytes=Buffer.from(await remote.arrayBuffer());manifestValidator={etag:etag&&!etag.startsWith('W/')?etag:''};
      try{remoteParsed=JSON.parse(remoteBytes.toString('utf8'));}catch{throw Error('云端存档清单格式无效，未覆盖云端');}
      const localHash=saveTools.manifestHash(file.manifest),remoteHash=saveTools.manifestHash(remoteParsed),remoteLocations=remoteParsed.entries||[],localLocations=file.manifest.entries||[];
      const hasDeviceLocation=localLocations.every((row,index)=>row.sourceByDevice?.[deviceId]===remoteLocations[index]?.sourceByDevice?.[deviceId]);
      if(localHash===remoteHash&&hasDeviceLocation){skipped++;return;}
      if(localHash!==remoteHash&&direction==='bidirectional')throw Error('同一存档快照的本地清单与云端清单内容不同；没有共同版本可判断备注等改动，未按时间戳覆盖，请先选择上传或下载方向');
      if(localHash===remoteHash&&!hasDeviceLocation){
        for(const [index,row] of localLocations.entries())row.sourceByDevice={...(remoteLocations[index]?.sourceByDevice||{}),...(row.sourceByDevice||{})};
      }else if(remoteParsed?.entries?.length===localLocations.length){
        for(const [index,row] of localLocations.entries())row.sourceByDevice={...(remoteLocations[index]?.sourceByDevice||{}),...(row.sourceByDevice||{})};
      }
      if(etag&&!etag.startsWith('W/'))conditions={'If-Match':etag};
      else if(lastModified)conditions={'If-Unmodified-Since':lastModified};
      else throw Error('云端存档清单没有可用的条件写入标识，未覆盖云端');
    }
    const outputBytes=Buffer.from(JSON.stringify(file.manifest,null,2));
    await ensureFileDirectory(target);
    const readBackManifest=async()=>{
      const checked=await webdavRequest(settings,'GET',target,null,'',{'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'});
      if(checked.status===404){await checked.body?.cancel();return null;}
      if(!checked.ok){await checked.body?.cancel();return null;}
      try{
        const stored=JSON.parse(Buffer.from(await checked.arrayBuffer()).toString('utf8'));
        const locations=stored.entries||[],expectedLocations=file.manifest.entries||[];
        const hasDeviceLocation=expectedLocations.every((row,index)=>row.sourceByDevice?.[deviceId]===locations[index]?.sourceByDevice?.[deviceId]);
        if(saveTools.manifestHash(stored)!==saveTools.manifestHash(file.manifest)||!hasDeviceLocation)return null;
        const checkedEtag=checked.headers.get('etag')||'';
        return {etag:checkedEtag&&!checkedEtag.startsWith('W/')?checkedEtag:'',lastModified:checked.headers.get('last-modified')||'',byteLength:Number(checked.headers.get('content-length'))||null};
      }catch{return null;}
    };
    let put;
    try{put=await webdavRequest(settings,'PUT',target,outputBytes,'',conditions);}
    catch(error){
      const confirmed=await readBackManifest().catch(()=>null);
      if(!confirmed)throw Error('存档清单上传中断，远端内容校验未确认：'+entry.id,{cause:error});
      manifestValidator={etag:confirmed.etag,lastModified:confirmed.lastModified};uploaded++;return;
    }
    if(put.status===412){await put.body?.cancel();throw Error('云端存档清单在上传期间发生变化，已停止覆盖，请重新同步');}
    if(!put.ok){const message=webdavProtocol.failure('PUT',put.status).message;await put.body?.cancel();throw Error('上传存档清单失败：'+message);}
    await put.body?.cancel();
    const confirmed=await readBackManifest();
    if(!confirmed)throw Error('存档清单上传后回读校验失败，未更新云端存档索引：'+entry.id);
    uploaded++;
    manifestValidator={etag:confirmed.etag,lastModified:confirmed.lastModified};
  });
  return {ok:true,id:entry.id,manifestHash:entry.manifestHash,uploaded,skipped,context,verification:{manifestValidator,objects:verifiedObjects}};
}
const SAVE_CATALOG_FILE='saves/catalog.json';
const saveCatalogModule=require('./webdav-save-catalog');
function invalidateLocalSaveCatalog(){
  const store=readSaveSyncStore(),endpoints=store.schemaVersion===2&&store.endpoints&&typeof store.endpoints==='object'?{...store.endpoints}:{};let changed=false;
  for(const index of Object.values(endpoints)){if(index.catalog?.localCatalog){delete index.catalog.localCatalog;delete index.catalog.localRevision;changed=true;}}
  if(changed){const file=saveSyncIndexFile(),temporary=file+'.tmp-'+randomBytes(4).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify({schemaVersion:2,endpoints},null,2),'utf8');fs.renameSync(temporary,file);}
}
function updateCachedLocalSaveCatalog({upsert=[],removeIds=[],allEntries=null,tombstones=null}={}){
  const store=readSaveSyncStore(),endpoints=store.schemaVersion===2&&store.endpoints&&typeof store.endpoints==='object'?{...store.endpoints}:{};
  const removals=new Set((removeIds||[]).map(value=>String(value||'')));let changed=false;
  const upserts=saveCatalogEntries(upsert);
  for(const index of Object.values(endpoints)){
    let catalog=null;
    try{catalog=index.catalog?.localCatalog?saveCatalogModule.parse(index.catalog.localCatalog):null;}catch{}
    if(!catalog&&!Array.isArray(allEntries))continue;
    const rows=catalog?.entries||saveCatalogEntries(allEntries),entries=new Map(rows.map(row=>[row.id,row]));
    for(const id of removals)entries.delete(id);
    for(const row of upserts)entries.set(row.id,row);
    const next=saveCatalogModule.create([...entries.values()],tombstones||catalog?.tombstones||[]);
    index.catalog={...(index.catalog||{}),localRevision:next.revision,localCatalog:next};changed=true;
  }
  if(changed){const file=saveSyncIndexFile(),temporary=file+'.tmp-'+randomBytes(4).toString('hex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify({schemaVersion:2,endpoints},null,2),'utf8');fs.renameSync(temporary,file);}
}
function saveCatalogEntries(entries){return (entries||[]).map(entry=>{for(const row of entry.entries||[]){if(!Array.isArray(row.files)&&(Number(entry.files)||0)>0)throw Error('本地存档快照包含旧格式文件；请重新备份该存档后再同步');for(const file of row.files||[])if(!file.object)throw Error('本地存档快照包含旧格式文件；请重新备份该存档后再同步');}const fileCount=Number(entry.files)||((entry.entries||[]).reduce((sum,row)=>sum+(row.files?.length||0),0));const storedSize=Number(entry.size)||((entry.entries||[]).reduce((sum,row)=>sum+(row.files||[]).reduce((subtotal,file)=>subtotal+(Number(file.storedSize)||0),0),0));return {id:entry.id,manifestHash:entry.manifestHash,objects:saveCatalogModule.objectRefs(entry.entries||[]),metadata:{itemId:String(entry.itemId||''),gameName:String(entry.gameName||''),createdAt:String(entry.createdAt||''),note:String(entry.note||'').slice(0,2000),files:fileCount,size:storedSize}};});}
function readLocalSnapshotForSync(summary){
  const saveTools=require('./save-snapshots'),file=syncSavePath(String(summary.id)+'/manifest.json');
  if(!fs.existsSync(file))throw Error('本地存档索引指向了不存在的清单：'+summary.id);
  let manifest;try{manifest=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw Error('本地存档清单无法读取：'+summary.id,{cause:error});}
  if(!manifest||manifest.schema!==2||!Array.isArray(manifest.entries))throw Error('本地存档快照格式过旧；请重新备份该存档后再同步');
  const manifestHash=saveTools.manifestHash(manifest);
  if(manifestHash!==String(summary.manifestHash||summary.manifestRevision||''))throw Error('本地存档索引与快照清单修订不一致：'+summary.id+'；请重新同步以刷新本地索引');
  const entry={id:summary.id,itemId:manifest.itemId,folder:path.dirname(file),createdAt:manifest.createdAt||'',gameName:manifest.gameName||'',note:manifest.note||'',entries:manifest.entries,files:manifest.entries.reduce((count,row)=>count+(row.files?.length||0),0),manifestHash};
  const verified=saveCatalogEntries([entry])[0];
  if(JSON.stringify(verified.objects)!==JSON.stringify(summary.objects||[]))throw Error('本地存档索引与数据块清单不一致：'+summary.id+'；请重新同步以刷新本地索引');
  return entry;
}
function buildLocalSaveCatalog(items,tombstones=[]){return saveCatalogModule.create(saveCatalogEntries(saveSnapshots.listAll(items)),tombstones);}
function localSaveCatalog(endpointKey,items,tombstones=[]){
  const index=readSaveSyncIndex(endpointKey),cached=index.catalog?.localCatalog;
  if(cached){try{const parsed=saveCatalogModule.parse(cached),catalog=saveCatalogModule.create(parsed.entries,tombstones);if(index.catalog.localRevision!==catalog.revision){index.catalog={...index.catalog,localRevision:catalog.revision,localCatalog:catalog};writeSaveSyncIndex(index,endpointKey);}return catalog;}catch{}}
  const catalog=buildLocalSaveCatalog(items,tombstones);index.catalog={...(index.catalog||{}),localRevision:catalog.revision,localCatalog:catalog};writeSaveSyncIndex(index,endpointKey);return catalog;
}
async function readRemoteSaveCatalog(settings){
  const headers={'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'},response=await webdavRequest(settings,'GET',SAVE_CATALOG_FILE,null,'',headers);
  if(response.status===404){await response.body?.cancel();return null;}
  if(!response.ok){const status=response.status;await response.body?.cancel();throw Error('无法读取云端存档索引（HTTP '+status+'）');}
  const bytes=Buffer.from(await response.arrayBuffer());let catalog;
  try{catalog=saveCatalogModule.parse(JSON.parse(bytes.toString('utf8')));}catch(error){throw Error('云端存档索引损坏；为避免漏掉云端存档，已停止同步',{cause:error});}
  return {catalog,etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||'',byteLength:bytes.length};
}
async function readRemoteSnapshotManifest(settings,entry){
  const id=require('./webdav-save-catalog').normalizeEntry(entry).id,relative='saves/'+id+'/manifest.json';
  const response=await webdavRequest(settings,'GET',relative,null,'',{'Cache-Control':'no-cache'});
  if(response.status===404){await response.body?.cancel();return null;}
  if(!response.ok){const status=response.status;await response.body?.cancel();throw Error('无法读取云端存档清单（HTTP '+status+'）：'+id);}
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8*1024*1024)throw Error('云端存档清单超过安全读取大小：'+id);
  let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw Error('云端存档清单格式无效：'+id);}
  const saveTools=require('./save-snapshots');if(!Array.isArray(manifest?.entries)||saveTools.manifestHash(manifest)!==String(entry.manifestRevision||entry.manifestHash||''))throw Error('云端存档清单与索引不一致：'+id);
  return manifest;
}
function summaryFromRemoteManifest(id,manifest,manifestRevision,localAvailable=false){
  const rows=manifest.entries||[];return {id,itemId:String(manifest.itemId||''),gameName:String(manifest.gameName||''),createdAt:String(manifest.createdAt||''),note:String(manifest.note||''),files:rows.reduce((sum,row)=>sum+(row.files?.length||0),0),size:rows.reduce((sum,row)=>sum+(row.files||[]).reduce((n,file)=>n+(Number(file.storedSize)||0),0),0),manifestHash:manifestRevision,localAvailable,remoteOnly:!localAvailable,syncStatus:localAvailable?'已同步':'云端（未下载）'};
}
async function listRemoteSaveSnapshots(itemId,settings){
  const remote=await readRemoteSaveCatalog(settings);if(!remote)return [];
  const localIds=new Set(saveSnapshots.list(itemId).map(row=>row.id));
  const candidates=remote.catalog.entries.filter(row=>!remote.catalog.tombstones.includes(row.id));
  const rows=await mapWebdavBatch(candidates,4,async entry=>{
    let metadata=entry.metadata||null;
    if(metadata?.itemId!==String(itemId)){
      const manifest=await readRemoteSnapshotManifest(settings,entry);if(!manifest)return null;
      metadata={itemId:String(manifest.itemId||''),gameName:String(manifest.gameName||''),createdAt:String(manifest.createdAt||''),note:String(manifest.note||''),files:(manifest.entries||[]).reduce((sum,row)=>sum+(row.files?.length||0),0),size:(manifest.entries||[]).reduce((sum,row)=>sum+(row.files||[]).reduce((n,file)=>n+(Number(file.storedSize)||0),0),0)};
    }
    if(String(metadata?.itemId||'')!==String(itemId))return null;
    const localAvailable=localIds.has(entry.id);
    return {id:entry.id,itemId:String(itemId),gameName:String(metadata.gameName||''),createdAt:String(metadata.createdAt||''),note:String(metadata.note||''),files:Number(metadata.files)||0,size:Number(metadata.size)||0,manifestHash:entry.manifestRevision,objects:entry.objects||[],localAvailable,remoteOnly:!localAvailable,syncStatus:localAvailable?'已同步':'云端（未下载）'};
  });
  return rows.filter(Boolean).sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
}
async function refreshRemoteSaveCatalogForWrite(settings,diagnostic=()=>{}){
  return require('./webdav-save-catalog-write').refreshCurrent({
    stat:()=>webdavClient.stat(settings,SAVE_CATALOG_FILE,SYNC_STATE_STAT_TIMEOUT_MS),
    read:()=>readRemoteSaveCatalog(settings),
    onDiagnostic:row=>diagnostic({...row,operation:'sync',phase:'save-catalog-verify'})
  });
}
async function publishRemoteSaveCatalog(settings,localCatalog,direction,remoteState,diagnostic=()=>{}){
  const writer=require('./webdav-save-catalog-write');
  return writer.publish({
    current:remoteState,localCatalog,direction,merge:saveCatalogModule.merge,
    refreshCurrent:()=>refreshRemoteSaveCatalogForWrite(settings,diagnostic),
    put:async(target,conditions)=>{await ensureWebdavDirectories(settings,'saves');return webdavRequest(settings,'PUT',SAVE_CATALOG_FILE,JSON.stringify(target),'application/json; charset=utf-8',conditions);},
    verify:()=>readRemoteSaveCatalog(settings),
    onDiagnostic:row=>diagnostic({...row,operation:'sync',phase:'save-catalog-verify'})
  });
}
async function registerUploadedSnapshot(settings,entry,remoteState=null){
  const endpointKey=webdavSyncEndpointKey(settings),library=loadLibrary(),tombstones=library.deletedSaveSnapshots||[];
  const cached=localSaveCatalog(endpointKey,library.items,tombstones),updated=saveCatalogEntries([entry])[0];
  const localCatalog=saveCatalogModule.create([...cached.entries.filter(row=>row.id!==updated.id),updated],tombstones);
  let remote=arguments.length>=3?remoteState:await readRemoteSaveCatalog(settings);
  if(!remote)remote={catalog:saveCatalogModule.create(),etag:'',byteLength:null};
  const published=await publishRemoteSaveCatalog(settings,localCatalog,'upload',remote,row=>webdavDiagnosticLog.write(row));
  const index=readSaveSyncIndex(endpointKey),local=localCatalog;index.catalog={...(index.catalog||{}),localRevision:local.revision,localCatalog:local,remoteRevision:published.catalog.revision,etag:published.etag||'',remoteLength:published.byteLength??null,lastModified:published.lastModified||''};writeSaveSyncIndex(index,endpointKey);
}
async function syncOneSnapshot(settings,entry,context='item-retry'){
  const endpointKey=webdavSyncEndpointKey(settings);
  try{
    await ensureWebdavPath(settings);
    const remote=await readRemoteSaveCatalog(settings);
    const result=await uploadSnapshotToWebdav(settings,entry,{direction:'upload',context});
    await require('./save-backup-sync').confirmSnapshotUploads([{entry,result}],{
      publishCatalog:()=>registerUploadedSnapshot(settings,entry,remote),
      markSynced:(snapshot,verification)=>markSaveSynced(snapshot.id,snapshot.manifestHash,verification,endpointKey)
    });
    return result;
  }catch(error){
    clearSaveSynced(entry.id,endpointKey);
    throw error;
  }
}
async function syncWebdav(settings,direction,resolution,expectedVersion){
  webdavSyncLibraryCommitted=false;
  webdavSyncPhase='local-prepare';
  let uploaded=0,downloaded=0,skippedFiles=0,libraryWriteConfirmedAfterConnectionError=false,saveSnapshotConfirmations=[];
  const syncStarted=Date.now(),endpointKey=webdavSyncEndpointKey(settings),syncPlan=require('./webdav-library-sync');
  webdavDiagnosticLog.write({event:'webdav.sync.SYNC_START',operation:'sync',phase:'start'});
  const localStarted=Date.now(),local=localSyncState(coverStore.compactForSync(loadLibrary()),settings,endpointKey),localStateModel=require('./webdav-state');
  webdavDiagnosticLog.write({event:'webdav.sync.LOCAL_PREPARE',operation:'sync',phase:'local-prepare',durationMs:Date.now()-localStarted,resourceCount:local.items.length,contentRevision:localStateModel.contentRevision(local),syncRevision:localStateModel.syncRevision(local)});
  const previousLineage=readSyncLineage(endpointKey);let cachedRemote=null,remoteMetadata=null;
  webdavSyncPhase='remote-stat';
  const statStarted=Date.now();
  try{
    remoteMetadata=await webdavClient.stat(settings,SYNC_STATE_FILE,SYNC_STATE_STAT_TIMEOUT_MS);
    webdavDiagnosticLog.write({event:'webdav.sync.REMOTE_STAT',operation:'sync',phase:'remote-stat',durationMs:Date.now()-statStarted,etag:remoteMetadata.etag||'',size:remoteMetadata.contentLength});
  }catch(error){webdavDiagnosticLog.write({event:'webdav.sync.REMOTE_STAT',operation:'sync',phase:'remote-stat',durationMs:Date.now()-statStarted,error});}
  const saveIndex=readSaveSyncIndex(endpointKey),initialSaveCatalog=localSaveCatalog(endpointKey,loadLibrary().items,local.deletedSaveSnapshots||[]),hasPendingSaveSnapshots=require('./save-backup-sync').hasPendingSnapshots(initialSaveCatalog.entries,saveIndex);
  let remoteSaveCatalogMetadata=null,remoteSaveCatalog=null,skipSaveSync=false;
  webdavSyncPhase='save-catalog-stat';
  try{
    remoteSaveCatalogMetadata=await webdavClient.stat(settings,SAVE_CATALOG_FILE,SYNC_STATE_STAT_TIMEOUT_MS);
    skipSaveSync=!hasPendingSaveSnapshots&&saveCatalogModule.canSkip({localRevision:initialSaveCatalog.revision,cached:saveIndex.catalog,remote:remoteSaveCatalogMetadata});
    if(skipSaveSync)remoteSaveCatalog={catalog:{revision:saveIndex.catalog.remoteRevision||'',entries:[],tombstones:[]},etag:remoteSaveCatalogMetadata.etag||'',lastModified:remoteSaveCatalogMetadata.lastModified||'',byteLength:remoteSaveCatalogMetadata.contentLength};
    webdavDiagnosticLog.write({event:'webdav.save-catalog.stat',operation:'sync',phase:'save-catalog-stat',exists:remoteSaveCatalogMetadata.exists,skip:skipSaveSync,localRevision:initialSaveCatalog.revision,remoteEtag:remoteSaveCatalogMetadata.etag||''});
  }catch(error){webdavDiagnosticLog.write({event:'webdav.save-catalog.stat.failed',operation:'sync',phase:'save-catalog-stat',error});}
  if(!skipSaveSync&&remoteSaveCatalogMetadata?.exists){
    webdavSyncPhase='save-catalog-read';
    try{remoteSaveCatalog=await readRemoteSaveCatalog(settings);if(!remoteSaveCatalog)throw Error('云端存档索引在检查期间消失，请重新同步');}
    catch(error){webdavDiagnosticLog.write({event:'webdav.save-catalog.read.failed',operation:'sync',phase:'save-catalog-read',error});throw error;}
  }
  if(!skipSaveSync&&!hasPendingSaveSnapshots&&remoteSaveCatalog&&saveCatalogModule.canSkipByContent(initialSaveCatalog.revision,remoteSaveCatalog.catalog)){
    skipSaveSync=true;
    const currentIndex=readSaveSyncIndex(endpointKey);
    currentIndex.catalog={...(currentIndex.catalog||{}),localRevision:initialSaveCatalog.revision,localCatalog:initialSaveCatalog,remoteRevision:remoteSaveCatalog.catalog.revision,etag:remoteSaveCatalog.etag||'',remoteLength:remoteSaveCatalog.byteLength??null,lastModified:remoteSaveCatalog.lastModified||''};
    writeSaveSyncIndex(currentIndex,endpointKey);
    webdavDiagnosticLog.write({event:'webdav.save-catalog.content-fast-path',operation:'sync',phase:'save-catalog-stat',unchanged:true,revision:initialSaveCatalog.revision});
  }
  if(!remoteMetadata?.exists){webdavSyncPhase='ensure-remote-path';await webdavClient.ensurePath(settings,{timeoutMs:5000});}
  const libraryFastPath=Boolean(previousLineage?.remoteValidator?.endpointKey===endpointKey&&previousLineage.remoteValidator.contentLength!=null&&remoteMetadata?.contentLength===previousLineage.remoteValidator.contentLength&&remoteMetadata?.etag===previousLineage.remoteValidator.etag&&!/^W\//i.test(remoteMetadata.etag||'')&&localStateModel.syncRevision(local)===previousLineage.syncRevision&&localStateModel.contentRevision(local)===previousLineage.contentRevision);
  if(libraryFastPath){
    cachedRemote={state:previousLineage.baseState,etag:remoteMetadata.etag,lastModified:remoteMetadata.lastModified||'',byteLength:remoteMetadata.contentLength,storageEncoding:previousLineage.remoteValidator.storageEncoding||null};
  }else if(previousLineage)webdavDiagnosticLog.write({event:'webdav.sync-state-read.cache-miss',operation:'sync',phase:'read-sync-state'});
  const syncContext=createSaveSyncContext(settings,endpointKey);
  const noCacheHeaders=extra=>({'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache',...(extra||{})});
  const planOptions={local,direction,endpointKey,normalizeRemoteState:state=>coverStore.compactForSync(state),get:(extra,signal,requestOptions={})=>webdavRequest(settings,'GET',SYNC_STATE_FILE,null,'',noCacheHeaders(extra),signal,false,false,SYNC_STATE_REQUEST_TIMEOUT_MS,undefined,requestOptions),stat:({forceFresh}={})=>forceFresh?webdavClient.stat(settings,SYNC_STATE_FILE,SYNC_STATE_STAT_TIMEOUT_MS):remoteMetadata||webdavClient.stat(settings,SYNC_STATE_FILE,SYNC_STATE_STAT_TIMEOUT_MS),cachedRemote,diagnostic:row=>webdavDiagnosticLog.write(row),backup:async snapshots=>{const folder=path.join(app.getPath('userData'),'sync-recovery');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,Date.now()+'-'+randomBytes(4).toString('hex')+'.json'),JSON.stringify(snapshots));}};
  if(resolution!=null)planOptions.resolution=resolution;
  if(arguments.length>=4)planOptions.expectedVersion=expectedVersion;
  webdavSyncPhase='read-sync-state';
  let prepared=await syncPlan.plan(planOptions);
  webdavSyncPhase='compare';
  if(prepared.comparison){const c=prepared.comparison;webdavDiagnosticLog.write({event:'webdav.sync.COMPARE',operation:'sync',phase:'compare',unchanged:c.equal,syncUnchanged:c.syncEqual,localContentRevision:c.localContentRevision,remoteContentRevision:c.remoteContentRevision,localSyncRevision:c.localSyncRevision,remoteSyncRevision:c.remoteSyncRevision,localCount:c.localCount,remoteCount:c.remoteCount,changedResourceCount:c.changed,localNewer:c.localNewer,remoteNewer:c.remoteNewer,unknownCount:c.unknownItems?.length||0});}
  const fastPathLibraryUnchanged=prepared.comparison?.syncEqual===true,savesUnchanged=Boolean(skipSaveSync),archivesUnchanged=Boolean(skipSaveSync);
  webdavDiagnosticLog.write(webdavDiagnosticModule.fastPathRecord({libraryUnchanged:fastPathLibraryUnchanged,savesUnchanged,archivesUnchanged,libraryStatCacheHit:libraryFastPath,stateBytes:remoteMetadata?.contentLength,saveCount:initialSaveCatalog.entries.length,manifestCount:skipSaveSync?0:initialSaveCatalog.entries.length,objectCount:skipSaveSync?0:initialSaveCatalog.entries.reduce((sum,row)=>sum+row.objects.length,0)}));
  if(prepared.needsDecision)return {ok:false,needsDecision:true,message:prepared.preview.reason||'本地与云端同步数据不同，请先确认采用或合并哪一侧',preview:prepared.preview};
  if(prepared.cancelled)return {ok:true,cancelled:true,message:prepared.message};
  const actualDirection=prepared.actualDirection||direction;
  const plannedSaveCatalog=saveCatalogModule.create(initialSaveCatalog.entries,prepared.state.deletedSaveSnapshots||[]);
  if(skipSaveSync&&plannedSaveCatalog.revision!==initialSaveCatalog.revision){
    skipSaveSync=false;
    webdavDiagnosticLog.write({event:'webdav.save-catalog.fast-path-invalidated',operation:'sync',phase:'save-catalog-check',reason:'planned-tombstones-changed'});
    if(remoteSaveCatalogMetadata?.exists)remoteSaveCatalog=await readRemoteSaveCatalog(settings);
  }
  let libraryStateUploaded=false,remoteSnapshotAfterWrite=null,statePutMetadata=null;
  const upload=async(relative,content,conditions={},contentType='')=>{
    const started=Date.now();
    await ensureWebdavDirectories(settings,relative.includes('/')?relative.slice(0,relative.lastIndexOf('/')):'');
    const response=await webdavRequest(settings,'PUT',relative,content,contentType,conditions);
    if(!response.ok){const error=webdavProtocol.failure('PUT',response.status);if(response.status===412){error.responseDiagnostic=await webdavProtocol.responseDiagnostic(response);webdavDiagnosticLog.write({event:'webdav.precondition-rejected',operation:'sync',method:'PUT',resource:webdavProtocol.resourceLabel(relative),status:response.status,statusText:error.responseDiagnostic.statusText,requestConditions:conditions,responseHeaders:error.responseDiagnostic.headers,body:error.responseDiagnostic.body});}await response.body?.cancel();throw error;}
    const result={etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||'',byteLength:Buffer.byteLength(Buffer.isBuffer(content)?content:String(content)),storageEncoding:contentType==='application/gzip'?'gzip':null};
    webdavDiagnosticLog.write({event:'webdav.sync.STATE_UPLOAD_VERIFY',operation:'sync',phase:'state-upload-verify',durationMs:Date.now()-started,stateBytes:result.byteLength});
    await response.body?.cancel();uploaded++;return result;
  };
  const download=async relative=>{const response=await webdavRequest(settings,'GET',relative);if(response.status===404){await response.body?.cancel();return null;}if(!response.ok){const error=webdavProtocol.failure('GET',response.status);await response.body?.cancel();throw error;}return response;};
  if(actualDirection==='upload'||actualDirection==='bidirectional'){
    webdavSyncPhase='upload-sync-state';
    const coverSync=require('./webdav-cover-sync');
    const ensureStateCovers=async(state,previousState)=>{const covers=await coverSync.ensureRemoteObjects({settings,state:coverStore.compactForSync(state),previousState:previousState?coverStore.compactForSync(previousState):null,store:coverStore,request:(...args)=>webdavRequest(...args),ensureDirectories:ensureWebdavDirectories,diagnostic:row=>webdavDiagnosticLog.write(row)});uploaded+=covers.uploaded;skippedFiles+=covers.skipped;};
    const writeResult=await require('./webdav-write-recovery').writeSyncState({
      initial:prepared,plan:async options=>{webdavSyncPhase='read-sync-state';return syncPlan.plan(options);},planOptions,
      refreshLocal:async()=>localSyncState(coverStore.compactForSync(loadLibrary()),loadSettings(),endpointKey),
      same:syncPlan.sameState,
      diagnostic:row=>webdavDiagnosticLog.write(row),
      put:async(state,conditions,writePrepared)=>{webdavSyncPhase='upload-covers';await ensureStateCovers(state,writePrepared?.remoteSnapshot?.state||null);webdavSyncPhase='upload-sync-state';statePutMetadata=await upload(SYNC_STATE_FILE,syncPlan.serializeSnapshot(coverStore.compactForSync(state)),conditions,'application/gzip');}
    });
    if(writeResult.needsDecision)return {ok:false,needsDecision:true,message:writeResult.prepared.preview?.reason||'云端资源库刚刚变化，请核对后再继续',preview:writeResult.prepared.preview};
    prepared=writeResult.prepared;
    libraryWriteConfirmedAfterConnectionError=writeResult.confirmedAfterInterruption;
    if(actualDirection!=='download')webdavSyncLibraryCommitted=true;
    libraryStateUploaded=writeResult.wrote;
  remoteSnapshotAfterWrite=writeResult.wrote?{state:prepared.state,...(statePutMetadata||{})}:prepared.remoteSnapshot;
    if(writeResult.confirmedAfterInterruption)uploaded++;
    if(!writeResult.wrote)skippedFiles++;
    if(!skipSaveSync){
    webdavSyncPhase='upload-save-snapshots';
    const tombstones=prepared.state.deletedSaveSnapshots||[];
    if(tombstones.length){
      const remove=require('./webdav-save-delete').create({listFiles:listWebdavFiles,request:(...args)=>webdavRequest(...args)});
      const removed=await remove.deleteSnapshots(settings,tombstones.map(row=>row.id||row.snapshotId));
      if(!removed.ok)throw Error('资源库已同步；部分已删除的云端存档未能清理，已保留删除记录，可重试');
    }
    const deletedSnapshotIds=new Set(tombstones.map(row=>row.id||row.snapshotId));
    const remoteEntries=new Map((remoteSaveCatalog?.catalog?.entries||[]).map(entry=>[entry.id,entry]));
    const pendingEntries=[];
    for(const localEntry of initialSaveCatalog.entries.filter(entry=>!deletedSnapshotIds.has(entry.id))){
      const remoteEntry=remoteEntries.get(localEntry.id),same=Boolean(remoteEntry&&remoteEntry.manifestRevision===localEntry.manifestRevision&&JSON.stringify(remoteEntry.objects)===JSON.stringify(localEntry.objects));
      if(same){saveSnapshotConfirmations.push({entry:localEntry,verification:{}});continue;}
      clearSaveSynced(localEntry.id,endpointKey);
      pendingEntries.push(readLocalSnapshotForSync(localEntry));
    }
    const saveSync=require('./save-backup-sync'),saveResults=await saveSync.transferSnapshotBatch(pendingEntries,entry=>uploadSnapshotToWebdav(settings,entry,{direction:actualDirection,syncContext,context:saveSync.CONTEXT.SETTINGS_SYNC}),{concurrency:3,context:saveSync.CONTEXT.SETTINGS_SYNC});
    for(const row of saveResults.successes){const result=row.result;uploaded+=result.uploaded;skippedFiles+=result.skipped;saveSnapshotConfirmations.push({entry:row.entry,result,verification:result.verification});}
    if(saveResults.failures.length){const details=saveResults.failures.map(row=>`${row.entry?.gameName||row.entry?.id||'存档快照'}：${row.error?.message||row.error}`).join('；');throw Error(`存档同步部分失败（${saveResults.failures.length} 份），本次未更新云端存档索引；失败快照仍为待同步。${details}`);}
    }
    else webdavDiagnosticLog.write({event:'webdav.save-catalog.fast-path',operation:'sync',phase:'upload-saves',localRevision:initialSaveCatalog.revision,remoteEtag:remoteSaveCatalogMetadata?.etag||''});
    webdavSyncPhase='save-sync-settings';
  }
  if(actualDirection==='download'||actualDirection==='bidirectional'){
    webdavSyncPhase='download-library';
    try{
      if(!syncPlan.sameState(local,prepared.state)){
        const coverResult=await require('./webdav-cover-sync').ensureLocalObjects({settings,state:prepared.state,store:coverStore,request:(...args)=>webdavRequest(...args),diagnostic:row=>webdavDiagnosticLog.write(row)});
        downloaded+=coverResult.downloaded;
        applyLocalSyncState(prepared.state);downloaded++;
      }
    }
    catch(error){throw Error('云端资源库已同步；本地应用同步结果失败：'+error.message,{cause:error});}
    webdavSyncLibraryCommitted=true;
    webdavSyncPhase='download-save-snapshots';
    try{
      if(!skipSaveSync){
      const deletedRows=prepared.state.deletedSaveSnapshots||[],deletedIds=new Set(deletedRows.map(row=>row.id||row.snapshotId));
      const tombstonedLocals=initialSaveCatalog.entries.filter(entry=>deletedIds.has(entry.id)).map(summary=>{
        const manifest=syncSavePath(summary.id+'/manifest.json');
        if(fs.existsSync(manifest))return readLocalSnapshotForSync(summary);
        const deleted=deletedRows.find(row=>(row.id||row.snapshotId)===summary.id);
        return deleted?.itemId?{id:summary.id,itemId:deleted.itemId}:null;
      }).filter(Boolean);
      if(tombstonedLocals.length){const removed=saveSnapshots.removeMany(tombstonedLocals.map(entry=>({itemId:entry.itemId,backupId:entry.id})),loadLibrary().items,tombstonedLocals);if(removed.removed?.length){forgetSaveSync(removed.removed.map(row=>row.id));updateCachedLocalSaveCatalog({removeIds:removed.removed.map(row=>row.id),tombstones:deletedRows});}}
        const remoteCount=(remoteSaveCatalog?.catalog?.entries||[]).filter(entry=>!deletedIds.has(entry.id)).length;
        skippedFiles+=remoteCount;
        webdavDiagnosticLog.write({event:'webdav.save-snapshots.deferred',operation:'sync',phase:'download-saves',remoteSnapshotCount:remoteCount,downloadedObjects:0,detail:'Remote save snapshots remain cloud-only until the user switches to one'});
      }
      else webdavDiagnosticLog.write({event:'webdav.save-catalog.fast-path',operation:'sync',phase:'download-saves',localRevision:initialSaveCatalog.revision,remoteEtag:remoteSaveCatalogMetadata?.etag||''});
    }catch(error){webdavDiagnosticLog.write({event:'webdav.save-download.failed',operation:'sync',phase:'download-saves',error});throw Error('资源库已同步；存档下载未完成：'+error.message+'。已有文件保留，可重试。',{cause:error});}
  }
  if(!skipSaveSync){
    webdavSyncPhase='save-catalog-finalize';
    try{
      const tombstones=prepared.state.deletedSaveSnapshots||[];
      const finalLocalCatalog=plannedSaveCatalog;
      await require('./save-backup-sync').publishSnapshotCatalog(saveSnapshotConfirmations,async()=>{
          if(actualDirection==='upload'||actualDirection==='bidirectional'){
            if(!remoteSaveCatalog&&remoteSaveCatalogMetadata?.exists)remoteSaveCatalog=await readRemoteSaveCatalog(settings);
            let published;
            if(remoteSaveCatalog?.catalog?.revision===finalLocalCatalog.revision)published={catalog:remoteSaveCatalog.catalog,etag:remoteSaveCatalog.etag||'',lastModified:remoteSaveCatalog.lastModified||'',byteLength:remoteSaveCatalog.byteLength??null,uploaded:0};
            else published=await publishRemoteSaveCatalog(settings,finalLocalCatalog,actualDirection,remoteSaveCatalog||{catalog:saveCatalogModule.create(),etag:'',byteLength:null},row=>webdavDiagnosticLog.write(row));
            uploaded+=published.uploaded||0;
            remoteSaveCatalog={catalog:published.catalog,etag:published.etag||'',lastModified:published.lastModified||'',byteLength:published.byteLength??null};
          }
          const latestIndex=readSaveSyncIndex(endpointKey);
          latestIndex.catalog={...(latestIndex.catalog||{}),localRevision:finalLocalCatalog.revision,localCatalog:finalLocalCatalog,remoteRevision:remoteSaveCatalog?.catalog?.revision||'',etag:remoteSaveCatalog?.etag||'',remoteLength:remoteSaveCatalog?.byteLength??remoteSaveCatalogMetadata?.contentLength??null,lastModified:remoteSaveCatalog?.lastModified||remoteSaveCatalogMetadata?.lastModified||''};
          writeSaveSyncIndex(latestIndex,endpointKey);
          webdavDiagnosticLog.write({event:'webdav.save-catalog.updated',operation:'sync',phase:'save-catalog-finalize',localRevision:finalLocalCatalog.revision,remoteRevision:latestIndex.catalog.remoteRevision,etag:latestIndex.catalog.etag});
          return remoteSaveCatalog;
      });
    }catch(error){webdavDiagnosticLog.write({event:'webdav.save-catalog.finalize.failed',operation:'sync',phase:'save-catalog-finalize',error});throw Error('资源库已同步；存档索引更新未完成：'+error.message+'。可重试同步。',{cause:error});}
  }
  const libraryUnchanged=prepared.comparison?.equal===true;
  let validatorSnapshot=libraryStateUploaded?remoteSnapshotAfterWrite:(prepared.remoteSnapshot||null);
  if(libraryStateUploaded&&(!remoteSnapshotAfterWrite?.etag||remoteSnapshotAfterWrite.byteLength==null)){
    try{
      const metadata=await webdavClient.stat(settings,SYNC_STATE_FILE,SYNC_STATE_STAT_TIMEOUT_MS);
      validatorSnapshot={...(remoteSnapshotAfterWrite||{}),state:prepared.state,etag:metadata.etag||remoteSnapshotAfterWrite?.etag||'',lastModified:metadata.lastModified||remoteSnapshotAfterWrite?.lastModified||'',byteLength:metadata.contentLength??remoteSnapshotAfterWrite?.byteLength??null};
    }catch(error){webdavDiagnosticLog.write({event:'webdav.sync-state-read.cache-refresh-failed',operation:'sync',phase:'read-sync-state',error});}
  }
  const remoteValidator=validatorSnapshot?.etag&&!/^W\//i.test(validatorSnapshot.etag)?{endpointKey,etag:validatorSnapshot.etag,contentLength:validatorSnapshot.byteLength,lastModified:validatorSnapshot.lastModified||'',storageEncoding:validatorSnapshot.storageEncoding==='gzip'?'gzip':null}:null;
  webdavSyncPhase='write-sync-lineage';
  writeSyncLineage(prepared.state,endpointKey,remoteValidator);
  await require('./save-backup-sync').markSnapshotUploads(saveSnapshotConfirmations,{
    markSyncedBatch:rows=>markSaveSyncedBatch(rows,endpointKey)
  });
  const syncedSettings=loadSettings(),stableUpdatedAt=Object.prototype.hasOwnProperty.call(syncedSettings,'updatedAt')?syncedSettings.updatedAt:(prepared.state.settingsUpdatedAt||'');
  try{writeJson(settingsFile(),{...initialSettings,...syncedSettings,updatedAt:stableUpdatedAt,lastWebdavSyncAt:new Date().toISOString(),appearance:{...initialSettings.appearance,...(syncedSettings.appearance||{})}});}catch(error){webdavDiagnosticLog.write({event:'webdav.sync.last-success-time.failed',operation:'sync',phase:'settings-finalize',error});}
  const choice=resolution==='local'?'已按本地版本完成同步':resolution==='remote'?'已按云端版本完成同步':resolution==='merge'?'已合并资源、删除记录、设置和远程音频连接':'';
  const transferSummary=`文件传输：上传 ${uploaded} 个，实际写入本地 ${downloaded} 个，跳过 ${skippedFiles} 个未变化的文件。`;
  const librarySummary=libraryUnchanged?'资源库本地与云端内容一致，无需重复传输。':'资源库同步完成。';
  const confirmedNote=libraryWriteConfirmedAfterConnectionError?'上传响应中断后，已重新读取并确认云端资源库包含本次同步结果。':'';
  const message=choice?`${choice}。${confirmedNote}${transferSummary}`:libraryUnchanged?`${librarySummary}${confirmedNote}${transferSummary}`:direction==='upload'?`${librarySummary}${confirmedNote}${transferSummary}`:direction==='download'?`${librarySummary}${transferSummary}`:`${librarySummary}${confirmedNote}${transferSummary}`;
  const resultName=libraryUnchanged&&uploaded===0&&downloaded===0?'unchanged':resolution==='merge'?'merged':downloaded?'downloaded':uploaded?'uploaded':'unchanged';
  webdavDiagnosticLog.write({event:'webdav.sync.SYNC_DONE',operation:'sync',phase:'done',durationMs:Date.now()-syncStarted,result:resultName,localContentRevision:prepared.comparison?.localContentRevision||localStateModel.contentRevision(prepared.state),remoteContentRevision:prepared.comparison?.remoteContentRevision||'',syncRevision:localStateModel.syncRevision(prepared.state),resourceCount:prepared.state.items?.length||0,uploaded,downloaded,skippedFiles});
  webdavSyncPhase='done';
  return {ok:true,uploaded,downloaded,skippedFiles,libraryUnchanged,libraryWriteConfirmedAfterConnectionError,comparison:prepared.comparison,message};
}

function currentDisguiseState() {
  const stored = loadSettings();
  return { enabled: Boolean(stored.disguiseEnabled) };
}

let readerWindows=null,audioService=null,audioDisplay=null,unifiedPlayer=null,usageService=null,playerQuitting=false,webdavNetworkOperation='',webdavSyncPhase='idle',webdavSyncLibraryCommitted=false;
async function finishMediaSessions(){try{await unifiedPlayer?.close();}finally{readerWindows?.closeAll();await usageService?.stop();}}
app.on('before-quit',event=>{if(unifiedPlayer&&!playerQuitting){event.preventDefault();playerQuitting=true;finishMediaSessions().catch(error=>console.error('退出时保存失败：',error)).finally(()=>app.quit());}});
function setDisguiseState(enabled) {
  if(enabled){readerWindows?.closeAll();audioDisplay?.hide();}
  const stored = loadSettings();
  const next = { ...stored, disguiseEnabled: Boolean(enabled), updatedAt:new Date().toISOString() };
  writeJson(settingsFile(), next);
  const state = { enabled: next.disguiseEnabled };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(state.enabled ? '在线视频课程 - 学习中心' : '悦森盒 YueDen');
    mainWindow.webContents.send('disguise:state', state);
  }
  return state;
}

const quickDisguise=require('./quick-disguise').create({windows:()=>BrowserWindow.getAllWindows(),setState:()=>setDisguiseState(true),closePlayer:()=>unifiedPlayer?.conceal(),openExternal:url=>shell.openExternal(url),videoUrl:()=>loadSettings().disguiseVideoUrl,report:error=>console.error('快速伪装未完成：'+error.message)});
const appIconPath=path.join(__dirname,'assets','icon.ico');
let appWindowIcon=nativeImage.createFromPath(appIconPath);
if(appWindowIcon.isEmpty())appWindowIcon=nativeImage.createFromPath(path.join(__dirname,'assets','icon.png'));
app.on('browser-window-created',(_,win)=>{if(!appWindowIcon.isEmpty())win.setIcon(appWindowIcon);win.webContents.on('before-input-event',(event,input)=>{let file;try{file=require('node:url').fileURLToPath(win.webContents.getURL());}catch{return;}if(!['index.html','reader.html','audio-window.html',path.join('player','window.html')].some(p=>path.resolve(file)===path.join(__dirname,p)))return;if(quickDisguise.input(input))event.preventDefault();});});
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
  const localServices=require('./local-services').createLocalServices({ipcMain,protocol,dialog,windowFor:event=>BrowserWindow.fromWebContents(event.sender)||mainWindow,loadLibrary,dataRoot:()=>app.getPath('userData'),metadataSearch:require('./import-metadata').createImportSearch({search:metadataSearchSources}),prepareCandidate:prepareMetadataCandidate,resolveCandidate:resolveMetadataCandidate,metadataRuntime:MetadataRuntime,shell});localServices.install();
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
    const items=(state?.items||[]).map(normaliseItem),activeIds=new Set(items.map(item=>item.id));
    const safe = { ...require('./library-relations').fields({...state,deletedItems:(state?.deletedItems||[]).filter(row=>!activeIds.has(row.id))},normaliseItem),schemaVersion:4, items, categories: Array.from(new Set(state?.categories || [])) };
    writeJson(dataFile(), safe);
    return usage.decorate(safe);
  });
  ipcMain.handle('cache:size',()=>networkCache.size());
  ipcMain.handle('cache:clear',()=>networkCache.clear());
  ipcMain.handle('metadataDiagnostics:open',async()=>{try{const folder=metadataDiagnosticLog.directory();fs.mkdirSync(folder,{recursive:true});const error=await shell.openPath(folder);return {ok:!error,message:error||''};}catch(error){return {ok:false,message:error?.message||'无法打开日志文件夹'};}});
  ipcMain.handle('settings:load', () => secretSettings().publicSettings(loadSettings(),true));
  ipcMain.handle('settings:save', (_, settings) => {
    const safe = { ...initialSettings, ...secretSettings().resolve(settings||{},loadSettings()), updatedAt:new Date().toISOString(), appearance: { ...initialSettings.appearance, ...(settings?.appearance || {}) } };
    writeJson(settingsFile(), safe);
    readerWindows?.appearance();unifiedPlayer?.appearance();
    return secretSettings().publicSettings(loadSettings(),true);
  });
  ipcMain.handle('metadata:libraryCover',async(event,urls)=>{
    const candidates=Array.isArray(urls)?urls.filter(value=>typeof value==='string'):[];
    return candidateCoverCache.resolve(candidates,{owner:'library:'+event.sender.id,id:'library-covers'});
  });
  ipcMain.handle('metadata:prepareCandidate',(_,candidate)=>prepareMetadataCandidate(candidate));
  ipcMain.handle('metadata:integrate',(_,type,primarySource,sources,query='')=>{
    if(!['game','movie','anime','manga','book'].includes(type)||!Array.isArray(sources))throw Error('无效的整合来源');
    const primary=String(primarySource||''),integrated=require('./metadata-merge').mergeMetadata(sources,type,primary),score=type==='game'?candidate=>require('./game-sources').score(candidate,gameSearchTerms(query)):candidate=>require('./metadata-enrichment').relevance(candidate,query);
    return integrated.sort((a,b)=>score(b)-score(a)||Number(b._sourceId===primary)-Number(a._sourceId===primary));
  });
  ipcMain.handle('metadata:resolveCandidate',async(event,id,candidate)=>{
    if(typeof id!=='string'||id.length>120||!candidate||typeof candidate!=='object')throw Error('无效的元数据候选');
    try{return await MetadataRuntime.run(event.sender.id,id,()=>resolveMetadataCandidate(candidate),false,true);}
    catch(error){if(error.name==='AbortError')return {canceled:true};throw error;}
  });
  ipcMain.handle('metadata:openVerification',async(event,host,type,query,sourceId='',startUrl='')=>{
    const safeHost=require('./metadata-verification-window').hostName(host),safeQuery=String(query||'').trim().slice(0,240);
    if(!safeHost||!['game','movie','anime','manga','book','other'].includes(type)||!safeQuery)throw Error('无效的来源验证请求');
    const safeSourceId=/^[a-z][a-z0-9_-]{0,39}$/.test(String(sourceId||''))?String(sourceId):'';
    const parent=BrowserWindow.fromWebContents(event.sender);if(!parent||parent.isDestroyed())throw Error('主窗口已关闭');
    const effectiveStartUrl=startUrl||'';
    const safeStartUrl=effectiveStartUrl?require('./metadata-verification-window').safeNavigation(effectiveStartUrl):'';
    if(startUrl&&(!safeStartUrl||new URL(safeStartUrl).hostname.toLowerCase()!==safeHost))throw Error('来源搜索地址无效');
    if(!startUrl&&effectiveStartUrl&&(!safeStartUrl||new URL(safeStartUrl).hostname.toLowerCase()!==safeHost))throw Error('来源搜索地址无效');
    metadataDiagnosticLog.write({sourceId:safeSourceId||'unknown',mediaType:type,operation:'verification',queryLength:safeQuery.length,phase:'verification.window-open',requestHost:safeHost});
    const result=await metadataVerificationWindow.open(safeHost,parent,safeStartUrl||undefined);
    if(event.sender.isDestroyed()||parent.isDestroyed())return {canceled:true};
    const verified=Boolean(result?.verified&&!result?.verificationHit);
    if(verified&&result?.html)metadataVerificationWindow.cacheRenderedDom(safeStartUrl||require('./metadata-verification-window').verificationUrl(safeHost),{...result,verified});
    if(safeSourceId&&result?.finalUrl)metadataSourceLocations.record(safeSourceId,safeHost,result.finalUrl,{verified});
    metadataDiagnosticLog.write({sourceId:safeSourceId||'unknown',mediaType:type,operation:'verification',queryLength:safeQuery.length,phase:'verification.window-close',requestHost:safeHost,finalUrl:result?.finalUrl||'',pageTitle:require('./metadata-book-diagnostics').safeTitle(result?.title||'',safeQuery),loadCompleted:Boolean(result?.loadCompleted),verificationHit:Boolean(result?.verificationHit),verificationReason:result?.verificationReason||'',verified,frameDocumentCount:Number(result?.frameDocumentCount)||0,anchorCount:Number(result?.anchorCount)||0,bookLinkCount:Number(result?.bookLinkCount)||0,shadowRootCount:Number(result?.shadowRootCount)||0});
    if(!verified)return {verificationRequired:true,verificationHost:safeHost,verificationReason:result?.verificationReason||(!result?.loadCompleted?'page-not-loaded':'challenge-still-present')};
    const id='verification-'+randomUUID(),owner='verification-'+event.sender.id;
    try{return await MetadataRuntime.run(owner,id,()=>metadataSearchSources(type,safeQuery),true,true);}
    catch(error){if(error.name==='AbortError')return {canceled:true};throw error;}
  });
  ipcMain.handle('metadata:previewCover',(event,urls,id)=>candidateCoverCache.resolveDetailed(urls,{owner:event.sender.id,id:typeof id==='string'?id.slice(0,100):'preview'}));
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
  ipcMain.handle('saves:detectPaths',(_,item)=>discoverSavePaths(item));
  ipcMain.handle('saves:persistPaths',(_,itemId,paths)=>persistSavePaths(String(itemId||''),Array.isArray(paths)?paths:[]));
  ipcMain.handle('saves:backup', (_, itemId, paths, options) => backupSaves(itemId, paths, options));
  ipcMain.handle('saves:list', (_, itemId) => listBackups(itemId));
  ipcMain.handle('saves:listAll', () => listAllBackups());
  ipcMain.handle('saves:listRemote',async(_,itemId,settings)=>{
    if(webdavNetworkOperation)return {ok:false,message:'另一个 WebDAV 操作正在进行，请等待完成后再试'};
    webdavNetworkOperation='save-list';webdavOperationSignal=AbortSignal.timeout(60000);
    try{
      const resolvedSettings=secretSettings().resolve(settings||{},loadSettings()),resolvedItemId=String(itemId||''),entries=await listRemoteSaveSnapshots(resolvedItemId,resolvedSettings);
      return {ok:true,entries};
    }
    catch(error){return {ok:false,message:webdavProtocol.describe(error)};}
    finally{webdavOperationSignal=null;webdavNetworkOperation='';}
  });
  ipcMain.handle('saves:updateNote', (_, itemId, backupId, note) => {const result=saveSnapshots.updateNote(itemId, backupId, note);if(result?.ok){const entry=saveSnapshots.list(itemId).find(row=>row.id===backupId);if(entry)updateCachedLocalSaveCatalog({upsert:[entry]});else invalidateLocalSaveCatalog();}return result;});
  ipcMain.handle('saves:restore', (_, itemId, backupId) => restoreBackup(itemId, backupId));
  ipcMain.handle('saves:restoreRemote',async(_,itemId,backupId,settings)=>{
    if(webdavNetworkOperation)return {ok:false,message:'另一个 WebDAV 操作正在进行，请等待完成后再试'};
    webdavNetworkOperation='save-restore';webdavOperationSignal=AbortSignal.timeout(5*60*1000);
    try{return await restoreRemoteBackup(secretSettings().resolve(settings||{},loadSettings()),String(itemId||''),String(backupId||''));}
    catch(error){return {ok:false,message:webdavProtocol.describe(error)};}
    finally{webdavOperationSignal=null;webdavNetworkOperation='';}
  });
  ipcMain.handle('saves:delete', (_, itemId, backupId, options) => deleteBackup(itemId, backupId, options?.syncCloud === true));
  ipcMain.handle('saves:deleteRemote',async(_,itemId,backupId,settings)=>{
    if(webdavNetworkOperation)return {ok:false,message:'另一个 WebDAV 操作正在进行，请等待完成后再试'};
    webdavNetworkOperation='save-delete-remote';webdavOperationSignal=AbortSignal.timeout(120000);
    try{return await deleteRemoteBackup(secretSettings().resolve(settings||{},loadSettings()),String(itemId||''),String(backupId||''));}
    catch(error){return {ok:false,message:webdavProtocol.describe(error)};}
    finally{webdavOperationSignal=null;webdavNetworkOperation='';}
  });
  ipcMain.handle('saves:deleteMany', (_, rows, options) => deleteBackups(rows, options?.syncCloud === true));
  ipcMain.handle('saves:syncOne', async (_, itemId, backupId, settings, context) => {
    if(webdavNetworkOperation)return {ok:false,message:'另一个 WebDAV 操作正在进行，请等待完成后再试'};
    webdavNetworkOperation='save-upload';webdavOperationSignal=AbortSignal.timeout(3*60*1000);
    try{
    const resolved=secretSettings().resolve(settings||{},loadSettings()),syncContext=require('./save-backup-sync');
    const source=context===syncContext.CONTEXT.IMMEDIATE_BACKUP?syncContext.CONTEXT.IMMEDIATE_BACKUP:syncContext.CONTEXT.ITEM_RETRY;
    const result=await syncContext.retrySnapshot(backupId,{load:id=>saveSnapshots.list(itemId).find(row=>row.id===id),context:source,sync:(entry,syncSource)=>syncOneSnapshot(resolved,entry,syncSource)});
    return result;
    }catch(error){return {ok:false,message:webdavProtocol.describe(error)};}
    finally{webdavOperationSignal=null;webdavNetworkOperation='';}
  });
  ipcMain.handle('saves:openFolder', (_, itemId, gameName) => shell.openPath(saveSnapshots.openFolder(itemId, gameName)));
  ipcMain.handle('webdav:test', async (_, settings) => {
    if(webdavNetworkOperation)return {ok:false,message:'另一个 WebDAV 操作正在进行，请等待完成后再试'};
    webdavNetworkOperation='test';
    const started=Date.now();
    webdavDiagnosticLog.write({event:'webdav.connection-test.started',operation:'connection-test',phase:'start'});
    const deadline=AbortSignal.timeout(12000);
    try { const resolved=secretSettings().resolve(settings||{},loadSettings());await webdavTestClient.ensurePath(resolved,{signal:deadline});const result=await require('./webdav-condition-probe').probe({settings:resolved,signal:deadline,request:(target,method,relative,body,type,conditions,signal)=>webdavTestClient.request(target,method,relative,body,type,conditions,signal),diagnostic:row=>webdavDiagnosticLog.write(row)});webdavDiagnosticLog.write({event:result.ok?'webdav.connection-test.completed':'webdav.connection-test.failed',operation:'connection-test',durationMs:Date.now()-started});return result; } catch (error) { const message=deadline.aborted?'WebDAV 测试连接超时（12 秒），已停止等待，请检查服务器连接后重试':require('./webdav-client').describe(error);webdavDiagnosticLog.write({event:'webdav.connection-test.failed',operation:'connection-test',durationMs:Date.now()-started,error});return { ok: false, message }; } finally {if(webdavNetworkOperation==='test')webdavNetworkOperation='';}
  });
  ipcMain.handle('webdav:sync', async (_, settings, direction, resolution, expectedVersion) => {
    if(webdavNetworkOperation)return {ok:false,message:'另一个 WebDAV 操作正在进行，请等待完成后再试'};
    webdavNetworkOperation='sync';webdavSyncPhase='resolve-settings';webdavSyncLibraryCommitted=false;webdavOperationSignal=AbortSignal.timeout(5*60*1000);
    const started=Date.now();
    try {
      const args=[secretSettings().resolve(settings||{},loadSettings()),direction||'bidirectional'];if(resolution!==undefined)args.push(resolution);if(expectedVersion!==undefined){if(args.length<3)args.push(null);args.push(expectedVersion);}
      const result=await syncWebdav(...args);
      if(result?.needsDecision)webdavDiagnosticLog.write({event:'webdav.sync.decision-required',operation:'sync',phase:'compare',durationMs:Date.now()-started});
      else if(result?.ok)webdavDiagnosticLog.write({event:'webdav.sync.completed',operation:'sync',phase:'done',durationMs:Date.now()-started,libraryUnchanged:result.libraryUnchanged});
      else{const error=Error(result?.message||'WebDAV 同步未完成');webdavDiagnosticLog.write({event:'webdav.sync.failed',operation:'sync',phase:webdavSyncPhase||'sync',durationMs:Date.now()-started,error});}
      return result;
    } catch (error) { webdavDiagnosticLog.write({event:'webdav.sync.failed',operation:'sync',phase:webdavSyncPhase||'sync',durationMs:Date.now()-started,partial:webdavSyncLibraryCommitted,error});return { ok: false, partial:webdavSyncLibraryCommitted, phase:webdavSyncPhase||'sync', message: require('./webdav-client').describe(error) }; }
    finally {if(webdavNetworkOperation==='sync')webdavNetworkOperation='';webdavOperationSignal=null;webdavSyncPhase='idle';}
  });
  ipcMain.handle('disguise:set', (_, enabled) => setDisguiseState(enabled));
  const pendingBackupImports=new Map();
  ipcMain.handle('data:export', async (_, state) => {
    const result = await dialog.showSaveDialog({ title: '导出 悦森盒 YueDen 数据', defaultPath: 'YueDen-backup.json', filters: [{ name: 'JSON 数据', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    const settings=loadSettings(),connections=audioService?.exportConnections?.()||[];
    const library=coverStore.exportLibrary({...require('./library-relations').fields(state,normaliseItem),schemaVersion:4,items:(state?.items||[]).map(normaliseItem),categories:state?.categories||[]});
    const backup=localSyncState(library,settings);
    backup.settings.appearance=structuredClone(settings.appearance||initialSettings.appearance);
    backup.backupSecrets={settings:Object.fromEntries(require('./secure-settings').KEYS.map(key=>[key,settings[key]||''])),localWebdavSettings:require('./backup-webdav-settings').exportLocalWebdavSettings(settings),audioPasswords:Object.fromEntries(connections.filter(row=>row?.id&&row.password).map(row=>[row.id,row.password]))};
    fs.writeFileSync(result.filePath, JSON.stringify(coverStore.exportLibrary(backup), null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('data:import', async (event) => {
    const result = await dialog.showOpenDialog({ title: '导入 悦森盒 YueDen 数据', properties: ['openFile'], filters: [{ name: 'JSON 数据', extensions: ['json'] },{name:'所有文件（All Files）',extensions:['*']}] });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')),
        canonical=parsed?.syncFormat==='yueden-sync-state'&&parsed.syncVersion===4&&parsed.syncSchemaVersion===4,
        legacyFull=parsed?.backupFormat==='yueden-backup'&&[1,2].includes(parsed.backupVersion),full=canonical||legacyFull;
      const source=canonical?require('./webdav-state').restoreLocalLibrary(parsed,syncDeviceId(),loadLibrary()):legacyFull?parsed.library:parsed,
        library=Array.isArray(source)?{items:source}:source;
      if(!library||typeof library!=='object'||!Array.isArray(library.items))throw Error('备份资源库格式无效');
      if(!Array.isArray(source))require('./library-schema').validate(library);
      if(full&&(!parsed.settings||typeof parsed.settings!=='object'||Array.isArray(parsed.settings)||!Array.isArray(parsed.audioConnections)))throw Error('备份设置或远程音频库格式无效');
      const backupSecrets=canonical&&parsed.backupSecrets&&typeof parsed.backupSecrets==='object'?parsed.backupSecrets:{};
      const importedConnections=full?parsed.audioConnections.map(row=>({...row,password:backupSecrets.audioPasswords?.[row.id]??row.password??''})):null;
      if(full)audioService?.validateConnectionBackup?.(importedConnections);
      const normalized={...require('./library-relations').fields(library,normaliseItem),schemaVersion:4,items:library.items.map(normaliseItem),categories:library.categories||initialState.categories};
      const savedLineage=canonical?parsed.lineage:null;
      let syncLineage=null;if(savedLineage?.schemaVersion===2&&/^[a-f0-9]{64}$/i.test(savedLineage.endpointKey||'')){const state=require('./webdav-state'),baseState=state.toBaseState(savedLineage.baseState);if(state.syncRevision(baseState)===savedLineage.baseRevision)syncLineage={schemaVersion:2,endpointKey:savedLineage.endpointKey,baseRevision:savedLineage.baseRevision,baseState};}
      let settingsBackup=full?structuredClone(parsed.settings):null;if(canonical&&backupSecrets.settings)settingsBackup={...settingsBackup,...backupSecrets.settings};if(canonical&&settingsBackup)settingsBackup=require('./backup-webdav-settings').restoreLocalWebdavSettings(settingsBackup,backupSecrets.localWebdavSettings);if(settingsBackup)settingsBackup.appearance={...initialSettings.appearance,...(loadSettings().appearance||{}),...(settingsBackup.appearance||{})};
      const importSettings=canonical||legacyFull&&parsed.backupVersion===2?require('./webdav-state').restoreDeviceSettings(settingsBackup,loadSettings(),syncDeviceId(),devicePathSettings):full?settingsBackup:null;
      const token=require('node:crypto').randomUUID();pendingBackupImports.set(event.sender.id,{token,expires:Date.now()+300000,full,library:normalized,settings:importSettings,audioConnections:importedConnections,syncLineage});
      return {token,includesSettings:full,itemCount:normalized.items.length};
    } catch {
      return null;
    }
  });
  ipcMain.handle('data:restore', async (event,token) => {
    const pending=pendingBackupImports.get(event.sender.id);pendingBackupImports.delete(event.sender.id);
    if(!pending||pending.token!==token||pending.expires<Date.now())throw Error('备份确认已过期，请重新选择文件');
    const oldLibrary=loadLibrary(),oldSettings=loadSettings(),oldConnections=pending.full?audioService?.exportConnections?.():null,oldLineage=(()=>{try{return readSyncLineage(webdavSyncEndpointKey(oldSettings));}catch{return null;}})();
    try{
      if(pending.full){audioService?.restoreConnections?.(pending.audioConnections);const settings={...pending.settings};delete settings.credentialRefs;delete settings.credentialsUnavailable;const safe={...initialSettings,...secretSettings().resolve(settings,loadSettings()),appearance:{...initialSettings.appearance,...(settings.appearance||{})}};writeJson(settingsFile(),safe);}
      writeJson(dataFile(),pending.library);
      restoreSyncLineage(pending.full?pending.syncLineage:null);
      return true;
    }catch(error){
      const rollback=[];try{writeJson(dataFile(),oldLibrary);}catch(e){rollback.push('资料库：'+e.message)}
      if(pending.full){try{writeJson(settingsFile(),oldSettings);}catch(e){rollback.push('设置：'+e.message)}try{audioService?.restoreConnections?.(oldConnections||[]);}catch(e){rollback.push('远程音频库：'+e.message)}}try{restoreSyncLineage(oldLineage);}catch(e){rollback.push('同步版本记录：'+e.message)}
      throw Error('备份恢复失败：'+error.message+(rollback.length?'；原数据还原未全部成功（'+rollback.join('；')+'）':''));
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.whenReady().then(() => {
    getMetadataHttpSession();
    protocol.handle('um-cover', request => {
      const file = coverStore.fileFor(request.url);
      return file && fs.existsSync(file) ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    });
    registerIpc();
    createWindow();
    globalShortcut.register('CommandOrControl+Shift+U', () => {
      const current = currentDisguiseState();
      setDisguiseState(!current.enabled);
    });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
