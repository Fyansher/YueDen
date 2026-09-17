/* Source tabs contain original provider records; integrated results are separate. */
let metadataResultGroups = [], activeMetadataSource = 'integrated';
let metadataCandidatePicker=null;
function finishImportCandidate(choice=null){
 const picker=metadataCandidatePicker;if(!picker)return;metadataCandidatePicker=null;
 $('importCandidateActions')?.remove();$('candidateBackdrop').classList.add('hidden');$('candidateBackdrop').classList.remove('import-candidate-backdrop');appModalStack.release($('candidateBackdrop'));
 $('candidateBackdrop').querySelector('h2').textContent='请选择一个具体条目';
 candidateCoverObserver?.disconnect();picker.resolve(choice);
}
function dismissCandidateResults(){if(metadataCandidatePicker)finishImportCandidate(null);else cancelMetadataLookup();}
function chooseMetadataCandidate(candidate){if(window.audioPanels?.hasLookup?.())return window.audioPanels.chooseCandidate(candidate);if(metadataCandidatePicker)finishImportCandidate(candidate);else applyCandidate(candidate);}
function pickImportMetadata(job,row,bundle){
 cancelMetadataLookup();if(job.closed||job.ignoreAll)return Promise.resolve(null);
 return new Promise(resolve=>{
  metadataCandidatePicker={job,row,resolve};const backdrop=$('candidateBackdrop');backdrop.classList.add('import-candidate-backdrop');
  backdrop.querySelector('h2').textContent='为“'+row.name+'”选择元数据';
  const actions=document.createElement('footer');actions.id='importCandidateActions';actions.className='import-candidate-actions';
  const hint=document.createElement('span');hint.textContent='当前名称和路径已保存；不确定时可以忽略。';
  const skip=document.createElement('button');skip.type='button';skip.className='secondary-button';skip.textContent='忽略此项';skip.onclick=()=>finishImportCandidate(null);
  const skipAll=document.createElement('button');skipAll.type='button';skipAll.className='secondary-button';skipAll.textContent='忽略全部';skipAll.onclick=()=>{job.ignoreAll=true;finishImportCandidate(null);};
  actions.append(hint,skip,skipAll);backdrop.querySelector('section').appendChild(actions);showCandidates({...bundle,type:row.type});
  if(row.type==='game'&&metadataResultGroups.some(g=>g.id==='steam'&&g.items.length)){activeMetadataSource='steam';renderMetadataSource();}
  $('candidateClose').focus({preventScroll:true});
 });
}
let candidateCoverObserver;
const candidateCoverReferences=new Map();
const candidateCoverUrls=candidate=>[...new Set([candidate.coverPortrait,candidate.cover,candidate.coverLandscape].filter(Boolean))];
function loadCandidateCover(image,candidate) {
  const urls=candidateCoverUrls(candidate),key=JSON.stringify(urls);image.dataset.coverKey=key;
  const cached=candidateCoverReferences.get(key);if(cached){image.src=cached;return;}
  if(image.dataset.coverStarted)return;image.dataset.coverStarted='1';image.classList.add('is-loading');
  let cursor=0;const done=()=>{image.classList.remove('is-loading');if(image.naturalWidth){candidateCoverReferences.set(key,image.src);while(candidateCoverReferences.size>800)candidateCoverReferences.delete(candidateCoverReferences.keys().next().value);}};
  const fallback=()=>{if(cursor<urls.length){image.src=urls[cursor++];}else{image.classList.remove('is-loading');image.onerror=null;image.src=fallbackCover(candidate.name);}};
  image.onload=done;image.onerror=fallback;
  const start=async()=>{
    if(!image.isConnected||image.dataset.coverRequested)return;image.dataset.coverRequested='1';
    if(native.previewMetadataCover&&urls.some(url=>/^https:/.test(url))){
      const epoch=metadataSelectionEpoch;
      try{const ref=await native.previewMetadataCover(urls,metadataSession?.id||'preview');if(epoch!==metadataSelectionEpoch)return;if(ref){image.src=ref;return;}}catch{}
    }fallback();
  };
  if(candidateCoverObserver)candidateCoverObserver.observe(image);else start();image._loadCover=start;
}
function showCandidates(payload,{preserve=false}={}) { document.getElementById('completeMissingLyrics')?.closest('label').classList.toggle('hidden',payload.type!=='audio');
  const scroll=preserve?$('candidateList').scrollTop:0;const focusId=document.activeElement?.dataset?.sourceId;
  const items = Array.isArray(payload) ? payload : payload.integrated || [];
  const publication=['book','manga'].includes(payload.type||$('fieldType').value);
  metadataResultGroups = [{ id:'integrated', label:'整合源', state:payload.loading?'loading':items.length?'ok':'empty', items, message:publication?'只对已确认的同一作品互补；ISBN、页数、译者、出版社与出版日期按具体版本匹配。':'只对已确认的同一作品互补，保留评分的真实来源。' }, ...(Array.isArray(payload) ? [] : payload.sources || [])];
  metadataResultGroups = metadataResultGroups.map(group=>({...group,items:(group.items||[]).map(MetadataText.candidate)}));
  if(!preserve||!metadataResultGroups.some(group=>group.id===activeMetadataSource))activeMetadataSource = 'integrated';
  let tabs = $('candidateSourceTabs');
  if (!tabs) { tabs=document.createElement('div'); tabs.id='candidateSourceTabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','元数据来源'); $('candidateList').before(tabs); }
  tabs.replaceChildren();
  for (const group of metadataResultGroups) {
    const button=document.createElement('button'); button.type='button';button.dataset.sourceId=group.id;button.id='source-tab-'+group.id;button.setAttribute('role','tab');button.setAttribute('aria-controls','candidateList');
    const suffix=group.state==='loading'?'获取中 '+group.items.length:group.state==='unconfigured'?'需密钥':group.state==='unavailable'?(group.statusLabel||'请求失败'):({'disabled':'未启用','skipped':'未执行','empty':'0 条结果','timeout':'超时','http-error':'HTTP 错误','parse-error':'解析错误','rate-limited':'被限流','upstream-failure':'上游故障'}[group.state]||String(group.items.length));
    button.textContent=group.label+' · '+suffix;
    button.onclick=()=>{activeMetadataSource=group.id;renderMetadataSource();};tabs.appendChild(button);
  }
  tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const buttons=[...tabs.children],current=buttons.indexOf(document.activeElement);const next=buttons[(current+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];next.click();next.focus();};
  $('candidateBackdrop').classList.remove('hidden');appModalStack.open($('candidateBackdrop'),()=>$('candidateClose').click());renderMetadataSource();$('candidateList').scrollTop=scroll;
  if(focusId)tabs.querySelector('[data-source-id="'+focusId+'"]')?.focus({preventScroll:true});
}
function renderMetadataSource() {
  const group=metadataResultGroups.find(group=>group.id===activeMetadataSource);if(!group)return;
  all('#candidateSourceTabs button').forEach(button=>{const selected=button.dataset.sourceId===group.id;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
  const hint=document.querySelector('.candidate-hint');hint.textContent=group.label+' · '+group.items.length+' 个候选'+(group.state==='loading'?'，结果会陆续补充，可随时选择或关闭。':'')+(group.message?'。'+group.message:'。选择具体条目后填入编辑器。');
  const host=$('candidateList');host.scrollTop=0;host.setAttribute('aria-busy',String(group.state==='loading'));host.setAttribute('role','tabpanel');host.setAttribute('aria-labelledby','source-tab-'+group.id);
  const previousImages=new Map([...host.querySelectorAll('.candidate-cover[data-cover-key]')].map(image=>[image.dataset.coverKey,image]));
  candidateCoverObserver?.disconnect();
  candidateCoverObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){candidateCoverObserver.unobserve(entry.target);entry.target._loadCover?.();}},{root:host,rootMargin:'180px'}):null;
  candidateResults=group.items;
  host.innerHTML=group.items.length?group.items.map((candidate,index)=>{
    const type=candidate.mediaType||metadataCandidatePicker?.row.type||$('fieldType').value,publication=['book','manga'].includes(type);
    const details=[candidate.storeRegion,candidate.storeSection,candidate.releaseDate,candidate.developer?(publication?'作者':type==='game'?'开发者':type==='audio'?'艺术家':'导演 / 创作')+'：'+candidate.developer:'',candidate.publisher?(publication?'出版社':type==='game'?'发行商':'制作 / 发行')+'：'+candidate.publisher:'',candidate.isbn?'ISBN '+candidate.isbn:'',candidate.pages?candidate.pages+' 页':'',candidate.translator?'译者：'+candidate.translator:'',candidate.externalRating?(candidate.ratingSource||candidate.metadataSource||'平台')+'评分：'+candidate.externalRating:''];
    const provenance=group.id==='integrated'&&candidate.metadataSource?'数据来源：'+candidate.metadataSource:'';
    return '<button type="button" class="candidate-item" data-candidate-index="'+index+'"><img class="candidate-cover" alt="'+esc(candidate.name||'封面')+'"><div><div class="candidate-name">'+esc(candidate.name)+'</div><div class="candidate-meta">'+esc(details.filter(Boolean).join(' · ')||'暂无详情')+'</div>'+(provenance?'<div class="candidate-provenance">'+esc(provenance)+'</div>':'')+'</div><span class="candidate-choose">选择 →</span></button>';
  }).join(''):'<div class="source-empty">'+esc(group.message||'此来源没有匹配结果，可切换其他来源。')+'</div>';
  if(['unavailable','partial'].includes(group.state)){
    const retry=document.createElement('button');retry.type='button';retry.className='source-website-button';retry.textContent='↻ 重新查询（来源恢复后可重试）';
    retry.onclick=async()=>{
      const picker=metadataCandidatePicker,session=metadataSession,source=activeMetadataSource;retry.disabled=true;retry.textContent='正在重新查询…';
      try{
        if(picker){const bundle=await native.localMetadata('retry-'+Date.now(),picker.row.type,LocalModel.searchName(picker.row.name));if(metadataCandidatePicker!==picker||picker.job.closed)return;showCandidates({...bundle,type:picker.row.type},{preserve:true});activeMetadataSource=source;renderMetadataSource();}
        else if(session&&!session.running){await fetchMetadata();}
      }catch(error){showToast('重新查询未完成：'+error.message,'error');}
      finally{retry.disabled=false;retry.textContent='↻ 重新查询（来源恢复后可重试）';}
    };host.appendChild(retry);
  }
  if(group.searchLinks?.length){const details=document.createElement('details');details.className='source-division-links';const summary=document.createElement('summary');summary.textContent='DLsite 分区官方搜索（'+group.searchLinks.length+' 个游戏分区）';details.appendChild(summary);for(const entry of group.searchLinks){const link=document.createElement('button');link.type='button';link.className='source-website-button';link.textContent=entry.label+' ↗';link.onclick=()=>native.openExternal(entry.url);details.appendChild(link);}host.appendChild(details);}
  else if(group.searchUrl&&['unavailable','empty','partial'].includes(group.state)){const link=document.createElement('button');link.type='button';link.className='source-website-button';link.textContent='打开 '+group.label+' 官方搜索 ↗';link.onclick=()=>native.openExternal(group.searchUrl);host.appendChild(link);}
  all('.candidate-cover').forEach((image,index)=>{
    const candidate=group.items[index],old=previousImages.get(JSON.stringify(candidateCoverUrls(candidate)));
    if(old){image.replaceWith(old);previousImages.delete(old.dataset.coverKey);if(old.classList.contains('is-loading'))candidateCoverObserver?.observe(old);}
    else loadCandidateCover(image,candidate);
  });
  all('[data-candidate-index]').forEach(button=>{const candidate=group.items[Number(button.dataset.candidateIndex)];button.onclick=()=>chooseMetadataCandidate(candidate);});
  if(metadataCandidatePicker)hint.textContent=group.label+' · '+group.items.length+' 个候选。选择后补全“'+metadataCandidatePicker.row.name+'”的缺失字段，保留手填内容。';
}
