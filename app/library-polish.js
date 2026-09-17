/* List rows are a separate layout: no cover overlays or genre clutter. */
function smallCardHtml(item) {
  const image=stableCoverFor(item,['book','manga'].includes(item.type)?'portrait':'landscape');
  return '<article class="resource-card small-card" draggable="true" data-id="'+esc(item.id)+'" data-media-type="'+esc(item.type)+'" data-achievement="'+(item.type==='game'&&item.status==='全成就')+'">'+
    '<div class="card-cover">'+(image?'<img loading="lazy" decoding="async" src="'+esc(image)+'" alt="'+esc(item.name)+'">':'<span class="list-cover-empty" aria-label="暂无封面">◇</span>')+'</div>'+
    '<div class="card-body"><div class="card-title" title="'+esc(item.name)+'">'+esc(item.name)+'</div><div class="small-card-status">'+cardStatusMarkup(item)+'</div></div></article>';
}

function listCardHtml(item) { return buildListCard(item); }

function renderPlatformPicker() {
  const host=$('gamePlatforms');if(!host)return;
  const selected=PlatformModel.detect({...editorMetadata,storeUrl:valueFor('fieldStoreUrl'),steamAppId:valueFor('fieldSteamAppId')});
  host.querySelectorAll('[data-platform-option]').forEach(button=>button.setAttribute('aria-pressed',String(selected.includes(button.dataset.platformOption))));
  $('platformSelectionHint').textContent=selected.length?(editorMetadata.platformsManual?'已手动确认':'已联网识别 / 按链接识别'):'未指定 · 可多选';
}
function installPlatformPicker() {
  const host=$('gamePlatformOptions');
  for(const [key,label]of Object.entries(PlatformModel.labels)) {
    const button=document.createElement('button');button.type='button';button.dataset.platformOption=key;button.setAttribute('aria-pressed','false');
    button.innerHTML=PlatformModel.icons({platforms:[key]})+'<span>'+esc(label)+'</span>';
    button.onclick=()=>{
      const values=PlatformModel.detect({...editorMetadata,storeUrl:valueFor('fieldStoreUrl'),steamAppId:valueFor('fieldSteamAppId')});
      editorMetadata.platforms=values.includes(key)?values.filter(value=>value!==key):[...values,key];
      editorMetadata.platformsManual=true;editorMetadata.fieldSources={...editorMetadata.fieldSources,platforms:'手动'};
      renderPlatformPicker();updateTypeFields();updateEditorSaveCue(true,'gamePlatforms');
    };host.appendChild(button);
  }
  for(const id of ['fieldStoreUrl','fieldSteamAppId'])$(id).addEventListener('input',()=>{renderPlatformPicker();updateTypeFields();});
}

function setMaximizeIcon(maximized) {
  const button=$('maximizeBtn');button.dataset.maximized=String(Boolean(maximized));
  button.setAttribute('aria-label',maximized?'还原窗口':'最大化');button.title=maximized?'还原窗口':'最大化';
  button.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true">'+(maximized?'<path d="M5.5 5.5v-3h8v8h-3"/><rect x="2.5" y="5.5" width="8" height="8"/>':'<rect x="3" y="3" width="10" height="10"/>')+'</svg>';
}
function installWindowState() {
  native.onWindowState?.(state=>setMaximizeIcon(state.maximized));
  native.windowState?.().then(state=>setMaximizeIcon(state.maximized)).catch(()=>{});
  $('maximizeBtn').onclick=async()=>{const maximized=await native.toggleMaximize();if(typeof maximized==='boolean')setMaximizeIcon(maximized);};
}
