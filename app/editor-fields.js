/* File pickers and compact, horizontally scrollable single-line fields. */
let editorFileRequest = 0;
let editorMetadata = {};
function getEditorMetadata() { return { ...editorMetadata }; }
function syncOverflowFields() {
  document.querySelectorAll('.field-scrollbox').forEach(box => {
    const field = box.querySelector('.scrollable-field'), range = box.querySelector('.field-scrollbar');
    const overflow = Math.max(0, field.scrollWidth - field.clientWidth);
    range.max = String(overflow); range.value = String(field.scrollLeft);
    box.classList.toggle('has-overflow', overflow > 2 && field.clientWidth > 0);
    range.disabled = overflow <= 2;
  });
}
function installOverflowFields() {
  document.querySelectorAll('#editorForm input:not([type]), #editorForm input[type="text"], #editorForm input[type="url"]').forEach(field => {
    if (field.id === 'platformRatingValue') return;
    const box = document.createElement('div'); box.className = 'field-scrollbox'; field.before(box); box.appendChild(field); field.classList.add('scrollable-field');
    const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '0'; range.value = '0'; range.className = 'field-scrollbar'; range.tabIndex = -1; range.setAttribute('aria-label', '横向查看完整文本'); box.appendChild(range);
    range.addEventListener('input', event => { event.stopPropagation(); field.scrollLeft = Number(range.value); });
    range.addEventListener('change', event => event.stopPropagation());
    field.addEventListener('input', syncOverflowFields); field.addEventListener('scroll', () => { range.value = String(field.scrollLeft); });
    box.addEventListener('pointerenter', syncOverflowFields);
  });
  if (window.ResizeObserver) { const observer = new ResizeObserver(syncOverflowFields); document.querySelectorAll('.field-scrollbox').forEach(box => observer.observe(box)); }
}
async function selectEditorFile(kind) {
  const request = ++editorFileRequest, id = editorId, type = $('fieldType').value;
  const target = kind === 'note' ? $('fieldNoteUrl') : $('fieldLocalPath'), previous = target.value;
  const button = target;
  button.disabled = true;
  try {
    const result = await native.pickResourcePath(kind,previous);
    if (request !== editorFileRequest || id !== editorId || type !== $('fieldType').value || $('editorBackdrop').classList.contains('hidden') || target.value !== previous || result?.canceled) return;
    if (!result?.ok) throw Error(result?.message || '未能选择文件，请重试');
    target.value = result.value || '';
    target.dispatchEvent(new Event('input', { bubbles: true })); updateLinkButtons(); syncOverflowFields();
  } catch (error) { showToast('选择失败：' + error.message, 'error'); }
  finally { button.disabled = false; }
}
function installEditorFields() {
  installOverflowFields();
  installTextAreaResize();
  const resource = $('fieldLocalPath'); resource.setAttribute('aria-haspopup', 'menu'); resource.setAttribute('aria-expanded', 'false'); resource.title = '点击选择文件或文件夹，右键清除路径';
  resource.readOnly=false;resource.title='可编辑路径；右侧文件夹按钮选择，右键清除';resource.onclick=null;
  resource.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); openResourcePathMenu(true, event); };
  resource.onkeydown = event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openResourcePathMenu(true); }
    else if (event.altKey && event.key==='ArrowDown') { event.preventDefault(); openResourcePathMenu(false); }
  };
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#resourcePathMenu') && event.target !== resource) closeResourcePathMenu(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('resourcePathMenu')) { event.preventDefault(); event.stopImmediatePropagation(); closeResourcePathMenu(); resource.focus({ preventScroll: true }); } }, true);
  document.querySelector('.editor-modal').addEventListener('scroll', closeResourcePathMenu, { passive: true }); window.addEventListener('resize', closeResourcePathMenu);
  $('fieldNoteUrl').readOnly=false;$('fieldNoteUrl').onclick=null;
  for(const [id,action]of [['fieldLocalPath',()=>openResourcePathMenu(false)],['fieldNoteUrl',()=>selectEditorFile('note')]]){
   const button=document.createElement('button');button.type='button';button.className='path-picker-button';button.id=id==='fieldLocalPath'?'pickLocalPathBtn':'pickNotePathBtn';button.title=id==='fieldLocalPath'?'选择文件或文件夹':'选择笔记';button.setAttribute('aria-label',button.title);button.textContent='▱';$(id).closest('.field-scrollbox').after(button);button.onclick=action;
   $(id).addEventListener('input',()=>{++editorFileRequest;updateLinkButtons();syncOverflowFields();});
  }
  $('openLocalResourceBtn').onclick = () => openResourceLink(valueFor('fieldLocalPath'),editorId); $('openResourceUrlBtn').onclick = () => openResourceLink(valueFor('fieldResourceUrl'),editorId);
  $('fieldResourceUrl').addEventListener('input', updateLinkButtons);
  $('settingsObsidian').readOnly = true; $('settingsObsidian').placeholder = '点击选择笔记根目录';
  $('settingsObsidian').onclick = async () => { try { const result = await native.pickResourcePath('noteRoot'); if (result?.ok) { $('settingsObsidian').value = result.value; await queueSettingsSave({ obsidianRoot: result.value }); } else if (!result?.canceled) showToast(result?.message || '选择目录失败', 'error'); } catch (error) { showToast(error.message, 'error'); } };
}
function clearEditorPath(id) {
  ++editorFileRequest; $(id).value = ''; $(id).dispatchEvent(new Event('input', { bubbles: true })); updateLinkButtons(); syncOverflowFields();
}
function closeResourcePathMenu() { $('resourcePathMenu')?.remove(); $('fieldLocalPath')?.setAttribute('aria-expanded', 'false'); }
function openResourcePathMenu(clearOnly, event) {
  closeResourcePathMenu();
  if(!clearOnly)return selectEditorFile('resource');
  const field = $('fieldLocalPath'); if (field.disabled) return;
  const menu = document.createElement('div'); menu.id = 'resourcePathMenu'; menu.className = 'resource-path-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', clearOnly ? '本地资源操作' : '选择本地资源');
  const actions = clearOnly ? [['clear', '清除路径', () => clearEditorPath('fieldLocalPath')]] : [['file', '选择文件', () => selectEditorFile('file')], ['folder', '选择文件夹', () => selectEditorFile('folder')]];
  for (const [kind, text, action] of actions) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pathAction = kind; button.setAttribute('role', 'menuitem'); button.textContent = text; button.disabled = kind === 'clear' && !field.value;
    button.onclick = () => { closeResourcePathMenu(); action(); field.focus({ preventScroll: true }); }; menu.appendChild(button);
  }
  menu.onkeydown = event => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    if (event.key === 'Tab') closeResourcePathMenu();
  };
  document.body.appendChild(menu); const rect = field.getBoundingClientRect();
  const x = event?.clientX || rect.left, y = event?.clientY || rect.bottom + 4;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  field.setAttribute('aria-expanded', 'true'); menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
function renderMetadataCoverage(candidate = {}) {
  editorMetadata = { originalName:candidate.originalName||'',aliases:candidate.aliases||[],identifiers:candidate.identifiers||{},steamPlaytime:candidate.steamPlaytime??null,steamPlaytimeAt:candidate.steamPlaytimeAt||'',playtimeSource:candidate.playtimeSource||'',metadataSource: candidate.metadataSource || '', fieldSources: candidate.fieldSources || {}, editionKind: candidate.editionKind || '', ratingSource: candidate.ratingSource || RatingModel.source(candidate, $('fieldType').value), ratingValue: candidate.ratingValue ?? null, ratingMax: candidate.ratingMax ?? null, ratingEdited: Boolean(candidate.ratingEdited), platforms: PlatformModel.detect(candidate), platformsManual: Boolean(candidate.platformsManual), platformLinks: candidate.platformLinks || {} };
  const type = $('fieldType').value;
  const fields = type === 'book' || type === 'manga' ? { developer: '作者', publisher: '出版社', isbn: 'ISBN', pages: '页数', translator: '译者' } : type === 'anime' ? { developer: '制作 / 导演', cast: '声优', episodes: '集数' } : {};
  const missing = Object.keys(fields).filter(key => Array.isArray(candidate[key]) ? !candidate[key].length : !candidate[key]);
  const hint = $('metadataCoverage'); hint.classList.toggle('hidden', !candidate.metadataSource);
  hint.textContent = candidate.metadataSource ? candidate.metadataSource + (candidate.editionKind === '系列' ? ' · 系列无统一 ISBN 和页数，可选择单行本候选获取版本信息。' : missing.length ? ' · 未确认：' + missing.map(key => fields[key]).join('、') : ' · 已取得可用信息') : '';
}

function installTextAreaResize() {
  for(const id of ['fieldReview','fieldDescription']) {
    const field=$(id),wrap=document.createElement('div');wrap.className='textarea-resize-wrap';field.before(wrap);wrap.appendChild(field);
    const handle=document.createElement('div');handle.className='textarea-resize-edge';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-label','上下拖动调整'+(id==='fieldReview'?'个人评价':'简介')+'高度');wrap.appendChild(handle);
    let pointer=null,startY=0,startHeight=0;
    const size=value=>{const height=Math.max(82,Math.min(1200,value));field.style.height=height+'px';handle.setAttribute('aria-valuenow',String(Math.round(height)));updateEditorSaveCue(false);};
    handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();pointer=event.pointerId;startY=event.clientY;startHeight=field.getBoundingClientRect().height;try{handle.setPointerCapture(pointer);}catch{}wrap.classList.add('resizing');});
    document.addEventListener('pointermove',event=>{if(pointer!==null&&pointer===event.pointerId){event.preventDefault();size(startHeight+event.clientY-startY);}},{capture:true});
    const stop=()=>{pointer=null;wrap.classList.remove('resizing');};
    document.addEventListener('pointerup',stop,true);document.addEventListener('pointercancel',stop,true);window.addEventListener('blur',stop);handle.addEventListener('lostpointercapture',stop);
    handle.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();size(event.key==='Home'?82:field.getBoundingClientRect().height+(event.key==='ArrowDown'?20:-20));});
    handle.addEventListener('dblclick',()=>{field.style.height='';updateEditorSaveCue(false);});
  }
}

function renderTagStatusFilters() {
  let section = $('tagStatusFilters');
  if (!section) { section = document.createElement('section'); section.id = 'tagStatusFilters'; section.className = 'tag-status-section'; $('categoryGrid').before(section); }
  const previous = document.activeElement?.dataset.statusValue;
  const selection = resourceFilters.selected('statusFilter')[0];
  if (selection && !selection.startsWith('phase:')) { resourceFilters.values.statusFilter.clear(); resourceFilters.values.statusFilter.add('phase:' + StatusModel.stage(selection)); }
  const candidates = state.items.filter(item => resourceFilters.matches(item, ['statusFilter']));
  section.innerHTML = '<div class="status-section-heading"><strong>条目状态</strong></div><div class="tag-status-options" role="radiogroup" aria-label="条目状态"></div>';
  const host = section.querySelector('.tag-status-options');
  for (const [phase, label] of [['all', '全部状态'], ...Object.entries(StatusModel.stages)]) {
    const value = phase === 'all' ? 'all' : 'phase:' + phase;
    const selected = value === 'all' ? !resourceFilters.selected('statusFilter').length : resourceFilters.selected('statusFilter').includes(value);
    const count = phase === 'all' ? candidates.length : candidates.filter(item => item.type!=='audio'&&StatusModel.stage(item.status) === phase).length;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.statusValue = value; button.dataset.statusPhase = phase;
    button.className = 'status-filter-button' + (selected ? ' selected' : '');
    button.setAttribute('role','radio'); button.setAttribute('aria-checked',String(selected)); button.setAttribute('aria-pressed',String(selected));
    button.textContent = label + ' · ' + count; button.disabled = phase !== 'all' && !count && !selected;
    button.onclick = () => { if (value === 'all') resourceFilters.values.statusFilter.clear(); else resourceFilters.toggle('statusFilter',value); renderCategories(); };
    host.appendChild(button);
  }
  host.onkeydown = event => {
    if (!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)) return;
    const buttons = [...host.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement); if (index < 0) return;
    event.preventDefault(); const next = buttons[(index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : buttons.length - 1)) % buttons.length]; next.click();
    [...section.querySelectorAll('[data-status-value]')].find(button => button.dataset.statusValue === next.dataset.statusValue)?.focus({ preventScroll: true });
  };
  if (previous) [...host.children].find(button => button.dataset.statusValue === previous)?.focus({ preventScroll: true });
}
