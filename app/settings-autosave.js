/* Save individual setting edits, preserving unrelated settings and write order. */
let settingsRevision = 0, settingsSavedRevision = 0, settingsWrite = null;
let settingsToastDelay = null, settingsToastTimer = null, settingsToastExitTimer = null;
function hideSettingsToast() {
  clearTimeout(settingsToastDelay); clearTimeout(settingsToastTimer); clearTimeout(settingsToastExitTimer);
  $('settingsToast')?.classList.remove('visible','leaving');
}
function showSettingsSavedToast() {
  clearTimeout(settingsToastDelay);
  settingsToastDelay = setTimeout(() => {
    if (settingsSavedRevision !== settingsRevision || activeView !== 'settings' || !$('editorBackdrop').classList.contains('hidden')) return;
    let toast = $('settingsToast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'settingsToast'; toast.setAttribute('role','status'); toast.setAttribute('aria-live','polite'); toast.innerHTML = '<span>✓ 已保存</span><i class="save-toast-progress" aria-hidden="true"></i>'; document.body.appendChild(toast); }
    clearTimeout(settingsToastTimer); clearTimeout(settingsToastExitTimer);
    toast.classList.remove('leaving'); toast.classList.add('visible');
    const bar = toast.querySelector('.save-toast-progress'); bar.getAnimations?.().forEach(animation=>animation.cancel());
    if (bar.animate) bar.animate([{transform:'scaleX(1)'},{transform:'scaleX(0)'}],{duration:1800,easing:'linear',fill:'forwards'});
    settingsToastTimer = setTimeout(() => { toast.classList.add('leaving'); settingsToastExitTimer = setTimeout(() => { toast.classList.remove('visible','leaving'); }, 180); }, 1800);
  }, 400);
}
function settingsSaveHint(message, failed = false) {
  const hint = $('settingsSaved'); if (!hint) return;
  hint.textContent = failed ? message : ''; hint.classList.toggle('hidden', !failed); hint.classList.toggle('save-failed', failed);
  hint.setAttribute('role', failed ? 'button' : 'status'); hint.tabIndex = failed ? 0 : -1;
  hint.setAttribute('aria-label', failed ? message + '，点击重试' : message);
}
function flushSettingsSave() {
  if (settingsWrite) return settingsWrite;
  if (settingsSavedRevision === settingsRevision) return Promise.resolve(true);
  settingsWrite = (async () => {
    // Start on the next microtask so settingsWrite is assigned even if IPC throws.
    await Promise.resolve();
    try {
      while (settingsSavedRevision < settingsRevision) {
        const revision = settingsRevision, snapshot = structuredClone(settings);
        settingsSaveHint('正在自动保存…');
        const result = await native.saveSettings(snapshot);
        if (result?.ok === false) throw Error('保存失败');
        settingsSavedRevision = revision;
      }
      settingsSaveHint(''); showSettingsSavedToast(); return true;
    } catch {
      // Keep the edited values and the pending revision for a safe retry.
      settingsSaveHint('保存失败 · 点击重试', true);
      clearTimeout(settingsToastDelay); $('settingsToast')?.classList.remove('visible');
      showToast('设置未能写入本机，请在设置页点击重试。', 'error'); return false;
    } finally { settingsWrite = null; }
  })();
  return settingsWrite;
}
function queueSettingsSave(patch) {
  const next = { ...settings, ...patch };
  if (patch.appearance) next.appearance = { ...settings.appearance, ...patch.appearance };
  if (JSON.stringify(next) !== JSON.stringify(settings)) { settings = next; ++settingsRevision; }
  return flushSettingsSave();
}
function installSettingsAutosave() {
  const textFields = { settingsObsidian: 'obsidianRoot', settingsSteamKey: 'steamApiKey', settingsSteamId: 'steamId', settingsGoogleBooksKey: 'googleBooksApiKey', settingsWebdavUrl: 'webdavUrl', settingsWebdavUsername: 'webdavUsername', settingsWebdavPassword: 'webdavPassword', settingsWebdavPath: 'webdavRemotePath', settingsDisguiseVideoUrl: 'disguiseVideoUrl', settingsDisguiseProfile: 'disguiseProfile' };
  const appearanceFields = { settingsTheme: 'theme', settingsAccent: 'accent', settingsDefaultView: 'defaultView', settingsAnimations: 'animations' };
  const checkFields = { settingsConfirmDelete: 'confirmBeforeDelete', settingsAutoRefresh: 'autoRefreshMetadata' };
  const changed = event => {
    const field = event.target, id = field.id; let patch;
    if (textFields[id]) patch = { [textFields[id]]: field.type === 'password' ? field.value : field.value.trim() };
    else if (appearanceFields[id]) patch = { appearance: { [appearanceFields[id]]: field.type === 'checkbox' ? field.checked : field.value } };
    else if (checkFields[id]) patch = { [checkFields[id]]: field.checked };
    if (patch) { queueSettingsSave(patch); if (patch.appearance) applyAppearance(); }
  };
  $('settingsView').addEventListener('input', changed); $('settingsView').addEventListener('change', changed);
  const retry = () => { if ($('settingsSaved').classList.contains('save-failed')) flushSettingsSave(); };
  $('settingsSaved').onclick = retry;
  $('settingsSaved').onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); retry(); } };
  // Alt+F4 / system close must also let pending local writes finish.
  window.addEventListener('beforeunload', event => {
    if (settingsRevision === settingsSavedRevision) return;
    event.preventDefault(); event.returnValue = false;
    flushSettingsSave().then(ok => { if (ok) native.close(); });
  });
}
