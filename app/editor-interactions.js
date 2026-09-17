/* A native half-step slider and a single, movable save-action group. */
let editorBaseline = null, editorCueFrame = 0, editorCueAnimation = null, editorCueShown = false, editorLastInputAt = 0, editorLastField = '', editorLastSnapshot = '';
const EDITOR_CUE_IDLE_MS = 4000;
function editorSnapshot() {
  const values = [...$('editorForm').querySelectorAll('input, select, textarea')].filter(node => node.id && node.id !== 'ratingSlider').map(node => [node.id, node.type === 'checkbox' ? node.checked : node.value]);
  return JSON.stringify([values, currentRating, editorRatingKnown, getEditorCovers(), getEditorMetadata(), editorSavePaths, $('fieldType').value==='audio'?window.audioEditor?.value():null]);
}
function cueMotion(node) {
  if (!node?.animate || settings.appearance?.animations === false || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const current = getComputedStyle(node).transform;
  editorCueAnimation?.cancel();
  editorCueAnimation = node.animate([
    { transform: current === 'none' ? 'translateY(0) scale(1)' : current, opacity: 1 },
    { transform: 'translateY(-4px) scale(1.035)', opacity: 1, offset: .66 },
    { transform: 'translateY(1px) scale(.99)', offset: .85 },
    { transform: 'translateY(0) scale(1)', opacity: 1 }
  ], { duration: 500, easing: 'cubic-bezier(.2,.75,.25,1)' });
}
function fullyVisibleActionSlot(slot, modal) {
  const rect = slot.getBoundingClientRect(), clip = modal.getBoundingClientRect();
  const left = Math.max(0, clip.left + modal.clientLeft), top = Math.max(0, clip.top + modal.clientTop);
  const right = Math.min(window.innerWidth, clip.left + modal.clientLeft + modal.clientWidth), bottom = Math.min(window.innerHeight, clip.top + modal.clientTop + modal.clientHeight);
  // Every border pixel must be inside the scrollport, with a 1px safety margin.
  return rect.width > 0 && rect.height > 0 && rect.left >= left + 1 && rect.top >= top + 1 && rect.right <= right - 1 && rect.bottom <= bottom - 1;
}
function updateEditorSaveCue(animate = false, field = '') {
  const actions = $('editorSaveActions'), slot = $('editorActionSlot'), portal = $('editorActionPortal'), modal = document.querySelector('.editor-modal');
  if (!actions || !slot || !portal) return;
  const open = !$('editorBackdrop').classList.contains('hidden');
  const snapshot = editorSnapshot(), dirty = open && editorBaseline !== null && snapshot !== editorBaseline;
  if (actions.parentElement === slot) {
    if (actions.offsetWidth && actions.offsetHeight) { slot.style.width = actions.offsetWidth + 'px'; slot.style.height = actions.offsetHeight + 'px'; }
  }
  const floated = dirty && !fullyVisibleActionSlot(slot, modal);
  const moved = actions.parentElement !== (floated ? portal : slot);
  if (moved) {
    const focused = actions.contains(document.activeElement) ? document.activeElement : null;
    (floated ? portal : slot).appendChild(actions);
    focused?.focus({ preventScroll: true });
  }
  portal.classList.toggle('hidden', !floated || !$('coverBackdrop')?.classList.contains('hidden'));
  actions.classList.toggle('has-unsaved-changes', dirty);
  actions.dataset.dirty = String(dirty);
  if (floated) {
    const bounds = modal.getBoundingClientRect();
    portal.style.right = Math.max(18, window.innerWidth - bounds.right + 22) + 'px';
    portal.style.bottom = Math.max(18, window.innerHeight - bounds.bottom + 16) + 'px';
  }
  // Input + change can report the same value. Only actual edits start a new burst.
  const changed = animate && snapshot !== editorLastSnapshot;
  const key = /^(platformRatingValue|fieldExternalRating|platformRatingGauge)$/.test(field) ? 'platformRating' : field || 'metadata';
  const now = Date.now(), resumed = changed && now - editorLastInputAt >= EDITOR_CUE_IDLE_MS;
  const differentField = changed && key !== editorLastField;
  if (!dirty) { editorCueShown = false; editorLastInputAt = 0; editorLastField = ''; editorCueAnimation?.cancel(); }
  else if ((!editorCueShown && (animate || moved)) || resumed || differentField) { editorCueShown = true; cueMotion(actions); }
  if (changed && dirty) { editorLastInputAt = now; editorLastField = key; }
  editorLastSnapshot = snapshot;
}
function beginEditorSaveCue() {
  endEditorSaveCue();
  editorBaseline = editorSnapshot();
  editorLastSnapshot = editorBaseline;
  requestAnimationFrame(() => updateEditorSaveCue(false));
}
function endEditorSaveCue() {
  editorBaseline = null; editorCueShown = false; editorLastInputAt = 0; editorLastField = ''; editorLastSnapshot = ''; editorCueAnimation?.cancel();
  const actions = $('editorSaveActions'), slot = $('editorActionSlot');
  if (actions && slot && actions.parentElement !== slot) slot.appendChild(actions);
  actions?.classList.remove('has-unsaved-changes');
  $('editorActionPortal')?.classList.add('hidden');
}
function setStarSlider(value, notify = false) {
  editorRatingKnown = notify || value!=null;
  currentRating = Math.max(0, Math.min(5, Math.round(Number(value || 0) * 2) / 2));
  const slider = $('ratingSlider');
  if (slider) { slider.value = String(currentRating); slider.setAttribute('aria-valuetext', editorRatingKnown ? currentRating.toFixed(1) + ' 星' : '未评分'); }
  slider?.style.setProperty('--rating-progress', currentRating / 5 * 100 + '%');
  [...$('ratingStarPaint').children].forEach((star, index) => star.style.setProperty('--star-fill', Math.max(0, Math.min(1, currentRating - index)) * 100 + '%'));
  $('ratingText').textContent = currentRating ? currentRating.toFixed(1) + ' 星' : '未评分';
  if (notify) updateEditorSaveCue(true, 'ratingSlider');
}
function installEditorInteractions() {
  const completedDate=$('fieldCompletedDate');
  const openDate=()=>{if(completedDate.disabled)return;try{completedDate.showPicker?.();}catch{completedDate.focus();}};
  completedDate.addEventListener('click',openDate);
  completedDate.addEventListener('keydown',event=>{if(event.key===' '||event.altKey&&event.key==='ArrowDown'){event.preventDefault();openDate();}});
  $('ratingStars').innerHTML = '<div id="ratingStarPaint" aria-hidden="true">' + '<span class="rating-shape">★</span>'.repeat(5) + '</div><input id="ratingSlider" type="range" min="0" max="5" step="0.5" value="0" aria-label="个人评分，在星星上拖动调整半星" aria-valuetext="未评分">';
  $('ratingSlider').addEventListener('input', event => setStarSlider(event.target.value, true));
  const slider = $('ratingSlider'); let ratingPointer = null;
  const dragRating = event => {
    const rect = slider.getBoundingClientRect(), fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
    // Each star's left/right half selects a half/full star; dragging stays snapped.
    const rating = Math.ceil(Math.max(0, Math.min(1, fraction)) * 10) / 2;
    setStarSlider(rating, true);
  };
  slider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); slider.focus({ preventScroll: true }); ratingPointer = event.pointerId;
    try { slider.setPointerCapture(event.pointerId); } catch {}
    dragRating(event);
  });
  window.addEventListener('pointermove', event => { if (ratingPointer !== null && event.pointerId === ratingPointer) { event.preventDefault(); dragRating(event); } });
  window.addEventListener('pointerup', event => {
    if (event.pointerId !== ratingPointer) return;
    dragRating(event); ratingPointer = null;
    try { slider.releasePointerCapture(event.pointerId); } catch {}
  });
  window.addEventListener('pointercancel', () => { ratingPointer = null; });
  const form = $('editorForm'), actions = form.querySelector('.footer-right'); actions.id = 'editorSaveActions';
  const submit = actions.querySelector('[type="submit"]'); submit.id = 'editorSaveBtn'; submit.setAttribute('form', 'editorForm');
  const slot = document.createElement('div'); slot.id = 'editorActionSlot'; actions.before(slot); slot.appendChild(actions);
  const portal = document.createElement('div'); portal.id = 'editorActionPortal'; portal.className = 'hidden'; document.body.appendChild(portal);
  const schedule = () => { if (!editorCueFrame) editorCueFrame = requestAnimationFrame(() => { editorCueFrame = 0; updateEditorSaveCue(false); }); };
  form.addEventListener('input', event => updateEditorSaveCue(true, event.target.id)); form.addEventListener('change', event => updateEditorSaveCue(true, event.target.id));
  document.querySelector('.editor-modal').addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
  if (window.ResizeObserver) { const observer = new ResizeObserver(schedule); observer.observe(document.querySelector('.editor-modal')); observer.observe(slot); }
}
