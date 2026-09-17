const native = window.unifiedAPI;

const TYPE_NAMES = { audio:'声音', game:'游戏',movie:'影视',anime:'番剧',manga:'漫画',book:'书籍',software:'软件',document:'文档',unknown_application:'待确认应用',unknown_collection:'待确认图片集',other:'其他' };
const TYPE_LABELS = {...TYPE_NAMES,all:'全部资源',game:'游戏'};
const STATUS_BY_TYPE = StatusModel.lists;
const STATUS_COLORS = ['#65d8b0', '#3bb5d3', '#f7bd6a', '#f18291', '#a995e8'];

let state = { items: [], categories: [] };
let settings = { obsidianRoot: '', steamApiKey: '', steamId: '', webdavUrl: '', webdavUsername: '', webdavPassword: '', webdavRemotePath: 'UnifiedManager', appearance: { theme: 'ocean', accent: '#65d8b0', density: 'comfortable', animations: true, defaultView: 'dashboard' }, disguiseEnabled: false, disguiseProfile: 'course' };
let activeView = 'dashboard';
// Library layout preferences are stored separately for each media page.
let editorId = null;
let currentRating = 0, editorRatingKnown=false;
let candidateResults = [];
let editorSavePaths = [];
let tagKind = 'all';
let toastTimer = null;
let metadataRequestId = 0;
const resourceFilters = new ResourceFilters();
let backupRenderVersion = 0;

const $ = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function formatDate(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function formatDateTime(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function typeOf(item) { return TYPE_NAMES[item.type] || '其他'; }
function statusList(type) { return STATUS_BY_TYPE[type] || STATUS_BY_TYPE.other; }
function isCompleted(item) { return StatusModel.completed(item.status); }
function isActive(item) { return ['进行中', '在看', '在读'].includes(item.status); }
function fallbackCover(name, index = 0) { const palettes = [['#153d4d', '#65d8b0'], ['#322557', '#b69cff'], ['#4e2b24', '#f3a26e'], ['#20345d', '#67a6ff']]; const colors = palettes[index % palettes.length]; const title = String(name || '悦森盒 YueDen').slice(0, 16).replace(/[&<>]/g, ''); const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="760" cy="90" r="190" fill="white" opacity=".1"/><text x="54" y="270" fill="white" font-size="52" font-family="Microsoft YaHei,Segoe UI" font-weight="700">${title}</text><text x="58" y="320" fill="white" opacity=".75" font-size="22" font-family="Segoe UI">悦森盒 YueDen</text></svg>`; return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }

function stars(value, interactive = false) {
  const amount = Number(value) || 0;
  if (!interactive) return `<span class="stars" title="${amount ? `${amount} 星` : '未评分'}">${[1, 2, 3, 4, 5].map((index) => amount >= index ? '★' : amount >= index - .5 ? '<span class="card-half-star">☆<span aria-hidden="true">★</span></span>' : '☆').join('')}</span>`;
  return [1, 2, 3, 4, 5].map((index) => `<button type="button" class="rating-star ${amount >= index ? 'full' : amount >= index - .5 ? 'half' : ''}" data-rating-index="${index}" aria-label="${index} 星">★</button>`).join('');
}
function showToast(message, tone = 'normal') { const toast = $('toast'); if (!toast) return; toast.textContent = message; toast.style.borderColor = tone === 'error' ? 'rgba(241,130,145,.45)' : ''; toast.style.color = tone === 'error' ? '#ffdce2' : ''; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600); }
function showAppDialog({ title = '请确认', message = '', input = false, defaultValue = '', confirmText = '确定', danger = false } = {}) { return new Promise((resolve) => { const backdrop = document.createElement('div'); backdrop.className = 'app-dialog-backdrop'; backdrop.innerHTML = '<section class="app-dialog"><div class="app-dialog-head"><strong>' + esc(title) + '</strong><button class="app-dialog-close" type="button">×</button></div><p>' + esc(message).replace(/\n/g, '<br>') + '</p>' + (input ? '<input class="app-dialog-input" value="' + esc(defaultValue) + '">' : '') + '<div class="app-dialog-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button><button type="button" class="' + (danger ? 'danger-button' : 'add-button') + ' app-dialog-confirm">' + esc(confirmText) + '</button></div></section>'; appModalStack.open(backdrop,()=>backdrop.querySelector('.app-dialog-close').click()); const finish = (value) => { appModalStack.remove(backdrop); resolve(value); }; backdrop.querySelector('.app-dialog-cancel').addEventListener('click', () => finish(input ? null : false)); backdrop.querySelector('.app-dialog-close').addEventListener('click', () => finish(input ? null : false)); backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(input ? null : false); }); backdrop.querySelector('.app-dialog-confirm').addEventListener('click', () => finish(input ? backdrop.querySelector('.app-dialog-input').value : true)); if (input) { const field = backdrop.querySelector('.app-dialog-input'); field.focus(); field.select(); } }); }
const askConfirm = (message, options = {}) => showAppDialog({ title: options.title || '请确认操作', message, confirmText: options.confirmText || '确定', danger: options.danger !== false });
const askPrompt = (message, defaultValue = '') => showAppDialog({ title: '输入内容', message, input: true, defaultValue, confirmText: '确定', danger: false });
async function confirmDeletion(message) { return settings.confirmBeforeDelete === false || await askConfirm(message, { title: '删除前确认', confirmText: '确认删除', danger: true }); }
function setActiveNav(view) { all('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view)); }
function applyAppearance() { YueDenAppearance.apply(settings.appearance); }

let networkCacheBusy=false,networkCacheQuery=0;
function displayNetworkCacheSize(value){
  const format=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
  $('networkCacheSize').textContent=`HTTP ${format(value.httpBytes)} · 联网内存约 ${format(value.memoryBytes)}`;
}
async function refreshNetworkCacheSize(){
  if(networkCacheBusy)return;const query=++networkCacheQuery;
  try{const value=await native.cacheSize();if(query===networkCacheQuery)displayNetworkCacheSize(value);}
  catch(error){if(query===networkCacheQuery){$('networkCacheSize').textContent='大小查询失败';$('networkCacheSize').title=error.message;}}
}

function render() {
  if ($('audioSubview')) $('audioSubview').hidden = activeView !== 'audio';
  if(!['all',...LocalModel.types].includes(activeView)){librarySelection.ids.clear();}
  if(activeView!=='settings')hideSettingsToast();
  $('localResourcesBtn')?.classList.toggle('hidden',!['game','movie','anime','manga','book'].includes(activeView)||settings.disguiseEnabled);
  $('librarySearchHeader').classList.toggle('hidden', !['all',...LocalModel.types].includes(activeView));
  $('totalNavCount').textContent = state.items.length; setActiveNav(activeView); applyAppearance();
  $('dashboardView').classList.toggle('hidden', activeView !== 'dashboard'); $('libraryView').classList.toggle('hidden', !['all',...LocalModel.types].includes(activeView)); $('categoriesView').classList.toggle('hidden', activeView !== 'categories'); $('settingsView').classList.toggle('hidden', activeView !== 'settings');
  if (activeView === 'dashboard') renderDashboard(); if (['all',...LocalModel.types].includes(activeView)) renderLibrary(); if (activeView === 'categories') renderCategories(); if (activeView === 'settings') { loadSettingsForm(); void refreshNetworkCacheSize(); }
}

function repairImage(image, index = 0) { if (image.dataset.fallback === '1') return; image.dataset.fallback = '1'; image.src = fallbackCover(image.alt, index); }
function renderDashboard() {
  const total = state.items.length;
  const completed = state.items.filter(isCompleted).length;
  const active = state.items.filter(isActive).length;
  const hours = state.items.reduce((sum, item) => sum + resourceUsageHours(item), 0);
  const currentYear = String(new Date().getFullYear());
  const yearItems = state.items.filter((item) => String(item.createdAt || '').startsWith(currentYear) || String(item.completedDate || '').startsWith(currentYear));
  const typeCounts = Object.entries(TYPE_NAMES).map(([type, name]) => [type, name, state.items.filter((item) => item.type === type).length]).filter(([, , count]) => count);
  const topType = [...typeCounts].sort((a, b) => b[2] - a[2])[0];
  const genreCounts = {}; state.items.forEach((item) => (item.genres || []).forEach((genre) => { genreCounts[genre] = (genreCounts[genre] || 0) + 1; }));
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
  $('statGrid').innerHTML = [['总条目', total, '全部媒体收藏', ''], ['进行中', active, '正在体验的内容', 'accent'], ['完成率', total ? `${Math.round(completed / total * 100)}%` : '—', `${completed} 条已完成`, 'warn'], ['今年新增', yearItems.filter((item) => String(item.createdAt || '').startsWith(currentYear)).length, `${currentYear} 年记录`, ''], ['累计时长', `${hours.toFixed(1)}h`, '游玩 / 阅读 / 观看记录', ''], ['最常见类型', topType ? topType[1] : '—', topType ? `${topType[2]} 条资源` : '添加资源后生成', ''], ['偏好标签', topGenre ? topGenre[0] : '—', topGenre ? `${topGenre[1]} 次出现` : '等待标签数据', 'accent'], ['最近整理', formatDate([...state.items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.createdAt), '最后一次添加或更新', '']].map(([label, value, hint, cls]) => `<article class="stat-card ${cls}"><span class="stat-label">${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
  const statusCounts = {}; state.items.forEach((item) => { statusCounts[item.status] = (statusCounts[item.status] || 0) + 1; }); const statusEntries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]); const segments = total ? (() => { let cursor = 0; return statusEntries.map(([, count], index) => { const start = cursor; cursor += count / total * 360; return `${STATUS_COLORS[index % STATUS_COLORS.length]} ${start}deg ${cursor}deg`; }).join(', '); })() : '#223243 0deg 360deg';
  $('donut').style.background = `conic-gradient(${segments})`; $('donutTotal').textContent = total; $('statusLegend').innerHTML = statusEntries.length ? statusEntries.slice(0, 6).map(([status, count], index) => `<div class="legend-item"><span class="legend-dot" style="background:${STATUS_COLORS[index % STATUS_COLORS.length]}"></span><span>${esc(status)}</span><strong>${count}</strong></div>`).join('') : '<div class="legend-item"><span>添加资源后会显示状态分布</span></div>';
  const recent = [...state.items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5); $('recentList').innerHTML = recent.length ? recent.map((item) => `<div class="recent-item" data-open-id="${esc(item.id)}"><img class="recent-cover" src="${esc(item.cover || '')}" alt=""><div><div class="recent-name">${esc(item.name)}</div><div class="recent-status">${esc(typeOf(item))} · ${esc(item.status)}</div></div><span class="recent-date">${formatDate(item.createdAt)}</span></div>`).join('') : '<div class="empty-state" style="padding:35px 12px;border:0"><p>还没有添加资源，请前往资源页添加条目。</p></div>';
  all('.recent-item[data-open-id]').forEach((node) => node.addEventListener('click', () => openEditor(node.dataset.openId))); all('.recent-cover').forEach((image, index) => image.addEventListener('error', () => repairImage(image, index)));
  const maxType = Math.max(1, ...typeCounts.map(([, , count]) => count)); const topTags = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8); const maxTag = Math.max(1, ...topTags.map(([, count]) => count)); const statusText = statusEntries.length ? statusEntries.slice(0, 4).map(([name, count]) => `${name} ${count}`).join(' · ') : '暂无状态记录';
  $('insights').innerHTML = `<div class="insight-section"><h3>收藏结构</h3>${(typeCounts.length ? typeCounts : [['', '暂无数据', 0]]).map(([, name, count]) => `<div class="bar-row"><span>${name}</span><div class="bar-track"><div class="bar-fill" style="width:${count / maxType * 100}%"></div></div><strong>${count}</strong></div>`).join('')}</div><div class="insight-section"><h3>主题偏好</h3>${(topTags.length ? topTags : [['暂无标签', 0]]).map(([name, count]) => `<div class="bar-row"><span>${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${count / maxTag * 100}%"></div></div><strong>${count}</strong></div>`).join('')}</div><div class="insight-section insight-narrative"><h3>使用画像</h3><p>当前收藏以 <strong>${esc(topType ? topType[1] : '多种媒体')}</strong> 为主，状态分布为 <strong>${esc(statusText)}</strong>。</p><p>${topGenre ? `最常出现的主题是 <strong>${esc(topGenre[0])}</strong>，共覆盖 ${topGenre[1]} 条资源。` : '补充类型标签后，这里会生成更准确的偏好分析。'}</p></div>`;
  renderUsageChart();refreshUsage().then(()=>{if(activeView==='dashboard')renderUsageChart();});renderAnnualReview();
}
function renderAnnualReview() {
  const years = Array.from(new Set([new Date().getFullYear().toString(), ...state.items.flatMap((item) => [String(item.createdAt || '').slice(0, 4), String(item.completedDate || '').slice(0, 4)]).filter((year) => /^\d{4}$/.test(year))])).sort().reverse(); const select = $('annualYear'); if (!select) return; const previous = select.value; select.innerHTML = years.map((year) => `<option value="${year}">${year} 年</option>`).join(''); select.value = years.includes(previous) ? previous : years[0]; const year = select.value;
  const inYear = state.items.filter((item) => String(item.createdAt || '').startsWith(year) || String(item.completedDate || '').startsWith(year)); const added = inYear.filter((item) => String(item.createdAt || '').startsWith(year)); const completed = inYear.filter((item) => String(item.completedDate || '').startsWith(year) || (isCompleted(item) && String(item.updatedAt || '').startsWith(year))); const hours = inYear.reduce((sum, item) => sum + (Number(item.playtime) || 0), 0); const typeCounts = {}; const genreCounts = {}; inYear.forEach((item) => { typeCounts[item.type] = (typeCounts[item.type] || 0) + 1; (item.genres || []).forEach((genre) => { genreCounts[genre] = (genreCounts[genre] || 0) + 1; }); }); const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]; const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]; const monthDone = Array.from({ length: 12 }, (_, index) => { const month = String(index + 1).padStart(2, '0'); return { label: `${index + 1}月`, value: inYear.filter((item) => String(item.completedDate || '').slice(5, 7) === month).length + inYear.filter((item) => !item.completedDate && String(item.createdAt || '').slice(5, 7) === month).length }; }); const max = Math.max(1, ...monthDone.map((entry) => entry.value)); const top = [...inYear].filter((item) => Number(item.rating) > 0).sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 3);
  $('annualSummary').innerHTML = [['新增条目', added.length], ['完成 / 看完', completed.length], ['投入时长', `${hours.toFixed(1)} 小时`], ['年度主轴', topType ? `${TYPE_LABELS[topType[0]] || topType[0]}` : '—']].map(([label, value]) => `<div class="annual-metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const narrative = inYear.length ? `${year} 年你新增了 ${added.length} 条资源，完成或看完 ${completed.length} 条，累计记录 ${hours.toFixed(1)} 小时。内容主要集中在 <strong>${esc(topType ? (TYPE_LABELS[topType[0]] || topType[0]) : '多种媒体')}</strong>${topGenre ? `，最常出现的主题是 <strong>${esc(topGenre[0])}</strong>` : ''}。` : `${year} 年还没有足够的记录，添加资源并记录状态后会自动生成年度报告。`;
  $('annualTimeline').innerHTML = `<div class="annual-chart">${monthDone.map((entry) => `<div class="month-bar"><div class="month-value" style="height:${entry.value / max * 100}%"><span>${entry.value || ''}</span></div><small>${entry.label}</small></div>`).join('')}</div><div class="annual-highlights"><h3>年度高光</h3>${top.length ? top.map((item) => `<button class="annual-item" data-open-id="${esc(item.id)}"><span>${stars(item.rating)}</span><strong>${esc(item.name)}</strong><small>${esc(typeOf(item))}</small></button>`).join('') : '<p>给年度收藏补充评分，就能看到年度高光。</p>'}<p class="annual-analysis">${narrative}</p></div>`; all('.annual-item[data-open-id]').forEach((node) => node.addEventListener('click', () => openEditor(node.dataset.openId)));
}
function selectedFilterValues(id) { return resourceFilters.selected(id); }
function filterItems() {
  const query = $('searchInput').value.trim().toLowerCase();
  return librarySorting.apply(state.items.filter(item => {
    if (activeView !== 'all' && item.type !== activeView) return false;if(window.audioBrowser&&!audioBrowser.matches(item))return false;
    const text = [item.name, item.developer, item.publisher, item.review, item.description, ...(item.audio?.artists||[]), ...(item.audio?.albumArtists||[]), item.audio?.circle, ...(item.audio?.creators||[]), ...(item.audio?.performers||[]), ...(item.audio?.tracks||[]).flatMap(t=>[t.title,...t.artists||[]]), ...(item.genres || []), ...(item.categories || [])].join(' ').toLowerCase();
    return (!query || text.includes(query)) && resourceFilters.matches(item);
  }));
}
function populateFilters() {
  resourceFilters.render(state.items, renderLibrary);
}
function cardHtml(item) { return buildLibraryCard(item); }
function mergeRefreshedItem(current,original,updated) {
 const next={...current};
 for(const [key,value]of Object.entries(updated||{}))if(JSON.stringify(current[key])===JSON.stringify(original[key]))next[key]=value;
 return next;
}

function renderLibrary() {
 const previousCards=new Map([...$('libraryGrid').children].map(node=>[node.dataset.id,node.getBoundingClientRect()])); const previousLayout=$('libraryGrid').dataset.motionLayout;const previousView=$('libraryGrid').dataset.motionView;const previousIds=[...previousCards.keys()].join('|');
 $('libraryEyebrow').textContent=activeView==='all'?'资源列表':'我的收藏';
 $('libraryHeading').innerHTML=`<span id="resultCount">0</span><span class="resource-count-unit">项资源</span>`;
 $('librarySearchHeader').prepend($('libraryHeading'));const actions=$('filterToggle').closest('.toolbar-actions');$('librarySearchHeader').append(actions);populateFilters();librarySorting.render();const items=filterItems();$('resultCount').textContent=items.length;const layout=currentLibraryLayout();const audioRows=window.audioBrowser?.render(items);document.querySelector('.view-switch').classList.toggle('hidden',Boolean(audioRows));if(audioRows){decorateLocalCards();renderLibrarySelection();return;}$('libraryGrid').classList.remove('audio-browser-list');$('libraryGrid').classList.add('library-grid');
 all('.view-switch-btn').forEach(button=>{button.classList.toggle('active',button.dataset.layout===layout);button.setAttribute('aria-pressed',String(button.dataset.layout===layout));});
 for(const [name,value]of [['small','small'],['list','list'],['portrait','portrait']])$('libraryGrid').classList.toggle(name+'-layout',layout===value);
 $('libraryGrid').innerHTML=items.map(cardHtml).join('');$('libraryEmpty').classList.toggle('hidden',items.length>0);
 all('.resource-card').forEach(card=>{
  card.tabIndex=0;
  card.addEventListener('keydown',event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();card.click();}});
  card.addEventListener('click',async event=>{
   const action=event.target.closest('[data-action]')?.dataset.action,item=state.items.find(entry=>entry.id===card.dataset.id);if(!item)return;
   if(librarySelection.active&&!action){toggleLibrarySelection(item.id,event);return;}
   if(item.type==='audio'&&!action&&event.target.closest('.card-cover')&&!document.body.classList.contains('is-disguised')){window.audioPlayer?.playItem(item);return;}
   if(!action&&event.target.closest('.card-cover')&&!document.body.classList.contains('is-disguised')){openMedia(item.id);return;}
   try{
    if(action==='store'){const result=await native.openExternal(cardAccessUrl(item));await recordResourceOpen(item.id);return result;}
    if(action==='note')return await native.openExternal(item.noteUrl);
    if(action==='refresh'){
     if(document.body.classList.contains('is-disguised'))return;
     await refreshResources([item.id]);return;
    }
    if(document.body.classList.contains('is-disguised'))return await native.openDisguiseVideo(item.name,0);
    openEditor(item.id);
   }catch(error){showToast('操作未完成：'+error.message,'error');}
  });
 });
 all('.card-cover img').forEach((image,index)=>repairCardCover(image,items.find(item=>item.id===image.closest('.resource-card').dataset.id)||{},index));
 renderLibrarySelection();decorateLocalCards();fitCardTags();
 $('libraryGrid').dataset.motionLayout=layout;
 $('libraryGrid').dataset.motionView=activeView;
 if(previousLayout&&previousLayout!==layout&&previousView===activeView&&settings.appearance?.animations!==false&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
  for(const card of $('libraryGrid').children){const before=previousCards.get(card.dataset.id),after=card.getBoundingClientRect();if(!before||before.bottom<0||after.top>innerHeight)continue;card.animate?.([{transform:`translate(${before.left-after.left}px,${before.top-after.top}px) scale(${before.width/after.width},${before.height/after.height})`,transformOrigin:'top left',opacity:1},{transform:'none',transformOrigin:'top left',opacity:1}],{duration:420,easing:'cubic-bezier(.22,1.12,.36,1)'});}
 } else if(settings.appearance?.animations!==false&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches&&(previousView!==activeView||previousIds!==items.map(item=>item.id).join('|'))){
  for(const card of $('libraryGrid').children){const after=card.getBoundingClientRect();if(after.top>innerHeight||after.bottom<0)continue;const before=previousView===activeView?previousCards.get(card.dataset.id):null;const dx=before?before.left-after.left:0,dy=before?before.top-after.top:10;card.animate?.([{transform:`translate(${dx}px,${dy}px) scale(${before?1:.97})`,opacity:1},{transform:'translate(0,-2px) scale(1.012,.992)',opacity:1,offset:.72},{transform:'none',opacity:1}],{duration:460,easing:'cubic-bezier(.22,.75,.25,1)'});}
 }
}
 
function renderCategories() {
  renderTagStatusFilters();
  const grid = $('categoryGrid');
  const keyOf = node => node.dataset.tagType + ':' + node.dataset.tagName;
  const positions = new Map([...grid.querySelectorAll('.tag-card')].map(node => [keyOf(node), node.getBoundingClientRect()]));
  const search = ($('categorySearch')?.value || '').trim().toLowerCase();
  const matched = state.items.filter(item => resourceFilters.matches(item));
  const hasSelection = Object.values(resourceFilters.values).some(values => values.size) || resourceFilters.hasCompletion();
  const possible = new Set();
  matched.forEach(item => { (item.genres || []).forEach(tag => possible.add('genre:' + tag)); (item.categories || []).forEach(tag => possible.add('category:' + tag)); });
  const entries = new Map();
  const add = (kind, name) => { const key = kind + ':' + name; if (!entries.has(key)) entries.set(key, { kind, name, count: 0 }); };
  state.categories.forEach(name => add('category', name));
  state.items.forEach(item => { (item.categories || []).forEach(name => add('category', name)); (item.genres || []).forEach(name => add('genre', name)); });
  matched.forEach(item => { (item.categories || []).forEach(name => entries.get('category:' + name).count++); (item.genres || []).forEach(name => entries.get('genre:' + name).count++); });
  const selected = entry => resourceFilters.selected(entry.kind === 'genre' ? 'genreFilter' : 'categoryFilter').includes(entry.name);
  const filtered = [...entries.values()].filter(entry => (selected(entry) || (!hasSelection || possible.has(entry.kind + ':' + entry.name))) && (tagKind === 'all' || entry.kind === tagKind) && (!search || entry.name.toLowerCase().includes(search))).sort((a,b) => a.name.localeCompare(b.name, 'zh') || a.kind.localeCompare(b.kind));
  let tools = $('tagSelectionTools');
  if (!tools) { tools = document.createElement('div'); tools.id = 'tagSelectionTools'; tools.className = 'tag-selection-tools'; grid.before(tools); }
  $('categoriesView').querySelector('.tag-tools').append(tools);
  tools.innerHTML = '<p class="tag-selection-hint">再次点击已选标签可取消；仅显示还能匹配的标签。</p><div><button type="button" class="secondary-button" id="resetTagSelection">清除选择</button> <button type="button" class="add-button" id="viewTagResults">查看匹配资源（' + matched.length + '） →</button></div>';
  $('resetTagSelection').onclick = () => { resourceFilters.clear(); renderCategories(); };
  $('viewTagResults').onclick = () => { activeView = 'all'; render(); $('filters').classList.remove('hidden'); };
  grid.innerHTML = filtered.length ? filtered.map(entry => '<article tabindex="0" role="button" aria-pressed="' + selected(entry) + '" class="category-card tag-card' + (selected(entry) ? ' selected' : '') + '" data-tag-name="' + esc(entry.name) + '" data-tag-type="' + entry.kind + '"><span class="tag-kind">' + (entry.kind === 'category' ? '分类' : '类型标签') + (selected(entry) ? ' · 已选中 ✓' : '') + '</span><strong>' + esc(entry.name) + '</strong><small>' + entry.count + ' 条匹配资源</small></article>').join('') : '<div class="empty-state"><h3>没有匹配的标签</h3><p>可清除选择或搜索条件。</p></div>';
  grid.querySelectorAll('.tag-card').forEach(card => {
    const toggle = () => { resourceFilters.toggle(card.dataset.tagType === 'genre' ? 'genreFilter' : 'categoryFilter', card.dataset.tagName); renderCategories(); [...grid.querySelectorAll('.tag-card')].find(node => keyOf(node) === keyOf(card))?.focus({ preventScroll: true }); };
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); toggle(); } });
    if (settings.appearance?.animations === false || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !card.animate) return;
    const before = positions.get(keyOf(card)), after = card.getBoundingClientRect();
    const dx = before ? before.left - after.left : 0, dy = before ? before.top - after.top : 12;
    card.animate([
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + (before ? '1' : '.92') + ')', opacity: 1 },
      { transform: 'translate(' + (-dx * .035) + 'px,' + (-dy * .035) + 'px) scale(1.035,.975)', opacity: 1, offset: .72 },
      { transform: 'translate(0,0) scale(.992,1.008)', offset: .88 },
      { transform: 'translate(0,0) scale(1)', opacity: 1 }
    ], { duration: 560, easing: 'cubic-bezier(.22,.75,.25,1)' });
  });
}
function setStatusOptions(type, selected = '') { selected = StatusModel.normalize(selected, type); const values = statusList(type); $('fieldStatus').innerHTML = values.map((value) => `<option value="${esc(value)}">${value === '全成就' ? '🏆 ' : ''}${esc(value)}</option>`).join(''); $('fieldStatus').value = values.includes(selected) ? selected : values[0]; updateCompletedDateState(); updateTypeFields(type); }
function updateTypeFields(type = $('fieldType')?.value || 'game') {
  const show = (selector, enabled) => all(selector).forEach(node => node.classList.toggle('hidden', !enabled));
  const game = type === 'game', publication = ['book', 'manga'].includes(type), media = ['movie', 'anime'].includes(type);
  $('editorForm').dataset.mediaType = type;window.audioEditor?.show(type);
  show('.game-only', game); const platforms=PlatformModel.detect({...editorMetadata,storeUrl:valueFor('fieldStoreUrl'),steamAppId:valueFor('fieldSteamAppId')});show('#steamAppIdField',game&&(!platforms.length||platforms.includes('steam'))); show('#pickSavePathsBtn, #backupSaveBtn, #openBackupBtn', game); show('#savePathHint', game && editorSavePaths.length > 0);
  renderPlatformPicker();
  show('.media-only', media); show('.publication-only', publication); show('.resource-only', !game);
  const localOnly=['audio','software','document','unknown_application','unknown_collection'].includes(type);show('#metadataBtn',!localOnly||type==='audio');
  $('developerField').firstChild.textContent = game ? '开发商 / 工作室' : publication ? '作者 / 原作' : type === 'movie' ? '导演' : '制作 / 导演';
  $('publisherField').firstChild.textContent = publication ? '出版社' : game ? '发行商' : '平台 / 制作方';
  $('castField').firstChild.textContent = type === 'movie' ? '演员' : '声优';
  $('resourceUrlLabel').textContent = publication ? '购买 / 阅读链接' : '观看 / 访问链接';
  $('releaseDateField').firstChild.textContent = publication ? '出版日期' : '发行日期';
  $('platformRatingLabel').textContent = game ? 'Steam 评价' : '来源平台评分'; renderPlatformRating();
  $('playtimeField').firstChild.textContent = game ? '游玩时长（小时）' : '阅读时长（小时）';
  show('#playtimeField', game || publication); show('#platformRatingField', type !== 'other');
  if(localOnly){show('#platformRatingField',false);$('developerField').firstChild.textContent=['software','unknown_application'].includes(type)?'开发者 / 公司':'作者';$('publisherField').firstChild.textContent=['software','unknown_application'].includes(type)?'发行方':'来源 / 机构';}
  $('fieldGenres').placeholder=type==='audio'?'流行, 古典, 环境音':'动作, RPG';
  $('fieldCompletedDate').closest('.field').classList.toggle('hidden',type==='audio');
  $('fieldCompletedDate').closest('.progress-row').classList.toggle('hidden',type==='audio');
  show('#fieldStatus',true);$('fieldStatus').closest('.field').classList.toggle('hidden',type==='audio');
  if(type==='audio'){show('#developerField,#resourceUrlField,#platformRatingField',false);show('#publisherField',true);$('publisherField').firstChild.textContent='发行方 / 厂牌';}
  requestAnimationFrame(syncOverflowFields);
}
function updateCompletedDateState() { const field=$('fieldCompletedDate');field.disabled=false;field.title='点击选择完成日期，也可用键盘输入；不受当前状态限制';field.parentElement.title=field.title; }
function setRating(value) { setStarSlider(value); }
function valueFor(id) { return $(id)?.value?.trim() || ''; } function splitValues(value) { return value.split(/[,，、]/).map((entry) => entry.trim()).filter(Boolean); }
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return bytes + ' B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'; if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'; return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'; }
function ensureBackupPanel() { if ($('backupList')) return; const host = document.querySelector('.editor-main'); if (!host) return; const panel = document.createElement('div'); panel.id = 'backupList'; panel.className = 'backup-list backup-manager'; host.appendChild(panel); $('openBackupBtn').textContent = '▣ 打开备份文件夹'; }
async function renderBackupList() {
  ensureBackupPanel();
  const panel = $('backupList'), itemId = editorId, version = ++backupRenderVersion;
  if (!panel) return;
  panel.classList.toggle('hidden', $('fieldType').value !== 'game');
  if ($('fieldType').value !== 'game') { panel.textContent = ''; return; }
  if (!itemId) { panel.innerHTML = '<div class="backup-list-title">存档备份</div><div class="backup-empty">还没有存档备份。请先保存条目，选择存档位置后点击“立即备份存档”。</div>'; return; }
  panel.textContent = '正在读取存档备份…';
  const backups = await native.listBackups(itemId);
  if (editorId !== itemId || version !== backupRenderVersion) return;
  panel.innerHTML = backups?.length ? '<div class="backup-list-title">存档快照 <span>' + backups.length + ' 份</span></div>' + backups.map(entry =>
    '<div class="backup-entry"><div class="backup-entry-main"><strong>' + formatDateTime(entry.createdAt) +
    '</strong><span>' + entry.files + ' 个文件 · ' + formatBytes(entry.size) + '</span></div><span class="backup-sync">' +
    esc(entry.syncStatus || '待同步') + '</span><button type="button" class="backup-restore" data-backup-id="' + esc(entry.id) +
    '">切换</button><button type="button" class="backup-delete" data-backup-id="' + esc(entry.id) + '">删除</button></div>'
  ).join('') : '<div class="backup-empty">还没有存档备份。选择位置后点击“立即备份存档”。</div>';
  all('.backup-restore, .backup-delete', panel).forEach(button => button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    const backup = backups.find(entry => entry.id === button.dataset.backupId);
    if (!backup) return;
    const removing = button.classList.contains('backup-delete');
    const confirmed = removing
      ? await confirmDeletion('删除 ' + formatDateTime(backup.createdAt) + ' 的存档备份？此操作无法撤销。')
      : await askConfirm('切换到 ' + formatDateTime(backup.createdAt) + ' 的存档？当前文件可能被覆盖。', { title: '恢复存档前确认', confirmText: '确认切换', danger: true });
    if (!confirmed || editorId !== itemId) return;
    button.disabled = true;
    try {
      const result = removing ? await native.deleteBackup(itemId, backup.id) : await native.restoreBackup(itemId, backup.id);
      if (!result?.ok) throw Error(result?.message || '操作失败');
      const remaining = await native.listBackups(itemId);
      if (removing && remaining.some(entry => entry.id === backup.id)) throw Error('快照仍然存在，请检查文件占用或权限');
      const item = state.items.find(entry => entry.id === itemId);
      if (item) { item.backupCount = remaining.length; state = await native.saveLibrary(state); }
      if (editorId === itemId) await renderBackupList();
      showToast(removing ? '存档快照已删除' : '已切换到所选存档');
    } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
  }));
}
function updateSavePathHint() { const hint = $('savePathHint'); if (hint) hint.textContent = editorSavePaths.length ? `已选择 ${editorSavePaths.length} 个文件/文件夹` : ''; if (hint) hint.classList.toggle('hidden', !editorSavePaths.length); $('fieldSavePaths').value = JSON.stringify(editorSavePaths); }
function updateLinkButtons() { $('openLocalResourceBtn').disabled = !valueFor('fieldLocalPath'); $('openResourceUrlBtn').disabled = !valueFor('fieldResourceUrl'); $('openStoreBtn').disabled = !valueFor('fieldStoreUrl'); $('openNoteBtn').disabled = !valueFor('fieldNoteUrl'); $('openBackupBtn').disabled = !editorId; $('backupSaveBtn').disabled = !editorId || !editorSavePaths.length; }
function fillEditor(item) { cancelMetadataLookup(); hideSettingsToast(); ++editorFileRequest; closeResourcePathMenu(); endEditorSaveCue(); item = MetadataText.candidate(item || {}); $('editorId').value = item?.id || ''; $('editorEyebrow').textContent = item ? '编辑资源' : '新建资源'; $('editorTitle').textContent = item ? item.name : '添加资源'; $('fieldName').value = item?.name || ''; $('fieldType').value = item?.type || 'game'; setStatusOptions($('fieldType').value, item?.status || ''); $('fieldCompletedDate').value = item?.completedDate || ''; $('fieldPlaytime').value = item?.playtime ?? ''; $('fieldGenres').value = (item?.genres || []).join(', '); $('fieldCategories').value = (item?.categories || []).join(', '); $('fieldDeveloper').value = item?.developer || ''; $('fieldPublisher').value = item?.publisher || ''; $('fieldReleaseDate').value = item?.releaseDate || ''; $('fieldExternalRating').value = item?.externalRating || item?.steamRating || ''; $('fieldSteamAppId').value = item?.steamAppId || ''; $('fieldCast').value = (item?.cast || []).join(', '); $('fieldEpisodes').value = item?.episodes ?? ''; $('fieldIsbn').value = item?.isbn || ''; $('fieldPages').value = item?.pages ?? ''; $('fieldTranslator').value = item?.translator || ''; $('fieldResourceUrl').value = item?.resourceUrl || ''; $('fieldLocalPath').value = item?.localPath || ''; renderMetadataCoverage(item); fillCoverFields(item); $('fieldReview').value = item?.review || ''; $('fieldDescription').value = item?.description || ''; $('fieldStoreUrl').value = item?.storeUrl || ''; $('fieldNoteUrl').value = item?.noteUrl || ''; editorSavePaths = [...(item?.savePaths || [])]; updateSavePathHint(); setRating(item?.rating ?? null); updateCoverPreview(coverFor(item, ['book', 'manga'].includes(item.type) ? 'portrait' : 'landscape')); $('deleteBtn').classList.toggle('hidden', !item); updateLinkButtons(); $('editorBackdrop').classList.remove('hidden'); updateTypeFields($('fieldType').value); ensureBackupPanel(); renderBackupList(); window.audioEditor?.fill(item);beginEditorSaveCue(); requestAnimationFrame(syncOverflowFields); setTimeout(() => {if(!$('editorBackdrop').classList.contains('hidden'))$('fieldName').focus();}, 30); }
function updateCoverPreview(url) {
  const preview = $('coverPreview'); preview.classList.toggle('empty-cover', !url);
  preview.innerHTML = url ? '<img src="' + esc(url) + '" alt="' + esc(valueFor('fieldName') || '封面') + '">' : '<span>暂无封面</span>';
  const image = preview.querySelector('img'); if (image) { image.dataset.coverDirection = ['book','manga'].includes($('fieldType').value)?'portrait':'landscape'; attachStableCover(image,{...editorCovers,name:valueFor('fieldName')}); }
}
function openEditor(id = null) { if (document.body.classList.contains('is-disguised')) return; editorId = id; const typeFromView = ['audio', 'game', 'software', 'movie', 'anime', 'manga', 'book', 'document', 'unknown_application', 'unknown_collection', 'other'].includes(activeView) ? activeView : 'game'; const item = id ? state.items.find((entry) => entry.id === id) : { type: typeFromView }; fillEditor(item); if (!id) { $('editorEyebrow').textContent = '新建资源'; $('editorTitle').textContent = '添加资源'; $('deleteBtn').classList.add('hidden'); } } function closeEditor() { window.audioCompletion?.clearDeferred(editorId);cancelMetadataLookup(); endEditorSaveCue(); closeResourcePathMenu(); closeCoverDialog(); metadataRequestId += 1; $('editorBackdrop').classList.add('hidden'); editorId = null; }
async function applyCandidate(candidate) {
  if(!candidate||$('editorBackdrop').classList.contains('hidden'))return;
  candidate=MetadataText.candidate(candidate);const previous=metadataSession?.fields||{},before=getEditorMetadata(),hadPlaytime=valueFor('fieldPlaytime')!=='';
  const changed=id=>Object.hasOwn(previous,id)&&$(id).value!==previous[id];
  const scoreChanged=changed('fieldExternalRating'),coverChanged=Boolean(metadataSession?.covers&&metadataSession.covers!==JSON.stringify(getEditorCovers()));
  cancelMetadataLookup();const epoch=metadataSelectionEpoch,owner=editorId,type=$('fieldType').value;
  const fields={fieldName:'name',fieldPlaytime:'playtime',fieldGenres:'genres',fieldDeveloper:'developer',fieldPublisher:'publisher',fieldReleaseDate:'releaseDate',fieldExternalRating:'externalRating',fieldCast:'cast',fieldEpisodes:'episodes',fieldIsbn:'isbn',fieldPages:'pages',fieldTranslator:'translator',fieldStoreUrl:'storeUrl',fieldDescription:'description'};
  for(const [id,key]of Object.entries(fields)){
    if(changed(id)||key==='playtime'&&valueFor(id)!=='')continue;const value=candidate[key]??(key==='externalRating'?candidate.steamRating:null);
    if(value!==undefined&&value!==null&&value!=='')$(id).value=Array.isArray(value)?value.join(', '):value;
  }
  if(type==='game'&&!changed('fieldSteamAppId'))$('fieldSteamAppId').value=candidate.steamAppId||(/^Steam$/i.test(candidate.metadataSource||'')&&/^\d+$/.test(String(candidate.id))?String(candidate.id):'');
  const manualTime=changed('fieldPlaytime')||before.playtimeSource==='手动';
  renderMetadataCoverage(candidate);
  if(hadPlaytime)for(const key of ['steamPlaytime','steamPlaytimeAt','playtimeSource'])editorMetadata[key]=before[key];
  if(manualTime)editorMetadata.playtimeSource='手动';
  if(before.platformsManual){editorMetadata.platforms=before.platforms;editorMetadata.platformsManual=true;editorMetadata.fieldSources.platforms='手动';}
  if(scoreChanged||!(candidate.externalRating||candidate.steamRating))for(const key of ['ratingSource','ratingValue','ratingMax','ratingEdited'])editorMetadata[key]=before[key];
  for(const [id,key]of Object.entries(fields))if(changed(id)||candidate[key]===undefined||candidate[key]===null||candidate[key]==='')editorMetadata.fieldSources[key]=before.fieldSources?.[key]||'';
  if(!coverChanged)applyCoverCandidate(candidate);
  updateTypeFields(type);updateLinkButtons();updateEditorSaveCue(true);requestAnimationFrame(syncOverflowFields);
  showToast('已填充元数据，请检查后保存');
  if(native.prepareMetadataCandidate&&!coverChanged){
    const covers=JSON.stringify(getEditorCovers());
    try{const prepared=await native.prepareMetadataCandidate(candidate);
      if(prepared&&epoch===metadataSelectionEpoch&&editorId===owner&&$('fieldType').value===type&&!$('editorBackdrop').classList.contains('hidden')&&covers===JSON.stringify(getEditorCovers())){applyCoverCandidate(prepared);updateEditorSaveCue(false);}
    }catch{/* Online URLs remain usable if local image preparation fails. */}
  }
}
async function saveEditor(event) { event.preventDefault(); const name = valueFor('fieldName'); if (!name) { showToast('名称不能为空', 'error'); return; } const old = editorId ? state.items.find((item) => item.id === editorId) : null; const type = $('fieldType').value; const item = { ...(old || {}), id: editorId || `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, type, ...(type==='audio'?{audio:window.audioEditor.value()}:{}), status: $('fieldStatus').value, completedDate: valueFor('fieldCompletedDate'), playtime: valueFor('fieldPlaytime') ? Number(valueFor('fieldPlaytime')) : null, rating: editorRatingKnown ? currentRating : null, genres: splitValues(valueFor('fieldGenres')), categories: splitValues(valueFor('fieldCategories')), developer: valueFor('fieldDeveloper'), publisher: valueFor('fieldPublisher'), releaseDate: valueFor('fieldReleaseDate'), externalRating: valueFor('fieldExternalRating'), steamAppId: type === 'game' ? valueFor('fieldSteamAppId') : '', cast: ['movie', 'anime'].includes(type) ? splitValues(valueFor('fieldCast')) : [], episodes: ['movie', 'anime'].includes(type) && valueFor('fieldEpisodes') ? Number(valueFor('fieldEpisodes')) : null, isbn: ['book', 'manga'].includes(type) ? valueFor('fieldIsbn') : '', pages: ['book', 'manga'].includes(type) && valueFor('fieldPages') ? Number(valueFor('fieldPages')) : null, translator: ['book', 'manga'].includes(type) ? valueFor('fieldTranslator') : '', resourceUrl: ['movie', 'anime', 'manga', 'book', 'document', 'unknown_collection', 'other'].includes(type) ? valueFor('fieldResourceUrl') : '', localPath: valueFor('fieldLocalPath'), localFiles: valueFor('fieldLocalPath')===old?.localPath?(old?.localFiles||[]):valueFor('fieldLocalPath')?(old?.localFiles||[]).some(f=>LocalModel.pathKey(f.path)===LocalModel.pathKey(valueFor('fieldLocalPath')))?old.localFiles:[{path:valueFor('fieldLocalPath'),name:LocalModel.base(valueFor('fieldLocalPath'))}]:[], ...getEditorCovers(), ...getEditorMetadata(), review: valueFor('fieldReview'), description: valueFor('fieldDescription'), storeUrl: valueFor('fieldStoreUrl'), noteUrl: valueFor('fieldNoteUrl'), savePaths: editorSavePaths, createdAt: old ? old.createdAt || '' : new Date().toISOString(), updatedAt: new Date().toISOString(), sortOrder: old?.sortOrder ?? state.items.length }; if (!state.categories) state.categories = []; state.categories = Array.from(new Set(state.categories.concat(item.categories))); state.items = old ? state.items.map((entry) => entry.id === old.id ? item : entry) : [...state.items, item]; state = await native.saveLibrary(state);window.audioCompletion?.afterSave(item.id,editorId); closeEditor(); render(); showToast(old ? '条目已更新' : '已添加到你的资源空间'); }

function clearFilters() { resourceFilters.clear(); renderLibrary(); }
async function refreshAllMetadata() { return refreshResources(filterItems().map(item=>item.id)); }
async function selectSavePaths() { if ($('fieldType').value !== 'game') { showToast('存档备份仅适用于游戏条目', 'error'); return; } const paths = await native.pickSavePaths(); if (paths?.length) { editorSavePaths = Array.from(new Set(paths)); updateSavePathHint(); updateLinkButtons(); updateEditorSaveCue(true); showToast(`已选择 ${paths.length} 个存档位置`); } }
async function backupCurrentSaves() { if (!editorId) { showToast('请先保存条目，再备份存档', 'error'); return; } if (!editorSavePaths.length) { showToast('请先选择存档文件或文件夹', 'error'); return; } const result = await native.backupSaves(editorId, editorSavePaths); if (!result?.ok) { showToast(result?.message || '存档备份失败', 'error'); return; } const item = state.items.find((entry) => entry.id === editorId); if (item) { item.backupCount = (Number(item.backupCount) || 0) + 1; item.lastBackupAt = result.createdAt; state = await native.saveLibrary(state); } showToast(`存档已备份（${result.files || 0} 个文件）`); }
async function syncWebdav(direction) { if (!(await flushSettingsSave())) return; const status = $('webdavStatus'); status.textContent = '同步中…'; const current = { ...settings, webdavUrl: valueFor('settingsWebdavUrl'), webdavUsername: valueFor('settingsWebdavUsername'), webdavPassword: $('settingsWebdavPassword').value, webdavRemotePath: valueFor('settingsWebdavPath') || 'UnifiedManager' }; const result = await native.syncWebdav(current, direction); status.textContent = result?.message || '同步完成'; if (result?.ok && direction !== 'upload') { state = await native.loadLibrary(); await refreshUsage(); settings = await native.loadSettings(); render(); } if (!result?.ok) showToast(result?.message || 'WebDAV 同步失败', 'error'); else showToast(result.message); }
async function testWebdav() { const status = $('webdavStatus'); status.textContent = '测试中…'; const result = await native.testWebdav({ ...settings, webdavUrl: valueFor('settingsWebdavUrl'), webdavUsername: valueFor('settingsWebdavUsername'), webdavPassword: $('settingsWebdavPassword').value, webdavRemotePath: valueFor('settingsWebdavPath') || 'UnifiedManager' }); status.textContent = result?.message || ''; showToast(result?.message || '测试完成', result?.ok ? 'normal' : 'error'); }
const DISGUISE_SAFE_LIBRARY = [
  { name: '资源整理基础课', tags: ['课程', '效率'], category: '学习资料', description: '建立清晰、可持续的个人资料整理方法。', color: ['#2d7e82', '#65c7ad'] },
  { name: '标签体系设计', tags: ['知识管理', '方法论'], category: '学习资料', description: '用少量高质量标签提升查找效率。', color: ['#65509a', '#a98be2'] },
  { name: '数字备份实践', tags: ['数据安全', '实操'], category: '公开课程', description: '从本地快照到云端同步的完整实践。', color: ['#a3623d', '#e4a06e'] },
  { name: '年度复盘工作流', tags: ['复盘', '效率'], category: '公开课程', description: '把一年的记录整理成清楚的回顾。', color: ['#3b6795', '#7aa8d9'] },
  { name: '阅读笔记结构化', tags: ['阅读', '笔记'], category: '学习资料', description: '让摘录、想法和行动项自然连接。', color: ['#8b4f6e', '#cf8ba8'] },
  { name: '专注与时间分配', tags: ['专注', '习惯'], category: '课程', description: '给长期项目建立轻盈稳定的节奏。', color: ['#527548', '#a6c878'] },
  { name: '数字收藏的取舍', tags: ['整理', '思考'], category: '课程', description: '减少噪音，保留值得再次打开的内容。', color: ['#39766f', '#77b9aa'] },
  { name: '云端同步入门', tags: ['WebDAV', '实操'], category: '学习资料', description: '检查同步状态，构建安心的多设备流程。', color: ['#5d5a88', '#9d9ad1'] },
];
const DISGUISE_DEFAULT_VIDEO = 'https://www.bilibili.com/video/BV1jR4y1M78W/?p=17&t=466';
let disguiseOriginalState = null;
let disguisePreviousView = 'dashboard';
function disguiseCover(title, index) {
  const safeTitle = String(title || '学习资料').slice(0, 16).replace(/[&<>"]/g, '');
  const palette = DISGUISE_SAFE_LIBRARY[index % DISGUISE_SAFE_LIBRARY.length].color;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + palette[0] + '"/><stop offset="1" stop-color="' + palette[1] + '"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="760" cy="90" r="180" fill="white" opacity=".12"/><circle cx="100" cy="410" r="210" fill="black" opacity=".13"/><text x="56" y="225" fill="white" font-size="50" font-family="Microsoft YaHei,Segoe UI" font-weight="700">' + safeTitle + '</text><text x="58" y="278" fill="white" opacity=".72" font-size="21" font-family="Segoe UI">LEARNING SPACE</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function disguiseVideoLink(index = 0, title = '') {
  const configured = String(settings.disguiseVideoUrl || '').trim();
  const raw = configured && configured !== DISGUISE_DEFAULT_VIDEO ? configured : `https://search.bilibili.com/all?keyword=${encodeURIComponent(title || '学习资料')}`;
  try {
    const target = new URL(raw);
    const host = (target.hostname + target.pathname).toLowerCase();
    if (/(bilibili|youtube|youtu\\.be|iqiyi|youku|vimeo|netflix)/i.test(host) && !target.searchParams.has('t') && !target.searchParams.has('start')) target.searchParams.set('t', String(360 + (index % 6) * 73));
    if (!configured || configured === DISGUISE_DEFAULT_VIDEO) return target.toString();
    return target.toString();
  } catch {
    return title ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}` : raw;
  }
}
function disguiseItem(item, index) {
  const safe = DISGUISE_SAFE_LIBRARY[index % DISGUISE_SAFE_LIBRARY.length];
  return {
    ...item,
    type: 'other',
    name: safe.name,
    status: ['待整理', '进行中', '已完成', '进行中'][index % 4],
    completedDate: '',
    playtime: null,
    rating: [4, 4.5, 5, 3.5][index % 4],
    genres: safe.tags,
    categories: [safe.category, '学习空间'],
    developer: '学习频道',
    publisher: '公开课程',
    releaseDate: '2024-' + String((index % 9) + 1).padStart(2, '0') + '-01',
    externalRating: '推荐',
    ratingSource: '', ratingValue: null, ratingMax: null, ratingEdited: false, platforms: [], platformLinks: {}, fieldSources: {}, metadataSource: '',
    steamRating: '',
    steamAppId: '',
    cover: disguiseCover(safe.name, index), coverPortrait: disguiseCover(safe.name, index), coverLandscape: disguiseCover(safe.name, index),
    review: '学习空间中的课程条目。',
    description: safe.description,
    storeUrl: disguiseVideoLink(index, safe.name),
    noteUrl: `obsidian://open?path=${encodeURIComponent(`学习空间/${safe.name}.md`)}`,
    savePaths: [], localPath:'',localFiles:[],resourceUrl:'',
    backupCount: 0,
  };
}
function applyDisguise(disguise) {
  const enabled = Boolean(disguise?.enabled);
  const profile = disguise?.profile || settings.disguiseProfile || 'course';
  settings = { ...settings, disguiseEnabled: enabled, disguiseProfile: profile };
  if (enabled) {
    cancelMetadataLookup();hideSettingsToast();$('readerBackdrop')?.classList.add('hidden');closeMedia();if(localImportSession)closeLocalImport();
    if (!disguiseOriginalState) { disguiseOriginalState = JSON.parse(JSON.stringify(state)); disguisePreviousView = activeView; }
    state = { ...disguiseOriginalState, categories: ['学习空间', '学习资料', '课程', '公开课程'], items: (disguiseOriginalState.items || []).map(disguiseItem) };
    activeView = 'all';
    $('editorBackdrop')?.classList.add('hidden');
    $('candidateBackdrop')?.classList.add('hidden');
    document.body.classList.add('is-disguised');
    $('disguiseScreen').classList.add('hidden');
    render();
  } else {
    if (disguiseOriginalState) { state = disguiseOriginalState; disguiseOriginalState = null; activeView = disguisePreviousView || 'dashboard'; }
    document.body.classList.remove('is-disguised');
    $('disguiseScreen').classList.add('hidden');
    render();
    renderLibrary();
  }
  if ($('disguiseStatus')) $('disguiseStatus').textContent = enabled ? '已启用封面与标签伪装，Ctrl + Shift + U 退出' : '';
}

async function backupCurrentSaves() { if (!editorId) { showToast('请先保存条目，再备份存档', 'error'); return; } if (!editorSavePaths.length) { showToast('请先选择存档文件或文件夹', 'error'); return; } const result = await native.backupSaves(editorId, editorSavePaths); if (!result?.ok) { showToast(result?.message || '存档备份失败', 'error'); return; } const item = state.items.find((entry) => entry.id === editorId); if (item) { item.backupCount = (Number(item.backupCount) || 0) + 1; item.lastBackupAt = result.createdAt; state = await native.saveLibrary(state); } await renderBackupList(); showToast('存档已备份（' + (result.files || 0) + ' 个文件）'); }
async function syncWebdav(direction) { if (!(await flushSettingsSave())) return; const status = $('webdavStatus'); status.textContent = '同步中…'; const current = { ...settings, webdavUrl: valueFor('settingsWebdavUrl'), webdavUsername: valueFor('settingsWebdavUsername'), webdavPassword: $('settingsWebdavPassword').value, webdavRemotePath: valueFor('settingsWebdavPath') || 'UnifiedManager' }; const result = await native.syncWebdav(current, direction); status.textContent = result?.message || '同步完成'; if (result?.ok) { state = await native.loadLibrary(); settings = await native.loadSettings(); render(); if (editorId) renderBackupList(); } if (!result?.ok) showToast(result?.message || 'WebDAV 同步失败', 'error'); else showToast(result.message); }
async function deleteEditor() { if (!editorId) return; const item = state.items.find((entry) => entry.id === editorId); if (!item || !(await confirmDeletion('确定删除“' + item.name + '”？此操作无法撤销。'))) return; state.items = state.items.filter((entry) => entry.id !== editorId); state = await native.saveLibrary(state); closeEditor(); render(); showToast('条目已删除'); }
async function addCategory() { const category = (await askPrompt('输入新分类名称：', '新分类') || '').trim(); if (!category) return; if (state.categories.includes(category)) { showToast('这个分类已经存在', 'error'); return; } state.categories.push(category); state = await native.saveLibrary(state); renderCategories(); showToast('分类已创建'); }
async function openBackupFolder() {
  if (!editorId) return;
  try { const error = await native.openBackupFolder(editorId); if (error) showToast('打开备份目录失败：' + error, 'error'); }
  catch (error) { showToast('打开备份目录失败：' + error.message, 'error'); }
}
function ensureSettingsColumns(){const layout=document.querySelector('.settings-layout');if(!layout||layout.querySelector('.settings-column'))return;const left=document.createElement('div'),right=document.createElement('div');left.className=right.className='settings-column';left.append($('settingsTheme').closest('.settings-card'),layout.querySelector('.webdav-card'));right.append($('settingsObsidian').closest('.settings-card'),layout.querySelector('.disguise-card'));layout.append(left,right);}
function ensureDeletePreference() { if ($('settingsConfirmDelete')) return; const card = $('settingsTheme')?.closest('.settings-card'); if (!card) return; const label = document.createElement('label'); label.className = 'check-label delete-preference'; label.innerHTML = '<input id="settingsConfirmDelete" type="checkbox" checked> 删除资源或存档前显示确认提醒'; const animation=$('settingsAnimations')?.closest('label');const row=document.createElement('div');row.className='settings-toggle-row';if(animation){animation.before(row);row.append(animation,label);}else card.appendChild(label); }
function installDisguiseButtonHandlers() {
  const enter = $('enterDisguiseBtn'); const exit = $('exitDisguiseBtn'); if (!enter || !exit || enter.dataset.umBound) return;
  const freshEnter = enter.cloneNode(true); const freshExit = exit.cloneNode(true); enter.replaceWith(freshEnter); exit.replaceWith(freshExit); freshEnter.dataset.umBound = 'true'; freshExit.dataset.umBound = 'true';
  freshEnter.addEventListener('click', async () => { const result = await native.setDisguise(true, $('settingsDisguiseProfile').value); settings = { ...settings, disguiseEnabled: true, disguiseProfile: result?.profile || $('settingsDisguiseProfile').value }; applyDisguise({ enabled: true, profile: settings.disguiseProfile }); });
  freshExit.addEventListener('click', async () => { const result = await native.setDisguise(false, $('settingsDisguiseProfile').value); settings = { ...settings, disguiseEnabled: false, disguiseProfile: result?.profile || settings.disguiseProfile || 'course' }; applyDisguise({ enabled: false, profile: settings.disguiseProfile }); });
}
function filterSelectOptions(input) { const target = $(input.dataset.target); if (!target) return; const query = input.value.trim().toLowerCase(); Array.from(target.options).forEach((option) => { option.hidden = Boolean(query && option.value !== 'all' && !option.textContent.toLowerCase().includes(query)); }); }
function ensureFilterSearches() { const labels = { statusFilter: '搜索状态…', genreFilter: '搜索类型标签…', categoryFilter: '搜索分类…', yearFilter: '搜索年份…', ratingFilter: '搜索评分…' }; Object.entries(labels).forEach(([targetId, placeholder]) => { const target = $(targetId); if (!target || document.querySelector('[data-filter-search="' + targetId + '"]')) return; const input = document.createElement('input'); input.className = 'filter-search'; input.dataset.filterSearch = targetId; input.dataset.target = targetId; input.placeholder = placeholder; input.addEventListener('input', () => filterSelectOptions(input)); target.insertAdjacentElement('afterend', input); new MutationObserver(() => filterSelectOptions(input)).observe(target, { childList: true }); }); }
function clearDragShift() { all('.resource-card').forEach((card) => card.classList.remove('shift-left', 'shift-right')); }
function updateDragShift(target) { const dragged = document.querySelector('.resource-card.dragging'); if (!dragged || !target || dragged === target) return clearDragShift(); const cards = [...document.querySelectorAll('.resource-card')]; const from = cards.indexOf(dragged); const to = cards.indexOf(target); clearDragShift(); if (from < to) cards.slice(from + 1, to + 1).forEach((card) => card.classList.add('shift-left')); else cards.slice(to, from).forEach((card) => card.classList.add('shift-right')); }
function bindEvents() {
  all('[data-view]').forEach((button) => button.addEventListener('click', () => { activeView = button.dataset.view; render(); })); $('addBtn').addEventListener('click', () => openEditor()); $('emptyAdd').addEventListener('click', () => openEditor()); $('searchInput').addEventListener('input', () => { if ($('searchInput').value && activeView === 'dashboard') activeView = 'all'; render(); }); $('filterToggle').addEventListener('click', () => $('filters').classList.toggle('hidden')); ['statusFilter', 'genreFilter', 'categoryFilter', 'yearFilter', 'ratingFilter'].forEach((id) => $(id).addEventListener('change', renderLibrary)); $('clearFilters').addEventListener('click', clearFilters); all('.view-switch-btn').forEach((button) => button.addEventListener('click', () => { setLibraryLayout(button.dataset.layout); }));
  $('fieldType').addEventListener('change', () => { setStatusOptions($('fieldType').value); updateTypeFields($('fieldType').value); renderBackupList(); }); $('fieldStatus').addEventListener('change', updateCompletedDateState); $('fieldStoreUrl').addEventListener('input', updateLinkButtons); $('fieldNoteUrl').addEventListener('input', updateLinkButtons); $('editorForm').addEventListener('submit', saveEditor); $('metadataBtn').addEventListener('click', fetchMetadata); $('deleteBtn').addEventListener('click', deleteEditor); $('editorClose').addEventListener('click', closeEditor); $('editorCancel').addEventListener('click', closeEditor); $('candidateClose').addEventListener('click', dismissCandidateResults); $('editorBackdrop').addEventListener('contextmenu', (event) => { if (event.target === $('editorBackdrop')) {event.preventDefault();closeEditor();} }); $('candidateBackdrop').addEventListener('contextmenu', (event) => { if (event.target === $('candidateBackdrop')) {event.preventDefault();dismissCandidateResults();} });
  $('openStoreBtn').addEventListener('click', () => openResourceLink(valueFor('fieldStoreUrl'),editorId)); $('openNoteBtn').addEventListener('click', () => native.openExternal(valueFor('fieldNoteUrl'))); $('pickSavePathsBtn').addEventListener('click', selectSavePaths); $('backupSaveBtn').addEventListener('click', backupCurrentSaves); $('openBackupBtn').addEventListener('click', openBackupFolder); $('categorySearch').addEventListener('input', renderCategories); all('.tag-tab').forEach((button) => button.addEventListener('click', () => { tagKind = button.dataset.tagKind; all('.tag-tab').forEach((entry) => entry.classList.toggle('active', entry === button)); renderCategories(); })); $('annualYear').addEventListener('change', renderAnnualReview);
  $('settingsAnimations').addEventListener('change', applyAppearance); $('settingsTheme').addEventListener('change', applyAppearance); $('settingsAccent').addEventListener('input', applyAppearance); $('testWebdavBtn').addEventListener('click', testWebdav); $('uploadWebdavBtn').addEventListener('click', () => syncWebdav('upload')); $('downloadWebdavBtn').addEventListener('click', () => syncWebdav('download')); $('bidirectionalWebdavBtn').addEventListener('click', () => syncWebdav('bidirectional')); $('enterDisguiseBtn').addEventListener('click', async () => { settings = await native.setDisguise(true, $('settingsDisguiseProfile').value); applyDisguise({ enabled: true, profile: settings.disguiseProfile, label: '伪装模式' }); }); $('exitDisguiseBtn').addEventListener('click', async () => { settings = await native.setDisguise(false, $('settingsDisguiseProfile').value); applyDisguise({ enabled: false }); }); $('disguiseExitTop').addEventListener('click', () => native.setDisguise(false, $('settingsDisguiseProfile').value));
$('clearNetworkCacheBtn').addEventListener('click',async()=>{
  if(networkCacheBusy)return;networkCacheBusy=true;++networkCacheQuery;const button=$('clearNetworkCacheBtn');button.disabled=true;button.textContent='清除中…';
  try{const result=await native.clearNetworkCache();if(result.after)displayNetworkCacheSize(result.after);else $('networkCacheSize').textContent='大小查询失败';showToast(result.errors.length?'缓存未全部清除：'+result.errors.join('；'):'联网缓存已清除',result.errors.length?'error':'normal');}
  catch(error){$('networkCacheSize').textContent='清除失败';showToast('清除缓存失败：'+error.message,'error');}
  finally{networkCacheBusy=false;button.disabled=false;button.textContent='清除缓存';}
});
$('exportBtn').addEventListener('click', async () => { if (await native.exportData(state)) showToast('数据备份已导出'); }); $('importBtn').addEventListener('click', async () => { const imported = await native.importData(); if (!imported) return; if (!(await askConfirm('导入会覆盖当前资源列表，确定继续吗？', { title: '导入前确认', confirmText: '继续导入', danger: true }))) return; state = await native.saveLibrary(imported); render(); showToast('数据已导入'); }); $('minimizeBtn').addEventListener('click', native.minimize);  $('closeBtn').addEventListener('click', async () => { if (await flushSettingsSave()) native.close(); });
}

ensureDragMotion();
native.onDisguiseState(applyDisguise);
async function init() { try { state = await native.loadLibrary(); settings = await native.loadSettings(); if(settings.credentialsUnavailable)showToast('此电脑无法解密原凭据，请在设置中重新输入；不会回退明文。','error'); if (!state || !Array.isArray(state.items)) state = { items: [], categories: [] }; if (!Array.isArray(state.categories)) state.categories = []; state.items = state.items.map(item => ({ ...item, status: StatusModel.normalize(item.status, item.type) })); activeView = settings.appearance?.defaultView || 'dashboard'; bindEvents(); installLibrarySelection(); installLibraryTools(); installCardQuickEdit(); installCardLayout(); installLocalImport(); installEditorInteractions(); installCoverControls(); installEditorFields(); installEditorPolish(); installPlatformPicker(); installWindowState(); installMetadataSession(); installSettingsAutosave(); installDisguiseButtonHandlers(); render(); applyDisguise({ enabled: settings.disguiseEnabled, profile: settings.disguiseProfile }); } catch (error) { showToast(`读取本地数据失败：${error.message}`, 'error'); } }
init();
function loadSettingsForm() { ensureSettingsColumns();ensureDeletePreference(); const appearance = settings.appearance || {}; $('settingsObsidian').value = settings.obsidianRoot || ''; $('settingsSteamKey').value = settings.steamApiKey || ''; $('settingsSteamId').value = settings.steamId || ''; $('settingsGoogleBooksKey').value = settings.googleBooksApiKey || ''; $('settingsTheme').value = appearance.theme || 'ocean'; $('settingsAccent').value = appearance.accent || '#65d8b0'; $('settingsAnimations').checked = appearance.animations !== false; $('settingsDefaultView').value = appearance.defaultView || 'dashboard'; $('settingsWebdavUrl').value = settings.webdavUrl || ''; $('settingsWebdavUsername').value = settings.webdavUsername || ''; $('settingsWebdavPassword').value = settings.webdavPassword || ''; $('settingsWebdavPath').value = settings.webdavRemotePath || 'UnifiedManager'; $('settingsDisguiseProfile').value = settings.disguiseProfile || 'course'; $('settingsDisguiseVideoUrl').value = settings.disguiseVideoUrl || DISGUISE_DEFAULT_VIDEO; $('settingsConfirmDelete').checked = settings.confirmBeforeDelete !== false; applyAppearance(); }
