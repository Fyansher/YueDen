const native = window.unifiedAPI;

const TYPE_NAMES = { audio:'声音', game:'游戏',movie:'影视',anime:'番剧',manga:'漫画',book:'书籍',software:'软件',document:'文档',unknown_application:'待确认应用',unknown_collection:'待确认图片集',other:'其他' };
const TYPE_LABELS = {...TYPE_NAMES,all:'全部资源',game:'游戏'};
const STATUS_BY_TYPE = StatusModel.lists;
const STATUS_COLORS = ['#65d8b0', '#3bb5d3', '#f7bd6a', '#f18291', '#a995e8'];

let state = { items: [], categories: [] };
let settings = { obsidianRoot: '', steamApiKey: '', steamId: '', webdavUrl: '', webdavUsername: '', webdavPassword: '', webdavRemotePath: 'YueDen', deleteCloudSaveWithLocal: true, appearance: { theme: 'ocean', accent: '#65d8b0', density: 'comfortable', animations: true, defaultView: 'dashboard' }, disguiseEnabled: false, positiveEnergyEnabled: false };
let activeView = 'dashboard';
// Library layout preferences are stored separately for each media page.
let editorId = null;
let currentRating = 0, editorRatingKnown=false;
let candidateResults = [];
let editorSavePaths = [];
let tagKinds = new Set();
let tagManagementSelection = new Set(), tagManagementAnchor = null, tagManagementPaint = null, tagManagementSuppressClickUntil = 0;
let tagDeletionBusy = false;
let toastTimer = null;
let metadataRequestId = 0;
const resourceFilters = new ResourceFilters();
const POSITIVE_ENERGY_TAGS = new Set(['NSFW', 'R18', 'R18+']);
let backupRenderVersion = 0;
let snapshotIndex = [], snapshotIndexGeneration = 0, snapshotSelection = new Set(), expandedSnapshotGroups = new Set(), snapshotAnchor = null, snapshotPaint = null, snapshotSuppressClickUntil = 0;
const remoteSnapshotCache = new Map();
let editorOriginalItem = null;
const backupNoteTimers = new WeakMap(), backupNoteWrites = new WeakMap();

const $ = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function formatDate(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function formatDateTime(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function formatSyncDateTime(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function formatWebdavCompareTimestamp(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未记录';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function typeOf(item) { return TYPE_NAMES[item.type] || '其他'; }
function positiveEnergyTagKey(value) { return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s\-‐‑‒–—−]/g, ''); }
function hasPositiveEnergyTag(item) { return [...(item?.genres || []), ...(item?.categories || [])].some(value => POSITIVE_ENERGY_TAGS.has(positiveEnergyTagKey(value))); }
function visibleResourceItems() { const items = Array.isArray(state?.items) ? state.items : []; return settings?.positiveEnergyEnabled ? items.filter(item => !hasPositiveEnergyTag(item)) : items; }
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
function showAppDialog({ title = '请确认', message = '', input = false, defaultValue = '', checkbox = null, checkboxes = null, confirmText = '确定', danger = false, choices = null, choicesInline = false, content = null, dialogClass = '', dismissOn = 'left', choiceGuard = null } = {}) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div'); backdrop.className = 'app-dialog-backdrop';
    const checkboxRows = Array.isArray(checkboxes) ? checkboxes : checkbox ? [checkbox] : [];
    const checkboxMarkup = checkboxRows.map((entry,index) => '<label class="app-dialog-check"><input class="app-dialog-checkbox" data-dialog-check="' + index + '" type="checkbox" ' + (entry.checked ? 'checked ' : '') + (entry.disabled || (entry.dependsOn != null && !checkboxRows[entry.dependsOn]?.checked) ? 'disabled ' : '') + '><span>' + esc(entry.label) + '</span></label>').join('');
    const hasChoices = Array.isArray(choices) && choices.length > 0;
    const choiceButtons = hasChoices && !choicesInline ? choices.map((choice, index) => '<button type="button" class="' + (choice.primary === true ? 'add-button' : choice.primary === false ? 'secondary-button' : index === choices.length - 1 ? 'add-button' : 'secondary-button') + ' app-dialog-choice" data-choice-index="' + index + '"><span class="app-dialog-choice-label">' + esc(choice.label) + '</span>' + (choice.description ? '<span class="app-dialog-choice-description">' + esc(choice.description) + '</span>' : '') + '</button>').join('') : '';
    const choiceList = choiceButtons ? '<div class="app-dialog-choice-list">' + choiceButtons + '</div>' : '';
    const actions = hasChoices ? '<div class="app-dialog-actions app-dialog-choice-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button></div>' : '<div class="app-dialog-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button><button type="button" class="' + (danger ? 'danger-button' : 'add-button') + ' app-dialog-confirm">' + esc(confirmText) + '</button></div>';
    const messageMarkup = content ? '<div class="app-dialog-content app-dialog-comparison"></div>' : '<p class="app-dialog-message ' + (hasChoices ? 'app-dialog-comparison' : '') + '">' + esc(message).replace(/\n/g, '<br>') + '</p>';
    const dialogClasses = ['app-dialog', hasChoices ? 'app-dialog-has-choices' : '', dialogClass].filter(Boolean).join(' ');
    backdrop.innerHTML = '<section class="' + dialogClasses + '" role="dialog" aria-modal="true"><div class="app-dialog-head"><strong>' + esc(title) + '</strong><button class="app-dialog-close" type="button" aria-label="关闭">×</button></div>' + messageMarkup + (input ? '<input class="app-dialog-input" value="' + esc(defaultValue) + '">' : '') + checkboxMarkup + choiceList + actions + '</section>';
    if (content) backdrop.querySelector('.app-dialog-content').append(content);
    appModalStack.open(backdrop, () => backdrop.querySelector('.app-dialog-close').click());
    const finish = value => { appModalStack.remove(backdrop); resolve(checkboxRows.length ? { confirmed: Boolean(value), checked: backdrop.querySelector('.app-dialog-checkbox')?.checked || false, checks: [...backdrop.querySelectorAll('.app-dialog-checkbox')].map(input=>input.checked) } : value); };
    const cancelled = () => finish(input || hasChoices ? null : false);
    backdrop.querySelector('.app-dialog-cancel').addEventListener('click', cancelled);
    backdrop.querySelector('.app-dialog-close').addEventListener('click', cancelled);
    if (dismissOn === 'right') backdrop.addEventListener('contextmenu', event => { if (event.target === backdrop) { event.preventDefault(); cancelled(); } });
    else backdrop.addEventListener('click', event => { if (event.target === backdrop) cancelled(); });
    if (hasChoices) backdrop.querySelectorAll('[data-choice-index]').forEach(button => button.addEventListener('click', () => { const choice = choices[Number(button.dataset.choiceIndex)]; if (choice && (typeof choiceGuard !== 'function' || choiceGuard(choice.value, backdrop) !== false)) finish(choice.value); }));
    else backdrop.querySelector('.app-dialog-confirm').addEventListener('click', () => finish(input ? backdrop.querySelector('.app-dialog-input').value : true));
    checkboxRows.forEach((entry,index)=>{if(entry.dependsOn==null)return;const parent=backdrop.querySelector('[data-dialog-check="'+entry.dependsOn+'"]'),dependent=backdrop.querySelector('[data-dialog-check="'+index+'"]');parent?.addEventListener('change',()=>{dependent.disabled=Boolean(entry.disabled)||!parent.checked;});});
    if (input) { const field = backdrop.querySelector('.app-dialog-input'); field.focus(); field.select(); }
  });
}
const askConfirm = (message, options = {}) => showAppDialog({ title: options.title || '请确认操作', message, confirmText: options.confirmText || '确定', danger: options.danger !== false });
const askPrompt = (message, defaultValue = '') => showAppDialog({ title: '输入内容', message, input: true, defaultValue, confirmText: '确定', danger: false });
async function confirmDeletion(message) { return settings.confirmBeforeDelete === false || await askConfirm(message, { title: '删除前确认', confirmText: '确认删除', danger: true }); }
async function confirmBackupDeletion(message) {
  const result = await showAppDialog({ title: '删除前确认', message, confirmText: '确认删除', danger: true, checkbox: { label: '同步删除云端存档（若已配置 WebDAV）', checked: settings.deleteCloudSaveWithLocal !== false } });
  if (!result?.confirmed) return false;
  if (!(await queueSettingsSave({ deleteCloudSaveWithLocal: result.checked }))) { showToast('删除偏好未能保存，已取消删除', 'error'); return false; }
  return { confirmed: true, syncCloud: result.checked };
}
async function confirmResourceDeletion(resources,backupCount,{selectedBackupCount=0}={}){
  const names=resources.slice(0,4).map(item=>'“'+item.name+'”').join('、'),rows=[],deleteAssociatedIndex=backupCount?rows.length:-1;
  if(backupCount)rows.push({label:'同时删除资源关联的其他 '+backupCount+' 份存档快照',checked:false});
  const cloudIndex=(backupCount||selectedBackupCount)&&settings.webdavUrl?rows.length:-1;
  if(cloudIndex>=0)rows.push({label:'同步删除云端存档副本',checked:settings.deleteCloudSaveWithLocal!==false,...(selectedBackupCount?{}:{dependsOn:deleteAssociatedIndex})});
  const selectedText=selectedBackupCount?'，以及已勾选的 '+selectedBackupCount+' 份存档快照':'';
  const result=await showAppDialog({title:'删除所选内容前确认',message:'确定删除 '+resources.length+' 个资源条目'+selectedText+'？\n'+names+(resources.length>4?' 等':'')+'\n未勾选时会保留未单独勾选的关联存档快照，删除记录会同步到 WebDAV。',checkboxes:rows,confirmText:'确认删除',danger:true});
  if(rows.length?!result?.confirmed:!result)return false;
  let syncCloud=Boolean(cloudIndex>=0&&result.checks?.[cloudIndex]);
  if(cloudIndex>=0&&syncCloud!== (settings.deleteCloudSaveWithLocal!==false)){
    if(!(await queueSettingsSave({deleteCloudSaveWithLocal:syncCloud}))){showToast('云端删除偏好未能保存，已取消删除','error');return false;}
  }
  return {deleteSaves:Boolean(backupCount&&result.checks?.[deleteAssociatedIndex]),syncCloud};
}
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
  $('totalNavCount').textContent = visibleResourceItems().length; setActiveNav(activeView); applyAppearance();
  $('dashboardView').classList.toggle('hidden', activeView !== 'dashboard'); $('libraryView').classList.toggle('hidden', !['all',...LocalModel.types].includes(activeView)); $('categoriesView').classList.toggle('hidden', activeView !== 'categories'); $('settingsView').classList.toggle('hidden', activeView !== 'settings');
  if (activeView === 'dashboard') renderDashboard(); if (['all',...LocalModel.types].includes(activeView)) renderLibrary(); if (activeView === 'categories') renderCategories(); if (activeView === 'settings') { loadSettingsForm(); void refreshNetworkCacheSize(); }renderSnapshotSelectionUi();
}

function repairImage(image, index = 0) { if (image.dataset.fallback === '1') return; image.dataset.fallback = '1'; image.src = fallbackCover(image.alt, index); }
function renderDashboard() {
  const items = visibleResourceItems();
  const total = items.length;
  const completed = items.filter(isCompleted).length;
  const active = items.filter(isActive).length;
  const hours = items.reduce((sum, item) => sum + resourceUsageHours(item), 0);
  const currentYear = String(new Date().getFullYear());
  const yearItems = items.filter((item) => String(item.createdAt || '').startsWith(currentYear) || String(item.completedDate || '').startsWith(currentYear));
  const typeCounts = Object.entries(TYPE_NAMES).map(([type, name]) => [type, name, items.filter((item) => item.type === type).length]).filter(([, , count]) => count);
  const topType = [...typeCounts].sort((a, b) => b[2] - a[2])[0];
  const genreCounts = {}; items.forEach((item) => (item.genres || []).forEach((genre) => { genreCounts[genre] = (genreCounts[genre] || 0) + 1; }));
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
  $('statGrid').innerHTML = [['总条目', total, '全部媒体收藏', ''], ['进行中', active, '正在体验的内容', 'accent'], ['完成率', total ? `${Math.round(completed / total * 100)}%` : '—', `${completed} 条已完成`, 'warn'], ['今年新增', yearItems.filter((item) => String(item.createdAt || '').startsWith(currentYear)).length, `${currentYear} 年记录`, ''], ['累计时长', `${hours.toFixed(1)}h`, '游玩 / 阅读 / 观看记录', ''], ['最常见类型', topType ? topType[1] : '—', topType ? `${topType[2]} 条资源` : '添加资源后生成', ''], ['偏好标签', topGenre ? topGenre[0] : '—', topGenre ? `${topGenre[1]} 次出现` : '等待标签数据', 'accent'], ['最近整理', formatDate([...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.createdAt), '最后一次添加或更新', '']].map(([label, value, hint, cls]) => `<article class="stat-card ${cls}"><span class="stat-label">${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
  const statusCounts = {}; items.forEach((item) => { statusCounts[item.status] = (statusCounts[item.status] || 0) + 1; }); const statusEntries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]); const segments = total ? (() => { let cursor = 0; return statusEntries.map(([, count], index) => { const start = cursor; cursor += count / total * 360; return `${STATUS_COLORS[index % STATUS_COLORS.length]} ${start}deg ${cursor}deg`; }).join(', '); })() : '#223243 0deg 360deg';
  $('donut').style.background = `conic-gradient(${segments})`; $('donutTotal').textContent = total; $('statusLegend').innerHTML = statusEntries.length ? statusEntries.slice(0, 6).map(([status, count], index) => `<div class="legend-item"><span class="legend-dot" style="background:${STATUS_COLORS[index % STATUS_COLORS.length]}"></span><span>${esc(status)}</span><strong>${count}</strong></div>`).join('') : '<div class="legend-item"><span>添加资源后会显示状态分布</span></div>';
  const recent = [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5); $('recentList').innerHTML = recent.length ? recent.map((item) => `<div class="recent-item" data-open-id="${esc(item.id)}"><img class="recent-cover" src="${esc(item.cover || '')}" alt=""><div><div class="recent-name">${esc(item.name)}</div><div class="recent-status">${esc(typeOf(item))} · ${esc(item.status)}</div></div><span class="recent-date">${formatDate(item.createdAt)}</span></div>`).join('') : '<div class="empty-state" style="padding:35px 12px;border:0"><p>还没有添加资源，请前往资源页添加条目。</p></div>';
  all('.recent-item[data-open-id]').forEach((node) => node.addEventListener('click', () => openEditor(node.dataset.openId))); all('.recent-cover').forEach((image, index) => image.addEventListener('error', () => repairImage(image, index)));
  const maxType = Math.max(1, ...typeCounts.map(([, , count]) => count)); const topTags = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8); const maxTag = Math.max(1, ...topTags.map(([, count]) => count)); const statusText = statusEntries.length ? statusEntries.slice(0, 4).map(([name, count]) => `${name} ${count}`).join(' · ') : '暂无状态记录';
  $('insights').innerHTML = `<div class="insight-section"><h3>收藏结构</h3>${(typeCounts.length ? typeCounts : [['', '暂无数据', 0]]).map(([, name, count]) => `<div class="bar-row"><span>${name}</span><div class="bar-track"><div class="bar-fill" style="width:${count / maxType * 100}%"></div></div><strong>${count}</strong></div>`).join('')}</div><div class="insight-section"><h3>主题偏好</h3>${(topTags.length ? topTags : [['暂无标签', 0]]).map(([name, count]) => `<div class="bar-row"><span>${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${count / maxTag * 100}%"></div></div><strong>${count}</strong></div>`).join('')}</div><div class="insight-section insight-narrative"><h3>使用画像</h3><p>当前收藏以 <strong>${esc(topType ? topType[1] : '多种媒体')}</strong> 为主，状态分布为 <strong>${esc(statusText)}</strong>。</p><p>${topGenre ? `最常出现的主题是 <strong>${esc(topGenre[0])}</strong>，共覆盖 ${topGenre[1]} 条资源。` : '补充标签后，这里会生成更准确的偏好分析。'}</p></div>`;
  renderUsageChart();refreshUsage().then(()=>{if(activeView==='dashboard')renderUsageChart();});renderAnnualReview();
}
function renderAnnualReview() {
  const items = visibleResourceItems();
  const years = Array.from(new Set([new Date().getFullYear().toString(), ...items.flatMap((item) => [String(item.createdAt || '').slice(0, 4), String(item.completedDate || '').slice(0, 4)]).filter((year) => /^\d{4}$/.test(year))])).sort().reverse(); const select = $('annualYear'); if (!select) return; const previous = select.value; select.innerHTML = years.map((year) => `<option value="${year}">${year} 年</option>`).join(''); select.value = years.includes(previous) ? previous : years[0]; const year = select.value;
  const inYear = items.filter((item) => String(item.createdAt || '').startsWith(year) || String(item.completedDate || '').startsWith(year)); const added = inYear.filter((item) => String(item.createdAt || '').startsWith(year)); const completed = inYear.filter((item) => String(item.completedDate || '').startsWith(year) || (isCompleted(item) && String(item.updatedAt || '').startsWith(year))); const hours = inYear.reduce((sum, item) => sum + (Number(item.playtime) || 0), 0); const typeCounts = {}; const genreCounts = {}; inYear.forEach((item) => { typeCounts[item.type] = (typeCounts[item.type] || 0) + 1; (item.genres || []).forEach((genre) => { genreCounts[genre] = (genreCounts[genre] || 0) + 1; }); }); const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]; const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]; const monthDone = Array.from({ length: 12 }, (_, index) => { const month = String(index + 1).padStart(2, '0'); return { label: `${index + 1}月`, value: inYear.filter((item) => String(item.completedDate || '').slice(5, 7) === month).length + inYear.filter((item) => !item.completedDate && String(item.createdAt || '').slice(5, 7) === month).length }; }); const max = Math.max(1, ...monthDone.map((entry) => entry.value)); const top = [...inYear].filter((item) => Number(item.rating) > 0).sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 3);
  $('annualSummary').innerHTML = [['新增条目', added.length], ['完成 / 看完', completed.length], ['投入时长', `${hours.toFixed(1)} 小时`], ['年度主轴', topType ? `${TYPE_LABELS[topType[0]] || topType[0]}` : '—']].map(([label, value]) => `<div class="annual-metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const narrative = inYear.length ? `${year} 年你新增了 ${added.length} 条资源，完成或看完 ${completed.length} 条，累计记录 ${hours.toFixed(1)} 小时。内容主要集中在 <strong>${esc(topType ? (TYPE_LABELS[topType[0]] || topType[0]) : '多种媒体')}</strong>${topGenre ? `，最常出现的主题是 <strong>${esc(topGenre[0])}</strong>` : ''}。` : `${year} 年还没有足够的记录，添加资源并记录状态后会自动生成年度报告。`;
  $('annualTimeline').innerHTML = `<div class="annual-chart">${monthDone.map((entry) => `<div class="month-bar"><div class="month-value" style="height:${entry.value / max * 100}%"><span>${entry.value || ''}</span></div><small>${entry.label}</small></div>`).join('')}</div><div class="annual-highlights"><h3>年度高光</h3>${top.length ? top.map((item) => `<button class="annual-item" data-open-id="${esc(item.id)}"><span>${stars(item.rating)}</span><strong>${esc(item.name)}</strong><small>${esc(typeOf(item))}</small></button>`).join('') : '<p>给年度收藏补充评分，就能看到年度高光。</p>'}<p class="annual-analysis">${narrative}</p></div>`; all('.annual-item[data-open-id]').forEach((node) => node.addEventListener('click', () => openEditor(node.dataset.openId)));
}
function selectedFilterValues(id) { return resourceFilters.selected(id); }
function filterItems() {
  const query = $('searchInput').value.trim().toLowerCase();
  return librarySorting.apply(visibleResourceItems().filter(item => {
    if (activeView !== 'all' && item.type !== activeView) return false;if(window.audioBrowser&&!audioBrowser.matches(item))return false;
    const saveFilter=activeView==='game'?($('saveFilter')?.value||'all'):'all';
    if(!resourceFilters.saveFilterMatches(saveFilter,snapshotsFor(item.id).length))return false;
    const text = [item.name, item.developer, item.publisher, item.review, item.description, ...(item.audio?.artists||[]), ...(item.audio?.albumArtists||[]), item.audio?.circle, ...(item.audio?.creators||[]), ...(item.audio?.performers||[]), ...(item.audio?.tracks||[]).flatMap(t=>[t.title,...t.artists||[]]), ...(item.genres || []), ...(item.categories || [])].join(' ').toLowerCase();
    return (!query || text.includes(query)) && resourceFilters.matches(item);
  }));
}
function populateFilters() {
  const pageItems=visibleResourceItems().filter(item=>activeView==='all'||item.type===activeView);
  resourceFilters.render(pageItems, renderLibrary);
}
function snapshotSyncStatusHtml(entry,itemId=entry.itemId){
  if(entry.remoteOnly)return '<span class="snapshot-sync-button remote-only">仅云端</span>';
  if(entry.syncStatus==='已同步')return '<button type="button" class="snapshot-sync-button synced" disabled>已同步</button>';
  if(entry.syncStatus==='未配置云同步')return '<span class="snapshot-sync-button unconfigured">未配置</span>';
  return '<button type="button" class="snapshot-sync-button" data-snapshot-upload data-item-id="'+esc(itemId)+'" data-backup-id="'+esc(entry.id)+'">待同步</button>';
}
function cardHtml(item) {
  let html=buildLibraryCard(item);if(!snapshotCardMode())return html;
  const selecting=snapshotSelectionMode();
  const template=document.createElement('template');template.innerHTML=html.trim();const card=template.content.firstElementChild,content=document.createElement('div');content.className='resource-card-content';
  while(card.firstChild)content.append(card.firstChild);card.append(content);
  const rows=snapshotsFor(item.id),expanded=expandedSnapshotGroups.has(item.id),shown=expanded?rows:rows.slice(0,3),inputId='snapshot-group-'+encodeURIComponent(item.id);
  const list=shown.map(entry=>{
    const checked=snapshotSelection.has(entry.id),rowSelect=selecting?'<label class="snapshot-row-select" aria-label="选择 '+esc(item.name)+' 的存档 '+esc(formatDateTime(entry.createdAt))+'"><input type="checkbox" data-snapshot-select="'+esc(entry.id)+'" data-item-id="'+esc(item.id)+'"><span class="snapshot-checkmark" aria-hidden="true"></span></label>':'';
    return '<div class="card-save-snapshot-row'+(selecting?' has-select':'')+(checked?' selected':'')+'" data-snapshot-row="'+esc(entry.id)+'">'+rowSelect+'<div class="snapshot-row-copy"><span class="snapshot-row-date" title="'+esc(formatDateTime(entry.createdAt))+'">'+esc(formatDateTime(entry.createdAt))+'</span><span class="snapshot-row-note" title="'+esc(entry.note||'无备注')+'">'+esc(entry.note||'无备注')+'</span></div>'+snapshotSyncStatusHtml(entry)+'</div>';
  }).join('');
  const groupSelect=selecting?'<label class="snapshot-group-select" title="选择或取消此游戏的全部存档"><input id="'+esc(inputId)+'" type="checkbox" data-snapshot-group-select="'+esc(item.id)+'"><span class="snapshot-checkmark" aria-hidden="true"></span></label>':'';
  const panel='<section class="card-save-snapshots" data-snapshot-group="'+esc(item.id)+'"><div class="snapshot-group-heading">'+groupSelect+'<strong>存档快照</strong><span class="snapshot-group-count">'+rows.length+' 份</span></div><div class="card-save-snapshot-list">'+list+'</div>'+(rows.length>3?'<button type="button" class="snapshot-expand" data-snapshot-expand="'+esc(item.id)+'">'+(expanded?'收起':'展开其余 '+(rows.length-3)+' 份')+'</button>':'')+'</section>';
  card.insertAdjacentHTML('beforeend',panel);return card.outerHTML;
}
function renderSnapshotSelectionUi(){
  const enabled=snapshotSelectionMode();
  if(!enabled){snapshotSelection.clear();snapshotPaint=null;return;}
  const visible=visibleSnapshotRows(),ids=new Set(visible.map(entry=>entry.id));snapshotSelection=new Set([...snapshotSelection].filter(id=>ids.has(id)));
  const selected=snapshotSelection.size;
  for(const input of all('[data-snapshot-select]',$('libraryGrid'))){const checked=snapshotSelection.has(input.dataset.snapshotSelect);input.checked=checked;input.closest('.card-save-snapshot-row')?.classList.toggle('selected',checked);}
  for(const input of all('[data-snapshot-group-select]',$('libraryGrid'))){const rows=visible.filter(entry=>entry.itemId===input.dataset.snapshotGroupSelect),count=rows.filter(entry=>snapshotSelection.has(entry.id)).length;input.checked=rows.length>0&&count===rows.length;input.indeterminate=count>0&&count<rows.length;}
  return selected;
}
function installSnapshotCardControls(){
  const grid=$('libraryGrid');
  for(const input of all('[data-snapshot-select]',grid))input.onchange=()=>{input.checked?snapshotSelection.add(input.dataset.snapshotSelect):snapshotSelection.delete(input.dataset.snapshotSelect);snapshotAnchor=input.dataset.snapshotSelect;renderSnapshotSelectionUi();renderLibrarySelection();};
  for(const input of all('[data-snapshot-group-select]',grid))input.onchange=()=>{
    const rows=visibleSnapshotRows().filter(entry=>entry.itemId===input.dataset.snapshotGroupSelect),checked=rows.some(entry=>!snapshotSelection.has(entry.id));
    rows.forEach(entry=>checked?snapshotSelection.add(entry.id):snapshotSelection.delete(entry.id));renderSnapshotSelectionUi();renderLibrarySelection();
  };
  for(const button of all('[data-snapshot-expand]',grid))button.onclick=event=>{event.preventDefault();event.stopPropagation();const id=button.dataset.snapshotExpand;expandedSnapshotGroups.has(id)?expandedSnapshotGroups.delete(id):expandedSnapshotGroups.add(id);renderLibrary();};
  for(const button of all('[data-snapshot-upload]',grid))button.onclick=event=>{event.preventDefault();event.stopPropagation();void syncSnapshotButton(button);};
}
function installSnapshotPainting(){
  const grid=$('libraryGrid');
  grid.addEventListener('pointerdown',event=>{
    if(!snapshotSelectionMode()||event.button!==0||!event.target.closest('.snapshot-row-select'))return;
    const input=event.target.closest('.snapshot-row-select').querySelector('[data-snapshot-select]');if(!input)return;
    const id=input.dataset.snapshotSelect,ids=visibleSnapshotRows().map(entry=>entry.id),base=[...snapshotSelection],selected=event.shiftKey||!snapshotSelection.has(id),anchor=event.shiftKey&&snapshotAnchor?snapshotAnchor:id;
    event.preventDefault();event.stopImmediatePropagation();snapshotAnchor=anchor;snapshotPaint={pointerId:event.pointerId,last:id,anchor,base,selected};
    snapshotSelection=new Set(SelectionRange.apply(ids,anchor,id,base,selected));grid.classList.add('snapshot-selection-painting');grid.setPointerCapture?.(event.pointerId);renderSnapshotSelectionUi();renderLibrarySelection();
  },true);
  grid.addEventListener('pointermove',event=>{
    if(!snapshotPaint||snapshotPaint.pointerId!==event.pointerId)return;
    event.preventDefault();const label=document.elementFromPoint(event.clientX,event.clientY)?.closest('#libraryGrid .snapshot-row-select'),input=label?.querySelector('[data-snapshot-select]'),id=input?.dataset.snapshotSelect;
    if(!id||id===snapshotPaint.last)return;snapshotPaint.last=id;
    snapshotSelection=new Set(SelectionRange.apply(visibleSnapshotRows().map(entry=>entry.id),snapshotPaint.anchor,id,snapshotPaint.base,snapshotPaint.selected));renderSnapshotSelectionUi();renderLibrarySelection();
  },true);
  const stop=event=>{if(!snapshotPaint||snapshotPaint.pointerId!==event.pointerId)return;snapshotPaint=null;snapshotSuppressClickUntil=Date.now()+450;grid.classList.remove('snapshot-selection-painting');if(grid.hasPointerCapture?.(event.pointerId))grid.releasePointerCapture(event.pointerId);};
  grid.addEventListener('pointerup',stop);grid.addEventListener('pointercancel',stop);grid.addEventListener('lostpointercapture',stop);
  grid.addEventListener('click',event=>{if(Date.now()<snapshotSuppressClickUntil&&event.target.closest('.snapshot-row-select')){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('dragstart',event=>{if(event.target.closest?.('.snapshot-row-select')){event.preventDefault();event.stopImmediatePropagation();}},true);
}
async function syncSnapshotButton(button){
  const itemId=button.dataset.itemId||button.closest('.backup-entry')?.querySelector('[data-item-id]')?.dataset.itemId,backupId=button.dataset.backupId;
  if(!itemId||!backupId||!settings.webdavUrl)return;
  setSnapshotUploadProgress(itemId,backupId,true);
  try{
    const result=await native.syncBackupSnapshot(itemId,backupId,settings,'item-retry');if(!result?.ok)throw Error(result?.message||'存档上传失败');
    await refreshSnapshotIndex(true);if(snapshotCardMode())renderLibrary();if(editorId===itemId&&!$('editorBackdrop').classList.contains('hidden'))await renderBackupList();
    showToast('存档快照已同步');
  }catch(error){setSnapshotUploadProgress(itemId,backupId,false);await refreshSnapshotIndex(true);if(snapshotCardMode())renderLibrary();if(editorId===itemId&&!$('editorBackdrop').classList.contains('hidden'))await renderBackupList();showToast('存档上传失败：'+error.message,'error');}
}
function setSnapshotUploadProgress(itemId,backupId,uploading){
  for(const button of all('[data-snapshot-upload]')){
    if(button.dataset.itemId!==itemId||button.dataset.backupId!==backupId)continue;
    button.disabled=uploading;button.classList.toggle('uploading',uploading);button.textContent=uploading?'上传中':'待同步';
  }
}
async function deleteSelectedSnapshots(){
  const visible=visibleSnapshotRows(),selected=visible.filter(entry=>snapshotSelection.has(entry.id));if(!selected.length)return;
  const decision=await confirmBackupDeletion('删除选中的 '+selected.length+' 份存档快照？此操作无法撤销。');if(!decision)return;
  const button=$('batchDelete');button.disabled=true;
  try{
    const result=await native.deleteBackups(selected.map(entry=>({itemId:entry.itemId,backupId:entry.id})),{syncCloud:decision.syncCloud});
    await refreshSnapshotIndex(true);
    const affected=new Set(selected.map(entry=>entry.itemId)),items=state.items.map(item=>affected.has(item.id)?{...item,backupCount:snapshotsFor(item.id).length}:item);
    state=await native.saveLibrary({...state,items});
    if(!result?.ok)throw Error(result?.message||'批量删除失败');
    snapshotSelection.clear();renderLibrary();showToast(result.message||'已删除所选存档快照');
  }catch(error){await refreshSnapshotIndex(true);renderLibrary();showToast('批量删除失败：'+error.message,'error');}finally{button.disabled=false;renderSnapshotSelectionUi();}
}
function mergeRefreshedItem(current,original,updated) {
 const next={...current};
 for(const [key,value]of Object.entries(updated||{}))if(JSON.stringify(current[key])===JSON.stringify(original[key]))next[key]=value;
 return next;
}
function animateLibraryCard(card,keyframes,options) {
 if(!card.animate)return;
 card.style.willChange='transform';const animation=card.animate(keyframes,options),release=()=>{card.style.willChange='';};
 animation.addEventListener('finish',release,{once:true});animation.addEventListener('cancel',release,{once:true});return animation;
}

function renderLibrary() {
 const grid=$('libraryGrid'),previousLayout=grid.dataset.motionLayout,previousView=grid.dataset.motionView,layout=currentLibraryLayout(),previousIds=[...grid.children].map(node=>node.dataset.id).join('|');
 const motionAllowed=settings.appearance?.animations!==false&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const layoutChanged=Boolean(previousLayout&&previousLayout!==layout&&previousView===activeView),items=filterItems(),nextIds=items.map(item=>item.id).join('|');
 const transitionNeeded=layoutChanged||previousView!==activeView||previousIds!==nextIds;
 const previousCards=motionAllowed&&previousView===activeView&&transitionNeeded?(layoutChanged?captureLibraryCardRects(grid):captureVisibleLibraryCardRects(grid)):new Map(),previousCoverStages=layoutChanged?captureLibraryCoverStages(grid):null;
 $('saveFilter').classList.toggle('hidden',!resourceFilters.shouldShowSaveFilter(activeView));
 $('libraryEyebrow').textContent=activeView==='all'?'资源列表':'我的收藏';
 $('libraryHeading').innerHTML=`<span id="resultCount">0</span><span class="resource-count-unit">项资源</span>`;
 $('librarySearchHeader').prepend($('libraryHeading'));const actions=$('filterToggle').closest('.toolbar-actions');$('librarySearchHeader').append(actions);populateFilters();librarySorting.render();$('resultCount').textContent=items.length;const audioRows=window.audioBrowser?.render(items);document.querySelector('.view-switch').classList.toggle('hidden',Boolean(audioRows));if(audioRows){decorateLocalCards();renderLibrarySelection();renderSnapshotSelectionUi();return;}grid.classList.remove('audio-browser-list');grid.classList.add('library-grid');
 all('.view-switch-btn').forEach(button=>{button.classList.toggle('active',button.dataset.layout===layout);button.setAttribute('aria-pressed',String(button.dataset.layout===layout));});
 for(const [name,value]of [['small','small'],['list','list'],['portrait','portrait']])grid.classList.toggle(name+'-layout',layout===value);
 grid.innerHTML=items.map(cardHtml).join('');observeLibraryCardVisibility(grid);const preservedCoverImages=reuseLibraryCoverStages(grid,previousCoverStages,items,layout);$('libraryEmpty').classList.toggle('hidden',items.length>0);installSnapshotCardControls();
 all('.resource-card').forEach(card=>{
  card.tabIndex=0;
  card.addEventListener('keydown',event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();card.click();}});
  card.addEventListener('click',async event=>{
   if(event.target.closest('.card-save-snapshots'))return;
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
 const itemById=new Map(items.map(item=>[item.id,item]));
 all('.card-cover img.cover-art-image',grid).forEach((image,index)=>{if(preservedCoverImages.has(image))return;const item=itemById.get(image.closest('.resource-card')?.dataset.id)||{};repairCardCover(image,item,index);});
 renderLibrarySelection();renderSnapshotSelectionUi();decorateLocalCards();fitCardTags();
 grid.dataset.motionLayout=layout;
 grid.dataset.motionView=activeView;
 if(motionAllowed&&transitionNeeded){
  for(const card of grid.children){const after=card.getBoundingClientRect();if(after.bottom<0||after.top>innerHeight)continue;const before=previousCards.get(card.dataset.id);
   if(before&&layoutChanged){animateLibraryCard(card,[{transform:`translate(${before.left-after.left}px,${before.top-after.top}px) scale(${before.width/after.width},${before.height/after.height})`,transformOrigin:'top left',opacity:1},{transform:'none',transformOrigin:'top left',opacity:1}],{duration:420,easing:'cubic-bezier(.22,1.12,.36,1)'});}
   else {const dx=before?before.left-after.left:0,dy=before?before.top-after.top:10;animateLibraryCard(card,[{transform:`translate(${dx}px,${dy}px) scale(${before?1:.97})`,opacity:1},{transform:'translate(0,-2px) scale(1.012,.992)',opacity:1,offset:.72},{transform:'none',opacity:1}],{duration:460,easing:'cubic-bezier(.22,.75,.25,1)'});}
  }
 }
}
 
function tagSortPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem('tagCardSort') || 'null');
    return { field: ['manual', 'name', 'count'].includes(value?.field) ? value.field : 'manual', direction: value?.direction === 'desc' ? 'desc' : 'asc' };
  } catch { return { field: 'manual', direction: 'asc' }; }
}
function saveTagSortPreferences(value) {
  try { localStorage.setItem('tagCardSort', JSON.stringify(value)); }
  catch { showToast('标签排序偏好保存失败', 'error'); }
}
function renderTagSortControl() {
  return librarySorting.render({
    hostId: 'tagSort', target: '#categoriesView .tag-tools', append: true,
    fields: [['name', '名称'], ['count', '资源数']], getState: tagSortPreferences,
    selectValue: preferences => preferences.field === 'manual' ? '' : preferences.field,
    onFieldChange: field => { saveTagSortPreferences({ ...tagSortPreferences(), field: field || 'manual' }); renderCategories(); },
    onDirectionChange: () => { const preferences = tagSortPreferences(); saveTagSortPreferences({ ...preferences, direction: preferences.direction === 'asc' ? 'desc' : 'asc' }); renderCategories(); },
    title: '随时拖动卡片调整顺序；选择名称或资源数可切换排序方式'
  });
}
function tagEntryKey(entry) { return entry.kind + ':' + entry.name; }
function readTagCardOrder(entries = []) {
  let stored = [];
  try { const value = JSON.parse(localStorage.getItem('tagCardOrder') || '[]'); if (Array.isArray(value)) stored = value.filter(key => typeof key === 'string'); } catch {}
  const valid = new Set(entries.map(tagEntryKey));
  const remaining = [...entries].sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.kind.localeCompare(b.kind));
  return [...new Set(stored.filter(key => valid.has(key))), ...remaining.map(tagEntryKey).filter(key => !stored.includes(key))];
}
async function renameTagEntry(kind, oldName) {
  const label = kind === 'category' ? '分类' : '标签';
  const nextName = (await askPrompt('输入新的' + label + '名称：', oldName) || '').trim();
  if (!nextName || nextName === oldName) return;
  const existing = kind === 'category'
    ? new Set([...(state.categories || []), ...state.items.flatMap(item => item.categories || [])])
    : new Set(state.items.flatMap(item => item.genres || []));
  if (existing.has(nextName)) { showToast('同类中已存在“' + nextName + '”', 'error'); return; }
  const field = kind === 'category' ? 'categories' : 'genres';
  const items = state.items.map(item => {
    const values = item[field] || [];
    return values.includes(oldName) ? { ...item, [field]: values.map(value => value === oldName ? nextName : value), updatedAt: new Date().toISOString() } : item;
  });
  const categories = kind === 'category' ? (state.categories || []).map(value => value === oldName ? nextName : value) : state.categories;
  try {
    state = await native.saveLibrary({ ...state, categories, items });
    const filter = resourceFilters.values[kind === 'category' ? 'categoryFilter' : 'genreFilter'];
    if (filter.delete(oldName)) filter.add(nextName);
    const oldKey = kind + ':' + oldName, newKey = kind + ':' + nextName;
    if (tagManagementSelection.delete(oldKey)) tagManagementSelection.add(newKey);
    tagManagementAnchor = tagManagementAnchor === oldKey ? newKey : tagManagementAnchor;
    try {
      const order = JSON.parse(localStorage.getItem('tagCardOrder') || '[]');
      localStorage.setItem('tagCardOrder', JSON.stringify(Array.isArray(order) ? order.map(key => key === oldKey ? newKey : key) : []));
    } catch {}
    renderCategories(); showToast(label + '已重命名');
  } catch (error) { showToast(label + '重命名失败：' + error.message, 'error'); }
}
function syncTagToolbarAlignment() {
  const toolbar = document.querySelector('#categoriesView .tag-tools'), search = toolbar?.querySelector('.tag-search'), sort = $('tagSort'), tools = $('tagSelectionTools');
  const running = $('tagStatusFilters')?.querySelector('[data-status-label="进行中"]'), completed = $('tagStatusFilters')?.querySelector('[data-status-label="已完成"]');
  if (!toolbar || !search || !sort || !tools || !running || !completed) return;
  const clear = () => { toolbar.classList.add('tag-tools-natural'); search.style.flex = ''; search.style.width = ''; search.style.maxWidth = ''; sort.style.marginLeft = ''; tools.style.marginLeft = ''; };
  const root = toolbar.getBoundingClientRect(), run = running.getBoundingClientRect(), done = completed.getBoundingClientRect();
  const width = run.right - root.left, offset = done.left - run.right, gap = parseFloat(getComputedStyle(toolbar).columnGap) || 0;
  if (Math.abs(run.top - done.top) > 3 || width < 150 || width + offset + sort.getBoundingClientRect().width + tools.getBoundingClientRect().width + gap * 2 > toolbar.clientWidth) { clear(); return; }
  toolbar.classList.remove('tag-tools-natural');
  search.style.flex = '0 0 ' + width + 'px'; search.style.width = width + 'px'; search.style.maxWidth = 'none';
  sort.style.marginLeft = Math.max(0, offset - gap) + 'px'; tools.style.marginLeft = 'auto';
}
function renderTagManagementSelection() {
  const tools = $('tagSelectionTools'); if (!tools) return;
  for (const card of $('categoryGrid').querySelectorAll('.tag-card')) {
    const key = card.dataset.tagType + ':' + card.dataset.tagName, checked = tagManagementSelection.has(key), input = card.querySelector('.tag-card-select input');
    if (input) { input.checked = checked; input.setAttribute('aria-label', '选择' + (card.dataset.tagType === 'category' ? '分类 ' : '标签 ') + card.dataset.tagName); }
    card.classList.toggle('management-selected', checked);
  }
  const count = $('tagSelectionCount'), remove = $('deleteTagSelection');
  if (count) { count.textContent = tagManagementSelection.size ? '已勾选 ' + tagManagementSelection.size + ' 项' : ''; count.hidden = !tagManagementSelection.size; }
  if (remove) { remove.disabled = !tagManagementSelection.size || tagDeletionBusy; remove.setAttribute('aria-disabled', String(remove.disabled)); remove.classList.toggle('is-disabled', remove.disabled); }
  requestAnimationFrame(syncTagToolbarAlignment);
}
async function deleteTagEntries(keys = [...tagManagementSelection]) {
  const wanted = [...new Set(keys)].filter(key => typeof key === 'string');
  if (!wanted.length || tagDeletionBusy) return;
  const categories = new Set(wanted.filter(key => key.startsWith('category:')).map(key => key.slice(9)));
  const genres = new Set(wanted.filter(key => key.startsWith('genre:')).map(key => key.slice(6)));
  if (!(await confirmDeletion('将删除所选的 ' + wanted.length + ' 个分类或标签，并从相关条目中移除对应关联。资源条目和本地文件不会删除。继续吗？'))) return;
  tagDeletionBusy = true; renderTagManagementSelection();
  try {
    const items = state.items.map(item => {
      const nextCategories = (item.categories || []).filter(name => !categories.has(name));
      const nextGenres = (item.genres || []).filter(name => !genres.has(name));
      return nextCategories.length === (item.categories || []).length && nextGenres.length === (item.genres || []).length ? item : { ...item, categories: nextCategories, genres: nextGenres, updatedAt: new Date().toISOString() };
    });
    state = await native.saveLibrary({ ...state, categories: (state.categories || []).filter(name => !categories.has(name)), items });
    for (const name of categories) resourceFilters.values.categoryFilter.delete(name);
    for (const name of genres) resourceFilters.values.genreFilter.delete(name);
    tagManagementSelection.clear(); tagManagementAnchor = null;
    const entries = new Map();
    (state.categories || []).forEach(name => entries.set('category:' + name, true));
    state.items.forEach(item => { (item.categories || []).forEach(name => entries.set('category:' + name, true)); (item.genres || []).forEach(name => entries.set('genre:' + name, true)); });
    try { localStorage.setItem('tagCardOrder', JSON.stringify(readTagCardOrder([...entries.keys()].map(key => { const index = key.indexOf(':'); return { kind: key.slice(0, index), name: key.slice(index + 1) }; })))); } catch {}
    renderCategories(); showToast('已删除所选分类和标签');
  } catch (error) { showToast('删除分类或标签失败：' + error.message, 'error'); }
  finally { tagDeletionBusy = false; renderTagManagementSelection(); }
}
function renderCategories() {
  renderTagStatusFilters();
  renderTagSortControl();
  const grid = $('categoryGrid'), keyOf = node => node.dataset.tagType + ':' + node.dataset.tagName;
  const positions = new Map([...grid.querySelectorAll('.tag-card')].map(node => [keyOf(node), node.getBoundingClientRect()]));
  const search = ($('categorySearch')?.value || '').trim().toLowerCase();
  const items = visibleResourceItems(), matched = items.filter(item => resourceFilters.matches(item));
  const hasSelection = Object.values(resourceFilters.values).some(values => values.size) || resourceFilters.hasCompletion();
  const possible = new Set();
  matched.forEach(item => { (item.genres || []).forEach(tag => possible.add('genre:' + tag)); (item.categories || []).forEach(tag => possible.add('category:' + tag)); });
  const entries = new Map();
  const add = (kind, name) => { if (settings.positiveEnergyEnabled && POSITIVE_ENERGY_TAGS.has(positiveEnergyTagKey(name))) return; const key = kind + ':' + name; if (!entries.has(key)) entries.set(key, { kind, name, count: 0 }); };
  (state.categories || []).forEach(name => add('category', name));
  items.forEach(item => { (item.categories || []).forEach(name => add('category', name)); (item.genres || []).forEach(name => add('genre', name)); });
  if (settings.positiveEnergyEnabled) for (const key of [...tagManagementSelection]) if (POSITIVE_ENERGY_TAGS.has(positiveEnergyTagKey(key.slice(key.indexOf(':') + 1)))) tagManagementSelection.delete(key);
  matched.forEach(item => { (item.categories || []).forEach(name => entries.get('category:' + name).count++); (item.genres || []).forEach(name => entries.get('genre:' + name).count++); });
  const selected = entry => resourceFilters.selected(entry.kind === 'genre' ? 'genreFilter' : 'categoryFilter').includes(entry.name);
  const prefs = tagSortPreferences(), order = readTagCardOrder([...entries.values()]), orderIndex = new Map(order.map((key, index) => [key, index]));
  grid.dataset.sortMode = prefs.field;
  const filtered = [...entries.values()].filter(entry => (selected(entry) || (!hasSelection || possible.has(tagEntryKey(entry)))) && (!tagKinds.size || tagKinds.has(entry.kind)) && (!search || entry.name.toLowerCase().includes(search)));
  filtered.sort((a, b) => {
    if (prefs.field === 'manual') return ((orderIndex.get(tagEntryKey(a)) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(tagEntryKey(b)) ?? Number.MAX_SAFE_INTEGER)) * (prefs.direction === 'desc' ? -1 : 1) || a.name.localeCompare(b.name, 'zh');
    const primary = prefs.field === 'count' ? a.count - b.count : a.name.localeCompare(b.name, 'zh');
    return primary * (prefs.direction === 'desc' ? -1 : 1) || a.name.localeCompare(b.name, 'zh') || a.kind.localeCompare(b.kind);
  });
  let tools = $('tagSelectionTools');
  if (!tools) { tools = document.createElement('div'); tools.id = 'tagSelectionTools'; tools.className = 'tag-selection-tools'; }
  document.querySelector('#categoriesView .tag-tools')?.append(tools);
  if (tools) {
    tools.innerHTML = '<span id="tagSelectionCount" class="tag-selection-count" aria-live="polite"></span><div class="tag-selection-actions"><button type="button" id="deleteTagSelection" class="batch-icon batch-delete" aria-label="删除所选分类和标签" title="删除所选项">' + DELETE_ICON + '</button><button type="button" class="secondary-button" id="resetTagSelection">清除选择</button><button type="button" class="add-button" id="viewTagResults">查看匹配资源（' + matched.length + '） →</button></div>';
    $('resetTagSelection').onclick = () => { tagManagementSelection.clear(); tagManagementAnchor = null; tagKinds.clear(); resourceFilters.clearTagFilters(); renderCategories(); };
    $('viewTagResults').onclick = () => { activeView = 'all'; render(); $('filters').classList.remove('hidden'); };
    $('deleteTagSelection').onclick = () => { if (tagManagementSelection.size && !tagDeletionBusy) void deleteTagEntries(); };
  }
  grid.innerHTML = filtered.length ? filtered.map(entry => {
    const key = tagEntryKey(entry), filterSelected = selected(entry), checked = tagManagementSelection.has(key), label = entry.kind === 'category' ? '分类' : '标签';
    return '<article draggable="true" class="category-card tag-card' + (filterSelected ? ' selected' : '') + (checked ? ' management-selected' : '') + '" data-tag-name="' + esc(entry.name) + '" data-tag-type="' + entry.kind + '"><button type="button" class="tag-card-main" aria-pressed="' + filterSelected + '"><span class="tag-kind">' + label + '</span><strong>' + esc(entry.name) + '</strong><small>' + entry.count + ' 条匹配资源</small></button><label class="tag-card-select" title="勾选以批量管理"><input type="checkbox"' + (checked ? ' checked' : '') + '><span aria-hidden="true"></span></label></article>';
  }).join('') : '<div class="empty-state"><h3>没有匹配的标签</h3><p>' + (search ? '当前搜索词没有匹配标签。' : '当前筛选条件下没有标签。') + '</p>' + (search ? '<button type="button" class="secondary-button" id="clearTagSearch">清除搜索</button>' : '') + '</div>';
  const clearSearch = $('clearTagSearch');
  if (clearSearch) clearSearch.onclick = () => { $('categorySearch').value = ''; renderCategories(); $('categorySearch').focus(); };
  grid.querySelectorAll('.tag-card').forEach(card => {
    const toggle = () => { resourceFilters.toggle(card.dataset.tagType === 'genre' ? 'genreFilter' : 'categoryFilter', card.dataset.tagName); renderCategories(); [...grid.querySelectorAll('.tag-card')].find(node => keyOf(node) === keyOf(card))?.querySelector('.tag-card-main')?.focus({ preventScroll: true }); };
    card.querySelector('.tag-card-main').addEventListener('click', toggle);
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
  renderTagManagementSelection();
  requestAnimationFrame(syncTagToolbarAlignment);
}
function installTagManagement() {
  const toolbar = document.querySelector('#categoriesView .tag-tools');
  toolbar?.querySelector('.tag-tabs')?.remove();
  renderTagSortControl();
  $('categorySearch').addEventListener('input', renderCategories);
  const grid = $('categoryGrid');
  if (!$('tagStatusFilters')) { const section = document.createElement('section'); section.id = 'tagStatusFilters'; section.className = 'tag-status-section'; grid.before(section); }
  let tools = $('tagSelectionTools');
  if (!tools) { tools = document.createElement('div'); tools.id = 'tagSelectionTools'; tools.className = 'tag-selection-tools'; }
  toolbar?.append(tools);
  const cardKey = card => card?.dataset.tagType + ':' + card?.dataset.tagName;
  const syncSelection = () => renderTagManagementSelection();
  grid.addEventListener('contextmenu', event => {
    const name = event.target.closest('.tag-card-main strong'), card = name?.closest('.tag-card');
    if (!card) return;
    event.preventDefault(); event.stopPropagation();
    void renameTagEntry(card.dataset.tagType, card.dataset.tagName);
  });
  grid.addEventListener('pointerdown', event => {
    const target = event.target.closest('.tag-card-select'); if (!target || event.button !== 0) return;
    const card = target.closest('.tag-card'); if (!card) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const visible = [...grid.querySelectorAll('.tag-card')].map(cardKey), key = cardKey(card);
    const base = event.shiftKey && !event.ctrlKey ? [] : [...tagManagementSelection];
    const selected = event.shiftKey || !tagManagementSelection.has(key);
    const anchor = event.shiftKey && tagManagementAnchor ? tagManagementAnchor : key;
    tagManagementAnchor = anchor;
    tagManagementSelection = new Set(SelectionRange.apply(visible, anchor, key, base, selected));
    tagManagementPaint = { pointerId: event.pointerId, lastKey: key, visible, base, anchor, selected };
    grid.classList.add('is-painting'); grid.setPointerCapture?.(event.pointerId); syncSelection();
  }, true);
  grid.addEventListener('pointermove', event => {
    const paint = tagManagementPaint; if (!paint || paint.pointerId !== event.pointerId) return;
    event.preventDefault();
    const card = document.elementFromPoint(event.clientX, event.clientY)?.closest('#categoryGrid .tag-card'), key = cardKey(card);
    if (!card || key === paint.lastKey) return;
    paint.lastKey = key;
    tagManagementSelection = new Set(SelectionRange.apply([...grid.querySelectorAll('.tag-card')].map(cardKey), paint.anchor, key, paint.base, paint.selected));
    syncSelection();
  });
  const stopPaint = event => {
    if (!tagManagementPaint || event.pointerId !== tagManagementPaint.pointerId) return;
    tagManagementPaint = null; tagManagementSuppressClickUntil = Date.now() + 450; grid.classList.remove('is-painting');
    if (grid.hasPointerCapture?.(event.pointerId)) grid.releasePointerCapture(event.pointerId);
  };
  grid.addEventListener('pointerup', stopPaint); grid.addEventListener('pointercancel', stopPaint); grid.addEventListener('lostpointercapture', stopPaint);
  grid.addEventListener('click', event => {
    if (Date.now() < tagManagementSuppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  grid.addEventListener('change', event => {
    const input = event.target.closest('.tag-card-select input'); if (!input) return;
    const key = cardKey(input.closest('.tag-card'));
    if (input.checked) tagManagementSelection.add(key); else tagManagementSelection.delete(key);
    tagManagementAnchor = key; syncSelection();
  });

  let dragged = null, draggedKeys = [], draggedInitialOrder = [];
  const clearDrag = () => {
    grid.querySelectorAll('.tag-card.dragging,.tag-card.drag-over').forEach(card => card.classList.remove('dragging', 'drag-over'));
    $('deleteTagSelection')?.classList.remove('drag-delete-over'); dragged = null; draggedKeys = []; draggedInitialOrder = [];
  };
  grid.addEventListener('dragstart', event => {
    const card = event.target.closest('.tag-card'); if (!card || event.target.closest('.tag-card-select')) return;
    dragged = card; const key = cardKey(card);
    draggedInitialOrder = [...grid.querySelectorAll('.tag-card')].map(cardKey);
    draggedKeys = tagManagementSelection.has(key) ? [...grid.querySelectorAll('.tag-card')].map(cardKey).filter(value => tagManagementSelection.has(value)) : [key];
    draggedKeys.forEach(value => [...grid.querySelectorAll('.tag-card')].find(node => cardKey(node) === value)?.classList.add('dragging'));
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key);
  }, true);
  grid.addEventListener('dragover', event => {
    if (!dragged || !grid.contains(event.target)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    let target = event.target.closest('.tag-card');
    if (!target) target = [...grid.querySelectorAll('.tag-card')].filter(card => !draggedKeys.includes(cardKey(card))).sort((a, b) => {
      const distance = card => { const rect = card.getBoundingClientRect(); return Math.hypot(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2); };
      return distance(a) - distance(b);
    })[0];
    if (!target || draggedKeys.includes(cardKey(target))) return;
    const rect = target.getBoundingClientRect(), after = event.clientY > rect.bottom ? true : event.clientY < rect.top ? false : event.clientX > rect.left + rect.width / 2;
    const nodes = [...grid.querySelectorAll('.tag-card')], moving = nodes.filter(card => draggedKeys.includes(cardKey(card))), stationary = nodes.filter(card => !draggedKeys.includes(cardKey(card)));
    const at = stationary.indexOf(target) + (after ? 1 : 0), ordered = [...stationary.slice(0, at), ...moving, ...stationary.slice(at)];
    if (ordered.some((card, index) => card !== nodes[index])) ReorderMotion.move(grid, ordered, { exclude: moving });
  }, true);
  tools?.addEventListener('dragover', event => {
    if (!dragged || !event.target.closest('#deleteTagSelection')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; $('deleteTagSelection')?.classList.add('drag-delete-over');
  });
  document.addEventListener('drop', async event => {
    if (!dragged) return;
    const keys = [...draggedKeys], deleteTarget = event.target.closest?.('#deleteTagSelection');
    if (deleteTarget) {
      event.preventDefault(); event.stopPropagation(); clearDrag(); await deleteTagEntries(keys); return;
    }
    if (grid.contains(event.target)) {
      event.preventDefault();
      const visibleOrder = [...grid.querySelectorAll('.tag-card')].map(cardKey);
      if (visibleOrder.every((key, index) => key === draggedInitialOrder[index])) { clearDrag(); return; }
      const visible = new Set(visibleOrder), entries = new Map();
      (state.categories || []).forEach(name => entries.set('category:' + name, { kind: 'category', name }));
      state.items.forEach(item => { (item.categories || []).forEach(name => entries.set('category:' + name, { kind: 'category', name })); (item.genres || []).forEach(name => entries.set('genre:' + name, { kind: 'genre', name })); });
      const order = readTagCardOrder([...entries.values()]); let index = 0;
      const next = order.map(key => visible.has(key) ? visibleOrder[index++] : key);
      try { localStorage.setItem('tagCardOrder', JSON.stringify(next)); } catch { showToast('自定义顺序保存失败', 'error'); }
      saveTagSortPreferences({ ...tagSortPreferences(), field: 'manual', direction: 'asc' });
      clearDrag(); renderCategories(); showToast('已保存自定义顺序'); return;
    }
    clearDrag(); renderCategories();
  }, true);
  document.addEventListener('dragend', () => { const abandoned = Boolean(dragged); clearDrag(); if (abandoned) renderCategories(); }, true);
  tools?.addEventListener('click', event => {
    if (event.target.closest('#deleteTagSelection') && !tagManagementSelection.size) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  if (window.ResizeObserver && toolbar) {
    let scheduled = false;
    const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; syncTagToolbarAlignment(); }); };
    const observer = new ResizeObserver(schedule); observer.observe(toolbar); observer.observe($('tagStatusFilters'));
    window.addEventListener('resize', schedule);
  }
}
function setStatusOptions(type, selected = '') { selected = StatusModel.normalize(selected, type); const values = statusList(type); $('fieldStatus').innerHTML = values.map((value) => `<option value="${esc(value)}">${value === '全成就' ? '🏆 ' : ''}${esc(value)}</option>`).join(''); $('fieldStatus').value = values.includes(selected) ? selected : values[0]; updateCompletedDateState(); updateTypeFields(type); }
function updateTypeFields(type = $('fieldType')?.value || 'game') {
  const show = (selector, enabled) => all(selector).forEach(node => node.classList.toggle('hidden', !enabled));
  const game = type === 'game', publication = ['book', 'manga'].includes(type), media = ['movie', 'anime'].includes(type);
  const localOnly=['audio','software','document','unknown_application','unknown_collection'].includes(type);
  $('editorForm').dataset.mediaType = type;window.audioEditor?.show(type);
  show('.game-only', game); const platforms=PlatformModel.detect({...editorMetadata,storeUrl:valueFor('fieldStoreUrl'),steamAppId:valueFor('fieldSteamAppId')});show('#steamAppIdField',game&&platforms.includes('steam')); show('#detectSavePathsBtn, #pickSavePathsBtn, #backupSaveBtn', game);
  renderPlatformPicker();
  show('.media-only', media); show('.publication-only', publication); show('.resource-only', !game);
  show('#metadataBtn',!localOnly||type==='audio');$('metadataBtn').parentElement.classList.toggle('hidden',localOnly&&type!=='audio'&&!editorMetadata.metadataSource);
  $('developerField').firstChild.textContent = game ? '开发商 / 工作室' : publication ? '作者 / 原作' : type === 'movie' ? '导演' : '制作 / 导演';
  $('publisherField').firstChild.textContent = publication ? '出版社' : game ? '发行商' : '平台 / 制作方';
  $('castField').firstChild.textContent = type === 'movie' ? '演员' : '声优';
  $('resourceUrlLabel').textContent = publication ? '购买 / 阅读链接' : '观看 / 访问链接';
  $('releaseDateField').firstChild.textContent = publication ? '出版日期' : '发行日期';
  $('platformRatingLabel').textContent = game ? 'Steam 评价' : '来源平台评分'; renderPlatformRating();
  $('playtimeField').firstChild.textContent = game ? '游玩时长（小时）' : media ? '观看时长（小时）' : '阅读时长（小时）';
  show('#playtimeField', game || publication || media); show('#platformRatingField', type !== 'other');
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
async function refreshSnapshotIndex(rerender=true,clearRemoteCache=true){if(clearRemoteCache)remoteSnapshotCache.clear();const version=++snapshotIndexGeneration;try{const rows=await native.listAllBackups();if(version===snapshotIndexGeneration)snapshotIndex=Array.isArray(rows)?rows:[];}catch(error){if(version===snapshotIndexGeneration){snapshotIndex=[];showToast('读取存档快照失败：'+error.message,'error');}}if(rerender&&activeView==='game')renderLibrary();return snapshotIndex;}
function snapshotsFor(itemId){return snapshotIndex.filter(entry=>entry.itemId===itemId).sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));}
function snapshotCardMode(){return activeView==='game'&&$('saveFilter')?.value==='has'&&currentLibraryLayout()==='list';}
function snapshotSelectionMode(){return snapshotCardMode()&&Boolean(librarySelection?.active)&&!$('filters')?.classList.contains('hidden')&&!document.body.classList.contains('is-disguised');}
function visibleSnapshotRows(){const allowed=new Set(filterItems().map(item=>item.id));return snapshotIndex.filter(entry=>allowed.has(entry.itemId));}
function ensureBackupPanel() { return $('backupList'); }
async function remoteBackupsFor(itemId){
  if(!settings.webdavUrl)return [];
  const key=[itemId,settings.webdavUrl,settings.webdavRemotePath,settings.webdavUsername].join('\n'),cached=remoteSnapshotCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.rows;
  const result=await native.listRemoteBackups(itemId,settings);
  if(!result?.ok)throw Error(result?.message||'读取云端存档列表失败');
  const rows=Array.isArray(result.entries)?result.entries:[];remoteSnapshotCache.set(key,{rows,expires:Date.now()+20000});return rows;
}
async function renderBackupList() {
  ensureBackupPanel();
  const panel = $('backupList'), list = $('backupSnapshotRows'), itemId = editorId, version = ++backupRenderVersion;
  if (!panel || !list) return;
  updateSavePathHint();
  panel.classList.toggle('hidden', $('fieldType').value !== 'game');
  if ($('fieldType').value !== 'game') { list.textContent = ''; return; }
  if (!itemId) { $('backupSnapshotCount').textContent = '0 份'; list.innerHTML = '<div class="backup-empty">暂无存档快照</div>'; return; }
  list.textContent = '正在读取存档快照…';
  let backups = await native.listBackups(itemId),remoteRows=[],remoteError='';
  try{remoteRows=await remoteBackupsFor(itemId);}catch(error){remoteError=error.message;}
  if (editorId !== itemId || version !== backupRenderVersion) return;
  const localIds=new Set(backups.map(entry=>entry.id));
  const cloudOnly=remoteRows.filter(entry=>!localIds.has(entry.id)).map(entry=>({...entry,remoteOnly:true}));
  backups=[...backups,...cloudOnly];
  $('backupSnapshotCount').textContent = backups.length + ' 份'+(cloudOnly.length?'（'+cloudOnly.length+' 份仅在云端）':'');
  list.innerHTML = backups?.length ? backups.map(entry =>
    '<div class="backup-entry'+(entry.remoteOnly?' remote-backup-entry':'')+'"><div class="backup-entry-main"><strong>' + formatDateTime(entry.createdAt) +
    '</strong><span>' + (Number(entry.files)||0) + ' 个文件 · '+(entry.remoteOnly?'云端压缩存储 ':'压缩存储 ') + formatBytes(entry.size) + (entry.remoteOnly?' · 选择切换时才下载':'')+'</span></div><input class="backup-note-input" type="text" data-item-id="' + esc(itemId) + '" data-backup-id="' + esc(entry.id) + '" value="' + esc(entry.note || '') + '" maxlength="2000" placeholder="进度备注" aria-label="' + esc(formatDateTime(entry.createdAt) + ' 存档备注') + '"'+(entry.remoteOnly?' disabled title="下载到本机后可编辑备注"':'')+'>' +
    snapshotSyncStatusHtml(entry,itemId) + '<button type="button" class="backup-restore" data-backup-id="' + esc(entry.id) +
    '"'+(entry.remoteOnly?' title="下载此快照并切换存档"':'')+'>切换</button><button type="button" class="backup-delete" data-backup-id="' + esc(entry.id) + '"'+(entry.remoteOnly?' title="删除云端存档"':'')+'>删除</button></div>'
  ).join('') : '<div class="backup-empty">暂无存档快照</div>';
  if(remoteError&&settings.webdavUrl)list.insertAdjacentHTML('beforeend','<div class="backup-empty backup-remote-error">云端列表暂不可用：'+esc(remoteError)+'</div>');
  all('.backup-note-input', list).forEach(input => {
    input.dataset.savedValue = input.value.trim();
    input.addEventListener('input', () => scheduleBackupNoteSave(input));
    input.addEventListener('blur', () => scheduleBackupNoteSave(input, true));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
  });
  all('.snapshot-sync-button:not(.synced):not(.unconfigured)',list).forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void syncSnapshotButton(button);}));
  all('.backup-restore, .backup-delete', list).forEach(button => button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    const backup = backups.find(entry => entry.id === button.dataset.backupId);
    if (!backup) return;
    const removing = button.classList.contains('backup-delete');
    const decision = removing
      ? backup.remoteOnly?await askConfirm('从 WebDAV 云端删除 ' + formatDateTime(backup.createdAt) + ' 的存档快照？此操作无法撤销。',{title:'删除云端存档',confirmText:'删除',danger:true}):await confirmBackupDeletion('删除 ' + formatDateTime(backup.createdAt) + ' 的存档快照？此操作无法撤销。')
      : await askConfirm('切换到 ' + formatDateTime(backup.createdAt) + ' 的存档？当前文件可能被覆盖。', { title: '恢复存档前确认', confirmText: '确认切换', danger: true });
    if (!decision || editorId !== itemId) return;
    button.disabled = true;
    try {
      const result = removing ? backup.remoteOnly?await native.deleteRemoteBackup(itemId,backup.id,settings):await native.deleteBackup(itemId, backup.id, { syncCloud: decision.syncCloud }) : backup.remoteOnly?await native.restoreRemoteBackup(itemId,backup.id,settings):await native.restoreBackup(itemId, backup.id);
      if (!result?.ok) throw Error(result?.message || '操作失败');
      remoteSnapshotCache.clear();
      if(!removing&&backup.remoteOnly&&result.paths){state=await native.loadLibrary();editorSavePaths=[...(state.items.find(entry=>entry.id===itemId)?.savePaths||result.paths)];updateSavePathHint();updateLinkButtons();}
      const remaining = await native.listBackups(itemId);
      if (removing && remaining.some(entry => entry.id === backup.id)) throw Error('快照仍然存在，请检查文件占用或权限');
      const item = state.items.find(entry => entry.id === itemId);
      if (item) { item.backupCount = remaining.length; state = await native.saveLibrary(state); }
      await refreshSnapshotIndex(true);
      if(snapshotCardMode())renderLibrary();
      if (editorId === itemId) await renderBackupList();
      showToast(removing ? (result.message || '存档快照已删除') : backup.remoteOnly?'已下载并切换到所选存档':'已切换到所选存档');
    } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
  }));
}
function scheduleBackupNoteSave(input, immediate = false) {
  const timer = backupNoteTimers.get(input);
  if (timer) clearTimeout(timer);
  if (immediate) return persistBackupNote(input);
  backupNoteTimers.set(input, setTimeout(() => { void persistBackupNote(input); }, 500));
}
async function persistBackupNote(input) {
  const timer = backupNoteTimers.get(input);
  if (timer) clearTimeout(timer);
  const previous = backupNoteWrites.get(input) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const note = input.value.trim().slice(0, 2000);
    if (note === input.dataset.savedValue) return;
    const result = await native.updateBackupNote(input.dataset.itemId, input.dataset.backupId, note);
    if (!result?.ok) throw Error(result?.message || '存档备注保存失败');
    input.dataset.savedValue = note;
    await refreshSnapshotIndex(true);
    const status = input.closest('.backup-entry')?.querySelector('.snapshot-sync-button');
    const updated=snapshotIndex.find(entry=>entry.id===input.dataset.backupId);
    if(status&&updated){const template=document.createElement('template');template.innerHTML=snapshotSyncStatusHtml(updated,input.dataset.itemId).trim();const button=template.content.firstElementChild;status.replaceWith(button);if(button.matches('.snapshot-sync-button:not(.synced):not(.unconfigured)'))button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void syncSnapshotButton(button);});}
    if(snapshotCardMode())renderLibrary();
  });
  backupNoteWrites.set(input, write);
  try { await write; } catch (error) { showToast(error.message, 'error'); }
}
function updateSavePathHint() {
  const backup=$('backupSaveBtn');
  const rows=$('savePathRows');if(rows){rows.innerHTML=editorSavePaths.length?editorSavePaths.map((value,index)=>'<div class="save-path-row"><button type="button" class="save-path-open" data-open-save-path="'+index+'" title="打开存档位置：'+esc(value)+'" aria-label="打开存档位置 '+(index+1)+'：'+esc(value)+'"><span class="backup-path-icon" aria-hidden="true">📁</span><span class="backup-path-value">'+esc(value)+'</span></button><button type="button" class="save-path-clear" data-clear-save-path="'+index+'" aria-label="清除存档路径 '+(index+1)+'" title="清除路径">×</button></div>').join(''):'<div class="save-path-empty"><span class="backup-path-icon" aria-hidden="true">📁</span><span>未设置存档位置</span></div>';}
  if(backup)backup.disabled=!editorId||!editorSavePaths.length;
  const field=$('fieldSavePaths');if(field)field.value=JSON.stringify(editorSavePaths);
}
function updateLinkButtons() { $('openLocalResourceBtn').disabled = !valueFor('fieldLocalPath'); $('openResourceUrlBtn').disabled = !valueFor('fieldResourceUrl'); $('openStoreBtn').disabled = !valueFor('fieldStoreUrl'); $('openNoteBtn').disabled = !valueFor('fieldNoteUrl'); $('backupSaveBtn').disabled = !editorId || !editorSavePaths.length; }
function fillEditor(item) { cancelMetadataLookup(); hideSettingsToast(); ++editorFileRequest; closeResourcePathMenu(); endEditorSaveCue(); item = MetadataText.candidate(item || {}); $('editorId').value = item?.id || ''; $('editorEyebrow').textContent = item ? '编辑资源' : '新建资源'; $('editorTitle').textContent = item ? item.name : '添加资源'; $('fieldName').value = item?.name || ''; $('fieldType').value = item?.type || 'game'; setStatusOptions($('fieldType').value, item?.status || ''); $('fieldCompletedDate').value = item?.completedDate || ''; $('fieldPlaytime').value = item?.playtime ?? ''; $('fieldGenres').value = (item?.genres || []).join(', '); $('fieldCategories').value = (item?.categories || []).join(', '); $('fieldDeveloper').value = item?.developer || ''; $('fieldPublisher').value = item?.publisher || ''; $('fieldReleaseDate').value = item?.releaseDate || ''; $('fieldExternalRating').value = item?.externalRating || item?.steamRating || ''; $('fieldSteamAppId').value = item?.steamAppId || ''; $('fieldCast').value = (item?.cast || []).join(', '); $('fieldEpisodes').value = item?.episodes ?? ''; $('fieldIsbn').value = item?.isbn || ''; $('fieldPages').value = item?.pages ?? ''; $('fieldTranslator').value = item?.translator || ''; $('fieldResourceUrl').value = item?.resourceUrl || ''; $('fieldLocalPath').value = item?.localPath || ''; renderMetadataCoverage(item); fillCoverFields(item); $('fieldReview').value = item?.review || ''; $('fieldDescription').value = item?.description || ''; $('fieldStoreUrl').value = item?.storeUrl || ''; $('fieldNoteUrl').value = item?.noteUrl || ''; editorSavePaths = [...(item?.savePaths || [])]; updateSavePathHint(); setRating(item?.rating ?? null); updateCoverPreview(coverFor(item, editorCoverDirection), editorCoverDirection); $('deleteBtn').classList.toggle('hidden', !item); updateLinkButtons(); $('editorBackdrop').classList.remove('hidden'); updateTypeFields($('fieldType').value); ensureBackupPanel(); renderBackupList(); window.audioEditor?.fill(item);beginEditorSaveCue(); requestAnimationFrame(syncOverflowFields); setTimeout(() => {if(!$('editorBackdrop').classList.contains('hidden'))$('fieldName').focus();}, 30); }
function updateCoverPreview(url, direction = editorCoverDirection) {
  const preview = $('coverPreview'); preview.classList.toggle('empty-cover', !url); preview.replaceChildren();
  if (!url) { const empty = document.createElement('span'); empty.className = 'cover-empty-label'; empty.textContent = '暂无封面'; preview.append(empty); return; }
  const backdrop = document.createElement('img'); backdrop.className = 'cover-art-backdrop'; backdrop.alt = ''; backdrop.setAttribute('aria-hidden', 'true'); backdrop.src = url;
  const image = document.createElement('img'); image.className = 'cover-art-image'; image.alt = valueFor('fieldName') || '封面'; image.dataset.coverDirection = direction;
  image.addEventListener('load', () => { if (image.currentSrc) backdrop.src = image.currentSrc; });
  image.addEventListener('error', () => { if (image.src) backdrop.src = image.src; });
  image.src = url; preview.append(backdrop, image);
  attachStableCover(image,{...editorCovers,name:valueFor('fieldName')});
}
function openEditor(id = null) {
  if (document.body.classList.contains('is-disguised')) return;
  editorId = id;
  const typeFromView = ['audio', 'game', 'software', 'movie', 'anime', 'manga', 'book', 'document', 'unknown_application', 'unknown_collection', 'other'].includes(activeView) ? activeView : 'game';
  const item = id ? state.items.find(entry => entry.id === id) : { type: typeFromView };
  editorOriginalItem = item ? structuredClone(item) : { type: typeFromView };
  fillEditor(item);
  if (!id) { $('editorEyebrow').textContent = '新建资源'; $('editorTitle').textContent = '添加资源'; $('deleteBtn').classList.add('hidden'); }
}
function cancelEditorChanges() {
  closeEditor();
  render();
}
function closeEditor() { window.audioCompletion?.clearDeferred(editorId);cancelMetadataLookup(); endEditorSaveCue(); closeResourcePathMenu(); closeCoverDialog(); metadataRequestId += 1; $('editorBackdrop').classList.add('hidden'); editorId = null; editorOriginalItem = null; }
async function applyCandidate(candidate) {
  if(!candidate||$('editorBackdrop').classList.contains('hidden'))return;
  candidate=MetadataText.candidate(candidate);const previous=metadataSession?.fields||{},before=getEditorMetadata(),hadPlaytime=valueFor('fieldPlaytime')!=='';
  const changed=id=>Object.hasOwn(previous,id)&&$(id).value!==previous[id];
  const scoreChanged=changed('fieldExternalRating'),coverChanged=Boolean(metadataSession?.covers&&metadataSession.covers!==JSON.stringify(getEditorCovers()));
  cancelMetadataLookup();const epoch=metadataSelectionEpoch,owner=editorId,type=$('fieldType').value;
  if(native.resolveMetadataCandidate){
    const requestId='candidate-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);metadataDetailRequestId=requestId;
    try{const resolved=await native.resolveMetadataCandidate(requestId,candidate);if(resolved?.canceled)return;if(resolved)candidate=MetadataText.candidate(resolved);}
    catch{showToast('部分详情暂不可用，已保留搜索阶段资料');}
    finally{if(metadataDetailRequestId===requestId)metadataDetailRequestId=null;}
    if(epoch!==metadataSelectionEpoch||editorId!==owner||$('fieldType').value!==type||$('editorBackdrop').classList.contains('hidden'))return;
  }
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
  else if(type==='game'){
    const candidatePlatforms=PlatformModel.detect(candidate);
    editorMetadata.platforms=[...new Set([...(before.platforms||[]),...candidatePlatforms])];
    editorMetadata.platformsExplicit=Boolean(before.platformsExplicit||candidate.platformsExplicit);
    editorMetadata.platformsManual=false;editorMetadata.platformLinks={...before.platformLinks,...candidate.platformLinks};
    if(candidatePlatforms.length)editorMetadata.fieldSources.platforms=candidate._sourceId==='steam'||/^Steam$/i.test(candidate.metadataSource||'')?'Steam':before.fieldSources?.platforms||'';
  }
  editorMetadata.playedPlatforms=PlatformModel.normalizeMany(before.playedPlatforms);
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
async function saveEditor(event) { event.preventDefault(); const name = valueFor('fieldName'); if (!name) { showToast('名称不能为空', 'error'); return; } const old = editorId ? state.items.find((item) => item.id === editorId) : null; const type = $('fieldType').value; const item = { ...(old || {}), id: editorId || `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, type, ...(type==='audio'?{audio:window.audioEditor.value()}:{}), status: $('fieldStatus').value, completedDate: valueFor('fieldCompletedDate'), playtime: valueFor('fieldPlaytime') ? Number(valueFor('fieldPlaytime')) : null, rating: editorRatingKnown ? currentRating : null, genres: splitValues(valueFor('fieldGenres')), categories: splitValues(valueFor('fieldCategories')), developer: valueFor('fieldDeveloper'), publisher: valueFor('fieldPublisher'), releaseDate: valueFor('fieldReleaseDate'), externalRating: valueFor('fieldExternalRating'), steamAppId: type === 'game' ? valueFor('fieldSteamAppId') : '', cast: ['movie', 'anime'].includes(type) ? splitValues(valueFor('fieldCast')) : [], episodes: ['movie', 'anime'].includes(type) && valueFor('fieldEpisodes') ? Number(valueFor('fieldEpisodes')) : null, isbn: ['book', 'manga'].includes(type) ? valueFor('fieldIsbn') : '', pages: ['book', 'manga'].includes(type) && valueFor('fieldPages') ? Number(valueFor('fieldPages')) : null, translator: ['book', 'manga'].includes(type) ? valueFor('fieldTranslator') : '', resourceUrl: ['movie', 'anime', 'manga', 'book', 'document', 'unknown_collection', 'other'].includes(type) ? valueFor('fieldResourceUrl') : '', localPath: valueFor('fieldLocalPath'), localFiles: valueFor('fieldLocalPath')===old?.localPath?(old?.localFiles||[]):valueFor('fieldLocalPath')?(old?.localFiles||[]).some(f=>LocalModel.pathKey(f.path)===LocalModel.pathKey(valueFor('fieldLocalPath')))?old.localFiles:[{path:valueFor('fieldLocalPath'),name:LocalModel.base(valueFor('fieldLocalPath'))}]:[], ...getEditorCovers(), ...getEditorMetadata(), review: valueFor('fieldReview'), description: valueFor('fieldDescription'), storeUrl: valueFor('fieldStoreUrl'), noteUrl: valueFor('fieldNoteUrl'), savePaths: editorSavePaths, createdAt: old ? old.createdAt || '' : new Date().toISOString(), updatedAt: new Date().toISOString(), sortOrder: old?.sortOrder ?? state.items.length }; if (!state.categories) state.categories = []; state.categories = Array.from(new Set(state.categories.concat(item.categories))); state.items = old ? state.items.map((entry) => entry.id === old.id ? item : entry) : [...state.items, item]; state = await native.saveLibrary(state);
  const previousEditorId=editorId;
  closeEditor();
  window.audioCompletion?.afterSave(item.id,previousEditorId);
  render();
  showToast(old ? '条目已更新' : '条目已添加');
}

function clearFilters() { resourceFilters.clear();$('saveFilter').value='all';snapshotSelection.clear();snapshotAnchor=null;librarySelection.ids.clear();renderLibrary(); }
async function refreshAllMetadata() { return refreshResources(filterItems().map(item=>item.id)); }
async function selectSavePaths() { if ($('fieldType').value !== 'game') { showToast('存档备份仅适用于游戏条目', 'error'); return; } const paths = await native.pickSavePaths(); if (paths?.length) { editorSavePaths = Array.from(new Set([...editorSavePaths,...paths])); updateSavePathHint(); updateLinkButtons(); updateEditorSaveCue(true); showToast(`已添加 ${paths.length} 个存档位置`); } }
async function detectEditorSavePaths(){
  if($('fieldType').value!=='game')return;
  if(editorSavePaths.length){showToast('已有手动设置的存档位置，自动识别不会覆盖');return;}
  const button=$('detectSavePathsBtn'),old=button.textContent;button.disabled=true;button.textContent='识别中…';
  try{
    const item={...(editorOriginalItem||{}),id:editorId||'',type:'game',steamAppId:valueFor('fieldSteamAppId'),name:valueFor('fieldName'),savePaths:[]};
    const result=await native.detectSavePaths(item);
    if(!result?.ok)throw Error(result?.message||'没有识别到存档位置');
    if(result.status==='manual-preserved'){showToast('已有手动设置的存档位置，自动识别不会覆盖');return;}
    editorSavePaths=Array.from(new Set(result.paths||[]));updateSavePathHint();updateLinkButtons();updateEditorSaveCue(true);
    showToast('已识别 '+editorSavePaths.length+' 个存档位置'+(result.source?' · '+result.source:''));
  }catch(error){showToast(error.message||'获取存档路径失败','error');}
  finally{button.disabled=false;button.textContent=old;}
}
async function backupCurrentSaves() {
  if (!editorId) { showToast('请先保存条目，再备份存档', 'error'); return; }
  if (!editorSavePaths.length) { showToast('请先选择存档文件或文件夹', 'error'); return; }
  const itemId=editorId,result=await native.backupSaves(itemId,editorSavePaths,{gameName:valueFor('fieldName')});
  if(!result?.ok){showToast(result?.message||'存档备份失败','error');return;}
  const item=state.items.find(entry=>entry.id===itemId);
  if(item){item.backupCount=(Number(item.backupCount)||0)+1;item.lastBackupAt=result.createdAt;state=await native.saveLibrary(state);}
  await refreshSnapshotIndex(true);await renderBackupList();if(snapshotCardMode())renderLibrary();
  if(!settings.webdavUrl){showToast(`存档已压缩备份（${result.files||0} 个文件 · ${formatBytes(result.size)}）`);return;}
  if(!result.snapshotId){showToast('本地存档已保存，但无法定位快照；请在条目中重试同步','error');return;}
  let syncResult;
  setSnapshotUploadProgress(itemId,result.snapshotId,true);
  try{syncResult=await native.syncBackupSnapshot(itemId,result.snapshotId,settings,'immediate-backup');}
  catch(error){syncResult={ok:false,message:error?.message||String(error)};}
  await refreshSnapshotIndex(true);await renderBackupList();if(snapshotCardMode())renderLibrary();
  if(syncResult?.ok)showToast(`存档已压缩备份并同步（${result.files||0} 个文件 · ${formatBytes(result.size)}）`);
  else showToast(`本地存档已保存，云同步失败，快照已标记“待同步”：${syncResult?.message||'可稍后重试'}`,'error');
}
function webdavSyncPreviewContent(preview,direction,decisionMode=false,choiceSession=null) {
  const c=preview?.comparison||null,root=document.createElement('div');root.className='webdav-sync-summary';
  const intro=document.createElement('p');intro.className='webdav-sync-intro';intro.textContent=decisionMode?'请逐项选择无法判断的内容保留哪一侧。':direction==='bidirectional'?'请选择本次同步采用本地、云端，或合并两侧内容。':'请选择本次同步采用本地或云端内容。';root.append(intro);
  const count=value=>Math.max(0,Math.floor(Number(value)||0));
  const sides=document.createElement('div');sides.className='webdav-sync-sides';
  const addSide=(label,origin,itemCount,status,index,actionLabel,iconMarkup,interactive)=>{
    const card=document.createElement(interactive?'button':'div');if(interactive){card.type='button';card.dataset.choiceIndex=String(index);card.setAttribute('aria-label',actionLabel);card.title=actionLabel;}card.className='webdav-sync-side'+(interactive?' webdav-sync-side-choice':'');if(interactive&&choiceSession?.mode===['local','remote'][index])card.classList.add('is-selected');
    const heading=document.createElement('div');heading.className='webdav-sync-side-heading';
    const name=document.createElement('strong');name.textContent=label;
    const source=document.createElement('span');source.className='webdav-sync-origin';source.textContent=origin;heading.append(name,source);
    const total=document.createElement('strong');total.className='webdav-sync-count';total.textContent=itemCount==null?'数量未知':`${count(itemCount)} 个条目`;
    const date=document.createElement('p');date.className='webdav-sync-date';date.textContent=status||'等待比较';
    card.append(heading,total,date);
    if(interactive){const action=document.createElement('span');action.className='webdav-sync-card-action';action.setAttribute('aria-hidden','true');action.innerHTML=iconMarkup;card.append(action);}
    sides.append(card);
  };
  const addMergeAction=()=>{
    if(decisionMode||direction!=='bidirectional')return;
    const merge=document.createElement('button');merge.type='button';merge.dataset.choiceIndex='2';merge.setAttribute('aria-label','合并本地与云端资源库');merge.title='合并本地与云端资源库';merge.className='webdav-sync-merge-action'+(choiceSession?.mode==='merge'?' is-selected':'');merge.innerHTML='<svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3"/></svg>';sides.append(merge);
  };
  const addComparisonSides=(localCount,remoteCount,interactive)=>{
    const localStatus=c?'各资源最后修改时间见下方对照':'尚未读取';
    const remoteStatus=c?'各资源最后修改时间见下方对照':'尚未读取';
    addSide('本地资源库','此设备',localCount,localStatus,0,'上传本地资源库到云端','<svg viewBox="0 0 24 24" focusable="false"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"/></svg>',interactive);
    addSide('云端资源库','WebDAV',remoteCount,remoteStatus,1,'下载云端资源库到本地','<svg viewBox="0 0 24 24" focusable="false"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 14v5h14v-5"/></svg>',interactive);
    addMergeAction();root.append(sides);
  };
  if(c){
    const freshness=document.createElement('p');freshness.className='webdav-sync-freshness';
    freshness.textContent='下方显示需对照资源的本地与云端最后修改时间；时间按此设备时区显示，仅供人工判断。';
    root.append(freshness);
    addComparisonSides(c.localCount,c.remoteCount,!decisionMode);
    const differences=document.createElement('section');differences.className='webdav-sync-differences';
    const title=document.createElement('strong');title.className='webdav-sync-section-title';title.textContent='内容对照';differences.append(title);
    const metrics=document.createElement('div');metrics.className='webdav-sync-metrics';
    for(const [label,value] of [['两端相同',c.sameCount],['时间对照',c.resourceComparisons?.length],['可自动合并',c.autoMerged],['需要选择',c.unknownItems?.length]]){
      const metric=document.createElement('div');metric.className='webdav-sync-metric';
      const number=document.createElement('strong');number.textContent=String(count(value));
      const caption=document.createElement('span');caption.textContent=label;metric.append(number,caption);metrics.append(metric);
    }
    differences.append(metrics);
    if(count(c.autoMerged)>0){const detail=document.createElement('p');detail.className='webdav-sync-conflict-detail';detail.textContent=`${count(c.autoMerged)} 个条目两侧修改不冲突，可自动合并。`;differences.append(detail);}
    const resourceComparisons=(c.resourceComparisons||[]).filter(row=>!row.conflict);
    if(resourceComparisons.length){
      const section=document.createElement('section');section.className='webdav-sync-resource-section';
      const heading=document.createElement('strong');heading.className='webdav-sync-section-title';heading.textContent='资源时间对照';section.append(heading);
      const list=document.createElement('div');list.className='webdav-sync-resource-list';
      for(const item of resourceComparisons){
        const card=document.createElement('article');card.className='webdav-sync-resource-item';
        const name=document.createElement('strong');name.className='webdav-sync-resource-name';name.textContent=item.label||item.id||'未命名资源';card.append(name);
        appendWebdavResourceTimes(card,item);
        list.append(card);
      }
      section.append(list);differences.append(section);
    }
    if(c.unknownItems?.length){
      const unknown=document.createElement('div');unknown.className='webdav-sync-unknown-list';
      for(const item of c.unknownItems){
        const card=document.createElement('article');card.className='webdav-sync-unknown-item';
        const heading=document.createElement('strong');heading.className='webdav-sync-unknown-title';heading.textContent=item.label||'无法判断的内容';card.append(heading);
        if(item.kind==='resource')appendWebdavResourceTimes(card,item);
        if(item.fields?.length){const fields=document.createElement('div');fields.className='webdav-sync-unknown-fields';for(const field of item.fields){const row=document.createElement('div');row.className='webdav-sync-unknown-field';const name=document.createElement('span');name.className='webdav-sync-unknown-field-name';name.textContent=field.name;const values=document.createElement('span');values.className='webdav-sync-unknown-field-values';values.textContent=`本地：${field.local}　｜　云端：${field.remote}`;row.append(name,values);fields.append(row);}card.append(fields);}
        const label=document.createElement('label');label.className='webdav-sync-unknown-select-label';label.textContent='此项保留';const select=document.createElement('select');select.className='webdav-sync-unknown-select';select.dataset.syncDecisionKey=item.key;select.dataset.syncDecisionSignature=item.signature||'';const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择本地或云端';select.append(placeholder);for(const [value,text] of [['local','本地版本'],['remote','云端版本']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=WebdavSyncChoiceSession.restore(choiceSession,item);select.addEventListener('change',()=>WebdavSyncChoiceSession.remember(choiceSession,item.key,item.signature,select.value));label.append(select);card.append(label);unknown.append(card);
      }
      differences.append(unknown);
      if(decisionMode){const hint=document.createElement('p');hint.className='webdav-sync-selection-hint';hint.setAttribute('aria-live','polite');differences.append(hint);}
    }
    if(count(c.changed)>0){const detail=document.createElement('p');detail.className='webdav-sync-conflict-detail';detail.textContent=`${count(c.changed)} 个同一 ID 资源的内容不同；只对无法自动合并的冲突项要求选择。`;differences.append(detail);}
    if(c.possibleMatches?.length){const detail=document.createElement('p');detail.className='webdav-sync-conflict-detail';detail.textContent='不同 ID 但身份线索相同，需核对：'+c.possibleMatches.slice(0,5).map(row=>`${row.localName||row.localId} ↔ ${row.remoteName||row.remoteId}`).join('；');differences.append(detail);}
    root.append(differences);
  }else{
    const unavailable=document.createElement('p');unavailable.className='webdav-sync-unavailable';unavailable.textContent=preview?.reason||'暂时无法统计内容差异，请根据同步结果选择。';root.append(unavailable);
    addComparisonSides(null,null,!decisionMode);
  }
  const consequence=document.createElement('p');consequence.className='webdav-sync-consequence';
  consequence.textContent=decisionMode?'你选择的内容会按指定版本保留。':direction==='upload'?'选择本地会上传本地资源库；选择云端会改为采用云端资源库。':direction==='download'?'选择云端会下载云端资源库；选择本地会保留当前内容并取消下载。':'选择本地将上传本地内容；选择云端将下载云端内容；合并会保留两侧可合并的改动，并让你确认无法自动判断的冲突。';root.append(consequence);
  return root;
}
function appendWebdavResourceTimes(card,item) {
  const times=document.createElement('div');times.className='webdav-sync-resource-times';
  for(const [label,existsKey,timeKey] of [['本地','localExists','localUpdatedAt'],['云端','remoteExists','remoteUpdatedAt']]){
    const side=document.createElement('div');side.className='webdav-sync-resource-time';
    const name=document.createElement('span');name.className='webdav-sync-resource-time-label';name.textContent=label+'：';
    const value=document.createElement('time');value.className='webdav-sync-resource-time-value';
    const exists=item[existsKey]!==false;value.textContent=exists?formatWebdavCompareTimestamp(item[timeKey]):'不存在';
    if(!exists)value.classList.add('is-missing');
    else if(item[timeKey])value.dateTime=String(item[timeKey]);
    side.append(name,value);times.append(side);
  }
  card.append(times);
}
async function chooseWebdavSyncResolution(direction,preview,choiceSession) {
  const unknownItems=preview?.comparison?.unknownItems||[];
  WebdavSyncChoiceSession.update(choiceSession,unknownItems);
  const choices=[{value:'local'},{value:'remote'}];
  if(direction==='bidirectional')choices.push({value:'merge'});
  const selected=await showAppDialog({title:'本次同步对照',content:webdavSyncPreviewContent(preview,direction,false,choiceSession),choices,choicesInline:true,dialogClass:'app-dialog-webdav-sync',dismissOn:'right'});
  if(!selected)return null;
  WebdavSyncChoiceSession.setMode(choiceSession,selected);
  if(selected==='merge'&&unknownItems.length){
    const content=webdavSyncPreviewContent(preview,direction,true,choiceSession),choices=[{value:'apply-decisions',label:'按选择继续双向同步',primary:true}];
    const selected=await showAppDialog({title:'选择无法判断的内容',content,choices,dialogClass:'app-dialog-webdav-sync',dismissOn:'right',choiceGuard:(value,backdrop)=>{const selects=[...backdrop.querySelectorAll('[data-sync-decision-key]')],missing=selects.filter(row=>!row.value);if(missing.length){const hint=backdrop.querySelector('.webdav-sync-selection-hint');if(hint)hint.textContent=`还有 ${missing.length} 项未选择保留版本。`;missing[0].focus();return false;}return true;}});
    if(selected!=='apply-decisions')return null;
    const decisions=WebdavSyncChoiceSession.values(choiceSession,unknownItems);
    return {decisions};
  }
  return selected;
}
let webdavSyncInProgress=false;
const webdavSyncChoiceSessions=new Map();
function webdavChoiceSessionKey(settings,direction){
  let url=String(settings?.webdavUrl||'').trim();try{const parsed=new URL(url);parsed.username='';parsed.password='';url=parsed.href;}catch{}
  return JSON.stringify([url,String(settings?.webdavUsername||''),String(settings?.webdavRemotePath||''),String(direction||'bidirectional')]);
}
async function syncWebdav(direction) {
  if(webdavSyncInProgress)return;
  webdavSyncInProgress=true;
  try {
    if (!(await flushSettingsSave())) return;
    const status=$('webdavStatus');status.textContent='正在比较本地与云端…';
    const current={...settings,webdavUrl:valueFor('settingsWebdavUrl'),webdavUsername:valueFor('settingsWebdavUsername'),webdavPassword:$('settingsWebdavPassword').value,webdavRemotePath:valueFor('settingsWebdavPath')||'YueDen'};
    const choiceKey=webdavChoiceSessionKey(current,direction);let choiceSession=webdavSyncChoiceSessions.get(choiceKey);if(!choiceSession){choiceSession=WebdavSyncChoiceSession.create(choiceKey);webdavSyncChoiceSessions.set(choiceKey,choiceSession);}
    let result=await native.syncWebdav(current,direction);
    while(result?.needsDecision){
      const resolution=await chooseWebdavSyncResolution(direction,result.preview,choiceSession);
      if(!resolution){WebdavSyncChoiceSession.clear(choiceSession);webdavSyncChoiceSessions.delete(choiceKey);result={ok:true,cancelled:true,message:'已取消同步'};break;}
      status.textContent='正在复核云端版本…';
      result=await native.syncWebdav(current,direction,resolution,result.preview?.version??null);
    }
    if(result?.ok&&!result.cancelled){WebdavSyncChoiceSession.clear(choiceSession);webdavSyncChoiceSessions.delete(choiceKey);}
    status.textContent=(result?.partial?'部分同步：':'')+(result?.message||'同步完成');
    if(result?.ok&&!result.cancelled){state=await native.loadLibrary();settings=await native.loadSettings();await refreshSnapshotIndex(true);render();if(editorId)renderBackupList();await refreshUsage();}
    else if(!result?.cancelled){await refreshSnapshotIndex(true);renderLibrary();if(editorId)await renderBackupList();}
    if(!result?.ok)showToast(result?.message||'WebDAV 同步失败','error');else showToast(result.message||'同步完成');
  } finally {webdavSyncInProgress=false;}
}
async function testWebdav() { const status = $('webdavStatus'); status.textContent = '测试中…'; const result = await native.testWebdav({ ...settings, webdavUrl: valueFor('settingsWebdavUrl'), webdavUsername: valueFor('settingsWebdavUsername'), webdavPassword: $('settingsWebdavPassword').value, webdavRemotePath: valueFor('settingsWebdavPath') || 'YueDen' }); status.textContent = result?.message || ''; showToast(result?.message || '测试完成', result?.ok ? 'normal' : 'error'); }
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
  settings = { ...settings, disguiseEnabled: enabled };
  const toggle = $('settingsDisguiseEnabled'); if (toggle) toggle.checked = enabled;
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
}

async function deleteResourceRecords(ids,{selectedBackups=[]}={}){
  const wanted=new Set(ids||[]),resources=state.items.filter(item=>wanted.has(item.id));if(!resources.length)return false;
  try{
    const backups=await native.listAllBackups();if(!Array.isArray(backups))throw Error('无法读取关联存档，未删除资源');snapshotIndex=backups;
    const explicitIds=new Set((selectedBackups||[]).map(entry=>entry.id)),explicit=backups.filter(entry=>explicitIds.has(entry.id)),associated=backups.filter(entry=>wanted.has(entry.itemId)),additional=associated.filter(entry=>!explicitIds.has(entry.id)),decision=await confirmResourceDeletion(resources,additional.length,{selectedBackupCount:explicit.length});if(!decision)return false;
    const removeSaves=new Map(explicit.map(entry=>[entry.id,entry]));if(decision.deleteSaves)for(const entry of additional)removeSaves.set(entry.id,entry);
    if(removeSaves.size){const removed=await native.deleteBackups([...removeSaves.values()].map(entry=>({itemId:entry.itemId,backupId:entry.id})),{syncCloud:decision.syncCloud});if(!removed?.ok)throw Error(removed?.message||'所选存档删除失败，资源条目已保留');}
    const deletedAt=new Date().toISOString(),existing=(state.deletedItems||[]).filter(row=>!wanted.has(row.id)),tombstones=resources.map(item=>({id:item.id,identityKey:item.identityKey||'',deletedAt}));
    state=await native.saveLibrary({...state,items:state.items.filter(item=>!wanted.has(item.id)),deletedItems:[...existing,...tombstones]});
    await refreshSnapshotIndex(true);showToast('已删除 '+resources.length+' 个资源条目');return true;
  }catch(error){showToast('删除失败：'+error.message,'error');return false;}
}
async function deleteSnapshotResourceSelection(){
  if(librarySelection.mutation||document.body.classList.contains('is-disguised'))return;
  const resourceIds=visibleSelectionIds(),selectedBackups=visibleSnapshotRows().filter(entry=>snapshotSelection.has(entry.id));
  if(!resourceIds.length)return deleteSelectedSnapshots();
  if(!selectedBackups.length)return deleteLibrarySelection(resourceIds);
  librarySelection.mutation=true;renderLibrarySelection();
  try{
    const removed=await deleteResourceRecords(resourceIds,{selectedBackups});
    if(removed){librarySelection.ids.clear();snapshotSelection.clear();render();}
  }finally{librarySelection.mutation=false;renderLibrarySelection();}
}
async function deleteEditor() { if (!editorId) return;const id=editorId;if(!(await deleteResourceRecords([id])))return;closeEditor();render(); }
async function addCategory() { const category = (await askPrompt('输入新分类名称：', '新分类') || '').trim(); if (!category) return; if (state.categories.includes(category)) { showToast('这个分类已经存在', 'error'); return; } state.categories.push(category); state = await native.saveLibrary(state); renderCategories(); showToast('分类已创建'); }
async function openSaveLocation(target) {
  if(!target)return;
  try { const result=await native.revealLocal(target);if(!result?.ok)throw Error(result?.message||'存档位置不可用'); }
  catch(error){showToast('打开存档位置失败：'+error.message,'error');}
}
function ensureSettingsColumns(){const layout=document.querySelector('.settings-layout');if(!layout||layout.querySelector('.settings-column'))return;const left=document.createElement('div'),right=document.createElement('div');left.className=right.className='settings-column';left.append($('settingsTheme').closest('.settings-card'),layout.querySelector('.webdav-card'));right.append($('settingsObsidian').closest('.settings-card'),layout.querySelector('.disguise-card'));layout.append(left,right);}
function ensureDeletePreference() { if ($('settingsConfirmDelete')) return; const card = $('settingsTheme')?.closest('.settings-card'); if (!card) return; const label = document.createElement('label'); label.className = 'check-label delete-preference'; label.innerHTML = '<input id="settingsConfirmDelete" type="checkbox" checked> 删除资源或存档前显示确认提醒'; const animation=$('settingsAnimations')?.closest('label');const row=document.createElement('div');row.className='settings-toggle-row';if(animation){animation.before(row);row.append(animation,label);}else card.appendChild(label); }
function installDisguiseSwitchHandler() {
  const toggle = $('settingsDisguiseEnabled'); if (!toggle || toggle.dataset.umBound) return;
  toggle.dataset.umBound = 'true';
  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    try { applyDisguise(await native.setDisguise(enabled)); }
    catch { toggle.checked = Boolean(settings.disguiseEnabled); }
    finally { toggle.disabled = false; }
  });
}
function filterSelectOptions(input) { const target = $(input.dataset.target); if (!target) return; const query = input.value.trim().toLowerCase(); Array.from(target.options).forEach((option) => { option.hidden = Boolean(query && option.value !== 'all' && !option.textContent.toLowerCase().includes(query)); }); }
function ensureFilterSearches() { const labels = { statusFilter: '搜索状态…', genreFilter: '搜索标签…', categoryFilter: '搜索分类…', yearFilter: '搜索年份…', ratingFilter: '搜索评分…' }; Object.entries(labels).forEach(([targetId, placeholder]) => { const target = $(targetId); if (!target || document.querySelector('[data-filter-search="' + targetId + '"]')) return; const input = document.createElement('input'); input.className = 'filter-search'; input.dataset.filterSearch = targetId; input.dataset.target = targetId; input.placeholder = placeholder; input.addEventListener('input', () => filterSelectOptions(input)); target.insertAdjacentElement('afterend', input); new MutationObserver(() => filterSelectOptions(input)).observe(target, { childList: true }); }); }
function clearDragShift() { all('.resource-card').forEach((card) => card.classList.remove('shift-left', 'shift-right')); }
function updateDragShift(target) { const dragged = document.querySelector('.resource-card.dragging'); if (!dragged || !target || dragged === target) return clearDragShift(); const cards = [...document.querySelectorAll('.resource-card')]; const from = cards.indexOf(dragged); const to = cards.indexOf(target); clearDragShift(); if (from < to) cards.slice(from + 1, to + 1).forEach((card) => card.classList.add('shift-left')); else cards.slice(to, from).forEach((card) => card.classList.add('shift-right')); }
function bindEvents() {
  $('saveFilter').addEventListener('change',()=>{snapshotSelection.clear();snapshotAnchor=null;renderLibrary();});
  all('[data-view]').forEach((button) => button.addEventListener('click', () => { activeView = button.dataset.view; render(); })); $('addBtn').addEventListener('click', () => openEditor()); $('emptyAdd').addEventListener('click', () => openEditor()); $('searchInput').addEventListener('input', () => { if ($('searchInput').value && activeView === 'dashboard') activeView = 'all'; render(); }); $('filterToggle').addEventListener('click', () => $('filters').classList.toggle('hidden')); ['statusFilter', 'genreFilter', 'categoryFilter', 'yearFilter', 'ratingFilter'].forEach((id) => $(id).addEventListener('change', renderLibrary)); $('clearFilters').addEventListener('click', clearFilters); all('.view-switch-btn').forEach((button) => button.addEventListener('click', () => { setLibraryLayout(button.dataset.layout); }));
  $('fieldType').addEventListener('change', () => { setStatusOptions($('fieldType').value); updateTypeFields($('fieldType').value); renderBackupList(); }); $('fieldStatus').addEventListener('change', updateCompletedDateState); $('fieldStoreUrl').addEventListener('input', updateLinkButtons); $('fieldNoteUrl').addEventListener('input', updateLinkButtons); $('editorForm').addEventListener('submit', saveEditor); $('metadataBtn').addEventListener('click', fetchMetadata); $('deleteBtn').addEventListener('click', deleteEditor); $('editorClose').addEventListener('click', closeEditor); $('editorCancel').addEventListener('click', cancelEditorChanges); $('candidateClose').addEventListener('click', dismissCandidateResults); $('editorBackdrop').addEventListener('contextmenu', (event) => { if (event.target === $('editorBackdrop')) {event.preventDefault();closeEditor();} }); $('candidateBackdrop').addEventListener('contextmenu', (event) => { if (event.target === $('candidateBackdrop')) {event.preventDefault();dismissCandidateResults();} });
  $('openStoreBtn').addEventListener('click', () => openResourceLink(valueFor('fieldStoreUrl'),editorId)); $('openNoteBtn').addEventListener('click', () => native.openExternal(valueFor('fieldNoteUrl'))); $('detectSavePathsBtn').addEventListener('click',detectEditorSavePaths);$('pickSavePathsBtn').addEventListener('click', selectSavePaths); $('backupSaveBtn').addEventListener('click', backupCurrentSaves); $('savePathRows').addEventListener('click',event=>{const open=event.target.closest('[data-open-save-path]');if(open){const index=Number(open.dataset.openSavePath);if(Number.isInteger(index)&&index>=0&&index<editorSavePaths.length)void openSaveLocation(editorSavePaths[index]);return;}const button=event.target.closest('[data-clear-save-path]');if(!button)return;const index=Number(button.dataset.clearSavePath);if(!Number.isInteger(index)||index<0||index>=editorSavePaths.length)return;editorSavePaths.splice(index,1);updateSavePathHint();updateLinkButtons();updateEditorSaveCue(true);});  $('annualYear').addEventListener('change', renderAnnualReview);
  $('settingsAnimations').addEventListener('change', applyAppearance); $('settingsTheme').addEventListener('change', applyAppearance); $('settingsAccent').addEventListener('input', applyAppearance); $('testWebdavBtn').addEventListener('click', testWebdav); $('syncWebdavBtn').addEventListener('click', () => syncWebdav('bidirectional')); $('disguiseExitTop').addEventListener('click', () => native.setDisguise(false));
$('clearNetworkCacheBtn').addEventListener('click',async()=>{
  if(networkCacheBusy)return;networkCacheBusy=true;++networkCacheQuery;const button=$('clearNetworkCacheBtn');button.disabled=true;button.textContent='清除中…';
  try{const result=await native.clearNetworkCache();if(result.after)displayNetworkCacheSize(result.after);else $('networkCacheSize').textContent='大小查询失败';showToast(result.errors.length?'缓存未全部清除：'+result.errors.join('；'):'联网缓存已清除',result.errors.length?'error':'normal');}
  catch(error){$('networkCacheSize').textContent='清除失败';showToast('清除缓存失败：'+error.message,'error');}
  finally{networkCacheBusy=false;button.disabled=false;button.textContent='清除缓存';}
});
$('openLogsBtn').addEventListener('click',async()=>{try{const result=await native.openMetadataDiagnosticLogs();if(!result?.ok)showToast(result?.message||'无法打开日志文件夹','error');}catch(error){showToast(error?.message||'无法打开日志文件夹','error');}});
$('exportBtn').addEventListener('click', async () => { if (!(await askConfirm('备份将包含资源资料和路径、设置以及远程音频库连接。WebDAV 和远程音频登录信息会以可恢复的明文写入所选 JSON 文件，请保存到可信位置。继续导出吗？', { title: '导出完整备份', confirmText: '继续导出' }))) return; if (!(await flushSettingsSave())) return; try { if (await native.exportData(state)) showToast('完整数据备份已导出'); } catch (error) { showToast('数据备份失败：' + error.message, 'error'); } }); $('importBtn').addEventListener('click', async () => { const imported = await native.importData(); if (!imported) return; const message = imported.includesSettings ? '将覆盖当前资源库、设置和远程音频库连接。备份中的登录凭据会重新加密保存在本机。继续导入吗？' : '将覆盖当前资源库；旧格式备份不会修改设置和远程音频连接。继续导入吗？'; if (!(await askConfirm(message, { title: '导入前确认', confirmText: '继续导入', danger: true }))) return; try { await native.restoreData(imported.token); state = await native.loadLibrary(); settings = await native.loadSettings(); render(); if (activeView === 'settings') loadSettingsForm(); showToast('数据已恢复'); } catch (error) { showToast('数据恢复失败：' + error.message, 'error'); } }); $('minimizeBtn').addEventListener('click', native.minimize);  $('closeBtn').addEventListener('click', async () => { if (await flushSettingsSave()) native.close(); });
}

ensureDragMotion();
native.onDisguiseState(applyDisguise);
async function init() { try { state = await native.loadLibrary(); settings = await native.loadSettings(); if(settings.credentialsUnavailable)showToast('此电脑无法解密原凭据，请在设置中重新输入；不会回退明文。','error'); if (!state || !Array.isArray(state.items)) state = { items: [], categories: [] }; if (!Array.isArray(state.categories)) state.categories = []; state.items = state.items.map(item => ({ ...item, status: StatusModel.normalize(item.status, item.type) })); activeView = settings.appearance?.defaultView || 'dashboard'; bindEvents(); installTagManagement(); installLibrarySelection(); installLibraryTools(); installCardQuickEdit(); installCardLayout(); installLocalImport(); installEditorInteractions(); installCoverControls(); installEditorFields(); installEditorPolish(); installPlatformPicker(); installWindowState(); installMetadataSession(); installSettingsAutosave(); installDisguiseSwitchHandler(); render(); applyDisguise({ enabled: settings.disguiseEnabled }); void refreshSnapshotIndex(true); } catch (error) { showToast(`读取本地数据失败：${error.message}`, 'error'); } }
init();
function loadSettingsForm() { ensureSettingsColumns();ensureDeletePreference(); const appearance = settings.appearance || {}; $('settingsObsidian').value = settings.obsidianRoot || ''; $('settingsSteamKey').value = settings.steamApiKey || ''; $('settingsSteamId').value = settings.steamId || ''; $('settingsGoogleBooksKey').value = settings.googleBooksApiKey || ''; $('settingsTheme').value = appearance.theme || 'ocean'; $('settingsAccent').value = appearance.accent || '#65d8b0'; $('settingsAnimations').checked = appearance.animations !== false; $('settingsDefaultView').value = appearance.defaultView || 'dashboard'; $('settingsWebdavUrl').value = settings.webdavUrl || ''; $('settingsWebdavUsername').value = settings.webdavUsername || ''; $('settingsWebdavPassword').value = settings.webdavPassword || ''; $('settingsWebdavPath').value = settings.webdavRemotePath || 'YueDen'; $('settingsDisguiseVideoUrl').value = settings.disguiseVideoUrl || ''; $('settingsDisguiseEnabled').checked = Boolean(settings.disguiseEnabled); $('settingsPositiveEnergy').checked = Boolean(settings.positiveEnergyEnabled); $('settingsConfirmDelete').checked = settings.confirmBeforeDelete !== false; applyAppearance(); }
