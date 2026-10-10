/* Shared card markup: one action group, no cover overlays that duplicate actions. */
const layoutVisibleLibraryCards = new WeakSet(), layoutHiddenLibraryCards = new WeakSet(), layoutObservedLibraryCards = new WeakSet();
let cardLayoutVisibilityObserver = null;
function observeLibraryCardVisibility(root = $('libraryGrid')) {
 if(!window.IntersectionObserver)return;
 if(!cardLayoutVisibilityObserver)cardLayoutVisibilityObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){layoutVisibleLibraryCards.add(entry.target);layoutHiddenLibraryCards.delete(entry.target);}else{layoutVisibleLibraryCards.delete(entry.target);layoutHiddenLibraryCards.add(entry.target);}}},{root:null,rootMargin:'96px 0px'});
 const cards=root.matches?.('.resource-card')?[root]:root.querySelectorAll?.('.resource-card')||[];
 for(const card of cards)if(!layoutObservedLibraryCards.has(card)){layoutObservedLibraryCards.add(card);cardLayoutVisibilityObserver.observe(card);}
}
function isLibraryCardNearViewport(card) {
 if(layoutVisibleLibraryCards.has(card))return true;
 if(layoutHiddenLibraryCards.has(card))return false;
 const rect=card.getBoundingClientRect();return rect.bottom>=-96&&rect.top<=innerHeight+96;
}
function captureVisibleLibraryCardRects(root) {
 const rects=new Map();for(const card of root.children){if(card.dataset.id&&isLibraryCardNearViewport(card))rects.set(card.dataset.id,card.getBoundingClientRect());}return rects;
}
function captureLibraryCardRects(root) {
 const rects=new Map();for(const card of root.children)if(card.dataset.id)rects.set(card.dataset.id,card.getBoundingClientRect());return rects;
}
function captureLibraryCoverStages(root) {
 const covers=new Map();for(const card of root.children){const stage=card.querySelector('.card-cover .cover-art-stage');if(stage&&card.dataset.id)covers.set(card.dataset.id,stage);}return covers;
}
function reuseLibraryCoverStages(root,previousStages,items,layout) {
 const reused=new Set();if(!previousStages?.size)return reused;
 const itemById=new Map(items.map(item=>[item.id,item]));
 for(const card of root.children){const item=itemById.get(card.dataset.id),oldStage=previousStages.get(card.dataset.id),newStage=card.querySelector('.card-cover .cover-art-stage');if(!item||!oldStage||!newStage)continue;
  const image=oldStage.querySelector('.cover-art-image');if(!image)continue;
  const direction=coverDirectionForLayout(item,layout),oldDirection=image.dataset.coverDirection||'landscape',backdrop=oldStage.querySelector('.cover-art-backdrop');
  newStage.replaceWith(oldStage);reused.add(image);
  if(oldDirection!==direction){
   image.dataset.coverDirection=direction;image.alt=item.name;
   const source=stableCoverFor(item,direction);
   if(source&&(image.dataset.coverFallback==='true'||image.getAttribute('src')!==source)){image.dataset.coverFallback='false';image.setAttribute('src',source);}
   if(backdrop&&source&&backdrop.getAttribute('src')!==source)backdrop.setAttribute('src',source);
   attachStableCover(image,item,0);
  }
 }
 return reused;
}
function cardYear(item){return String(item.releaseDate||'').match(/\b\d{4}\b/)?.[0]||'';}
function cardAccessUrl(item){return item.type==='game'?item.storeUrl:(item.resourceUrl||item.storeUrl);}
function cardActions(item){return '<div class="card-actions">'+[['refresh','补全缺失信息','↻'],...(cardAccessUrl(item)?[['store',item.type==='game'?'打开商店 / 官网':'打开购买 / 阅读链接','↗']]:[]),...(item.noteUrl?[['note','打开笔记','▤']]:[])].map(([action,label,icon])=>'<button type="button" class="card-action" data-action="'+action+'" title="'+label+'" aria-label="'+label+'">'+icon+'</button>').join('')+'</div>';}
function cardTags(item){
 const row=(values,kind,label)=>{const tags=[...new Set((values||[]).filter(Boolean))];return '<div class="card-'+kind+'-tags" data-tag-kind="'+kind+'" aria-label="'+label+'" title="右键编辑'+label+'">'+tags.map(tag=>'<span class="card-tag '+kind+'" title="'+esc(tag)+'">'+esc(tag)+'</span>').join('')+(!tags.length&&kind==='category'?'<span class="category-placeholder">分类</span>':'')+'<span class="card-tag-more" hidden></span></div>';};
 return '<div class="card-tag-rows">'+row(item.genres,'genre','标签')+row(item.categories,'category','分类')+'</div>';
}
function cardScore(item){const source=RatingModel.parse(item,item.type).source||'平台',score=cardRatingText(item);return score?'<span class="card-source-score" title="'+esc(source+'评分：'+score)+'"><span>'+esc(source)+'</span><b>'+esc(score)+'</b></span>':'';}
function cardPersonal(item){const empty=item.rating==null,label=empty?'未评分':'个人评分：'+(Number(item.rating)||0)+' 星';return '<span class="card-personal" aria-label="'+label+'" title="'+label+' · 拖动星星调整个人评分">'+stars(empty?0:item.rating)+'</span>';}
function cardPlatformIcons(item,limit=4){const played=new Set(PlatformModel.normalizeMany(item.playedPlatforms)),rank=new Map(Object.keys(PlatformModel.labels).map((key,index)=>[key,index])),ordered=PlatformModel.detect(item).sort((a,b)=>Number(played.has(b))-Number(played.has(a))||((rank.get(a)??Number.MAX_SAFE_INTEGER)-(rank.get(b)??Number.MAX_SAFE_INTEGER)));return PlatformModel.icons({...item,platforms:ordered,platformsExplicit:true},limit);}
function cardCreator(item){if(item.type==='audio'){const credits=(item.audio?.kind==='asmr'?[item.audio.circle,...(item.audio.creators||[]),...(item.audio.performers||[])]:item.audio?.artists||[]).filter(Boolean).join(' / ');return '<div class="card-creator" title="'+esc(credits)+'">'+esc(credits||'')+'</div>';}const book=['book','manga'].includes(item.type),creator=book?item.developer: ['movie','anime'].includes(item.type)?[item.developer,item.publisher].filter(Boolean).join(' · '):'';return '<div class="card-creator" title="'+esc(creator)+'">'+(creator?'<span>'+(book?'作者':'导演 / 制作')+'</span> '+esc(creator):'')+'</div>';}
function cardImage(item,direction=coverDirectionForLayout(item)){const source=stableCoverFor(item,direction);return source?'<span class="cover-art-stage"><img class="cover-art-backdrop" loading="lazy" decoding="async" src="'+esc(source)+'" alt="" aria-hidden="true"><img class="cover-art-image" data-cover-direction="'+direction+'" loading="lazy" decoding="async" src="'+esc(source)+'" alt="'+esc(item.name)+'"></span>':'<span class="list-cover-empty" aria-label="暂无封面">◇</span>';}
function buildLibraryCard(item){
 const layout=currentLibraryLayout();if(layout==='small')return smallCardHtml(item);if(layout==='list')return listCardHtml(item);
 return '<article class="resource-card" draggable="true" data-id="'+esc(item.id)+'" data-media-type="'+esc(item.type)+'" data-achievement="'+(item.type==='game'&&item.status==='全成就')+'">'+
 '<div class="card-cover">'+cardImage(item,coverDirectionForLayout(item,layout))+'<div class="card-identifiers">'+(activeView==='all'?'<span class="type-pill">'+esc(typeOf(item))+'</span>':'')+(item.type==='game'?cardPlatformIcons(item):'')+'</div>'+cardStatusMarkup(item)+'</div>'+
 '<div class="card-body"><div class="card-title" title="'+esc(item.name)+'">'+esc(item.name)+'</div>'+cardCreator(item)+cardTags(item)+'<div class="card-community-row">'+cardScore(item)+'</div><div class="card-foot">'+cardPersonal(item)+cardActions(item)+'<span class="card-year" title="发行年份">'+esc(cardYear(item))+'</span></div></div></article>';
}
function buildListCard(item){
 const year=cardYear(item);return '<article class="resource-card compact-row" draggable="true" data-id="'+esc(item.id)+'" data-media-type="'+esc(item.type)+'" data-achievement="'+(item.type==='game'&&item.status==='全成就')+'">'+
 '<div class="card-cover">'+cardImage(item,coverDirectionForLayout(item,'list'))+'</div><div class="card-body"><div class="card-title">'+esc(item.name)+'</div><div class="list-detail-row">'+cardStatusMarkup(item)+(item.type==='game'?'<span class="list-platforms">'+(cardPlatformIcons(item)||'<span class="platform-unset">平台未指定</span>')+'</span>':'')+(year?'<span class="card-year">'+esc(year)+'</span>':'')+'</div>'+cardCreator(item)+cardTags(item)+'</div><div class="list-ratings">'+cardScore(item)+'<div class="card-foot">'+cardPersonal(item)+'</div></div>'+cardActions(item)+'</article>';
}
function fitCardTags(root=$('libraryGrid')){
 const rows=[...root.querySelectorAll('[data-tag-kind]')],measured=[];
 for(const row of rows){const tags=[...row.querySelectorAll('.card-tag')],more=row.querySelector('.card-tag-more');tags.forEach(tag=>{tag.hidden=false;tag.style.maxWidth='';});if(more)more.hidden=true;if(tags.length&&more)measured.push({row,tags,more});}
 const overflow=[];
 for(const entry of measured){const available=entry.row.clientWidth;if(!available)continue;const gap=parseFloat(getComputedStyle(entry.row).columnGap)||4,widths=entry.tags.map(tag=>tag.offsetWidth),total=widths.reduce((a,b)=>a+b,0)+gap*(entry.tags.length-1);if(total>available+1)overflow.push({...entry,available,gap,widths});}
 for(const entry of overflow){entry.more.textContent='+'+entry.tags.length;entry.more.hidden=false;}
 const results=[];
 for(const entry of overflow){const reserve=entry.more.offsetWidth+entry.gap;let used=0,count=0;for(const width of entry.widths){if(used+width+(count?entry.gap:0)>entry.available-reserve+1)break;used+=width+(count?entry.gap:0);count++;}results.push({...entry,count,reserve});}
 for(const entry of results){if(!entry.count&&entry.tags.length)entry.tags[0].style.maxWidth=Math.max(24,entry.available-entry.reserve)+'px';entry.tags.forEach((tag,index)=>tag.hidden=index>=entry.count);entry.more.hidden=entry.count===entry.tags.length;entry.more.textContent='+'+(entry.tags.length-entry.count);entry.more.title=entry.tags.slice(entry.count).map(tag=>tag.textContent).join('、');}
}
function installCardLayout(){
 const grid=$('libraryGrid');let frame,lastWidth=-1;const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>fitCardTags());};
 if(window.ResizeObserver)new ResizeObserver(entries=>{const width=entries[entries.length-1]?.contentRect.width||0;if(Math.abs(width-lastWidth)>.5){lastWidth=width;update();}}).observe(grid);
 if(window.MutationObserver){observeLibraryCardVisibility(grid);new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)observeLibraryCardVisibility(node);}).observe(grid,{childList:true});}
 window.addEventListener('resize',update);
}
/* Patch only the edited item's text/controls. Existing image and all sibling nodes stay alive. */
function patchLibraryCard(id){
 const card=[...$('libraryGrid').children].find(node=>node.dataset.id===id),item=state.items.find(i=>i.id===id),visible=filterItems();
 if(!card)return;if(!item||!visible.some(i=>i.id===id)){card.remove();$('resultCount').textContent=visible.length;$('libraryEmpty').classList.toggle('hidden',visible.length>0);renderLibrarySelection();return;}
 const template=document.createElement('template');template.innerHTML=cardHtml(item);const fresh=template.content.firstElementChild;
 const currentCover=card.querySelector('.card-cover .cover-art-stage, .card-cover .list-cover-empty'),freshCover=fresh.querySelector('.card-cover .cover-art-stage, .card-cover .list-cover-empty');
 const currentImage=currentCover?.querySelector('img.cover-art-image'),freshImage=freshCover?.querySelector('img.cover-art-image');
 const direction=freshImage?.dataset.coverDirection||coverDirectionForLayout(item,currentLibraryLayout()),expectedSignature=freshImage?coverSignature(item,direction):'';
 const fallbackNameChanged=currentImage?.dataset.coverFallback==='true'&&currentImage.alt!==item.name;
 if(Boolean(currentImage)!==Boolean(freshImage)||(freshImage&&currentImage?.dataset.coverSignature!==expectedSignature)||fallbackNameChanged){
  if(currentCover&&freshCover)currentCover.replaceWith(freshCover);
  else if(currentCover)currentCover.remove();
  else if(freshCover)card.querySelector('.card-cover')?.prepend(freshCover);
  const replacement=card.querySelector('.card-cover img.cover-art-image');if(replacement)repairCardCover(replacement,item,0);
 }
 for(const key of ['mediaType','achievement'])card.dataset[key]=fresh.dataset[key];
 const copy=(oldNode,newNode)=>{if(!oldNode||!newNode)return;if(oldNode.outerHTML!==newNode.outerHTML)oldNode.replaceWith(newNode);};
 copy(card.querySelector('.card-body'),fresh.querySelector('.card-body'));
 copy(card.querySelector('.card-cover .card-identifiers'),fresh.querySelector('.card-cover .card-identifiers'));
 copy(card.querySelector('.card-cover .status-pill'),fresh.querySelector('.card-cover .status-pill'));
 copy(card.querySelector('.list-ratings'),fresh.querySelector('.list-ratings'));copy(card.querySelector('.card-actions'),fresh.querySelector('.card-actions'));
 const cover=card.querySelector('.card-cover');if(cover){cover.setAttribute('aria-label',(['game','software','unknown_application'].includes(item.type)?'启动':'播放 / 阅读')+' '+item.name);cover.querySelector('img.cover-art-image')?.setAttribute('alt',item.name);cover.title=(item.localPath||item.localFiles?.length||item.resourceUrl)?(item.type==='game'?'启动游戏':'打开播放器 / 阅读器'):'添加本地路径后打开';
 const count=LocalModel.members(item).length,multiple=item.type!=='game'&&count>1;card.classList.toggle('multiple-resource',multiple);cover.querySelector('.local-count')?.remove();if(multiple){const badge=document.createElement('span');badge.className='local-count';badge.textContent='▱ '+count;badge.title='包含 '+count+' 个本地文件';cover.append(badge);}
 }
 card.classList.add('patched-card');fitCardTags(card);populateFilters();renderLibrarySelection();
}
