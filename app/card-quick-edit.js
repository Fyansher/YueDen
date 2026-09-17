function cardRatingText(item){
 const info=RatingModel.parse(item,item.type),numeric=info.value!==null?Number(info.value.toFixed(1))+(info.max===100?'%':' / '+info.max):'';
 const tier=info.source==='Steam'?RatingModel.tier(info.raw):'';return tier?tier+(numeric?' · '+numeric:''):numeric||info.raw;
}
function cardTagRows(item){return cardTags(item);}
let cardQuickEditor=null,cardQuickSaveQueue=Promise.resolve();
function commitCardPatch(id,patch){cardQuickSaveQueue=cardQuickSaveQueue.catch(()=>{}).then(async()=>{if(document.body.classList.contains('is-disguised'))throw Error('界面已切换，未保存快捷修改');return saveLocalLibrary({...state,categories:[...new Set([...(state.categories||[]),...(patch.categories||[])])],items:state.items.map(i=>i.id===id?{...i,...patch,updatedAt:new Date().toISOString()}:i)});});return cardQuickSaveQueue;}
function closeCardQuickEdit(){cardQuickEditor?.remove();cardQuickEditor=null;}
function openCardQuickEdit(id,kind,point){
 closeCardQuickEdit();if(document.body.classList.contains('is-disguised'))return;
 const original=state.items.find(i=>i.id===id);if(!original)return;
 const labels={platform:'游戏平台 · 可多选',status:'条目状态',name:'资源名称',genres:'类型标签',categories:'自定义分类',rating:'个人评分',localPath:'本地路径',storeUrl:'商店 / 官方链接',resourceUrl:'购买 / 阅读链接'};
 if(!labels[kind])return;
 const menu=document.createElement('section');menu.className='card-quick-editor';menu.dataset.kind=kind;menu.setAttribute('role','dialog');menu.setAttribute('aria-label',labels[kind]);cardQuickEditor=menu;
 let busy=false;const title=document.createElement('strong');title.textContent=labels[kind];menu.append(title);
 const error=document.createElement('div');error.className='quick-error';error.hidden=true;
 const fail=message=>{error.textContent=message;error.hidden=false;error.classList.remove('is-success');};
 const save=async patch=>{
  if(busy)return false;const current=state.items.find(i=>i.id===id);if(!current){closeCardQuickEdit();return false;}
  if(Object.entries(patch).every(([k,v])=>JSON.stringify(current[k])===JSON.stringify(v)))return true;
  busy=true;error.hidden=true;menu.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
   const saved=await commitCardPatch(id,patch);
   // A field popover never rebuilds the grid or reloads already visible cover images.
   if(!document.body.classList.contains('is-disguised'))patchLibraryCard(id);error.textContent='已更新';error.hidden=false;error.classList.add('is-success');return true;
  }catch(e){fail('未能保存：'+e.message);return false;}
  finally{busy=false;menu.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 const actions=(handler,onTyping=true)=>{let timer;const commit=()=>{clearTimeout(timer);timer=setTimeout(async()=>{if(busy){commit();return;}await handler();},300);};if(onTyping)menu.addEventListener('input',commit);menu.addEventListener('change',commit);menu.addEventListener('focusout',commit);menu.quickCommit=commit;menu.append(error);};
 const field=(value,type='text')=>{const input=document.createElement('input');input.type=type;input.value=value||'';input.setAttribute('aria-label',labels[kind]);input.dataset.quickInput='';menu.append(input);return input;};
 if(kind==='status'||kind==='platform'){
  const options=document.createElement('div');menu.append(options,error);
  const draw=()=>{
   const live=state.items.find(i=>i.id===id);if(!live)return;options.replaceChildren();
   const values=kind==='platform'?Object.entries(PlatformModel.labels):statusList(live.type).map(v=>[v,v]);
   for(const [value,label]of values){
    const selected=kind==='platform'?PlatformModel.detect(live).includes(value):live.status===value,button=document.createElement('button');
    button.type='button';button.dataset.quickValue=value;button.setAttribute('aria-pressed',String(selected));
    button.innerHTML=(kind==='platform'?PlatformModel.icons({platforms:[value]}):value==='全成就'?TROPHY_MARK:'')+'<span>'+esc(label)+'</span><i>'+(selected?'✓':'')+'</i>';
    button.onclick=async()=>{
     const current=state.items.find(i=>i.id===id);if(!current||busy)return;
     const values=PlatformModel.detect(current),patch=kind==='platform'?{platforms:values.includes(value)?values.filter(v=>v!==value):[...values,value],platformsManual:true,fieldSources:{...current.fieldSources,platforms:'手动'}}:{status:value};
     if(await save(patch)&&cardQuickEditor===menu){if(kind==='status')closeCardQuickEdit();else draw();}
    };options.append(button);
   }
  };draw();
 }else if(kind==='genres'||kind==='categories'){
  const selected=new Set(original[kind]||[]),known=new Set([...selected,...state.items.flatMap(i=>i[kind]||[]),...(kind==='categories'?state.categories||[]:[])]);
  const options=document.createElement('div');options.className='quick-options';menu.append(options);
  const input=field('');input.placeholder='输入新标签，逗号分隔后回车';
  const draw=()=>{options.replaceChildren();for(const value of known){const b=document.createElement('button');b.type='button';b.textContent=value;b.setAttribute('aria-pressed',String(selected.has(value)));b.onclick=()=>{selected.has(value)?selected.delete(value):selected.add(value);draw();void save({[kind]:[...selected]});};options.append(b);}};
  const add=()=>{for(const value of splitValues(input.value)){known.add(value);selected.add(value);}input.value='';draw();};
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add();void save({[kind]:[...selected]});}});
  draw();actions(()=>{add();return save({[kind]:[...selected]});},false);
 }else if(kind==='rating'){
  const host=document.createElement('div');host.className='quick-stars';host.innerHTML=Array.from({length:5},()=>'<span class="quick-star-cell" aria-hidden="true"><svg viewBox="0 0 40 40" class="quick-star-base"><path d="m20 3 5 11 12 1-9 9 3 12-11-6-11 6 3-12-9-9 12-1z"/></svg><span class="quick-star-lit"><svg viewBox="0 0 40 40"><path d="m20 3 5 11 12 1-9 9 3 12-11-6-11 6 3-12-9-9 12-1z"/></svg></span></span>').join('')+'<input type="range" min="0" max="5" step="0.5" aria-label="个人评分">';
  const range=host.querySelector('input'),fills=[...host.querySelectorAll('.quick-star-lit')],value=document.createElement('output');value.className='quick-rating-value';range.value=Number(original.rating)||0;
  const update=()=>{fills.forEach((fill,i)=>fill.style.width=Math.max(0,Math.min(1,Number(range.value)-i))*100+'%');value.textContent=range.value+' / 5 星';range.setAttribute('aria-valuetext',value.textContent);};
  range.oninput=update;const move=e=>{const r=host.getBoundingClientRect();range.value=Math.max(0,Math.min(5,Math.round((e.clientX-r.left)/r.width*10)/2));update();};let pointer=null;range.addEventListener('pointerdown',e=>{e.preventDefault();pointer=e.pointerId;range.focus({preventScroll:true});range.setPointerCapture?.(e.pointerId);move(e);});range.addEventListener('pointermove',e=>{if(pointer===e.pointerId){e.preventDefault();move(e);}});range.addEventListener('pointerup',e=>{if(pointer===e.pointerId){e.preventDefault();move(e);pointer=null;if(range.hasPointerCapture?.(e.pointerId))range.releasePointerCapture(e.pointerId);}});range.addEventListener('pointercancel',()=>pointer=null);update();menu.append(host,value);actions(()=>save({rating:Number(range.value)}));
 }else{
  const input=field(original[kind],['storeUrl','resourceUrl'].includes(kind)?'url':'text');input.maxLength=kind==='name'?500:4096;
  if(kind==='localPath'){
   if(original.type==='audio'&&window.audioBrowser){const refs=AudioContext.order(original.audio.tracks).map(t=>({itemId:original.id,trackId:t.id}));menu.append(audioBrowser.actions(refs,original));}
   const pick=document.createElement('button');pick.type='button';pick.textContent='选择本地路径';pick.onclick=async()=>{try{const value=await native.pickResourcePath('resource');if(cardQuickEditor===menu&&value){const selected=typeof value==='string'?value:value.ok?value.value:'';if(selected){input.value=selected;input.dispatchEvent(new Event('change',{bubbles:true}));}}}catch(e){fail(e.message);}};menu.append(pick);
  }
  actions(()=>{
   const value=input.value.trim();if(kind==='name'&&!value){fail('名称不能为空');return false;}
   if(['storeUrl','resourceUrl'].includes(kind)&&value&&!/^https?:\/\/\S+$/i.test(value)){fail('请输入 http 或 https 链接');return false;}
   const patch={[kind]:value};
   if(kind==='localPath'){const live=state.items.find(i=>i.id===id);patch.localFiles=value===live?.localPath?live.localFiles||[]:value?(live?.localFiles||[]).some(f=>LocalModel.pathKey(f.path)===LocalModel.pathKey(value))?live.localFiles:[{path:value,name:LocalModel.base(value)}]:[];}
   return save(patch);
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();menu.quickCommit?.();}});
 }
 document.body.append(menu);const r=menu.getBoundingClientRect();
 menu.style.left=Math.max(8,Math.min(point.x,innerWidth-r.width-8))+'px';menu.style.top=Math.max(36,Math.min(point.y,innerHeight-r.height-8))+'px';
 (menu.querySelector('input')||menu.querySelector('button'))?.focus({preventScroll:true});
}
function installCardQuickEdit(){
 installCardRatingDrag();
 $('libraryGrid').addEventListener('contextmenu',event=>{
  const card=event.target.closest('.resource-card');if(!card||document.body.classList.contains('is-disguised'))return;
  event.preventDefault();event.stopPropagation();closeCardQuickEdit();
  const target=event.target,item=state.items.find(i=>i.id===card.dataset.id);if(!item||target.closest('.card-source-score'))return;
  const kind=target.closest('[data-action=store]')?(item.type==='game'||!item.resourceUrl?'storeUrl':'resourceUrl'):target.closest('.card-title')?'name':target.closest('.card-genre-tags')?'genres':target.closest('.card-category-tags')?'categories':target.closest('.platform-logo,.platform-more,.platform-unset')&&item.type==='game'?'platform':target.closest('.status-pill')?'status':target.closest('.card-cover')?'localPath':null;
  if(kind)openCardQuickEdit(item.id,kind,{x:event.clientX,y:event.clientY});
 });
 document.addEventListener('pointerdown',e=>{if(cardQuickEditor&&!cardQuickEditor.contains(e.target))closeCardQuickEdit();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&cardQuickEditor){e.preventDefault();e.stopPropagation();closeCardQuickEdit();}},true);
 document.querySelector('.content').addEventListener('scroll',closeCardQuickEdit);window.addEventListener('resize',closeCardQuickEdit);
}
function installCardRatingDrag(){
 const grid=$('libraryGrid');let drag=null;
 const update=e=>{const r=drag.rect;drag.value=Math.max(0,Math.min(5,Math.round((e.clientX-r.left)/r.width*10)/2));drag.host.innerHTML=stars(drag.value);drag.host.setAttribute('aria-label','个人评分 '+drag.value+' 星');};
 grid.addEventListener('pointerdown',e=>{const host=e.target.closest('.card-personal');if(!host||e.button!==0||librarySelection.active||document.body.classList.contains('is-disguised'))return;e.preventDefault();e.stopImmediatePropagation();const card=host.closest('.resource-card'),item=state.items.find(i=>i.id===card.dataset.id);if(!item)return;drag={host,card,id:item.id,value:Number(item.rating)||0,rect:host.getBoundingClientRect(),pointer:e.pointerId};card.draggable=false;host.setPointerCapture?.(e.pointerId);update(e);},true);
 grid.addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.pointer){e.preventDefault();e.stopImmediatePropagation();update(e);}},true);
 grid.addEventListener('pointerup',async e=>{if(!drag||e.pointerId!==drag.pointer)return;e.preventDefault();e.stopImmediatePropagation();update(e);const done=drag;drag=null;done.card.draggable=true;done.host.releasePointerCapture?.(e.pointerId);try{await commitCardPatch(done.id,{rating:done.value});patchLibraryCard(done.id);}catch(error){patchLibraryCard(done.id);showToast('评分保存失败：'+error.message,'error');}},true);
 grid.addEventListener('pointercancel',()=>{if(drag){drag.card.draggable=true;patchLibraryCard(drag.id);drag=null;}},true);
 grid.addEventListener('click',e=>{if(e.target.closest('.card-personal')&&!librarySelection.active){e.preventDefault();e.stopImmediatePropagation();}},true);
}
