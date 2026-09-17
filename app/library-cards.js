/* Shared card markup: one action group, no cover overlays that duplicate actions. */
function cardYear(item){return String(item.releaseDate||'').match(/\b\d{4}\b/)?.[0]||'';}
function cardAccessUrl(item){return item.type==='game'?item.storeUrl:(item.resourceUrl||item.storeUrl);}
function cardActions(item){return '<div class="card-actions">'+[['refresh','补全缺失信息','↻'],...(cardAccessUrl(item)?[['store',item.type==='game'?'打开商店 / 官网':'打开购买 / 阅读链接','↗']]:[]),...(item.noteUrl?[['note','打开笔记','▤']]:[])].map(([action,label,icon])=>'<button type="button" class="card-action" data-action="'+action+'" title="'+label+'" aria-label="'+label+'">'+icon+'</button>').join('')+'</div>';}
function cardTags(item){
 const row=(values,kind,label)=>{const tags=[...new Set((values||[]).filter(Boolean))];return '<div class="card-'+kind+'-tags" data-tag-kind="'+kind+'" aria-label="'+label+'" title="右键编辑'+label+'">'+tags.map(tag=>'<span class="card-tag '+kind+'" title="'+esc(tag)+'">'+esc(tag)+'</span>').join('')+(!tags.length&&kind==='category'?'<span class="category-placeholder">自定义分类</span>':'')+'<span class="card-tag-more" hidden></span></div>';};
 return '<div class="card-tag-rows">'+row(item.genres,'genre','类型标签')+row(item.categories,'category','自定义分类')+'</div>';
}
function cardScore(item){const source=RatingModel.parse(item,item.type).source||'平台',score=cardRatingText(item);return score?'<span class="card-source-score" title="'+esc(source+'评分：'+score)+'"><span>'+esc(source)+'</span><b>'+esc(score)+'</b></span>':'';}
function cardPersonal(item){const empty=item.rating==null,label=empty?'未评分':'个人评分：'+(Number(item.rating)||0)+' 星';return '<span class="card-personal" aria-label="'+label+'" title="'+label+' · 拖动星星调整个人评分">'+stars(empty?0:item.rating)+'</span>';}
function cardCreator(item){if(item.type==='audio'){const credits=(item.audio?.kind==='asmr'?[item.audio.circle,...(item.audio.creators||[]),...(item.audio.performers||[])]:item.audio?.artists||[]).filter(Boolean).join(' / ');return '<div class="card-creator" title="'+esc(credits)+'">'+esc(credits||'')+'</div>';}const book=['book','manga'].includes(item.type),creator=book?item.developer: ['movie','anime'].includes(item.type)?[item.developer,item.publisher].filter(Boolean).join(' · '):'';return '<div class="card-creator" title="'+esc(creator)+'">'+(creator?'<span>'+(book?'作者':'导演 / 制作')+'</span> '+esc(creator):'')+'</div>';}
function cardImage(item,portrait){const source=stableCoverFor(item,portrait?'portrait':'landscape');return source?'<img loading="lazy" decoding="async" src="'+esc(source)+'" alt="'+esc(item.name)+'">':'<span class="list-cover-empty" aria-label="暂无封面">◇</span>';}
function buildLibraryCard(item){
 const layout=currentLibraryLayout();if(layout==='small')return smallCardHtml(item);if(layout==='list')return listCardHtml(item);
 return '<article class="resource-card" draggable="true" data-id="'+esc(item.id)+'" data-media-type="'+esc(item.type)+'" data-achievement="'+(item.type==='game'&&item.status==='全成就')+'">'+
 '<div class="card-cover">'+cardImage(item,layout==='portrait')+'<div class="card-identifiers">'+(activeView==='all'?'<span class="type-pill">'+esc(typeOf(item))+'</span>':'')+(item.type==='game'?PlatformModel.icons(item):'')+'</div>'+cardStatusMarkup(item)+'</div>'+
 '<div class="card-body"><div class="card-title" title="'+esc(item.name)+'">'+esc(item.name)+'</div>'+cardCreator(item)+cardTags(item)+'<div class="card-community-row">'+cardScore(item)+'</div><div class="card-foot">'+cardPersonal(item)+cardActions(item)+'<span class="card-year" title="发行年份">'+esc(cardYear(item))+'</span></div></div></article>';
}
function buildListCard(item){
 const year=cardYear(item);return '<article class="resource-card compact-row" draggable="true" data-id="'+esc(item.id)+'" data-media-type="'+esc(item.type)+'" data-achievement="'+(item.type==='game'&&item.status==='全成就')+'">'+
 '<div class="card-cover">'+cardImage(item,['book','manga'].includes(item.type))+'</div><div class="card-body"><div class="card-title">'+esc(item.name)+'</div><div class="list-detail-row">'+cardStatusMarkup(item)+(item.type==='game'?'<span class="list-platforms">'+(PlatformModel.icons(item)||'<span class="platform-unset">平台未指定</span>')+'</span>':'')+(year?'<span class="card-year">'+esc(year)+'</span>':'')+'</div>'+cardCreator(item)+cardTags(item)+'</div><div class="list-ratings">'+cardScore(item)+'<div class="card-foot">'+cardPersonal(item)+'</div></div>'+cardActions(item)+'</article>';
}
function fitCardTags(root=$('libraryGrid')){
 for(const row of root.querySelectorAll('[data-tag-kind]')){
  const tags=[...row.querySelectorAll('.card-tag')],more=row.querySelector('.card-tag-more');if(!tags.length){more.hidden=true;continue;}
  tags.forEach(tag=>{tag.hidden=false;tag.style.maxWidth='';});more.hidden=true;const available=row.clientWidth;if(!available)continue;
  const gap=parseFloat(getComputedStyle(row).columnGap)||4,widths=tags.map(tag=>tag.offsetWidth),total=widths.reduce((a,b)=>a+b,0)+gap*(tags.length-1);
  if(total<=available+1)continue;
  more.hidden=false;more.textContent='+'+tags.length;const reserve=more.offsetWidth+gap;let used=0,count=0;
  for(const width of widths){if(used+width+(count?gap:0)>available-reserve+1)break;used+=width+(count?gap:0);count++;}
  if(!count&&tags.length){count=1;tags[0].style.maxWidth=Math.max(24,available-reserve)+'px';}
  tags.forEach((tag,i)=>tag.hidden=i>=count);more.hidden=count===tags.length;more.textContent='+'+(tags.length-count);more.title=tags.slice(count).map(tag=>tag.textContent).join('、');
 }
}
function installCardLayout(){
 let frame;const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>fitCardTags());};
 if(window.ResizeObserver){const observer=new ResizeObserver(update);observer.observe($('libraryGrid'));new MutationObserver(()=>{update();setTimeout(update,350);}).observe($('libraryGrid'),{attributes:true,attributeFilter:['class','data-layout'],childList:true});}window.addEventListener('resize',update);
}
/* Patch only the edited item's text/controls. Existing image and all sibling nodes stay alive. */
function patchLibraryCard(id){
 const card=[...$('libraryGrid').children].find(node=>node.dataset.id===id),item=state.items.find(i=>i.id===id),visible=filterItems();
 if(!card)return;if(!item||!visible.some(i=>i.id===id)){card.remove();$('resultCount').textContent=visible.length;$('libraryEmpty').classList.toggle('hidden',visible.length>0);renderLibrarySelection();return;}
 const template=document.createElement('template');template.innerHTML=cardHtml(item);const fresh=template.content.firstElementChild;
 for(const key of ['mediaType','achievement'])card.dataset[key]=fresh.dataset[key];
 const copy=(oldNode,newNode)=>{if(!oldNode||!newNode)return;if(oldNode.outerHTML!==newNode.outerHTML)oldNode.replaceWith(newNode);};
 copy(card.querySelector('.card-body'),fresh.querySelector('.card-body'));
 copy(card.querySelector('.card-cover .card-identifiers'),fresh.querySelector('.card-cover .card-identifiers'));
 copy(card.querySelector('.card-cover .status-pill'),fresh.querySelector('.card-cover .status-pill'));
 copy(card.querySelector(':scope>.list-ratings'),fresh.querySelector(':scope>.list-ratings'));copy(card.querySelector(':scope>.card-actions'),fresh.querySelector(':scope>.card-actions'));
 const cover=card.querySelector('.card-cover');if(cover){cover.setAttribute('aria-label',(['game','software','unknown_application'].includes(item.type)?'启动':'播放 / 阅读')+' '+item.name);cover.querySelector('img')?.setAttribute('alt',item.name);cover.title=(item.localPath||item.localFiles?.length||item.resourceUrl)?(item.type==='game'?'启动游戏':'打开播放器 / 阅读器'):'添加本地路径后打开';
  const count=LocalModel.members(item).length,multiple=item.type!=='game'&&count>1;card.classList.toggle('multiple-resource',multiple);cover.querySelector('.local-count')?.remove();if(multiple){const badge=document.createElement('span');badge.className='local-count';badge.textContent='▱ '+count;badge.title='包含 '+count+' 个本地文件';cover.append(badge);}
 }
 card.classList.add('patched-card');fitCardTags(card);populateFilters();renderLibrarySelection();
}
