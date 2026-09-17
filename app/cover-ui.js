const COVER_KEYS = ['cover', 'coverPortrait', 'coverLandscape'];
let editorCovers = {}, coverDraft = null, coverDialogVersion = 0;
let coverDirection = 'landscape';
const isNetworkCover = value => /^https?:\/\//i.test(value || '');
const isLocalCover = value => /^(um-cover:|data:image\/)/i.test(value || '');
function currentLibraryLayout() {
  const saved = settings.appearance?.libraryLayouts?.[activeView];
  return ['small', 'cards', 'portrait', 'list'].includes(saved) ? saved : ['book', 'manga'].includes(activeView) ? 'portrait' : 'cards';
}
function setLibraryLayout(value) {
  if (!['small', 'cards', 'portrait', 'list'].includes(value)) return;
  queueSettingsSave({ appearance: { libraryLayouts: { ...settings.appearance?.libraryLayouts, [activeView]: value } } }); renderLibrary();
}
function coverFor(item, orientation = 'landscape') {
  return orientation === 'portrait' ? (item.coverPortrait || item.cover || item.coverLandscape || '') : (item.coverLandscape || item.cover || item.coverPortrait || '');
}
function fillCoverFields(item) {
  editorCovers = { ...Object.fromEntries(COVER_KEYS.map(key => [key, item[key] || ''])), customCovers: [...(item.customCovers || [])], networkCovers: { ...item.networkCovers } };
  for (const key of COVER_KEYS) if (isNetworkCover(item[key])) editorCovers.networkCovers[key] = item[key];
  closeCoverDialog();
}
function getEditorCovers() { return structuredClone(editorCovers); }
function applyCoverCandidate(candidate) {
  for (const key of COVER_KEYS) {
    const value = candidate[key] || candidate.cover || candidate.coverPortrait || candidate.coverLandscape || '';
    if (!value) continue;
    const sourceUrl = candidate.networkCovers?.[key] || (isNetworkCover(value) ? value : '');
    if (sourceUrl) editorCovers.networkCovers[key] = sourceUrl;
    if (!editorCovers.customCovers.includes(key)) editorCovers[key] = value;
  }
  updateCoverPreview(coverFor(editorCovers, ['book', 'manga'].includes($('fieldType').value) ? 'portrait' : 'landscape'));
}
function selectedCoverKey() { return coverDirection === 'portrait' ? 'coverPortrait' : 'coverLandscape'; }
function coverTargetKeys() { return $('coverShared').checked ? COVER_KEYS : [selectedCoverKey()]; }
function setDraftCover(value, networkUrl = '', custom = true) {
  for (const key of coverTargetKeys()) {
    coverDraft[key] = value; if (networkUrl) coverDraft.networkCovers[key] = networkUrl;
    coverDraft.customCovers = coverDraft.customCovers.filter(entry => entry !== key);
    if (custom && value) coverDraft.customCovers.push(key);
  }
}
function closeCoverDialog() { ++coverDialogVersion; coverDraft = null; $('coverBackdrop')?.classList.add('hidden'); }
function invalidateCoverRefresh() { ++coverDialogVersion; $('coverRefreshResults')?.replaceChildren(); }
function renderCoverDialog() {
  if (!coverDraft) return;
  const keys = coverTargetKeys(), key = selectedCoverKey();
  const selectedValue = coverFor(coverDraft, coverDirection);
  $('coverUrl').value = coverDraft.networkCovers[key] || (isNetworkCover(selectedValue) ? selectedValue : coverDraft.networkCovers.cover || '');
  $('coverUrl').dataset.changed = 'false';
  document.querySelectorAll('[data-cover-direction]').forEach(button => { const selected = button.dataset.coverDirection === coverDirection; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  const local = keys.some(key => isLocalCover(coverDraft[key]));
  $('cancelLocalCover').disabled = !local;
  $('coverSourceStatus').textContent = local ? '正在使用本地图片。网络链接会保留，可随时切回。' : '使用网络图片；缺少一个方向时共用另一张封面。';
  for (const [id, direction] of [['portraitCoverSample', 'portrait'], ['landscapeCoverSample', 'landscape']]) {
    const host = $(id); host.replaceChildren(); const src = coverFor(coverDraft, direction);
    if (src) { const image = document.createElement('img'); image.src = src; image.dataset.coverDirection = direction; image.alt = direction === 'portrait' ? '竖向封面预览' : '横向封面预览'; host.appendChild(image); repairCardCover(image, coverDraft, 0); }
    else { const empty = document.createElement('span'); empty.textContent = '暂无封面'; host.appendChild(empty); }
  }
}
function openCoverDialog() {
  coverDraft = getEditorCovers(); ++coverDialogVersion; coverDirection = ['book', 'manga'].includes($('fieldType').value) ? 'portrait' : 'landscape'; $('coverShared').checked = false;
  $('coverRefreshResults').replaceChildren();
  renderCoverDialog(); $('coverBackdrop').classList.remove('hidden'); $('coverDialogClose').focus(); updateEditorSaveCue(false);
}
function installCoverControls() {
  const preview = $('coverPreview'); preview.tabIndex = 0; preview.setAttribute('role', 'button'); preview.setAttribute('aria-label', '资源封面'); preview.removeAttribute('title');
  $('editCoverBtn').addEventListener('click', openCoverDialog);
  preview.addEventListener('click', openCoverDialog);
  preview.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openCoverDialog(); } });
  const backdrop = document.createElement('div'); backdrop.id = 'coverBackdrop'; backdrop.className = 'modal-backdrop hidden';
  backdrop.innerHTML = '<section class="cover-dialog" role="dialog" aria-modal="true" aria-labelledby="coverDialogTitle"><div class="modal-header"><h2 id="coverDialogTitle">调整封面</h2><button type="button" class="modal-close" id="coverDialogClose" aria-label="关闭封面设置">×</button></div><div class="cover-dialog-body"><div class="cover-samples"><button type="button" class="cover-direction" data-cover-direction="portrait" aria-pressed="false"><span id="portraitCoverSample" class="cover-sample book-sample"></span><span>竖向封面</span></button><button type="button" class="cover-direction" data-cover-direction="landscape" aria-pressed="false"><span id="landscapeCoverSample" class="cover-sample film-sample"></span><span>横向封面</span></button></div><label class="check-label cover-shared-label"><input id="coverShared" type="checkbox">横竖共用当前选中的封面</label><label class="field">网络图片 URL<input id="coverUrl" type="url" placeholder="https://…" maxlength="4096"></label><div class="cover-source-actions"><button type="button" class="secondary-button" id="useNetworkCover">使用网络图片</button><button type="button" class="secondary-button" id="pickCoverBtn">选择本地图片</button><button type="button" class="text-button" id="cancelLocalCover">取消本地图片</button><button type="button" class="secondary-button" id="refreshCoverBtn">↻ 重新获取图片</button></div><div id="coverRefreshResults" class="cover-refresh-results"></div><p id="coverSourceStatus" class="cover-source-status"></p></div><div class="modal-footer"><button type="button" class="secondary-button" id="coverDialogCancel">取消</button><button type="button" class="add-button" id="coverDialogApply">应用</button></div></section>';
  document.body.appendChild(backdrop);
  document.querySelectorAll('[data-cover-direction]').forEach(button => button.addEventListener('click', () => {
    if ($('coverUrl').dataset.changed === 'true') { $('useNetworkCover').click(); if ($('coverUrl').dataset.changed === 'true') return; }
    coverDirection = button.dataset.coverDirection; ++coverDialogVersion; $('coverRefreshResults').replaceChildren(); renderCoverDialog();
  }));
  $('coverShared').addEventListener('change', () => {
    ++coverDialogVersion;
    if ($('coverUrl').dataset.changed === 'true') { $('useNetworkCover').click(); if ($('coverUrl').dataset.changed === 'true') { $('coverShared').checked = false; return; } }
    if ($('coverShared').checked) {
      const key = selectedCoverKey(), src = coverFor(coverDraft, coverDirection);
      setDraftCover(src, coverDraft.networkCovers[key] || (isNetworkCover(src) ? src : ''), coverDraft.customCovers.includes(key) || isLocalCover(src));
    }
    renderCoverDialog();
  });
  $('coverUrl').addEventListener('input', () => { invalidateCoverRefresh(); $('coverUrl').dataset.changed = 'true'; });
  const close = () => { closeCoverDialog(); preview.focus(); updateEditorSaveCue(false); };
  $('coverDialogClose').onclick = close; $('coverDialogCancel').onclick = close;
  backdrop.addEventListener('contextmenu', event => { if (event.target === backdrop) { event.preventDefault(); close(); } });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') { const focusable = [...backdrop.querySelectorAll('button, input, select')].filter(node => !node.disabled); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  $('pickCoverBtn').onclick = async () => {
    invalidateCoverRefresh(); const version = coverDialogVersion, keys = coverTargetKeys(); $('pickCoverBtn').disabled = true;
    try {
      const result = await native.pickCoverImage();
      if (!coverDraft || version !== coverDialogVersion || !result || result.canceled) return;
      if (!result.ok || !result.reference) throw Error(result.message || '图片无法读取');
      for (const key of keys) { if (isNetworkCover(coverDraft[key])) coverDraft.networkCovers[key] = coverDraft[key]; coverDraft[key] = result.reference; if (!coverDraft.customCovers.includes(key)) coverDraft.customCovers.push(key); }
      renderCoverDialog();
    } catch (error) { showToast(error.message, 'error'); }
    finally { $('pickCoverBtn').disabled = false; }
  };
  $('useNetworkCover').onclick = () => {
    const url = $('coverUrl').value.trim();
    if (url && !isNetworkCover(url)) { showToast('请输入 http 或 https 图片链接', 'error'); return; }
    invalidateCoverRefresh();
    for (const key of coverTargetKeys()) { coverDraft[key] = url; coverDraft.networkCovers[key] = url; if (url && !coverDraft.customCovers.includes(key)) coverDraft.customCovers.push(key); if (!url) coverDraft.customCovers = coverDraft.customCovers.filter(entry => entry !== key); }
    renderCoverDialog();
  };
  $('cancelLocalCover').onclick = () => {
    invalidateCoverRefresh();
    for (const key of coverTargetKeys()) if (isLocalCover(coverDraft[key])) { coverDraft[key] = coverDraft.networkCovers[key] || ''; coverDraft.customCovers = coverDraft.customCovers.filter(entry => entry !== key); }
    renderCoverDialog();
  };
  $('coverDialogApply').onclick = () => {
    if ($('coverUrl').dataset.changed === 'true') { $('useNetworkCover').click(); if ($('coverUrl').dataset.changed === 'true') return; }
    editorCovers = structuredClone(coverDraft); closeCoverDialog();
    updateCoverPreview(coverFor(editorCovers, ['book', 'manga'].includes($('fieldType').value) ? 'portrait' : 'landscape')); preview.focus();
    updateEditorSaveCue(true);
  };
  $('refreshCoverBtn').onclick = refreshCoverImages;
}

async function refreshCoverImages() {
  const name = valueFor('fieldName'), type = $('fieldType').value;
  if (!name) { showToast('请先填写资源名称', 'error'); return; }
  const version = coverDialogVersion, keys = coverTargetKeys(), direction = coverDirection;
  const button = $('refreshCoverBtn'); button.disabled = true; button.textContent = '正在获取…'; $('coverRefreshResults').replaceChildren();
  const apply = candidate => {
    if (!coverDraft || version !== coverDialogVersion) return;
    const value = coverFor(candidate, direction), sourceKey = direction === 'portrait' ? 'coverPortrait' : 'coverLandscape';
    const url = candidate.networkCovers?.[sourceKey] || (isNetworkCover(value) ? value : '');
    for (const key of keys) { coverDraft[key] = value; if (url) coverDraft.networkCovers[key] = url; coverDraft.customCovers = coverDraft.customCovers.filter(entry => entry !== key); }
    $('coverRefreshResults').replaceChildren(); renderCoverDialog(); showToast('已更新所选封面，点击应用后保存条目');
  };
  try {
    const candidates = await native.refreshCoverMetadata(type, name, type === 'game' ? valueFor('fieldSteamAppId') : '');
    if (!coverDraft || version !== coverDialogVersion) return;
    const results = (candidates || []).filter(candidate => candidate.hasOnlineCover !== false && coverFor(candidate, direction) && !/离线/.test(candidate.metadataSource || '') && !String(candidate.id || '').startsWith('offline'));
    if (!results.length) { showToast('未获取到在线封面，现有图片已保留', 'error'); return; }
    const refreshedUrls=new Set(results.flatMap(candidate=>coverUrls(candidate)));
    for(const key of libraryCoverMemory.keys())if(JSON.parse(key).some(url=>refreshedUrls.has(url)))libraryCoverMemory.delete(key);
    const exact = results.find(candidate => String(candidate.name || '').toLowerCase() === name.toLowerCase());
    if (exact || results.length === 1) { apply(exact || results[0]); return; }
    for (const candidate of results) {
      const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'cover-refresh-choice';
      const image = document.createElement('img'); image.src = coverFor(candidate, direction); image.alt = ''; image.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = candidate.name; choice.append(image, label); choice.onclick = () => apply(candidate); $('coverRefreshResults').appendChild(choice);
    }
  } catch { showToast('获取图片失败，现有图片已保留', 'error'); }
  finally { button.disabled = false; button.textContent = '↻ 重新获取图片'; }
}
function repairCardCover(image, item, index) { attachStableCover(image,item,index); }
