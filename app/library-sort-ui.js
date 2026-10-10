const librarySorting={
 excluded(){return activeView==='audio'&&window.audioBrowser?.view==='playlists'?['rating','releaseDate']:activeView==='audio'&&window.audioBrowser?.view==='songs'?['rating']:[];},
 key(){return activeView+(activeView==='audio'?':'+(window.audioBrowser?.view||'all'):'');},
 preferences(){try{const p=LibrarySort.normalize(JSON.parse(localStorage.getItem('librarySort:'+this.key())||'null'));return this.excluded().includes(p.field)?LibrarySort.normalize():p;}catch{return LibrarySort.normalize();}},
 isCustom(){return true;},
 apply(items){return LibrarySort.sort(items.map(i=>({...i,lastOpenedAt:window.usageData?.[i.id]?.openedAt||i.lastOpenedAt})),this.preferences());},
 render(config={}){
  const hostId=config.hostId||'librarySort';let host=document.getElementById(hostId);
  if(!host){
   host=document.createElement('div');host.id=hostId;host.className='library-sort';host.innerHTML='<select aria-label="排序字段"><option value="" hidden disabled>排序方式</option></select><button type="button" aria-label="切换排序方向"></button>';
   const fields=config.fields||Object.entries(LibrarySort.fields).filter(([value])=>value!=='custom');
   for(const [value,label]of fields){const option=document.createElement('option');option.value=value;option.textContent=label;host.querySelector('select').append(option);}
   host.querySelector('select').onchange=event=>{
    if(config.onFieldChange){config.onFieldChange(event.target.value);return;}
    const next={...this.preferences(),field:event.target.value,manual:false};
    try{localStorage.setItem('librarySort:'+this.key(),JSON.stringify(next));}catch{showToast('排序偏好保存失败','error');}
    renderLibrary();
   };
   host.querySelector('button').onclick=()=>{
    if(config.onDirectionChange){config.onDirectionChange();return;}
    const current=this.preferences(),next={...current,direction:current.direction==='asc'?'desc':'asc',manual:false};
    try{localStorage.setItem('librarySort:'+this.key(),JSON.stringify(next));}catch{showToast('排序偏好保存失败','error');}
    renderLibrary();
   };
   if(!config.hostId)refreshUsage().then(()=>renderLibrary());
  }
  const select=host.querySelector('select');
  for(const option of select.options)option.hidden=config.hostId?false:this.excluded().includes(option.value);
  const prefs=config.getState?config.getState():this.preferences();
  select.value=config.selectValue?config.selectValue(prefs):(prefs.field==='custom'?'':prefs.field);
  const direction=host.querySelector('button');direction.textContent=prefs.direction==='asc'?'↑':'↓';
  direction.title=prefs.direction==='asc'?'升序':'降序';host.title=config.title||'随时拖动卡片可调整顺序；再次选择排序字段时重新排列';
  const target=document.querySelector(config.target||'#librarySearchHeader .toolbar-actions');
  if(target){if(config.append)target.append(host);else target.prepend(host);}
  return host;
 }
};
