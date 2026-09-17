/* Explicit, visible-only selection. Removing cards never deletes local files or saves. */
const librarySelection={active:false,ids:new Set(),view:null,mutation:false,refreshJob:null,anchor:null,paint:null,suppressClickUntil:0};
const DELETE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';
function visibleSelectionIds(){const visible=new Set(filterItems().map(i=>i.id));return [...librarySelection.ids].filter(id=>visible.has(id)&&state.items.some(i=>i.id===id));}
function setSelectionMode(enabled){
 librarySelection.active=Boolean(enabled)&&!document.body.classList.contains('is-disguised');librarySelection.ids.clear();librarySelection.view=activeView;renderLibrarySelection();
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
 if(librarySelection.view!==activeView||document.body.classList.contains('is-disguised')){librarySelection.ids.clear();librarySelection.view=activeView;if(document.body.classList.contains('is-disguised'))librarySelection.active=false;}
 const visible=new Set(filterItems().map(i=>i.id));librarySelection.ids=new Set([...librarySelection.ids].filter(id=>visible.has(id)));
 const active=librarySelection.active,dragging=Boolean(document.querySelector('.resource-card.dragging')),ids=visibleSelectionIds(),host=$('libraryGrid');host.classList.toggle('selection-mode',active);$('batchActions').classList.toggle('hidden',!active&&!dragging);$('batchSummary').classList.toggle('hidden',!active&&!dragging);$('batchSummary').classList.toggle('drag-only',!active&&dragging);
 $('batchCount').textContent='已选 '+ids.length+' / '+visible.size;$('batchSelectAll').textContent=ids.length&&ids.length===visible.size?'取消全选':'全选';
 $('batchDelete').setAttribute('aria-disabled',String(!ids.length||librarySelection.mutation));$('batchDelete').title=ids.length?'删除选中的 '+ids.length+' 个条目；也可拖入卡片':'拖入卡片删除';
 $('batchMove').disabled=!ids.length||librarySelection.mutation;$('batchRefresh').disabled=!ids.length||Boolean(librarySelection.refreshJob);$('batchSelectAll').disabled=!visible.size;
 $('filterToggle').setAttribute('aria-expanded',String(!$('filters').classList.contains('hidden')));
 for(const card of host.querySelectorAll('.resource-card')){
  let label=card.querySelector('.card-select');if(!active){label?.remove();card.classList.remove('is-selected');card.removeAttribute('aria-selected');continue;}
  if(!label){label=document.createElement('label');label.className='card-select';label.innerHTML='<input type="checkbox"><span aria-hidden="true"></span>';label.draggable=false;label.addEventListener('click',e=>e.stopPropagation());label.querySelector('input').addEventListener('change',()=>toggleLibrarySelection(card.dataset.id));card.prepend(label);}
  const selected=librarySelection.ids.has(card.dataset.id),input=label.querySelector('input');input.checked=selected;input.setAttribute('aria-label','选择 '+(state.items.find(i=>i.id===card.dataset.id)?.name||'条目'));card.classList.toggle('is-selected',selected);card.setAttribute('aria-selected',String(selected));
 }
}
function selectionDragIds(card){return librarySelection.active&&librarySelection.ids.has(card.dataset.id)?filterItems().filter(i=>librarySelection.ids.has(i.id)).map(i=>i.id):[card.dataset.id];}
async function deleteLibrarySelection(ids=visibleSelectionIds()){
 if(librarySelection.mutation||document.body.classList.contains('is-disguised'))return;
 const wanted=new Set(ids),items=state.items.filter(i=>wanted.has(i.id));if(!items.length)return;
 librarySelection.mutation=true;renderLibrarySelection();
 try{
  const names=items.slice(0,4).map(i=>'“'+i.name+'”').join('、');
  if(!await confirmDeletion('确定删除 '+items.length+' 个资源条目？\n'+names+(items.length>4?' 等':'')+'\n仅移除资源库记录，不删除本地文件、笔记或存档快照。'))return;
  const next={...state,items:state.items.filter(i=>!wanted.has(i.id))};state=await native.saveLibrary(next);items.forEach(i=>librarySelection.ids.delete(i.id));render();showToast('已删除 '+items.length+' 个资源条目');
 }catch(error){showToast('删除失败：'+error.message,'error');}finally{librarySelection.mutation=false;renderLibrary();}
}
async function moveLibrarySelection(){
 const ids=visibleSelectionIds();if(!ids.length||librarySelection.mutation||$('batchMoveDialog'))return;
 const backdrop=document.createElement('div');backdrop.className='app-dialog-backdrop';backdrop.id='batchMoveDialog';
 backdrop.innerHTML='<section class="app-dialog"><div class="app-dialog-head"><strong>移动到分类</strong><button type="button" class="app-dialog-close" aria-label="关闭">×</button></div><p>整理选中的 '+ids.length+' 个条目，不移动磁盘文件。</p><label class="batch-category-field">目标分类<span class="batch-category-combo"><input id="batchCategory" role="combobox" aria-label="目标分类" aria-autocomplete="list" aria-expanded="false" aria-controls="batchCategoryOptions" autocomplete="off" placeholder="选择已有分类或输入新分类"><button type="button" class="batch-category-toggle" aria-label="展开分类" aria-controls="batchCategoryOptions" aria-expanded="false">⌄</button></span><span id="batchCategoryOptions" class="batch-category-options" role="listbox" aria-label="已有分类" hidden></span></label><label class="batch-keep-label"><input id="batchKeepCategories" type="checkbox" checked>保留已有分类</label><div class="app-dialog-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button><button type="button" class="add-button app-dialog-confirm">移动到分类</button></div></section>';
 document.body.appendChild(backdrop);
 const input=$('batchCategory'),list=$('batchCategoryOptions'),toggle=backdrop.querySelector('.batch-category-toggle'),names=[...new Set(state.categories||[])];let active=-1;
 const hideList=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');toggle.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 const highlight=index=>{const options=[...list.querySelectorAll('[role=option]')];active=options.length?(index+options.length)%options.length:-1;options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===active)));if(active>=0){input.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');};
 const showList=(filter=true)=>{list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');for(const [i,name]of names.filter(n=>!filter||n.toLocaleLowerCase().includes(input.value.toLocaleLowerCase())).entries()){const option=document.createElement('button');option.type='button';option.id='batchCategoryOption-'+i;option.setAttribute('role','option');option.tabIndex=-1;option.textContent=name;option.onclick=()=>{input.value=name;hideList();input.focus();};list.append(option);}if(!list.children.length){const empty=document.createElement('span');empty.className='batch-category-empty';empty.textContent='输入名称可新建分类';list.append(empty);}list.hidden=false;input.setAttribute('aria-expanded','true');toggle.setAttribute('aria-expanded','true');};
 input.oninput=()=>showList();toggle.onclick=()=>{if(list.hidden){showList(false);input.focus();}else hideList();};
 input.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(list.hidden)showList(false);highlight(active<0?(e.key==='ArrowDown'?0:list.querySelectorAll('[role=option]').length-1):active+(e.key==='ArrowDown'?1:-1));}else if(e.key==='Enter'&&!list.hidden&&active>=0){e.preventDefault();list.querySelectorAll('[role=option]')[active].click();}};
 backdrop.addEventListener('focusout',e=>{if(!backdrop.querySelector('.batch-category-field').contains(e.relatedTarget))hideList();});backdrop.addEventListener('pointerdown',e=>{if(!e.target.closest('.batch-category-field'))hideList();});
 const close=()=>appModalStack.remove(backdrop);appModalStack.open(backdrop,()=>{if(!list.hidden)hideList();else close();});backdrop.querySelector('.app-dialog-close').onclick=close;backdrop.querySelector('.app-dialog-cancel').onclick=close;backdrop.onclick=e=>{if(e.target===backdrop)close();};
 backdrop.querySelector('.app-dialog-confirm').onclick=async()=>{
  const category=$('batchCategory').value.trim();if(!category){$('batchCategory').focus();return;}if(librarySelection.mutation)return;
  const keep=$('batchKeepCategories').checked,wanted=new Set(ids);librarySelection.mutation=true;
  try{const next={...state,categories:[...new Set([...(state.categories||[]),category])],items:state.items.map(i=>wanted.has(i.id)?{...i,categories:[...new Set([...(keep?i.categories||[]:[]),category])],updatedAt:new Date().toISOString()}:i)};state=await native.saveLibrary(next);close();render();showToast('已移入分类“'+category+'”');}catch(error){showToast('分类整理失败：'+error.message,'error');}finally{librarySelection.mutation=false;renderLibrarySelection();}
 };$('batchCategory').focus();
}
async function refreshLibrarySelection(){return refreshResources(visibleSelectionIds());}
function installLibrarySelection(){
 const actions=document.createElement('div');actions.id='batchActions';actions.className='batch-actions hidden';actions.setAttribute('role','group');actions.setAttribute('aria-label','批量操作');
 actions.innerHTML='<button type="button" id="batchDelete" class="batch-icon batch-delete" aria-label="删除所选资源">'+DELETE_ICON+'</button><button type="button" id="batchRefresh" class="batch-icon" title="补全所选资源缺失的信息" aria-label="刷新所选资源">↻</button><button type="button" id="batchMove" class="batch-icon" title="移动到分类" aria-label="移动所选资源到分类"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h7l2 2h9v12H3zM7 14h10m-3-3 3 3-3 3"/></svg></button>';$('filterToggle').after(actions);
 const summary=document.createElement('div');summary.id='batchSummary';summary.className='batch-summary hidden';summary.innerHTML='<span id="batchCount" aria-live="polite"></span><button type="button" id="batchSelectAll">全选</button>';$('filters').after(summary);
 // Keep one batch action group next to the per-library import controls.
 summary.prepend(actions);$('filterToggle').before(summary);installSelectionPainting();
 const progress=document.createElement('div');progress.id='batchProgress';progress.className='batch-progress hidden';progress.innerHTML='<span id="batchProgressText" role="status"></span><button type="button" id="batchStop">停止刷新</button>';$('libraryGrid').before(progress);
 $('filterToggle').addEventListener('click',()=>setSelectionMode(!$('filters').classList.contains('hidden')));
 $('batchSelectAll').onclick=()=>{const allIds=filterItems().map(i=>i.id);librarySelection.ids=new Set(visibleSelectionIds().length===allIds.length?[]:allIds);renderLibrarySelection();};
 $('batchDelete').onclick=()=>deleteLibrarySelection();$('batchRefresh').onclick=()=>refreshLibrarySelection();$('batchMove').onclick=moveLibrarySelection;
 $('batchStop').onclick=()=>{if(librarySelection.refreshJob){const job=librarySelection.refreshJob;job.cancelled=true;job.status='cancelled';native.cancelMetadataRefresh(job.jobId);window.audioPanels?.cancelLookup();librarySelection.refreshJob=null;$('batchProgress').classList.add('hidden');renderLibrarySelection();}};
 const bin=$('batchDelete');bin.addEventListener('dragover',event=>{if(!document.querySelector('.resource-card.dragging'))return;event.preventDefault();event.dataTransfer.dropEffect='move';bin.classList.add('drag-delete-over');});bin.addEventListener('dragleave',event=>{if(!bin.contains(event.relatedTarget))bin.classList.remove('drag-delete-over');});document.addEventListener('dragend',()=>bin.classList.remove('drag-delete-over'));
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&librarySelection.active&&$('editorBackdrop').classList.contains('hidden')&&!document.querySelector('.app-dialog-backdrop'))setSelectionMode(false);});
}
