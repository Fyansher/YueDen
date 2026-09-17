/* One drag owner for ordering and deletion, so a bin drop never becomes a reorder. */
function ensureDragMotion(){
 if(window.__umDragMotionV3)return;window.__umDragMotionV3=true;
 let dragged=null,group=[];const grid=()=>$('libraryGrid');
 const clear=()=>{all('.resource-card').forEach(c=>c.classList.remove('drag-over','dragging'));$('batchDelete')?.classList.remove('drag-delete-over');dragged=null;group=[];renderLibrarySelection();};
 document.addEventListener('dragstart',event=>{
  const card=event.target.closest?.('.resource-card');if(!card||!grid()?.contains(card)||event.target.closest('.card-select'))return;
  dragged=card;group=selectionDragIds(card);all('.resource-card').forEach(c=>c.classList.toggle('dragging',group.includes(c.dataset.id)));renderLibrarySelection();event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',card.dataset.id);
 },true);
 document.addEventListener('dragover',event=>{
  if(!dragged||!grid()?.contains(event.target)||!librarySorting.isCustom())return;
  event.preventDefault();event.dataTransfer.dropEffect='move';
  const content=grid(),cr=content.getBoundingClientRect();if(event.clientY>cr.bottom-65)content.scrollTop+=18;else if(event.clientY<cr.top+65)content.scrollTop-=18;
  let target=event.target.closest?.('.resource-card');
  if(!target){target=[...grid().querySelectorAll('.resource-card')].filter(c=>!group.includes(c.dataset.id)).sort((a,b)=>{const distance=c=>{const r=c.getBoundingClientRect();return Math.hypot(event.clientX-r.x-r.width/2,event.clientY-r.y-r.height/2);};return distance(a)-distance(b);})[0];}
  if(!target||group.includes(target.dataset.id))return;
  const rect=target.getBoundingClientRect(),list=grid().classList.contains('list-layout'),after=list?event.clientY>rect.top+rect.height/2:event.clientY>rect.bottom?true:event.clientY<rect.top?false:event.clientX>rect.left+rect.width/2;
  const nodes=[...grid().querySelectorAll('.resource-card')],moving=nodes.filter(c=>group.includes(c.dataset.id)),stationary=nodes.filter(c=>!group.includes(c.dataset.id));let at=stationary.indexOf(target)+(after?1:0);
  const ordered=[...stationary.slice(0,at),...moving,...stationary.slice(at)];if(ordered.every((c,i)=>c===nodes[i]))return;
  ReorderMotion.move(grid(),ordered,{exclude:moving});
 },true);
 document.addEventListener('drop',async event=>{
  if(!dragged)return;event.preventDefault();event.stopImmediatePropagation();
  const ids=[...group];if(event.target.closest?.('#batchDelete')){clear();await deleteLibrarySelection(ids);return;}
  if(!librarySorting.isCustom()){clear();renderLibrary();showToast('请切回自定义排序后重排；当前人工顺序未改变');return;}
  if(!grid()?.contains(event.target)){clear();renderLibrary();return;}
  const visibleIds=[...grid().querySelectorAll('.resource-card')].map(c=>c.dataset.id),visible=new Set(visibleIds),ordered=[...state.items].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
  let cursor=0;const positions=new Map(ordered.map((item,index)=>[visible.has(item.id)?visibleIds[cursor++]:item.id,index]));
  clear();
  try{state=await native.saveLibrary({...state,items:state.items.map(i=>({...i,sortOrder:positions.get(i.id)}))});localStorage.setItem('librarySort:'+librarySorting.key(),JSON.stringify({...librarySorting.preferences(),manual:true}));showToast('已保存自定义排序');}catch(error){showToast('排序保存失败：'+error.message,'error');}finally{renderLibrary();}
 },true);
 document.addEventListener('dragend',()=>{const abandoned=Boolean(dragged);clear();if(abandoned)renderLibrary();},true);
}
