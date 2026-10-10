/* Source tabs contain original provider records; integrated results are separate. */
let metadataResultGroups = [], activeMetadataSource = 'integrated', metadataCurrentPayload=null, metadataPrimaryRevision=0;
let metadataCandidatePicker=null;
const metadataPrimaryDefaults={game:'steam',movie:'douban',anime:'bangumi',manga:'bangumi',book:'douban'};
const metadataPrimaryLabels={steam:'Steam',douban:'豆瓣读书 / 豆瓣电影',bangumi:'Bangumi',googlebooks:'Google Books',openlibrary:'Open Library',zlibrary:'Z-Library',tstrs:'SaltyLeo 的书架',onelib:'1lib 公开书目',nintendo:'Nintendo Switch',playstation:'PlayStation',epic:'Epic Games（egdata）',dlsite:'DLsite',tvmaze:'TVmaze',itunes:'Apple iTunes',seedhub:'SeedHub',myanimelist:'MyAnimeList',anilist:'AniList',kitsu:'Kitsu',wikidata:'Wikidata'};
function finishImportCandidate(choice=null){
 const picker=metadataCandidatePicker;if(!picker)return;metadataCandidatePicker=null;
 $('importCandidateActions')?.remove();$('candidateBackdrop').classList.add('hidden');$('candidateBackdrop').classList.remove('import-candidate-backdrop');appModalStack.release($('candidateBackdrop'));
 $('candidateBackdrop').querySelector('h2').textContent='请选择一个具体条目';
 candidateCoverObserver?.disconnect();picker.resolve(choice);
}
function dismissCandidateResults(){if(metadataCandidatePicker)finishImportCandidate(null);else cancelMetadataLookup();}
function chooseMetadataCandidate(candidate){const key=candidateCoverKey(candidate),image=all('.candidate-cover').find(node=>node.dataset.coverKey===key);if(image?.naturalWidth&&candidate.cover&&candidateCoverSourceUrls.get(key)===candidate.cover){candidate.coverDimensions={width:image.naturalWidth,height:image.naturalHeight};candidate.coverOrientation=CoverClassifier.classify(image.naturalWidth,image.naturalHeight);}if(window.audioPanels?.hasLookup?.())return window.audioPanels.chooseCandidate(candidate);if(metadataCandidatePicker)finishImportCandidate(candidate);else applyCandidate(candidate);}
function metadataPrimaryType(){return metadataCandidatePicker?.row.type||metadataCurrentPayload?.type||$('fieldType').value;}
function metadataPrimaryValue(type){return settings?.metadataPrimarySourceByType?.[type]||metadataPrimaryDefaults[type]||'';}
function renderPrimarySourceControl(){
 const type=metadataPrimaryType(),row=$('candidatePrimarySource'),group=metadataResultGroups.find(value=>value.id===activeMetadataSource);
 if(!row)return;
 row.classList.toggle('hidden',!metadataPrimaryDefaults[type]||group?.id!=='integrated');
 const select=$('candidatePrimarySourceSelect');if(!select)return;
 const current=metadataPrimaryValue(type),sources=metadataResultGroups.filter(value=>value.id!=='integrated');select.replaceChildren();
 for(const source of sources){const option=document.createElement('option');option.value=source.id;option.textContent=source.label||metadataPrimaryLabels[source.id]||source.id;select.append(option);}
 if(current&&!sources.some(source=>source.id===current)){const option=document.createElement('option');option.value=current;option.textContent=metadataPrimaryLabels[current]||current;select.append(option);}
 select.value=current||metadataPrimaryDefaults[type]||'';
 select.onchange=async()=>{
  const selected=select.value;if(!selected)return;
  const byType={...(settings?.metadataPrimarySourceByType||{}),[type]:selected};
  void queueSettingsSave({metadataPrimarySourceByType:byType});
  const revision=++metadataPrimaryRevision,snapshot=metadataResultGroups,payload=metadataCurrentPayload,sourceGroups=snapshot.filter(value=>value.id!=='integrated');
  if(!native.integrateMetadataSources)return;
  try{const integrated=await native.integrateMetadataSources(type,selected,sourceGroups,payload?.query||'');if(revision!==metadataPrimaryRevision||snapshot!==metadataResultGroups||payload!==metadataCurrentPayload)return;const target=metadataResultGroups.find(value=>value.id==='integrated');if(target)target.items=integrated.map(MetadataText.candidate);renderMetadataSource();}
  catch{showToast('主来源已记忆，但当前结果暂未能重新整合。','error');}
 };
}
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
const candidateCoverDimensions=new Map();
const candidateCoverSourceUrls=new Map();
const candidateCoverUrls=candidate=>[...new Set([candidate.cover,candidate.coverPortrait,candidate.coverLandscape].filter(Boolean))];
const candidateCoverKey=candidate=>JSON.stringify({identity:[candidate._sourceId||candidate.sourceId||'',candidate.mediaType||candidate.type||'',candidate.providerId||'',candidate.id||'',candidate.storeUrl||'',candidate.name||'',candidate.originalName||'',candidate.isbn||'',candidate.releaseDate||''],urls:candidateCoverUrls(candidate)});
function loadCandidateCover(image,candidate) {
  const urls=candidateCoverUrls(candidate),key=candidateCoverKey(candidate);image.dataset.coverKey=key;
  const cached=candidateCoverReferences.get(key);if(cached){image.dataset.coverFallback='false';image.src=cached;const dimensions=candidateCoverDimensions.get(key),sourceUrl=candidateCoverSourceUrls.get(key);if(dimensions&&candidate.cover&&sourceUrl===candidate.cover){candidate.coverDimensions=dimensions;candidate.coverOrientation=CoverClassifier.classify(dimensions.width,dimensions.height);}return;}
  if(image.dataset.coverStarted)return;image.dataset.coverStarted='1';image.classList.add('is-loading');
  let cursor=0;const done=()=>{image.classList.remove('is-loading');if(image.naturalWidth){if(image.dataset.coverFallback!=='true'&&urls.length){candidateCoverReferences.set(key,image.src);while(candidateCoverReferences.size>800)candidateCoverReferences.delete(candidateCoverReferences.keys().next().value);}const sourceUrl=candidateCoverSourceUrls.get(key),dimensions={width:image.naturalWidth,height:image.naturalHeight};if(image.dataset.coverFallback!=='true'&&sourceUrl&&candidate.cover===sourceUrl){candidateCoverDimensions.set(key,dimensions);while(candidateCoverDimensions.size>800)candidateCoverDimensions.delete(candidateCoverDimensions.keys().next().value);candidate.coverDimensions=dimensions;candidate.coverOrientation=CoverClassifier.classify(image.naturalWidth,image.naturalHeight);}}};
  const fallback=()=>{if(cursor<urls.length){image.dataset.coverFallback='false';candidateCoverSourceUrls.set(key,urls[cursor]);image.src=urls[cursor++];}else{image.classList.remove('is-loading');image.dataset.coverFallback='true';image.onerror=null;image.src=fallbackCover(candidate.name);}};
  image.onload=done;image.onerror=fallback;
  const start=async()=>{
    if(!image.isConnected||image.dataset.coverRequested)return;image.dataset.coverRequested='1';
    if(native.previewMetadataCover&&urls.some(url=>/^https:/.test(url))){
      const epoch=metadataSelectionEpoch;
      try{const loaded=await native.previewMetadataCover(urls,metadataSession?.id||'preview');if(epoch!==metadataSelectionEpoch)return;const info=typeof loaded==='string'?{reference:loaded,sourceUrl:urls[0]}:loaded||{};if(info.sourceUrl)candidateCoverSourceUrls.set(key,info.sourceUrl);if(info.dimensions&&candidate.cover===info.sourceUrl){candidateCoverDimensions.set(key,info.dimensions);candidate.coverDimensions=info.dimensions;candidate.coverOrientation=CoverClassifier.classify(info.dimensions.width,info.dimensions.height);}if(info.reference){image.src=info.reference;return;}}catch{}
    }fallback();
  };
  if(candidateCoverObserver)candidateCoverObserver.observe(image);else start();image._loadCover=start;
}
function showCandidates(payload,{preserve=false}={}) { document.getElementById('completeMissingLyrics')?.closest('label').classList.toggle('hidden',payload.type!=='audio');
  metadataCurrentPayload=payload;
  const scroll=preserve?$('candidateList').scrollTop:0;const focusId=document.activeElement?.dataset?.sourceId;
  const items = Array.isArray(payload) ? payload : payload.integrated || [];
  const publication=['book','manga'].includes(payload.type||$('fieldType').value);
  metadataResultGroups = [{ id:'integrated', label:'整合源', state:payload.loading?'loading':items.length?'ok':'empty', items, message:publication?'只对已确认的同一作品互补；ISBN、页数、译者、出版社与出版日期按具体版本匹配。':'只对已确认的同一作品互补，保留评分的真实来源。' }, ...(Array.isArray(payload) ? [] : payload.sources || [])];
  metadataResultGroups = metadataResultGroups.map(group=>({...group,items:(group.items||[]).map(MetadataText.candidate)}));
  if(!preserve||!metadataResultGroups.some(group=>group.id===activeMetadataSource))activeMetadataSource = 'integrated';
  let tabs = $('candidateSourceTabs');
  if (!tabs) { tabs=document.createElement('div'); tabs.id='candidateSourceTabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','元数据来源'); $('candidateList').before(tabs); }
  let primaryRow=$('candidatePrimarySource');if(!primaryRow){primaryRow=document.createElement('div');primaryRow.id='candidatePrimarySource';primaryRow.className='candidate-primary-source hidden';primaryRow.innerHTML='<span>主来源：</span><select id="candidatePrimarySourceSelect" aria-label="整合源主来源"></select>';tabs.after(primaryRow);}
  tabs.replaceChildren();
  for (const group of metadataResultGroups) {
    const button=document.createElement('button'); button.type='button';button.dataset.sourceId=group.id;button.id='source-tab-'+group.id;button.setAttribute('role','tab');button.setAttribute('aria-controls','candidateList');
    const suffix=group.state==='loading'?'获取中 '+group.items.length:group.state==='supplementing'?'补充中 '+group.items.length:group.state==='unconfigured'?'需密钥':group.state==='unavailable'?(group.statusLabel||'请求失败'):({'disabled':'未启用','skipped':'未执行','empty':'0 条结果','timeout':'超时','http-error':'HTTP 错误','parse-error':'解析错误','rate-limited':'被限流','upstream-failure':'上游故障'}[group.state]||String(group.items.length));
    button.textContent=group.label+' · '+suffix;
    button.onclick=()=>{activeMetadataSource=group.id;renderMetadataSource();};tabs.appendChild(button);
  }
  tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const buttons=[...tabs.children],current=buttons.indexOf(document.activeElement);const next=buttons[(current+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];next.click();next.focus();};
  renderPrimarySourceControl();$('candidateBackdrop').classList.remove('hidden');appModalStack.open($('candidateBackdrop'),()=>$('candidateClose').click());renderMetadataSource();$('candidateList').scrollTop=scroll;
  if(focusId)tabs.querySelector('[data-source-id="'+focusId+'"]')?.focus({preventScroll:true});
}
function renderMetadataSource() {
  const group=metadataResultGroups.find(group=>group.id===activeMetadataSource);if(!group)return;
  renderPrimarySourceControl();
  all('#candidateSourceTabs button').forEach(button=>{const selected=button.dataset.sourceId===group.id;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
  const hint=document.querySelector('.candidate-hint');hint.textContent=group.label+' · '+group.items.length+' 个候选'+(group.state==='loading'?'，结果会陆续补充，可随时选择或关闭。':group.state==='supplementing'?'，已有候选可选，其他地区结果会继续追加。':'')+(group.message?'。'+group.message:'。选择具体条目后填入编辑器。');
  const host=$('candidateList');host.scrollTop=0;host.setAttribute('aria-busy',String(['loading','supplementing'].includes(group.state)));host.setAttribute('role','tabpanel');host.setAttribute('aria-labelledby','source-tab-'+group.id);
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
  if(['onelib','zlibrary'].includes(group.id)&&group.state==='unavailable'&&group.statusLabel==='解析失败'&&group.searchUrl&&metadataCurrentPayload?.query&&native.openMetadataVerification){
    const payload=metadataCurrentPayload,sourceId=group.id,searchUrl=group.searchUrl,picker=metadataCandidatePicker;
    const button=document.createElement('button');button.type='button';button.className='source-website-button';button.textContent='在内置浏览器检查搜索页并重试';
    button.onclick=async()=>{
      button.disabled=true;button.textContent='请在内置浏览器查看搜索页…';
      try{
        const hostName=new URL(searchUrl).hostname,refreshed=await native.openMetadataVerification(hostName,payload.type||metadataPrimaryType(),payload.query,sourceId,searchUrl);
        if(refreshed?.canceled||metadataCurrentPayload!==payload||metadataCandidatePicker!==picker||picker?.job.closed)return;
        if(refreshed?.verificationRequired){showToast(refreshed.verificationReason==='challenge-still-present'?'网站仍显示验证页面，请完成验证后再关闭窗口。':'网站页面未加载完成，请在验证窗口保持打开，等页面加载后再关闭。','error');return;}
        showCandidates(refreshed,{preserve:true});activeMetadataSource=sourceId;renderMetadataSource();
      }catch(error){showToast('内置浏览器重试失败：'+error.message,'error');}
      finally{if(button.isConnected){button.disabled=false;button.textContent='在内置浏览器检查搜索页并重试';}}
    };
    host.appendChild(button);
  }
  if(group.verificationRequired===true&&group.verificationHost&&metadataCurrentPayload?.query&&native.openMetadataVerification){
    const payload=metadataCurrentPayload,sourceId=group.id,picker=metadataCandidatePicker;
    const button=document.createElement('button');button.type='button';button.className='source-website-button';button.textContent='在内置浏览器处理 '+group.label+' 验证 ↗';
    button.onclick=async()=>{
      button.disabled=true;button.textContent='请在内置浏览器完成处理…';
      try{
        const refreshed=await native.openMetadataVerification(group.verificationHost,payload.type||metadataPrimaryType(),payload.query,sourceId);
        if(refreshed?.canceled||metadataCurrentPayload!==payload||metadataCandidatePicker!==picker||picker?.job.closed)return;
        if(refreshed?.verificationRequired){showToast(refreshed.verificationReason==='challenge-still-present'?'网站仍显示验证页面，请完成验证后再关闭窗口。':'网站页面未加载完成，请在验证窗口保持打开，等页面加载后再关闭。','error');return;}
        if(refreshed?.errorKind){showToast('来源重新搜索失败；原有候选结果仍保留。','error');return;}
        showCandidates(refreshed,{preserve:true});activeMetadataSource=sourceId;renderMetadataSource();
      }catch(error){showToast('来源验证后重新查询失败：'+error.message,'error');}
      finally{if(button.isConnected){button.disabled=false;button.textContent='在内置浏览器处理 '+group.label+' 验证 ↗';}}
    };
    host.appendChild(button);
  }
  all('.candidate-cover').forEach((image,index)=>{
    const candidate=group.items[index],old=previousImages.get(candidateCoverKey(candidate));
    if(old){image.replaceWith(old);previousImages.delete(old.dataset.coverKey);if(old.classList.contains('is-loading'))candidateCoverObserver?.observe(old);}
    else loadCandidateCover(image,candidate);
  });
  all('[data-candidate-index]').forEach(button=>{const candidate=group.items[Number(button.dataset.candidateIndex)];button.onclick=()=>chooseMetadataCandidate(candidate);});
  if(metadataCandidatePicker)hint.textContent=group.label+' · '+group.items.length+' 个候选。选择后补全“'+metadataCandidatePicker.row.name+'”的缺失字段，保留手填内容。';
}
