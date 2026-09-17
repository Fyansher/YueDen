/* Per-library roots; scanning is read-only, writing requires an explicit import. */
let localImportSession=null;
async function saveLocalLibrary(next){const saved=await native.saveLibrary(next);if(settings.disguiseEnabled){disguiseOriginalState=saved;applyDisguise({enabled:true,profile:settings.disguiseProfile});}else state=saved;return saved;}
function localRoots(type){return settings.localResourceRoots?.[type]||(type==='game'?settings.localScanPaths||[]:[]);}
function decorateLocalCards(){
 const button=$('localResourcesBtn');if(button){button.classList.toggle('hidden',!['audio','game','movie','anime','manga','book'].includes(activeView)||document.body.classList.contains('is-disguised')||activeView==='audio'&&window.audioBrowser?.view==='playlists');button.textContent='▱ 导入'+(TYPE_NAMES[activeView]||'资源');}
 for(const card of all('#libraryGrid .resource-card')){
  const item=state.items.find(i=>i.id===card.dataset.id),cover=card.querySelector('.card-cover');if(!item||!cover)continue;cover.querySelectorAll('img').forEach(img=>img.draggable=false);
  if(document.body.classList.contains('is-disguised'))continue;
  cover.classList.add('launch-cover');cover.tabIndex=0;cover.setAttribute('role','button');cover.setAttribute('aria-label',(['game','software','unknown_application'].includes(item.type)?'启动':'播放 / 阅读')+' '+item.name);cover.title=(item.localPath||item.localFiles?.length||item.resourceUrl)?(['game','software','unknown_application'].includes(item.type)?'启动游戏':'打开播放器 / 阅读器'):'添加本地路径后打开';
  cover.addEventListener('keydown',event=>{if(event.target===cover&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();librarySelection.active?toggleLibrarySelection(item.id,event):openMedia(item.id);}});
  const hint=document.createElement('span');hint.className='cover-launch-hint';hint.textContent=['game','software','unknown_application'].includes(item.type)?'▶ 启动':'▶ 打开';cover.appendChild(hint);
  const count=LocalModel.members(item).length;if(item.type!=='game'&&count>1){card.classList.add('multiple-resource');const badge=document.createElement('span');badge.className='local-count';badge.textContent='▱ '+count;badge.title='包含 '+count+' 个本地文件';cover.appendChild(badge);}
 }
}
function installLocalImport(){const button=document.createElement('button');button.id='localResourcesBtn';button.className='secondary-button hidden';button.type='button';button.textContent='导入资源';$('filterToggle').before(button);button.onclick=()=>activeView==='audio'?window.audioPlayer?.importDialog():openLocalImport(activeView);}
function scanChoices(type){return settings.localScanChoices?.[type]||{};}
function rememberScanChoices(job){
 return queueSettingsSave({localScanChoices:{...settings.localScanChoices,[job.type]:{uncheckedRoots:[...job.excluded],uncheckedRows:[...job.uncheckedRows].slice(-2000)}}});
}
function closeLocalImport(){
 const job=localImportSession;if(job){job.metadataQueue?.close();job.closed=true;native.cancelLocal?.();job.unlisten?.();if(metadataCandidatePicker?.job===job)finishImportCandidate(null);}
 localImportSession=null;appModalStack.remove($('localImportBackdrop'));renderLibrary();
}
async function openLocalImport(type,droppedPaths=[]){
 if(localImportSession||!['game','movie','anime','manga','book'].includes(type))return;
 const choices=scanChoices(type),job={type,roots:[...localRoots(type)],excluded:new Set((choices.uncheckedRoots||[]).map(LocalModel.pathKey)),uncheckedRows:new Set(choices.uncheckedRows||[]),rows:[],online:settings.scanOnline!==false,liveMetadata:settings.scanLiveMetadata!==false,includeAttachments:false,closed:false,busy:false,ignoreAll:false};localImportSession=job;
 const backdrop=createImportDialog({id:'localImportBackdrop',title:'导入'+(TYPE_NAMES[type]||'资源'),description:type==='game'?'选择游戏集合目录，每个直接子文件夹生成一项；内部程序为备选入口。':'勾选目录后检查文件；确认导入才写入资源库。',body:"<div class=\"local-root-tools\"><button type=\"button\" class=\"secondary-button\" id=\"localAddRoot\">＋ 添加文件夹</button><button type=\"button\" class=\"secondary-button\" id=\"localAddFiles\">＋ 添加文件</button><button type=\"button\" class=\"add-button\" id=\"localScan\">检查文件</button></div><div id=\"localRootList\"></div><p id=\"localScanStatus\" role=\"status\"></p><div id=\"localScanWarnings\"></div><div id=\"localImportRows\"></div>",closeId:'localImportClose',summaryId:'localImportSummary',stopId:'localImportStop',commitId:'localCommit'});
 if(type!=='game'){const group=document.createElement('button');group.className='secondary-button';group.textContent='组合勾选项';group.onclick=()=>importGroupDialog(job.rows,(chosen,name)=>{const head=chosen[0],files=LocalModel.mergeFiles([],chosen.flatMap(r=>r.localFiles));job.rows=job.rows.filter(r=>!chosen.includes(r)||r===head);head.name=name;head.localFiles=files;head.metadataInvalidated=true;delete head.metadataBundle;delete head.resolvedMetadata;delete head.metadataPrepared;renderLocalRows(job);});$('localScan').after(group);}$('localImportClose').onclick=closeLocalImport;$('localImportStop').onclick=closeLocalImport;backdrop.oncontextmenu=e=>{if(e.target===backdrop){e.preventDefault();closeLocalImport();}};

 const showRoots=()=>{
  if(job.closed)return;$('localRootList').replaceChildren();
  for(const root of job.roots){
   const key=LocalModel.pathKey(root),row=document.createElement('div');row.className='local-root';
   const check=document.createElement('input');check.type='checkbox';check.checked=!job.excluded.has(key);check.disabled=job.busy;check.setAttribute('aria-label','扫描 '+root);
   check.onchange=()=>{check.checked?job.excluded.delete(key):job.excluded.add(key);rememberScanChoices(job);};
   const label=document.createElement('span');label.textContent=root;label.title=root;
   const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='移除';remove.disabled=job.busy;
   remove.onclick=async()=>{job.roots=job.roots.filter(v=>v!==root);job.excluded.delete(key);await queueSettingsSave({localResourceRoots:{...settings.localResourceRoots,[type]:job.roots}});await rememberScanChoices(job);showRoots();};
   row.append(check,label,remove);$('localRootList').appendChild(row);
  }
  if(!job.roots.length)$('localRootList').textContent='还没有导入目录。可添加多个文件夹。';
 };
 $('localAddRoot').onclick=async()=>{try{
  const paths=await native.pickImportRoots();if(job.closed)return;
  const known=new Set(job.roots.map(LocalModel.pathKey));for(const entry of paths){const key=LocalModel.pathKey(entry);if(!known.has(key)){job.roots.push(entry);known.add(key);job.excluded.delete(key);}}
  await queueSettingsSave({localResourceRoots:{...settings.localResourceRoots,[type]:job.roots}});await rememberScanChoices(job);showRoots();
 }catch(e){showToast(e.message,'error');}};
 installScanOptions(job);
 importMetadataControls(job,$('localRootList'),{query:row=>native.localMetadata('preview-'+row.id,row.type,row.name),apply:(row,bundle)=>{row.metadataBundle=bundle;row.metadataChecked=true;row.metadataInvalidated=false;},render:()=>{if(!job.closed)renderLocalRows(job);}});
 job.unlisten=native.onLocalProgress?.(info=>{if(!job.closed){if(info.rows){job.rows=ImportMetadataQueue.reconcile(job.rows,info.rows.map(row=>localPreviewRow(row,job)));renderLocalRows(job,true);}else if(info.row){const old=job.rows.find(r=>r.id===info.row.id);if(old)ImportMetadataQueue.reconcile([old],[localPreviewRow(info.row,job)]);else job.rows.push(localPreviewRow(info.row,job));renderLocalRows(job,true);}if((info.rows||info.row)&&!job.metadataQueue.paused)void job.metadataQueue.resume();$('localScanStatus').textContent=(info.phase||'扫描')+' · 已检查 '+info.checked+' 个文件，识别到 '+info.found+' 个候选资源';}});
 const busy=value=>{
  if(job.closed)return;job.busy=value;
  for(const row of job.rows)document.querySelector('[data-local-row="'+row.id+'"]')?.querySelectorAll('input,select,button').forEach(el=>el.disabled=value||row.imported);
  document.querySelectorAll('#localImportRows>.local-root-tools button').forEach(el=>el.disabled=value);
  $('scanOnline').disabled=value;$('scanLiveMetadata').disabled=value;$('localAddRoot').disabled=value;$('localAddFiles').disabled=value;$('localScan').disabled=value;$('localCommit').disabled=value||!job.rows.some(r=>r.selected&&!r.imported);showRoots();
 };
 $('localScan').onclick=async()=>{
  const roots=job.roots.filter(v=>!job.excluded.has(LocalModel.pathKey(v)));if(!roots.length){showToast('请先勾选要扫描的文件夹');return;}
  busy(true);$('localCommit').textContent='导入所选资源';$('localScanStatus').textContent='正在检查目录，不会执行程序或修改文件…';
  try{
   await job.metadataQueue.pause();if(job.closed)return;job.rows=[];void job.metadataQueue.resume();renderLocalRows(job);const result=await native.previewLocal(roots,type,{online:false,liveMetadata:false});if(job.closed)return;
   job.scanResult=result;job.rows=ImportMetadataQueue.reconcile(job.rows,ScanManualGroups.partition(result.items,state.items).filter((row,i,arr)=>arr.findIndex(r=>r.id===row.id)===i).map(row=>localPreviewRow(row,job)));$('localScanWarnings').textContent=(result.warnings||[]).join('\n');
   const hiddenCount=(result.candidates||[]).filter(r=>!result.items.some(i=>i.id===r.id)).length;const ignored=result.ignored||{},notes=[hiddenCount?'其他类型或证据不足 '+hiddenCount+' 项':'',ignored.wallpaperDirectories?'壁纸目录 '+ignored.wallpaperDirectories:'',ignored.auxiliaryFiles?'说明文档 '+ignored.auxiliaryFiles:'',ignored.nonPageImages?'非书页图片 '+ignored.nonPageImages:''].filter(Boolean);
   $('localScanStatus').textContent='检查完成：'+result.checked+' 个文件，分组为 '+job.rows.length+' 个资源'+(notes.length?' · 已跳过 '+notes.join('、'):'');renderLocalRows(job);renderScanSummary(job,result);if(!job.metadataQueue.paused)void job.metadataQueue.resume();
  }catch(error){if(!job.closed)$('localScanStatus').textContent=error.message;}finally{busy(false);}
 };
 $('localAddFiles').onclick=async()=>{busy(true);try{const result=await native.pickImportFiles(type);if(job.closed||!result)return;const added=result.items.filter(source=>!job.rows.some(r=>r.id===source.id&&r.imported)).map(source=>{const row=localPreviewRow(source,job);if(row.classification?.type==='unknown_application'&&type==='game'){row.type='game';row.confirmed=true;for(const k of ['type','name','localPath'])rememberRowOverride(row,k,row[k]);}row.selected=!row.existingId;row.explicitFile=true;return row;});for(const row of added){const index=job.rows.findIndex(old=>old.id===row.id);if(index<0)job.rows.push(row);else job.rows[index]=row;}renderLocalRows(job);busy(false);void job.metadataQueue.resume();if(added.some(r=>r.type!==type)){showToast('所选文件含其他类型，请核对资源库后导入');return;}showToast('已添加 '+added.length+' 个候选，请点击“导入所选资源”');}catch(e){if(!job.closed)showToast(e.message,'error');}finally{busy(false);}};
 $('localCommit').onclick=()=>commitLocalRows(job,busy);showRoots();
 if(droppedPaths.length){busy(true);try{const result=await native.previewDropped(droppedPaths,type);if(job.closed)return;job.rows=result.items.map(row=>localPreviewRow(row,job));renderLocalRows(job);$('localScanWarnings').textContent=(result.warnings||[]).join('；');if(!job.metadataQueue.paused)void job.metadataQueue.resume();$('localScanStatus').textContent=job.rows.length?'拖入检查完成，请核对并确认导入':'未找到当前资源库支持的文件';}catch(error){if(!job.closed)$('localScanStatus').textContent=error.message;}finally{busy(false);}}
}
function localPreviewRow(row,job=localImportSession){
 row={...row,detectedType:row.detectedType||row.type,type:row.scanInfo?.userOverrides?.type||job?.type||row.type};const matched=state.items.filter(item=>LocalModel.same(item,row)),existing=matched[0];const possible=existing?null:state.items.find(item=>ResourceIdentity.compare(item,row).status==='review');
 const changed=existing&&row.localFiles.some(file=>LocalModel.members(existing).some(old=>LocalModel.pathKey(old.path)===LocalModel.pathKey(file.path)&&old.size>0&&(old.size!==file.size||Math.abs((old.mtimeMs||0)-file.mtimeMs)>1000)));
 return {...row,confirmed:true,selected:existing||possible||row.attachmentOf||row.selected===false?false:!job?.uncheckedRows?.has(row.id),existingId:existing?.id||possible?.id,matchedIds:matched.map(i=>i.id),action:changed||possible||matched.length>1?'':existing?'merge':'new',conflict:Boolean(changed||possible||matched.length>1),message:matched.length>1?'同一组启动入口匹配 '+matched.length+' 个已有条目，请选择是否整理；保留原评价与笔记':changed?'本地文件大小或修改时间变化，请选择保留方式':existing?'补充来源：匹配已有条目，将补全本地路径 / 缺失数据':possible?'疑似重复：请确认合并、版本或保持独立':'新资源'};
}
function selectLocalRow(job,row,selected){
 row.selected=selected;if(selected&&row.classification?.type!=='unknown_application'){row.confirmed=true;for(const k of ['type','name','localPath'])rememberRowOverride(row,k,row[k]);}selected?job.uncheckedRows.delete(row.id):job.uncheckedRows.add(row.id);rememberScanChoices(job);if(selected)void job.metadataQueue.resume();
 $('localCommit').disabled=job.busy||!job.rows.some(r=>r.selected&&!r.imported);
}
function localRowMessage(job,row,message,phase){
 row.message=message;if(phase)row.phase=phase;if(job.closed)return;
 const el=document.querySelector('[data-local-row="'+row.id+'"]');if(!el)return;
 el.dataset.phase=row.phase||'ready';el.setAttribute('aria-busy',String(['queued','searching','choosing'].includes(row.phase)));
 const node=el.querySelector('.local-row-meta');if(node)node.textContent=message+' · '+row.localFiles.length+' 个文件';
}
function localImportProgress(job,done,total,finished=false){
 if(job.closed)return;let panel=$('localImportProgress');
 if(!panel){panel=document.createElement('div');panel.id='localImportProgress';panel.className='local-import-progress';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');panel.innerHTML='<span></span><progress></progress>';$('localImportBackdrop').querySelector('header').after(panel);}
 panel.classList.toggle('is-finished',finished);panel.querySelector('span').textContent=(finished?'✓ 导入完成':'正在导入并补全元数据')+' · '+done+' / '+total;
 const bar=panel.querySelector('progress');bar.max=total;bar.value=done;bar.setAttribute('aria-label','导入进度');
}
function renderLocalRows(job,incremental=false){
 if(job.closed)return;const priorIds=new Set([...document.querySelectorAll('[data-local-row]')].map(e=>e.dataset.localRow));const host=$('localImportRows'),expanded=host.querySelector('.local-existing')?.open||false,uncertainOpen=host.querySelector('.local-uncertain')?.open||false;const priorNodes=new Map([...host.querySelectorAll('[data-local-row]')].map(e=>[e.dataset.localRow,e]));const openEvidence=new Set([...host.querySelectorAll('.scan-evidence[open]')].map(el=>el.closest('[data-local-row]').dataset.localRow));if(!incremental)host.replaceChildren();
 const tools=document.createElement('div');tools.className='local-root-tools';
 for(const [label,value]of [['全选',true],['取消全选',false]]){
  const b=document.createElement('button');b.type='button';b.className='secondary-button';b.textContent=label;b.disabled=job.busy;
  b.onclick=()=>{for(const row of job.rows)if(!row.imported){row.selected=value;value?job.uncheckedRows.delete(row.id):job.uncheckedRows.add(row.id);}rememberScanChoices(job);host.querySelectorAll('.local-check').forEach(box=>{if(!box.disabled)box.checked=value;});$('localCommit').disabled=job.busy||!job.rows.some(r=>r.selected&&!r.imported);if(value)void job.metadataQueue.resume();};tools.appendChild(b);
 }if(incremental)host.querySelector(':scope>.local-root-tools')?.remove();host.appendChild(tools);host.prepend(tools);
 job.rowGroups??=new Map();const folded=row=>{if(!job.rowGroups.has(row.id))job.rowGroups.set(row.id,Boolean(row.existingId));return job.rowGroups.get(row.id)&&!row.importedThisSession;};
 const existing=incremental&&host.querySelector('.local-existing')||document.createElement('details');existing.className='local-existing';existing.open=expanded;if(!existing.querySelector('summary'))existing.innerHTML='<summary></summary>';existing.querySelector('summary').textContent='扫描时已存在的资源（'+job.rows.filter(folded).length+'）';if(existing.parentNode!==host)host.appendChild(existing);existing.hidden=!job.rows.some(folded);
 const uncertain=row=>row.classification?.type==='unknown_application'&&!row.confirmed&&!row.existingId;
 const review=incremental&&host.querySelector('.local-uncertain')||document.createElement('details');review.className='local-uncertain scan-skipped';review.open=uncertainOpen;if(!review.querySelector('summary'))review.innerHTML='<summary></summary>';review.querySelector('summary').textContent='用途未确定的程序（'+job.rows.filter(uncertain).length+'）· 不代表游戏，请展开核对';review.hidden=!job.rows.some(uncertain);if(review.parentNode!==host)host.appendChild(review);
 for(const row of job.rows){
  const signature=JSON.stringify([row,job.busy]),prior=priorNodes.get(row.id);if(incremental&&prior?.scanSignature===signature)continue;
  const el=document.createElement('article');el.className='local-import-row'+(row.imported?' is-imported':'')+(!priorIds.has(row.id)?' is-scan-arriving':'');el.dataset.localRow=row.id;el.scanSignature=signature;el.dataset.phase=row.phase||(row.resolvedMetadata?'metadata-ready':row.metadataBundle?'metadata-candidates':'ready');
  el.innerHTML='<div class="local-row-heading"><input type="checkbox" class="local-check" '+(row.selected?'checked':'')+' aria-label="选择导入"><input class="local-name" aria-label="资源名称" value="'+esc(row.name)+'"><select class="local-type" aria-label="导入到资源库">'+['game','movie','anime','manga','book'].map(t=>'<option value="'+t+'" '+(row.type===t?'selected':'')+'>'+esc(TYPE_NAMES[t])+'</option>').join('')+'</select></div><div class="local-row-meta">'+esc(row.typeMismatch?'检测类型与当前页面不同：请确认右侧目标资源库。 ':'')+esc(row.message)+(row.resolvedMetadata?' · ✓ 资料已就绪':row.metadataBundle?' · 已获取候选，导入时选择':'')+' · '+row.localFiles.length+' 个文件</div><details class="local-files"><summary>查看文件与分集</summary>'+row.localFiles.map(f=>'<div title="'+esc(f.path)+'">'+esc(f.name)+'<small>'+esc(f.path)+'</small></div>').join('')+'</details><div class="local-row-options"></div>';
  el.querySelector('.local-check').onchange=e=>selectLocalRow(job,row,e.target.checked);el.querySelector('.local-name').oninput=e=>{row.name=e.target.value;ImportSessionModel.invalidate(row);delete row.enrichmentState;rememberRowOverride(row,'name',row.name);};el.querySelector('.local-name').onchange=()=>job.refreshMetadata();el.querySelector('.local-type').onchange=e=>{row.type=e.target.value;ImportSessionModel.invalidate(row);row.typeMismatch=false;row.confirmed=true;for(const k of ['type','name','localPath'])rememberRowOverride(row,k,row[k]);renderLocalRows(job);};
  if(uncertain(row)){const opt=document.createElement('option');opt.value='';opt.textContent='用途待确认';opt.disabled=true;opt.selected=true;el.querySelector('.local-type').prepend(opt);}
  renderScanEvidence(el,row);if(openEvidence.has(row.id)){const evidence=el.querySelector('.scan-evidence');if(evidence)evidence.open=true;}
  if(row.existingId){
   const select=document.createElement('select');select.setAttribute('aria-label','同名资源处理');
   for(const [value,label]of [['','请选择处理方式'],['merge','补充到已有条目（保留手填内容）'],['version','作为同作品不同版本'],['replace','覆盖相同已有条目'],['keep','保留原条目，跳过本次导入'],['new','确认是不同作品，建立独立条目']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}
   select.value=row.action;select.onchange=e=>{row.action=e.target.value;};el.querySelector('.local-row-options').appendChild(select);
   if(row.matchedIds?.length>1){const option=document.createElement('option');option.value='consolidate';option.textContent='合并这些已有条目（保留冲突记录，可撤销）';select.appendChild(option);select.value=row.action;}
  }
  if(!['game','software','unknown_application'].includes(row.type)&&row.localFiles.length>1){
   const split=document.createElement('button');split.type='button';split.className='text-button';split.textContent='这些是不同作品，拆分';
   split.onclick=()=>{job.splitHistory??=new Map();const key=crypto.randomUUID(),original=structuredClone(row);job.splitHistory.set(key,original);job.rows.splice(job.rows.indexOf(row),1,...row.localFiles.map((file,i)=>{const part=localPreviewRow({...row,id:row.id+'-'+i,splitKey:key,name:LocalModel.stem(file.name),localFiles:[file],localPath:file.path},job);delete part.resolvedMetadata;delete part.metadataBundle;delete part.metadataPrepared;return part;}));renderLocalRows(job);};el.querySelector('.local-row-options').appendChild(split);
  }
  if(row.splitKey&&job.splitHistory?.has(row.splitKey)){const restore=document.createElement('button');restore.type='button';restore.className='secondary-button';restore.textContent='↶ 撤销拆分，恢复合并';restore.onclick=()=>{const siblings=job.rows.filter(r=>r.splitKey===row.splitKey);if(siblings.some(r=>r.imported)){showToast('部分条目已导入，请使用资源整理合并','error');return;}const at=job.rows.findIndex(r=>r.splitKey===row.splitKey),original=job.splitHistory.get(row.splitKey);job.rows=job.rows.filter(r=>r.splitKey!==row.splitKey);const files=siblings.flatMap(r=>r.localFiles);job.rows.splice(at,0,{...original,localFiles:files,localPath:files.some(f=>f.path===original.localPath)?original.localPath:files[0]?.path});job.splitHistory.delete(row.splitKey);renderLocalRows(job);};const separate=document.createElement('button');separate.type='button';separate.className='secondary-button';separate.textContent='彻底拆分为独立资源';separate.onclick=()=>{delete row.splitKey;row.action='new';renderLocalRows(job);};el.querySelector('.local-row-options').append(restore,separate);}
  if(row.metadataError||row.enrichmentState==='loading'){const note=document.createElement('small');note.className='import-metadata-result';note.textContent=row.metadataError||'正在获取元数据…';el.append(note);}else if(row.metadataBundle){const note=document.createElement('small');note.className='import-metadata-result';note.textContent=(row.metadataBundle.sources||[]).map(s=>s.label+'：'+(s.message||s.statusLabel||(s.items?.length||0)+' 条结果')).join('；');el.append(note);}
  if(row.warnings?.length){const p=document.createElement('small');p.textContent=row.warnings.join('；');el.appendChild(p);}
  if(job.busy||row.imported)el.querySelectorAll('input,select,button').forEach(control=>control.disabled=true);const target=folded(row)?existing:uncertain(row)?review:host;if(incremental&&prior?.parentElement===target){if(prior.querySelector('.local-files')?.open)el.querySelector('.local-files').open=true;prior.replaceWith(el);}else{prior?.remove();target.appendChild(el);}
 }
 if(incremental)for(const [id,node]of priorNodes)if(!job.rows.some(row=>row.id===id))node.remove();
 $('localImportSummary').textContent=job.rows.length+' 个资源候选';$('localCommit').disabled=job.busy||!job.rows.some(r=>r.selected&&!r.imported);
}
function completeLocalMetadata(current){
 const common=current.metadataSource&&(current.cover||current.coverPortrait)&&current.description&&current.developer;
 return Boolean(common&&(!['book','manga'].includes(current.type)||current.isbn&&current.pages));
}
function prefetchLocalMetadata(job,rows){
 const finish=[],promises=rows.map((_,i)=>new Promise(resolve=>finish[i]=resolve));let cursor=0;
 async function worker(){
  while(cursor<rows.length){
   const i=cursor++,row=rows[i],current=state.items.find(v=>v.id===row.itemId);
   if(job.closed||!current){finish[i]({skipped:true});continue;}
   if(row.metadataApplied){finish[i]({prepared:true});continue;}
   if(row.resolvedMetadata){finish[i]({bundle:{integrated:[row.resolvedMetadata],sources:[]}});continue;}
   if(row.metadataBundle){finish[i]({bundle:row.metadataBundle});continue;}
   if((ImportSessionModel.state(row)==='checked'||job.scanResult?.metadataPhaseCompleted)&&!row.metadataInvalidated){finish[i]({error:Error('扫描阶段未取得可用资料，已保留本地条目；需要时可点击刷新')});continue;}
   if(job.metadataPaused||!(job.online||job.liveMetadata)||!['game','movie','anime','manga','book'].includes(row.type)){finish[i]({offline:true});continue;}

   if(!row.metadataInvalidated&&completeLocalMetadata(current)){finish[i]({complete:true});continue;}
   localRowMessage(job,row,'正在联网识别 '+row.name+'…','searching');
   try{const bundle=await ImportSessionModel.once(row,()=>native.localMetadata('import-'+row.id,row.type,!row.metadataInvalidated&&row.identifiers?.steam?'appid:'+row.identifiers.steam:row.name));finish[i]({bundle});}
   catch(error){finish[i]({error});}
  }
 }
 // Two resources at a time. Metadata writes and candidate dialogs remain serialized.
 void worker();void worker();return promises;
}
async function commitLocalRows(job,busy,selection=job.rows){
 if(job.busy||job.closed)return;const rows=selection.filter(r=>r.selected&&!r.imported&&r.action!=='keep');
 if(rows.some(r=>!r.name.trim()||!r.action)){showToast('请填写名称并确认有差异资源的处理方式','error');return;}
 
 if(!rows.length){showToast('没有选中需要导入的资源');return;}
 job.committing=true;busy(true);try{await job.metadataQueue?.pause();}catch(error){job.committing=false;busy(false);showToast('无法停止元数据请求：'+error.message,'error');return;}if(job.closed)return;job.metadataStopped=true;job.ignoreAll=false;localImportProgress(job,0,rows.length);rows.forEach(row=>localRowMessage(job,row,'正在导入名称与本地路径…','queued'));let next=structuredClone(state),created=0,merged=0,automatic=0,chosen=0,ignored=0,missing=0;
 for(const row of rows){
  let current=row.action==='new'&&row.existingId?null:next.items.find(i=>i.id===row.existingId&&i.type===row.type&&(['merge','version','replace'].includes(row.action)||LocalModel.same(i,row)))||next.items.find(i=>LocalModel.same(i,row));
  const incoming=structuredClone(row.localFiles),embedded={developer:row.metadata?.author||row.metadata?.companyName||'',publisher:row.metadata?.publisher||'',isbn:row.metadata?.isbn||'',releaseDate:row.metadata?.releaseDate||'',...(row.type==='manga'&&row.metadata?.pages?{pages:row.metadata.pages}:{}),...(row.type==='game'&&row.identifiers?.steam?{steamAppId:row.identifiers.steam}:{})};
  if(row.reviewRequired&&row.confirmed)for(const k of ['name','type','localPath'])rememberRowOverride(row,k,row[k]);
  if(current){current.identityDecisions=[...(current.identityDecisions||[]),{key:ResourceIdentity.key(row),action:'merge'}];if(row.action==='version')current.installations=[...(current.installations||[]),{id:crypto.randomUUID(),localPath:row.localPath,files:incoming,name:row.name}];if(row.scanInfo)current.scanInfo=structuredClone(row.scanInfo);const files=row.action==='replace'?incoming:LocalModel.mergeFiles(LocalModel.members(current),incoming);Object.assign(current,LocalModel.fillMissing(current,embedded));current.localFiles=files;if(!current.localPath||row.action==='replace')current.localPath=row.localPath||files[0]?.path||'';row.itemId=current.id;merged++;}
  else{const id='local-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);current={id,...embedded,type:row.type,name:row.name.trim(),scanInfo:row.scanInfo?structuredClone(row.scanInfo):null,developer:row.metadata?.author||row.metadata?.companyName||'',identifiers:row.identifiers||{},status:StatusModel.normalize('',row.type),rating:0,genres:[],categories:[],localFiles:incoming,localPath:row.localPath||incoming[0]?.path||'',createdAt:new Date().toISOString(),sortOrder:next.items.length};if(row.action==='new'&&row.existingId){const prior=next.items.find(i=>i.id===row.existingId);if(prior){prior.identityDecisions=[...(prior.identityDecisions||[]),{key:ResourceIdentity.key(current),action:'separate'}];current.identityDecisions=[{key:ResourceIdentity.key(prior),action:'separate'}];}}next.items.push(current);row.itemId=id;row.newItem=true;created++;}
  if(row.resolvedMetadata&&row.metadataPrepared){const at=next.items.findIndex(v=>v.id===row.itemId);next.items[at]=LocalModel.fillMissing(next.items[at],row.resolvedMetadata);row.metadataApplied=true;}
  if(row.action==='consolidate')for(const id of row.matchedIds||[]){if(id!==row.itemId&&next.items.some(i=>i.id===id&&i.type===row.type)){next=LibraryRelations.merge(next,row.itemId,id);merged++;}}
 }
 try{
  await saveLocalLibrary(next);rows.forEach(r=>{r.imported=true;r.importedThisSession=true;r.selected=false;r.message=r.metadataApplied?'已导入已获取的资料':'已导入名称与路径，正在处理候选';});renderLocalRows(job);renderLibrary();if(job.closed)return;
  $('localScanStatus').textContent='已新增 '+created+' 个，合并 '+merged+' 个。正在应用扫描结果；不确定的候选将逐项弹出。';
  const pending=prefetchLocalMetadata(job,rows);
  for(let i=0;i<rows.length;i++){
   const row=rows[i],result=await pending[i];if(job.closed)break;
   localImportProgress(job,i,rows.length);
   if(result.prepared){automatic++;localRowMessage(job,row,'✓ 已导入扫描阶段准备好的资料，无需再次获取','success');localImportProgress(job,i+1,rows.length);continue;}
   if(result.offline){localRowMessage(job,row,'✓ 已导入 · 保留本地证据，未发送联网查询','success');localImportProgress(job,i+1,rows.length);continue;}
   if(result.complete){localRowMessage(job,row,'✓ 已导入 · 已有完整元数据，本地路径已补全','success');localImportProgress(job,i+1,rows.length);continue;}
   if(result.skipped)continue;
   if(result.error){missing++;localRowMessage(job,row,'已导入 · 联网未完成，已保留名称与路径：'+result.error.message,'partial');localImportProgress(job,i+1,rows.length);continue;}
   const bundle=result.bundle||{},first=row.resolvedMetadata||LocalModel.automaticCandidate(row.name,row.type,bundle);
   try{
    if(first){await applyLocalMetadata(job,row,first);automatic++;localRowMessage(job,row,'✓ 已导入并自动补全元数据 · '+(first.metadataSource||'整合源'),'success');}
    else if((bundle.integrated||[]).length||(bundle.sources||[]).some(s=>s.items?.length)){
     localRowMessage(job,row,'匹配待确认：请在搜索结果窗口选择，或忽略保留名称与路径','choosing');
     const selected=job.ignoreAll?null:await pickImportMetadata(job,row,bundle);if(job.closed)break;
     if(selected){await applyLocalMetadata(job,row,selected);chosen++;localRowMessage(job,row,'✓ 已导入并使用所选元数据 · '+(selected.metadataSource||'整合源'),'success');}
     else{ignored++;localRowMessage(job,row,'已导入 · 已忽略元数据选择，保留名称与路径','skipped');}
    }else{missing++;localRowMessage(job,row,'已导入 · 未找到元数据，已保留名称与路径，可稍后刷新','partial');}
   }catch(error){missing++;localRowMessage(job,row,'已导入 · 元数据填入未完成：'+error.message,'partial');}
   localImportProgress(job,i+1,rows.length);
  }
  if(!job.closed){$('localImportSummary').textContent='导入完成 · 新增 '+created+' / 合并 '+merged;$('localCommit').textContent='导入已完成';$('localScanStatus').textContent='自动匹配 '+automatic+' · 手动选择 '+chosen+' · 已忽略 '+ignored+' · 未取得 '+missing+'。本次结果保留展开；重复导入不会增加相同条目。';}
  if(!job.closed){localImportProgress(job,rows.length,rows.length,true);showToast('导入完成：新增 '+created+'，合并 '+merged+'；元数据补全 '+(automatic+chosen)+(missing?'，'+missing+' 项待补全':'')+(ignored?'，忽略 '+ignored+' 项':''));}
 }catch(error){if(!job.closed){rows.filter(row=>!row.imported).forEach(row=>localRowMessage(job,row,'导入失败：'+error.message,'error'));$('localImportProgress')?.remove();}showToast('导入失败：'+error.message,'error');}finally{job.committing=false;busy(false);}
}
async function applyLocalMetadata(job,row,candidate){
 const request=row.metadataRequest=(row.metadataRequest||0)+1;const prepared=job.metadataStopped||row.metadataPrepared&&candidate===row.resolvedMetadata?candidate:await native.prepareLocalCandidate(candidate);if(job.closed||request!==row.metadataRequest||!prepared)return;
 const live=state.items.find(i=>i.id===row.itemId);if(!live)return;const incoming={...prepared,type:row.type,localFiles:live.localFiles},duplicate=state.items.find(i=>i.id!==live.id&&LocalModel.same(i,incoming));
 let updated=LocalModel.fillMissing(live,prepared);if(row.newItem&&live.name===row.name&&!live.scanInfo?.userOverrides?.name){updated.name=prepared.name||live.name;if(updated.scanInfo)updated.scanInfo={...updated.scanInfo,automatic:{...updated.scanInfo.automatic,name:updated.name}};}
 if(duplicate&&!(row.action==='new'&&row.existingId)){await saveLocalLibrary(LibraryRelations.merge({...state,items:state.items.map(i=>i.id===live.id?updated:i)},duplicate.id,live.id));row.itemId=duplicate.id;}
 else await saveLocalLibrary({...state,items:state.items.map(i=>i.id===live.id?updated:i)});
 renderLibrary();
}
