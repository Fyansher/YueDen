/* Public book metadata only. This adapter never follows downloads, logins,
   mirrors or browser challenges. Search routes are derived from the live form. */
const Html=require('./metadata-html'),Text=require('./metadata-text'),Runtime=require('./metadata-runtime'),{isbn,count}=require('./metadata-enrichment');
const ORIGIN='https://zh.zlib.bz',HOST='zh.zlib.bz';
const clean=value=>Html.text(value||'').replace(/\s+/g,' ').trim();
function attributes(tag){const result={};for(const match of String(tag||'').matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[match[1].toLowerCase()]=Text.decode(match[2]??match[3]??match[4]??'');return result;}
function safeUrl(value,base=ORIGIN){try{const url=new URL(value,base);return url.protocol==='https:'&&url.origin===new URL(base).origin&&!url.username&&!url.password&&!url.port?url.href:'';}catch{return '';}}
function isChallenge(page){return /checking your browser|verifying your browser|just a moment|cf-chl-|captcha|验证码|机器人验证|verify you are human|access denied|diamwall|登录后(?:继续|查看|搜索)/i.test(String(page||''));}
function noResults(page){return /no results|没有找到|无搜索结果|未找到相关|暂无(?:相关)?书籍|0\s+(?:matching\s+)?results?|showing\s+0\s*(?:-|of)\s*0/i.test(clean(page));}
function detailPath(path){return /^\/(?:book|books?|detail|bookinfo|item)\/(?!search(?:\/|$))[^/?#]+(?:\/[^?#]*)?\/?$/i.test(path);}
function searchPageFor(homeUrl,query){try{const url=new URL(homeUrl),segments=url.pathname.split('/').filter(Boolean),tail=decodeURIComponent(segments.at(-1)||'');if(/^\/(?:s|search)(?:\/|$)/i.test(url.pathname)&&tail.toLowerCase()===String(query||'').toLowerCase())return url.href;if(/^\/(?:search|catalog)\/?$/i.test(url.pathname)){const key=['q','query','keyword','search','title','term'].find(name=>url.searchParams.has(name));if(key&&url.searchParams.get(key)?.toLowerCase()===String(query||'').toLowerCase())return url.href;}}catch{}return '';}
function searchTarget(home,query,base=ORIGIN,stats={}){
  const target=require('./metadata-search-form').buildGetSearchUrl(home,query,base,stats);
  if(!target)return '';
  try{
    const url=new URL(target),queryName=[...url.searchParams.keys()].find(name=>/^(?:q|query|keyword|search|title|term)$/i.test(name));
    // Current Z-Library forms submit through /s/ with q in the query string,
    // while the live site serves results from /s/<encoded query>. Mirror that
    // navigation instead of requesting the empty form shell returned by /s/?q=.
    if(/^\/s\/?$/i.test(url.pathname)&&queryName){
      const routed=new URL('/s/'+encodeURIComponent(String(query||'').trim().slice(0,240)),url.origin);
      for(const [name,value] of url.searchParams){if(name!==queryName&&!/^(?:csrf|token|nonce)$/i.test(name))routed.searchParams.append(name,value);}
      return routed.href;
    }
  }catch{}
  return target;
}
function safeImageUrl(value,base){if(!value)return '';try{const url=new URL(value,base);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function renderedPage(value,fallbackUrl=''){return typeof value==='string'?{html:value,finalUrl:fallbackUrl}:{html:String(value?.html||''),finalUrl:String(value?.finalUrl||fallbackUrl||'')};}
function safePageUrl(value,fallbackUrl){return value?safeUrl(value,value)||fallbackUrl:fallbackUrl;}
function diagnoseSearchFailure(requestUrl,finalUrl,page,context,stats){require('./metadata-book-diagnostics').write('zlibrary',requestUrl,finalUrl,page,isChallenge(page),context,stats);}
function anchorName(attrs,body,path,stats){
  const heading=body.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i)?.[1]||body.match(/<(?:span|div)[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i)?.[1];
  const dataTag=body.match(/<([a-z][\w:-]*)\b[^>]*\bdata-(?:book-)?(?:title|name)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/i);
  const dataAttr=dataTag?.[2]||body.match(/<[^>]+\bdata-(?:book-)?(?:title|name)=["']([^"']+)["'][^>]*>/i)?.[1]||attrs['data-book-title']||attrs['data-title']||attrs['data-name'];
  const imageTag=body.match(/<(?:img|source)\b[^>]*>/i),imageAttrs=imageTag?attributes(imageTag[0]):{};
  let urlTitle='';try{const segment=decodeURIComponent(String(path||'').split('/').filter(Boolean).at(-1)||'').replace(/\.(?:html?|php)$/i,'');if(segment.length>=3&&!/^[\da-f_-]{20,}$/i.test(segment))urlTitle=segment.replace(/[-_]+/g,' ').trim();}catch{}
  for(const [kind,value] of [['heading',heading],['data',dataAttr||dataTag?.[3]],['image-alt',imageAttrs.alt||imageAttrs.title],['label',attrs['data-yueden-accessible-label']||attrs['aria-label']||attrs.title],['text',body],['url-slug',urlTitle]]){
    const name=clean(value||'').replace(/^\s*(?:book|title)\s*[:：]\s*/i,'').replace(/\s*[|·•]\s*(?:details?|read more|下载).*$/i,'');
    if(!name||name.length>250||/^(?:details?|read more|下载|download|查看详情)$/i.test(name))continue;
    stats.nameSourceCounts[kind]=(stats.nameSourceCounts[kind]||0)+1;
    return name;
  }
  return '';
}
function parseSearch(page,base=ORIGIN,stats={}){
  if(!page||isChallenge(page))return [];
  const rows=[],seen=new Set();Object.assign(stats,{totalAnchors:[...String(page).matchAll(/<a\b/gi)].length,safeUrlAccepted:0,rejectedDifferentOrigin:0,rejectedUnsafeUrl:0,detailPathAccepted:0,detailPathRejected:0,nameRecognized:0,nameSourceCounts:{heading:0,data:0,'image-alt':0,label:0,text:0,'url-slug':0},finalCandidateCount:0,detailCandidateCount:0});
  for(const match of String(page).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const attrs=attributes(match[1]);let raw;
    try{raw=new URL(attrs.href,base);}catch{stats.rejectedUnsafeUrl=(stats.rejectedUnsafeUrl||0)+1;continue;}
    if(raw.protocol!=='https:'||raw.username||raw.password||raw.port){stats.rejectedUnsafeUrl=(stats.rejectedUnsafeUrl||0)+1;continue;}
    if(raw.origin!==new URL(base).origin){stats.rejectedDifferentOrigin=(stats.rejectedDifferentOrigin||0)+1;continue;}
    const target=raw.href;stats.safeUrlAccepted=(stats.safeUrlAccepted||0)+1;
    const path=raw.pathname;if(!detailPath(path)){stats.detailPathRejected=(stats.detailPathRejected||0)+1;continue;}
    stats.detailPathAccepted=(stats.detailPathAccepted||0)+1;
    const name=anchorName(attrs,match[2],raw.pathname,stats);if(!name)continue;stats.nameRecognized=(stats.nameRecognized||0)+1;
    const key=new URL(target).pathname;if(seen.has(key))continue;seen.add(key);
    const image=match[2].match(/<(?:img|source)\b[^>]*>/i)?.[0],imageAttrs=image?attributes(image):{},imageUrl=imageAttrs.src||imageAttrs['data-src']||imageAttrs.srcset?.split(/\s+/)[0],cover=imageUrl?safeImageUrl(imageUrl,base):'';
    rows.push({id:'zlibrary-'+key.replace(/[^\w-]+/g,'-').replace(/^-|-$/g,''),providerId:key,detailUrl:target,name,cover,storeUrl:target,metadataSource:'Z-Library',genres:[],detailsUnavailable:true});
    if(rows.length>=12)break;
  }
  stats.detailCandidateCount=stats.detailPathAccepted||0;stats.finalCandidateCount=rows.length;
  if(!rows.length&&!noResults(page))throw new SyntaxError('Z-Library 搜索页结构无法识别');
  return rows;
}
function labeled(page,label){
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const row of Html.blocks(page,'tr',()=>true)){
    const cells=[...row.body.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(match=>clean(match[1]));
    if(cells.length>1&&cells[0].replace(/[：:]$/,'').toLowerCase()===label.toLowerCase())return cells.slice(1).join('、');
  }
  const match=String(page||'').match(new RegExp('<(?:dt|th|span|div|strong)[^>]*>\\s*'+escaped+'\\s*:?\\s*<\\/(?:dt|th|span|div|strong)>\\s*<(?:dd|td|span|div)[^>]*>([\\s\\S]*?)<\\/(?:dd|td|span|div)>','i'));
  return clean(match?.[1]||'');
}
function parseDetail(page,seed,base=seed?.detailUrl||ORIGIN){
  if(!page||isChallenge(page))return {...seed,detailsUnavailable:true};
  const data=Html.structured(page,'Book')[0]||{},meta=(property)=>{
    const escaped=property.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    for(const match of String(page).matchAll(/<meta\b[^>]*>/gi)){const attrs=attributes(match[0]);if([attrs.property,attrs.name,attrs.itemprop].some(value=>String(value||'').toLowerCase()===property.toLowerCase()))return attrs.content||'';}
    return page.match(new RegExp("<meta\\b[^>]*(?:property|name)=[\"']"+escaped+"[\"'][^>]*content=[\"']([^\"']*)",'i'))?.[1]||'';
  };
  const props={};for(const match of String(page).matchAll(/<([a-z][\w:-]*)\b([^>]*\bitemprop\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/\1>/gi)){const attrs=attributes('<'+match[1]+' '+match[2]+'>');if(!props[attrs.itemprop])props[attrs.itemprop]=clean(attrs.content||attrs.href||match[3]);}
  const person=value=>[value].flat().filter(Boolean).map(item=>clean(typeof item==='string'?item:item.name)).filter(Boolean).join('、');
  const heading=clean(String(page).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
  const description=clean(data.description||props.description||meta('description')||meta('og:description'));
  const image=typeof data.image==='string'?data.image:data.image?.url||props.image||meta('og:image'),cover=safeImageUrl(image,base);
  const authors=person(data.author||data.creator)||props.author||labeled(page,'Author')||labeled(page,'作者');
  const rawIsbn=String(data.isbn||props.isbn||labeled(page,'ISBN')||''),code=isbn(rawIsbn);
  const pages=count(String(data.numberOfPages||props.numberOfPages||labeled(page,'Pages')||labeled(page,'页数')||''));
  const publisher=person(data.publisher)||props.publisher||labeled(page,'Publisher')||labeled(page,'出版社');
  const translator=labeled(page,'Translator')||labeled(page,'译者');
  const releaseDate=clean(data.datePublished||props.datePublished||labeled(page,'Published')||labeled(page,'出版日期'));
  const genres=[data.genre].flat().filter(Boolean).map(clean);
  const name=clean(data.name||props.name||meta('og:title')||heading||meta('twitter:title'))||seed.name;
  const recognized=Boolean(data.name||props.name||heading||description||authors||publisher||translator||code||pages||releaseDate||cover||genres.length);
  return {...seed,name,developer:authors,publisher,translator,isbn:code||'',pages,releaseDate,description,genres,cover:cover||seed.cover,storeUrl:seed.detailUrl,metadataSource:'Z-Library',detailsUnavailable:!recognized};
}
async function search({html,sourceHome=()=>'',sourceVerified=()=>false,renderHtml=async()=>({})},query){
  const checkpoint=html.timeoutCheckpoint?.()??0,verified=typeof sourceVerified==='function'?Boolean(sourceVerified()):Boolean(sourceVerified);
  const context=html.diagnosticContext;let stats={parseLayer:'search-results'};
  context?.log?.({phase:'parse.start',parseLayer:'homepage-search-form',requestUrl:sourceHome(),verified});
  const homeUrl=sourceHome()||ORIGIN+'/',safeHomeValue=safeUrl(homeUrl,homeUrl);
  let safeHome=safeHomeValue;
  if(!safeHome){Runtime.recordFailure({kind:'parse',status:200,host:HOST,label:'解析失败',message:'Z-Library 验证后的地址无效。'});return [];}
  let verifiedSearch=searchPageFor(safeHome,query);
  if(!verifiedSearch&&new URL(safeHome).pathname!=='/'&&!/^\/(?:s|search|catalog)(?:\/|$)/i.test(new URL(safeHome).pathname))safeHome=new URL(safeHome).origin+'/';
  if(!verifiedSearch&&/^\/(?:s|search|catalog)(?:\/|$)/i.test(new URL(safeHome).pathname))safeHome=new URL(safeHome).origin+'/';
  let home='',homeBase=safeHome,homeRendered=false;const formStats={parseLayer:'homepage-search-form'};
  const renderHome=async()=>{
    homeRendered=true;const rendered=renderedPage(await renderHtml(safeHome,8500,context),safeHome);Runtime.check();home=rendered.html;safeHome=safePageUrl(rendered.finalUrl,safeHome);homeBase=safePageUrl(rendered.finalUrl,safeHome);
    if(isChallenge(home)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(homeBase).hostname,label:'需验证',message:'Z-Library 返回验证页。'});return false;}
    verifiedSearch=searchPageFor(safeHome,query);return true;
  };
  if(verified){if(!await renderHome())return [];}
  else if(!verifiedSearch){
    const requestedHome=safeHome;home=await html(safeHome,2600);Runtime.check();
    const effective=sourceHome();if(effective&&effective!==requestedHome){safeHome=safeUrl(effective,effective)||safeHome;homeBase=safeHome;verifiedSearch=searchPageFor(safeHome,query);}
    if(isChallenge(home)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(safeHome).hostname,label:'需验证',message:'Z-Library 返回验证页。'});return [];}
  }
  if(!home&&!verifiedSearch&&!homeRendered){if(!await renderHome())return [];}
  if(!home&&!verifiedSearch&&verified){const requestedHome=safeHome;home=await html(safeHome,2400);Runtime.check();const effective=sourceHome();if(effective&&effective!==requestedHome){safeHome=safeUrl(effective,effective)||safeHome;homeBase=safeHome;verifiedSearch=searchPageFor(safeHome,query);}if(isChallenge(home)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(safeHome).hostname,label:'需验证',message:'Z-Library 返回验证页。'});return [];}}
  if(!home&&!verifiedSearch){Runtime.recordFailure({kind:'network',status:0,host:new URL(safeHome).hostname,label:'连接失败',message:'Z-Library 首页暂不可访问。'});return [];}
  let target=verifiedSearch||searchTarget(home,query,safeHome,formStats);
  if(!target&&!homeRendered){if(!await renderHome())return [];target=verifiedSearch||searchTarget(home,query,safeHome,formStats);}
  if(!target){diagnoseSearchFailure(safeHome,homeBase,home,context,formStats);context?.log?.({phase:'parse.failed',parseLayer:'homepage-search-form',errorName:'SyntaxError',errorMessage:'Z-Library 首页没有可识别的公开搜索表单。'});Runtime.recordFailure({kind:'parse',status:200,host:new URL(safeHome).hostname,label:'解析失败',message:'Z-Library 首页没有可识别的公开搜索表单。'});return [];}
  let page=verifiedSearch?home:'',pageBase=verifiedSearch?homeBase:target,renderedSearch=Boolean(verifiedSearch&&homeRendered);
  context?.log?.({phase:'parse.start',parseLayer:'search-results',requestUrl:target,verified});
  if(!verifiedSearch&&verified){
    const rendered=renderedPage(await renderHtml(target,8500,context),target);Runtime.check();page=rendered.html;pageBase=safePageUrl(rendered.finalUrl,target);renderedSearch=true;
  }else if(!verifiedSearch){
    const previousHome=sourceHome()||safeHome;page=await html(target,2800);Runtime.check();const latestPage=sourceHome();pageBase=latestPage&&latestPage!==previousHome?safeUrl(latestPage,latestPage)||target:target;
  }
  if(isChallenge(page)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(pageBase).hostname,label:'需验证',message:'Z-Library 返回验证页。'});return [];}
  let rows=[],parsed=false,parseError=null;
  if(page){try{rows=parseSearch(page,pageBase,stats);parsed=true;}catch(error){if(!(error instanceof SyntaxError))throw error;parseError=error;}}
  if(!parsed&&!renderedSearch){const rendered=renderedPage(await renderHtml(target,8500,context),target);Runtime.check();page=rendered.html;pageBase=safePageUrl(rendered.finalUrl,target);renderedSearch=true;if(isChallenge(page)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(pageBase).hostname,label:'需验证',message:'Z-Library 返回验证页。'});return [];}if(page){try{rows=parseSearch(page,pageBase,stats);parsed=true;}catch(error){if(!(error instanceof SyntaxError))throw error;parseError=error;}}}
  if(!parsed&&page){
    const retryStats={parseLayer:'search-results'},formTarget=searchTarget(page,query,pageBase,retryStats);
    if(formTarget&&formTarget!==target){
      context?.log?.({phase:'search.form-retry',parseLayer:'search-results',requestUrl:formTarget,verified,formCount:retryStats.formCount,searchFormCandidateCount:retryStats.searchFormCandidateCount});
      const retry=verified||renderedSearch?renderedPage(await renderHtml(formTarget,8500,context),formTarget):renderedPage(await html(formTarget,2800),formTarget);Runtime.check();page=retry.html;pageBase=safePageUrl(retry.finalUrl,formTarget);renderedSearch=Boolean(verified||renderedSearch);
      if(isChallenge(page)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(pageBase).hostname,label:'需验证',message:'Z-Library 返回验证页。'});return [];}
      if(page){const retryParseStats={parseLayer:'search-results'};try{rows=parseSearch(page,pageBase,retryParseStats);stats=retryParseStats;parsed=true;}catch(error){if(!(error instanceof SyntaxError))throw error;parseError=error;stats=retryParseStats;}}
    }
  }
  if(parsed){html.clearRecoveredTimeoutsSince?.(checkpoint);for(const row of rows)Runtime.check();context?.log?.({phase:rows.length?'parse.success':'source.empty',parseLayer:'search-results',resultCount:rows.length,finalCandidateCount:rows.length,requestUrl:target,finalUrl:pageBase});return rows;}
  if(page){diagnoseSearchFailure(target,pageBase,page,context,stats);context?.log?.({phase:'parse.failed',parseLayer:'search-results',errorName:parseError?.name||'SyntaxError',errorMessage:parseError?.message||'Z-Library 搜索页结构无法识别'});throw parseError||new SyntaxError('Z-Library 搜索页结构无法识别');}
  return [];
}
async function resolve({html,sourceHome=()=>'',sourceVerified=()=>false,renderHtml=async()=>({})},candidate){
  const base=sourceHome()||ORIGIN+'/',target=safeUrl(candidate?.detailUrl||candidate?.storeUrl,base);if(!target)return candidate;
  const context=html.diagnosticContext;context?.log?.({phase:'parse.start',operation:'resolve',parseLayer:'detail',requestUrl:target,verified:Boolean(sourceVerified())});
  const verified=typeof sourceVerified==='function'?Boolean(sourceVerified()):Boolean(sourceVerified);
  let best=null,lastError=null,renderedAttempted=false,challenge=false;
  const inspect=(page,pageBase)=>{
    if(!page)return null;
    if(isChallenge(page)){challenge=true;Runtime.recordFailure({kind:'verification',status:200,host:new URL(pageBase).hostname,label:'需验证',message:'Z-Library 详情页返回验证页。'});return null;}
    try{best=parseDetail(page,candidate,pageBase);if(!best.detailsUnavailable)return best;}catch(error){if(!(error instanceof SyntaxError))throw error;lastError=error;}
    return null;
  };
  if(verified){
    renderedAttempted=true;const rendered=renderedPage(await renderHtml(target,8500,context),target),pageBase=safePageUrl(rendered.finalUrl,target);Runtime.check();const detail=inspect(rendered.html,pageBase);if(challenge)return {...candidate,detailsUnavailable:true};if(detail)return detail;
  }
  let page=await html(target,verified?2600:3000);Runtime.check();let pageBase=target;try{const effective=sourceHome();if(effective&&new URL(effective).origin!==new URL(target).origin)pageBase=new URL(new URL(target).pathname+new URL(target).search,effective).href;}catch{}const detail=inspect(page,pageBase);if(challenge)return {...candidate,detailsUnavailable:true};if(detail)return detail;
  if(!renderedAttempted){
    renderedAttempted=true;const rendered=renderedPage(await renderHtml(target,8500,context),target),pageBase=safePageUrl(rendered.finalUrl,target);Runtime.check();const renderedDetail=inspect(rendered.html,pageBase);if(challenge)return {...candidate,detailsUnavailable:true};if(renderedDetail)return renderedDetail;
  }
  if(best)return best;
  if(lastError){context?.log?.({phase:'parse.failed',operation:'resolve',parseLayer:'detail',errorName:lastError.name,errorMessage:lastError.message,requestUrl:target});Runtime.recordFailure({kind:'parse',status:200,host:new URL(target).hostname,label:'解析失败',message:lastError.message});return {...candidate,detailsUnavailable:true};}
  context?.log?.({phase:'parse.success',operation:'resolve',parseLayer:'detail',resultCount:best&&!best.detailsUnavailable?1:0,requestUrl:target});
  return {...candidate,detailsUnavailable:true};
}
module.exports={ORIGIN,HOST,safeUrl,isChallenge,searchTarget,parseSearch,parseDetail,search,resolve};
