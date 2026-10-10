/* Refresh only missing fields, with visual per-item protection and honest counts. */
function refreshProtected(item){const keys=new Set((settings.refreshWhitelist||[]).map(v=>String(v).trim().toLowerCase()));return [item.id,item.name,item.steamAppId].some(v=>v&&keys.has(String(v).toLowerCase()));}
async function openRefreshProtection(){
 if($('refreshProtection')||document.body.classList.contains('is-disguised'))return;
 const backdrop=document.createElement('div');backdrop.id='refreshProtection';backdrop.className='app-dialog-backdrop';
 backdrop.innerHTML='<section class="app-dialog refresh-protection-dialog"><div class="app-dialog-head"><strong>刷新保护</strong><button type="button" class="app-dialog-close" aria-label="关闭">×</button></div><p>勾选的资源会跳过刷新。其他资源也只补全缺失信息，不覆盖手填内容。</p><input class="refresh-protection-search" placeholder="搜索资源名称" aria-label="搜索资源名称"><div class="refresh-protection-list"></div><div class="app-dialog-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button><button type="button" class="add-button app-dialog-confirm">应用</button></div></section>';
 document.body.append(backdrop);const selected=new Set(state.items.filter(refreshProtected).map(i=>i.id)),list=backdrop.querySelector('.refresh-protection-list');
 const renderList=()=>{const query=backdrop.querySelector('input').value.toLocaleLowerCase();list.replaceChildren();for(const item of state.items.filter(i=>i.name.toLocaleLowerCase().includes(query))){const row=document.createElement('label');row.innerHTML='<input type="checkbox"><span>'+esc(item.name)+'</span><small>'+esc(TYPE_NAMES[item.type]||'资源')+'</small>';row.querySelector('input').checked=selected.has(item.id);row.querySelector('input').onchange=e=>e.target.checked?selected.add(item.id):selected.delete(item.id);list.append(row);}if(!list.children.length)list.textContent='没有匹配的资源';};
 const close=()=>backdrop.remove();backdrop.querySelector('.app-dialog-close').onclick=close;backdrop.querySelector('.app-dialog-cancel').onclick=close;backdrop.onclick=e=>{if(e.target===backdrop)close();};backdrop.onkeydown=e=>{if(e.key==='Escape')close();};backdrop.querySelector('.refresh-protection-search').oninput=renderList;
 backdrop.querySelector('.app-dialog-confirm').onclick=async()=>{if(await queueSettingsSave({refreshWhitelist:[...selected]})){close();showToast('已更新刷新保护：'+selected.size+' 个资源');}};renderList();
}
async function refreshResources(ids){
 if(librarySelection.refreshJob||document.body.classList.contains('is-disguised'))return;

 const wanted=new Set(ids),items=structuredClone(state.items.filter(i=>wanted.has(i.id))),targets=items.filter(i=>!refreshProtected(i));
 if(!targets.length){showToast(items.length?'所选资源均已启用刷新保护':'没有需要补全的资源');return;}
 const job={jobId:crypto.randomUUID(),cancelled:false,status:'loading',currentItem:null};librarySelection.refreshJob=job;let filled=0,unchanged=0,failed=0,fields=0;
 $('batchProgress').classList.remove('hidden');renderLibrarySelection();
 try{for(let index=0;index<targets.length;index++){
  if(job.cancelled)break;const original=targets[index];$('batchProgressText').textContent='正在补全 '+(index+1)+' / '+targets.length+' · '+original.name;
  try{job.currentItem=original.id;if(original.type==='audio'){await window.audioPanels.metadata(original.id);if(job.cancelled||librarySelection.refreshJob!==job)break;continue;}const result=await native.refreshItemMetadata(original,job.jobId);if(job.cancelled||librarySelection.refreshJob!==job||result.status==='cancelled')break;if(!['success','empty'].includes(result.status)){failed++;$('batchProgressText').textContent='资料获取：'+result.status;continue;}const updated=result.item;
   const live=state.items.find(i=>i.id===original.id);if(!live)continue;const merged=mergeRefreshedItem(live,original,updated);
   const changed=Object.keys(updated||{}).filter(key=>!['autoMetadataAt','metadataSource','fieldSources','networkCovers'].includes(key)&&JSON.stringify(merged[key])!==JSON.stringify(live[key]));
   if(changed.length){state=await native.saveLibrary({...state,items:state.items.map(i=>i.id===live.id?merged:i)});filled++;fields+=changed.length;renderLibrary();}else unchanged++;
  }catch(error){if(!job.cancelled){failed++;console.error('补全失败',error);}}
 }
 showToast((job.cancelled?'已停止：':'补全结束：')+filled+' 个资源 / '+fields+' 个字段，'+unchanged+' 个无可补充数据'+(items.length-targets.length?'，保护跳过 '+(items.length-targets.length):'')+(failed?'，请求失败 '+failed:''),failed?'error':'normal');
 }finally{if(librarySelection.refreshJob===job){librarySelection.refreshJob=null;$('batchProgress').classList.add('hidden');renderLibrarySelection();}}
}
function openBatchSaveDialog(){
 if(librarySelection.mutation||$('batchSaveDialog'))return;
 const ids=visibleSelectionIds(),items=state.items.filter(item=>ids.includes(item.id)),games=items.filter(item=>item.type==='game');
 if(!games.length){showToast('所选资源中没有游戏条目');return;}
 const backdrop=document.createElement('div');backdrop.id='batchSaveDialog';backdrop.className='app-dialog-backdrop';
 backdrop.innerHTML='<section class="app-dialog batch-save-dialog"><div class="app-dialog-head"><strong>批量存档操作</strong><button type="button" class="app-dialog-close" aria-label="关闭">×</button></div><p>对选中的 '+games.length+' 个游戏选择一项操作。获取路径只填入空白路径；备份只使用已设置的位置，并在配置 WebDAV 时自动上传。</p><div class="app-dialog-actions"><button type="button" class="secondary-button app-dialog-cancel">取消</button><button type="button" class="secondary-button" data-save-action="detect">获取路径</button><button type="button" class="add-button" data-save-action="backup">备份</button></div></section>';
 document.body.appendChild(backdrop);const close=()=>appModalStack.remove(backdrop);appModalStack.open(backdrop,close);backdrop.querySelector('.app-dialog-close').onclick=close;backdrop.querySelector('.app-dialog-cancel').onclick=close;backdrop.onclick=event=>{if(event.target===backdrop)close();};
 backdrop.querySelectorAll('[data-save-action]').forEach(button=>button.onclick=()=>{const mode=button.dataset.saveAction;close();void runBatchSaveOperation(games.map(item=>item.id),mode);});
}
async function runBatchSaveOperation(ids,mode){
 if(librarySelection.saveJob||librarySelection.mutation)return;
 const job={cancelled:false,mode};librarySelection.saveJob=job;librarySelection.mutation=true;let success=0,skipped=0,failed=0,pendingUpload=0;
 const items=structuredClone(state.items.filter(item=>ids.includes(item.id)&&item.type==='game'));
 $('batchProgress').classList.remove('hidden');$('batchProgress').classList.add('is-saving');renderLibrarySelection();
 try{
  for(let index=0;index<items.length;index++){
   if(job.cancelled)break;const original=items[index];
   $('batchProgressText').textContent=(mode==='detect'?'获取路径 ':'备份存档 ')+(index+1)+' / '+items.length+' · '+original.name;
   try{
    const live=state.items.find(item=>item.id===original.id);if(!live){skipped++;continue;}
    if(mode==='detect'){
     if((live.savePaths||[]).some(Boolean)){skipped++;continue;}
     const result=await native.detectSavePaths(live);if(!result?.ok){skipped++;continue;}
     if(result.status==='manual-preserved'||!result.paths?.length){skipped++;continue;}
     const saved=await native.persistSavePaths(live.id,result.paths);if(!saved?.ok)throw Error(saved?.message||'存档路径无法保存');
     state={...state,items:state.items.map(item=>item.id===live.id?saved.item:item)};success++;renderLibrary();
    }else{
     const paths=(live.savePaths||[]).filter(Boolean);if(!paths.length){skipped++;continue;}
     const result=await native.backupSaves(live.id,paths,{gameName:live.name});if(!result?.ok)throw Error(result?.message||'本地存档备份失败');
     const updated={...live,backupCount:(Number(live.backupCount)||0)+1,lastBackupAt:result.createdAt};state=await native.saveLibrary({...state,items:state.items.map(item=>item.id===live.id?updated:item)});success++;renderLibrary();
     if(settings.webdavUrl&&result.snapshotId){$('batchProgressText').textContent='上传存档 '+(index+1)+' / '+items.length+' · '+original.name;const upload=await native.syncBackupSnapshot(live.id,result.snapshotId,settings,'immediate-backup');if(!upload?.ok)pendingUpload++;}
    }
   }catch(error){failed++;console.error('批量存档操作失败',original.name,error);}
  }
  if(mode==='detect')showToast((job.cancelled?'已停止：':'获取路径完成：')+'成功 '+success+' 个，跳过 '+skipped+' 个，失败 '+failed+' 个',failed?'error':'normal');
  else showToast((job.cancelled?'已停止：':'存档备份完成：')+'成功 '+success+' 个，缺少路径/跳过 '+skipped+' 个，失败 '+failed+' 个'+(pendingUpload?'，云同步待重试 '+pendingUpload+' 个':''),failed||pendingUpload?'error':'normal');
 }finally{
  librarySelection.saveJob=null;librarySelection.mutation=false;$('batchProgress').classList.add('hidden');$('batchProgress').classList.remove('is-saving');
  if(mode==='backup'){await refreshSnapshotIndex(false);if(snapshotCardMode())renderLibrary();if(editorId)await renderBackupList();}
  renderLibrarySelection();
 }
}
 let steamSyncTimer,steamSyncBusy=false,steamSyncRevision=0;
function scheduleSteamSync(){clearTimeout(steamSyncTimer);++steamSyncRevision;steamSyncTimer=setTimeout(()=>syncSteamHours(),1200);}
async function syncSteamHours(){
 const revision=steamSyncRevision,host=$('steamSyncStatus');if(steamSyncBusy||!host)return;
 if(document.body.classList.contains('is-disguised'))return;
 if(!await flushSettingsSave())return;steamSyncBusy=true;$('syncSteamHours').disabled=true;host.textContent='正在同步 Steam 游玩时长…';
 try{const result=await native.syncSteamPlaytime();if(revision!==steamSyncRevision)return;
  let updated=0,manual=0,matched=0;const items=state.items.map(item=>{
   if(item.type!=='game')return item;const appid=String(item.steamAppId||item.storeUrl?.match(/steampowered\.com\/app\/(\d+)/)?.[1]||'');if(!Object.hasOwn(result.hours,appid))return item;
   matched++;const hours=result.hours[appid],editable=item.playtime==null||item.playtime===''||item.playtimeSource==='Steam'&&Number(item.playtime)===Number(item.steamPlaytime);
   if(editable)updated++;else manual++;
   return {...item,steamPlaytime:hours,steamPlaytimeAt:result.syncedAt,...(editable?{playtime:hours,playtimeSource:'Steam'}:{})};
  });state=await native.saveLibrary({...state,items});renderLibrary();
  host.textContent=matched?'已同步 '+matched+' 个游戏，更新时长 '+updated+' 个'+(manual?'；'+manual+' 个手填时长保留':''):'Steam 数据已取得，但当前资源库没有匹配的 Steam AppID。请先补全条目的 AppID。';
 }catch(error){if(revision===steamSyncRevision)host.textContent=error.message;}
 finally{steamSyncBusy=false;$('syncSteamHours').disabled=false;if(revision!==steamSyncRevision)scheduleSteamSync();}
}
function installLibraryTools(){
 $('syncSteamHours').onclick=()=>{++steamSyncRevision;syncSteamHours();};
 for(const id of ['settingsSteamId','settingsSteamKey'])$(id).addEventListener('input',scheduleSteamSync);
 $('fieldPlaytime').addEventListener('input',()=>{editorMetadata.playtimeSource='手动';});
}
