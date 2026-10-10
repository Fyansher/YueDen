/* Explicit, visible-only selection. Removing cards never deletes local files or saves. */
const librarySelection={active:false,ids:new Set(),view:null,mutation:false,refreshJob:null,anchor:null,paint:null,suppressClickUntil:0};
const DELETE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';
function visibleSelectionIds(){const visible=new Set(filterItems().map(i=>i.id));return [...librarySelection.ids].filter(id=>visible.has(id)&&state.items.some(i=>i.id===id));}
function setSelectionMode(enabled){
 librarySelection.active=Boolean(enabled)&&!document.body.classList.contains('is-disguised');librarySelection.ids.clear();librarySelection.view=activeView;
 if(!librarySelection.active){snapshotSelection.clear();snapshotAnchor=null;snapshotPaint=null;}
 if(typeof snapshotCardMode==='function'&&snapshotCardMode())renderLibrary();else renderLibrarySelection();
}
function toggleLibrarySelection(id,event={}){
 if(!librarySelection.active)return;
 const visible=filterItems().map(item=>item.id),from=visible.indexOf(librarySelection.anchor),to=visible.indexOf(id);
 if(event.shiftKey&&from>=0&&to>=0)librarySelection.ids=SelectionRange.apply(visible,librarySelection.anchor,id,event.ctrlKey?[...librarySelection.ids]:[],true);
 else{librarySelection.ids.has(id)?librarySelection.ids.delete(id):librarySelection.ids.add(id);librarySelection.anchor=id;}
 renderLibrarySelection();
}
function installSelectionPainting(){
 const grid=$('libraryGrid');
 grid.addEventListener('pointerdown',event=>{
  if(!librarySelection.active||event.button!==0||!event.target.closest('.card-select'))return;
  const card=event.target.closest('.resource-card');if(!card)return;
  event.preventDefault();event.stopImmediatePropagation();
  const base=event.shiftKey&&!event.ctrlKey?[]:[...librarySelection.ids],selected=event.shiftKey||!librarySelection.ids.has(card.dataset.id),anchor=event.shiftKey&&librarySelection.anchor?librarySelection.anchor:card.dataset.id;
  toggleLibrarySelection(card.dataset.id,event);
  librarySelection.paint={pointerId:event.pointerId,lastCard:card.dataset.id,base,selected,anchor};
  grid.setPointerCapture?.(event.pointerId);grid.classList.add('is-painting');
 },true);
 grid.addEventListener('pointermove',event=>{
  const paint=librarySelection.paint;if(!paint||paint.pointerId!==event.pointerId)return;
  event.preventDefault();const card=document.elementFromPoint(event.clientX,event.clientY)?.closest('#libraryGrid .resource-card');
  const id=card?.dataset.id||null;if(id===paint.lastCard)return;paint.lastCard=id;if(!id)return;
  librarySelection.ids=SelectionRange.apply(filterItems().map(i=>i.id),paint.anchor,id,paint.base,paint.selected);renderLibrarySelection();
 });
 const stop=event=>{if(!librarySelection.paint||event.pointerId!==librarySelection.paint.pointerId)return;librarySelection.paint=null;librarySelection.suppressClickUntil=Date.now()+450;grid.classList.remove('is-painting');if(grid.hasPointerCapture?.(event.pointerId))grid.releasePointerCapture(event.pointerId);};
 grid.addEventListener('pointerup',stop);grid.addEventListener('pointercancel',stop);grid.addEventListener('lostpointercapture',stop);
 grid.addEventListener('click',event=>{if(Date.now()<librarySelection.suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}else if(librarySelection.active&&event.target.closest('.card-select')&&event.shiftKey){event.preventDefault();event.stopImmediatePropagation();toggleLibrarySelection(event.target.closest('.resource-card').dataset.id,event);}},true);
 document.addEventListener('dragstart',event=>{if(librarySelection.paint||event.target.closest?.('.card-select')){event.preventDefault();event.stopImmediatePropagation();}},true);
}
function renderLibrarySelection(){
 if(!document.querySelector('#batchActions'))return;
 if(activeView==='audio'&&['songs','playlists'].includes(window.audioBrowser?.view)){for(const id of ['batchActions','batchSummary'])$(id).classList.add('hidden');return;}
 const inSnapshotSelection=typeof snapshotSelectionMode==='function'&&snapshotSelectionMode();
 if(librarySelection.view!==activeView||document.body.classList.contains('is-disguised')){librarySelection.ids.clear();librarySelection.view=activeView;if(document.body.classList.contains('is-disguised'))librarySelection.active=false;}
 const visible=new Set(filterItems().map(i=>i.id));librarySelection.ids=new Set([...librarySelection.ids].filter(id=>visible.has(id)));
 const active=librarySelection.active,dragging=Boolean(document.querySelector('.resource-card.dragging')),ids=visibleSelectionIds(),host=$('libraryGrid'),showTools=active||dragging;
 host.classList.toggle('selection-mode',active);$('batchActions').classList.toggle('hidden',!showTools);$('batchSummary').classList.toggle('hidden',!showTools);$('batchSummary').classList.toggle('drag-only',!active&&dragging);
 const selectedSnapshots=inSnapshotSelection?snapshotSelection.size:0,snapshotIds=inSnapshotSelection?visibleSnapshotRows().map(row=>row.id):[],resourceIds=[...visible],allSnapshotRows=snapshotIds.length,allSelected=inSnapshotSelection?SaveSnapshotSelection.allSelected(resourceIds,snapshotIds,librarySelection.ids,snapshotSelection):ids.length>0&&ids.length===visible.size;
 $('batchCount').textContent=inSnapshotSelection?'已选 '+ids.length+' 个资源 · '+selectedSnapshots+' 份存档':'已选 '+ids.length+' / '+visible.size;$('batchSelectAll').textContent=allSelected?'取消全选':'全选';
 $('batchDelete').disabled=inSnapshotSelection?(!ids.length&&!selectedSnapshots||librarySelection.mutation):(!ids.length||librarySelection.mutation);
 $('batchDelete').setAttribute('aria-disabled',String(inSnapshotSelection?(!ids.length&&!selectedSnapshots||librarySelection.mutation):(!ids.length||librarySelection.mutation)));$('batchDelete').title=inSnapshotSelection?'删除所选资源或存档':'删除选中的 '+ids.length+' 个条目；也可拖入卡片';
 $('batchEdit').disabled=!ids.length||librarySelection.mutation;$('batchRefresh').disabled=!ids.length||Boolean(librarySelection.refreshJob);$('batchSave').disabled=!ids.length||librarySelection.mutation||Boolean(librarySelection.saveJob);$('batchSelectAll').disabled=!(inSnapshotSelection?SaveSnapshotSelection.hasRows(resourceIds,snapshotIds):visible.size>0);
 $('filterToggle').setAttribute('aria-expanded',String(!$('filters').classList.contains('hidden')));
 for(const card of host.querySelectorAll('.resource-card')){
  let label=card.querySelector('.card-select');if(!active){label?.remove();card.classList.remove('is-selected');card.removeAttribute('aria-selected');continue;}
  if(!label){label=document.createElement('label');label.className='card-select';label.innerHTML='<input type="checkbox"><span aria-hidden="true"></span>';label.draggable=false;label.addEventListener('click',e=>e.stopPropagation());label.querySelector('input').addEventListener('change',()=>toggleLibrarySelection(card.dataset.id));card.prepend(label);}
  const selected=librarySelection.ids.has(card.dataset.id),input=label.querySelector('input');input.checked=selected;input.setAttribute('aria-label','选择 '+(state.items.find(i=>i.id===card.dataset.id)?.name||'条目'));card.classList.toggle('is-selected',selected);card.setAttribute('aria-selected',String(selected));
 }
 renderSnapshotSelectionUi();
}
function selectionDragIds(card){return librarySelection.active&&librarySelection.ids.has(card.dataset.id)?filterItems().filter(i=>librarySelection.ids.has(i.id)).map(i=>i.id):[card.dataset.id];}
async function deleteLibrarySelection(ids=visibleSelectionIds()){
 if(librarySelection.mutation||document.body.classList.contains('is-disguised'))return;
 const wanted=new Set(ids),items=state.items.filter(i=>wanted.has(i.id));if(!items.length)return;
 librarySelection.mutation=true;renderLibrarySelection();
 try{
  if(!(await deleteResourceRecords(items.map(i=>i.id))))return;
  items.forEach(i=>librarySelection.ids.delete(i.id));render();
 }catch(error){showToast('删除失败：'+error.message,'error');}finally{librarySelection.mutation=false;renderLibrary();}
}
async function editLibrarySelection(){
 const ids=visibleSelectionIds();if(!ids.length||librarySelection.mutation||$('batchEditDialog'))return;
 const wanted=new Set(ids),selectedItems=state.items.filter(item=>wanted.has(item.id)),games=selectedItems.filter(item=>item.type==='game');
 const allGames=selectedItems.every(item=>item.type==='game'),stageLabels={pending:'未开始',active:'进行中',completed:'已完成',dropped:'已弃坑'},stages=Object.keys(stageLabels);
 const backdrop=document.createElement('div');backdrop.className='app-dialog-backdrop';backdrop.id='batchEditDialog';
 backdrop.innerHTML='<section class="app-dialog batch-edit-dialog"><div class="app-dialog-head"><strong>批量编辑</strong><button type="button" class="app-dialog-close" aria-label="关闭">×</button></div><div class="batch-edit-content"><p class="batch-edit-intro">编辑选中的 '+ids.length+' 个条目。未选择的内容保持不变。</p><div class="batch-edit-row"><strong class="batch-edit-label">游戏平台</strong><div class="batch-edit-control"><div class="batch-edit-platform-options" role="group" aria-label="批量设置游戏平台"></div><small class="batch-edit-hint batch-platform-hint"></small></div></div><div class="batch-edit-row"><strong class="batch-edit-label">状态</strong><div class="batch-edit-control"><div class="batch-edit-status-options" role="group" aria-label="批量设置状态"></div><small class="batch-edit-hint batch-status-hint"></small></div></div><div class="batch-edit-collections"><section class="batch-edit-collection"><strong>标签</strong><div class="batch-edit-options" role="group" aria-label="批量添加标签"></div><div class="batch-edit-entry"><input type="text" aria-label="输入标签" placeholder="输入新标签，逗号分隔"><button type="button" class="secondary-button">添加</button></div><label class="app-dialog-check"><input type="checkbox" checked>保留已有标签</label></section><section class="batch-edit-collection"><strong>分类</strong><div class="batch-edit-options" role="group" aria-label="批量添加分类"></div><div class="batch-edit-entry"><input type="text" aria-label="输入分类" placeholder="输入新分类，逗号分隔"><button type="button" class="secondary-button">添加</button></div><label class="app-dialog-check"><input type="checkbox" checked>保留已有分类</label></section></div></div><div class="app-dialog-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button><button type="button" class="add-button app-dialog-confirm">应用修改</button></div></section>';
 document.body.appendChild(backdrop);
 const close=()=>appModalStack.remove(backdrop),platformHost=backdrop.querySelector('.batch-edit-platform-options'),platformHint=backdrop.querySelector('.batch-platform-hint'),statusHost=backdrop.querySelector('.batch-edit-status-options'),statusHint=backdrop.querySelector('.batch-status-hint');
 const genreKnown=new Set(state.items.flatMap(item=>item.genres||[])),categoryKnown=new Set([...(state.categories||[]),...state.items.flatMap(item=>item.categories||[])]),genreChosen=new Set(),categoryChosen=new Set(),platformTargets=new Map();let statusTarget=null;
 const statusPhase=item=>StatusModel.stage(StatusModel.normalize(item.status,item.type));
 const statusForStage=(item,stage)=>{const values=statusList(item.type),match=values.find(value=>{const normalized=StatusModel.normalize(value,item.type);return StatusModel.stage(normalized)===stage&&!(item.type==='game'&&stage==='completed'&&normalized==='全成就');});return match||values[0];};
 const createChoice=(value,label,pressed,kind,extra={})=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(pressed));button.dataset.value=value;if(extra.mixed){button.dataset.mixed='true';button.classList.add('is-mixed');}if(kind==='platform'){button.className='platform-quick-option'+(extra.mixed?' is-mixed':'');button.dataset.platformState=extra.state||'unchecked';button.innerHTML=PlatformModel.icons({platforms:[value],playedPlatforms:extra.state==='played'?[value]:[]})+'<span>'+label+'</span>';const stateLabel=extra.state==='played'?'我玩过':extra.state==='release'?'发行平台':extra.state==='mixed-played'?'部分游戏标记为我玩过':extra.state==='mixed-release'?'部分游戏设为发行平台':'未指定';button.setAttribute('aria-label',label+'：'+stateLabel);}return button;};
 const allStates=key=>games.map(item=>PlatformModel.state(item,key)),aggregateState=key=>{const values=allStates(key);if(!values.length)return 'unchecked';if(values.every(value=>value===values[0]))return values[0];return values.includes('played')?'mixed-played':'mixed-release';};
 const drawPlatforms=()=>{platformHost.replaceChildren();for(const [key,label]of Object.entries(PlatformModel.labels)){const current=platformTargets.has(key)?platformTargets.get(key):aggregateState(key),mixed=current.startsWith('mixed-'),button=createChoice(key,label,current!=='unchecked'&&!mixed,'platform',{state:current,mixed});button.onclick=()=>{const from=platformTargets.has(key)?platformTargets.get(key):aggregateState(key),next=from.startsWith('mixed-')||from==='unchecked'?'release':from==='release'?'played':'unchecked';platformTargets.set(key,next);drawPlatforms();};platformHost.append(button);}};
 if(games.length){drawPlatforms();platformHint.textContent='仅影响 '+games.length+' 个游戏；单击循环：未指定、发行平台、我玩过。';}
 else{platformHost.textContent='所选条目中没有游戏';platformHost.classList.add('is-unavailable');platformHint.textContent='游戏平台只适用于游戏条目。';}
 const drawStatuses=()=>{statusHost.replaceChildren();statusHint.textContent='选择后按每条资源的类型转换为对应状态。';for(const stage of stages){const count=selectedItems.filter(item=>statusPhase(item)===stage).length,pressed=statusTarget!==null?statusTarget===stage:count===selectedItems.length,button=createChoice(stage,stageLabels[stage],pressed,'status',{mixed:statusTarget===null&&count>0&&count<selectedItems.length});button.onclick=()=>{statusTarget=stage;drawStatuses();};statusHost.append(button);}const masteredCount=games.filter(item=>StatusModel.phase(StatusModel.normalize(item.status,item.type))==='mastered').length,mastered=createChoice('mastered','全成就',statusTarget==='mastered'||(statusTarget===null&&allGames&&masteredCount===selectedItems.length),'status',{mixed:allGames&&statusTarget===null&&masteredCount>0&&masteredCount<selectedItems.length});mastered.disabled=!allGames;mastered.title=allGames?'将所选游戏统一设为全成就':'全成就仅适用于全部为游戏的选择';mastered.setAttribute('aria-disabled',String(!allGames));mastered.onclick=()=>{if(allGames){statusTarget='mastered';drawStatuses();}};statusHost.append(mastered);};drawStatuses();
 const drawValues=(host,known,chosen,field,items)=>{host.replaceChildren();for(const value of known){const presentCount=items.filter(item=>(item[field]||[]).includes(value)).length,button=createChoice(value,value,chosen.has(value),'value',{mixed:false});button.title=presentCount?'已存在于 '+presentCount+' / '+items.length+' 个所选条目':'';button.onclick=()=>{chosen.has(value)?chosen.delete(value):chosen.add(value);drawValues(host,known,chosen,field,items);};host.append(button);}};
 const addEntry=(input,known,chosen,host,field)=>{const values=String(input.value||'').split(/[,，]/).map(value=>value.trim()).filter(Boolean);for(const value of values){known.add(value);chosen.add(value);}input.value='';drawValues(host,known,chosen,field,selectedItems);};
 const genreHost=backdrop.querySelector('.batch-edit-collection:nth-child(1) .batch-edit-options'),categoryHost=backdrop.querySelector('.batch-edit-collection:nth-child(2) .batch-edit-options'),genreInput=backdrop.querySelector('.batch-edit-collection:nth-child(1) .batch-edit-entry input'),categoryInput=backdrop.querySelector('.batch-edit-collection:nth-child(2) .batch-edit-entry input');
 drawValues(genreHost,genreKnown,genreChosen,'genres',selectedItems);drawValues(categoryHost,categoryKnown,categoryChosen,'categories',selectedItems);
 for(const [input,known,chosen,host,field]of [[genreInput,genreKnown,genreChosen,genreHost,'genres'],[categoryInput,categoryKnown,categoryChosen,categoryHost,'categories']]){const addButton=input.nextElementSibling;addButton.onclick=()=>addEntry(input,known,chosen,host,field);input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addEntry(input,known,chosen,host,field);}};}
 const closeButton=backdrop.querySelector('.app-dialog-close');appModalStack.open(backdrop,close);closeButton.onclick=close;backdrop.querySelector('.app-dialog-cancel').onclick=close;backdrop.onclick=event=>{if(event.target===backdrop)close();};
 backdrop.querySelector('.app-dialog-confirm').onclick=async()=>{
  if(librarySelection.mutation)return;
  const keepGenres=genreHost.closest('.batch-edit-collection').querySelector('input[type=checkbox]').checked,keepCategories=categoryHost.closest('.batch-edit-collection').querySelector('input[type=checkbox]').checked,editGenres=genreChosen.size>0||!keepGenres,editCategories=categoryChosen.size>0||!keepCategories,editStatus=statusTarget!==null,editPlatforms=platformTargets.size>0;
  if(!editGenres&&!editCategories&&!editStatus&&!editPlatforms){close();showToast('没有需要应用的修改');return;}
  librarySelection.mutation=true;renderLibrarySelection();
  try{
   const timestamp=new Date().toISOString(),changedCategories=[...categoryChosen],nextItems=state.items.map(item=>{
    if(!wanted.has(item.id))return item;const patch={};
    if(item.type==='game'&&editPlatforms){let platforms=PlatformModel.detect(item),playedPlatforms=PlatformModel.normalizeMany(item.playedPlatforms);for(const [key,target]of platformTargets){if(target==='unchecked'){platforms=platforms.filter(value=>value!==key);playedPlatforms=playedPlatforms.filter(value=>value!==key);}else{if(!platforms.includes(key))platforms=[...platforms,key];if(target==='played'){if(!playedPlatforms.includes(key))playedPlatforms=[...playedPlatforms,key];}else playedPlatforms=playedPlatforms.filter(value=>value!==key);}}patch.platforms=platforms;patch.playedPlatforms=playedPlatforms;patch.platformsExplicit=true;patch.platformsManual=false;patch.fieldSources={...(item.fieldSources||{}),platforms:'手动'};}
    if(editStatus)patch.status=statusTarget==='mastered'?'全成就':statusForStage(item,statusTarget);
    if(editGenres)patch.genres=[...new Set([...(keepGenres?item.genres||[]:[]),...genreChosen])];
    if(editCategories)patch.categories=[...new Set([...(keepCategories?item.categories||[]:[]),...categoryChosen])];
    if(!Object.keys(patch).length)return item;const changed=Object.entries(patch).some(([key,value])=>JSON.stringify(item[key])!==JSON.stringify(value));return changed?{...item,...patch,updatedAt:timestamp}:item;
   });
   const next={...state,categories:[...new Set([...(state.categories||[]),...changedCategories])],items:nextItems};state=await native.saveLibrary(next);close();render();showToast('已批量更新 '+ids.length+' 个条目');
  }catch(error){showToast('批量编辑失败：'+error.message,'error');}finally{librarySelection.mutation=false;renderLibrarySelection();}
 };genreInput.focus();
}
async function refreshLibrarySelection(){return refreshResources(visibleSelectionIds());}
function installLibrarySelection(){
 const actions=document.createElement('div');actions.id='batchActions';actions.className='batch-actions hidden';actions.setAttribute('role','group');actions.setAttribute('aria-label','批量操作');
 actions.innerHTML='<button type="button" id="batchDelete" class="batch-icon batch-delete" aria-label="删除所选资源">'+DELETE_ICON+'</button><button type="button" id="batchRefresh" class="batch-icon" title="补全所选资源缺失的信息" aria-label="刷新所选资源">↻</button><button type="button" id="batchEdit" class="batch-icon" title="批量编辑" aria-label="批量编辑所选资源">✎</button><button type="button" id="batchSave" class="batch-icon" title="备份存档或获取路径" aria-label="备份存档">▤</button>';$('filterToggle').after(actions);
 const summary=document.createElement('div');summary.id='batchSummary';summary.className='batch-summary hidden';summary.innerHTML='<span id="batchCount" aria-live="polite"></span><button type="button" id="batchSelectAll">全选</button>';$('filters').after(summary);
 // Keep one batch action group next to the per-library import controls.
 summary.prepend(actions);$('filterToggle').before(summary);installSelectionPainting();
 const progress=document.createElement('div');progress.id='batchProgress';progress.className='batch-progress hidden';progress.innerHTML='<span id="batchProgressText" role="status"></span><button type="button" id="batchStop">停止操作</button>';$('libraryGrid').before(progress);
 $('filterToggle').addEventListener('click',()=>setSelectionMode(!$('filters').classList.contains('hidden')));
 $('batchSelectAll').onclick=()=>{
  if(typeof snapshotSelectionMode==='function'&&snapshotSelectionMode()){
   const itemIds=filterItems().map(i=>i.id),saveIds=visibleSnapshotRows().map(row=>row.id),next=SaveSnapshotSelection.toggleAll(itemIds,saveIds,librarySelection.ids,snapshotSelection);
   librarySelection.view=activeView;librarySelection.active=true;librarySelection.ids=new Set(next.resourceIds);snapshotSelection=new Set(next.snapshotIds);snapshotAnchor=null;renderLibrarySelection();return;
  }
  const allIds=filterItems().map(i=>i.id);librarySelection.ids=new Set(visibleSelectionIds().length===allIds.length?[]:allIds);renderLibrarySelection();
 };
 $('batchDelete').onclick=()=>typeof snapshotSelectionMode==='function'&&snapshotSelectionMode()?deleteSnapshotResourceSelection():deleteLibrarySelection();$('batchRefresh').onclick=()=>refreshLibrarySelection();$('batchEdit').onclick=editLibrarySelection;$('batchSave').onclick=()=>openBatchSaveDialog();
 $('batchStop').onclick=()=>{if(librarySelection.saveJob){librarySelection.saveJob.cancelled=true;$('batchProgressText').textContent='当前项目完成后停止…';return;}if(librarySelection.refreshJob){const job=librarySelection.refreshJob;job.cancelled=true;job.status='cancelled';native.cancelMetadataRefresh(job.jobId);window.audioPanels?.cancelLookup();librarySelection.refreshJob=null;$('batchProgress').classList.add('hidden');renderLibrarySelection();}};
 const bin=$('batchDelete');bin.addEventListener('dragover',event=>{if(!document.querySelector('.resource-card.dragging'))return;event.preventDefault();event.dataTransfer.dropEffect='move';bin.classList.add('drag-delete-over');});bin.addEventListener('dragleave',event=>{if(!bin.contains(event.relatedTarget))bin.classList.remove('drag-delete-over');});document.addEventListener('dragend',()=>bin.classList.remove('drag-delete-over'));
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&librarySelection.active&&$('editorBackdrop').classList.contains('hidden')&&!document.querySelector('.app-dialog-backdrop'))setSelectionMode(false);});
 installSnapshotPainting();
}
