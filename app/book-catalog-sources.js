const H=require('./metadata-html'),Runtime=require('./metadata-runtime');
const origins={tstrs:'https://tstrs.me',onelib:'https://zh.1lib.sk'};
function safeSiteUrl(value,base){try{const u=new URL(value,base);return u.protocol==='https:'&&u.origin===new URL(base).origin&&!u.username&&!u.password&&!u.port?u.href:'';}catch{return '';}}
function safePageUrl(value,fallback){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:fallback;}catch{return fallback;}}
function url(value,origin){const target=safeSiteUrl(value,origin);try{return target&&/^\/book\/[\w-]+(?:\/[\w%-]+)?\/?$/.test(new URL(target).pathname)?target:'';}catch{return '';}}
function oneLibSearchUrl(query,base){try{return new URL('/s/'+encodeURIComponent(String(query||'').trim().slice(0,240)),new URL(base).origin).href;}catch{return '';}}
function oneLibRouteForGetForm(value,query,base){
  try{const form=new URL(value),queryName=[...form.searchParams.keys()].find(name=>/^(?:q|query|keyword|search|title|term)$/i.test(name));if(/^\/s\/?$/i.test(form.pathname)&&queryName)return oneLibSearchUrl(query,base);}catch{}
  return value;
}
function noResults(html){return /没有找到|未找到相关|没有搜索到|暂无(?:相关)?书籍|No books found|Nothing found|no results|0\s+(?:matching\s+)?results?|showing\s+0\s*(?:-|of)\s*0/i.test(H.text(html));}
function verificationPage(html){return /checking your browser|verifying your browser|diamwall|just a moment|cf-chl-|captcha|验证码|机器人验证|verify you are human|access denied|登录后(?:继续|查看|搜索)/i.test(String(html||''));}
function oneLibDetailPath(path){return /^\/(?:book|books?|detail|bookinfo|item)\/(?!s(?:\/|$)|search(?:\/|$))[^/?#]+(?:\/[^?#]*)?\/?$/i.test(path);}
function titleFromAnchor(attrs,body,path,stats={}){
  const heading=body.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i)?.[1]||body.match(/<(?:span|div)[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i)?.[1];
  const dataTag=body.match(/<([a-z][\w:-]*)\b[^>]*\bdata-(?:book-)?(?:title|name)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/i);
  const dataAttr=dataTag?.[2]||body.match(/<[^>]+\bdata-(?:book-)?(?:title|name)=["']([^"']+)["'][^>]*>/i)?.[1]||attrs['data-book-title']||attrs['data-title']||attrs['data-name'];
  const imageTag=body.match(/<(?:img|source)\b[^>]*>/i),imageAttrs=imageTag?H.attributes(imageTag[0]):{};
  let urlTitle='';try{const segment=decodeURIComponent(String(path||'').split('/').filter(Boolean).at(-1)||'').replace(/\.(?:html?|php)$/i,'');if(segment.length>=3&&!/^[\da-f_-]{20,}$/i.test(segment))urlTitle=segment.replace(/[-_]+/g,' ').trim();}catch{}
  const candidates=[
    ['heading',heading],['data',dataAttr||dataTag?.[3]],['image-alt',imageAttrs.alt||imageAttrs.title],
    ['label',attrs['data-yueden-accessible-label']||attrs['aria-label']||attrs.title],['text',body],['url-slug',urlTitle],
  ];
  for(const [kind,value] of candidates){
    let title=H.text(value||'').replace(/^\s*(?:book|title)\s*[:：]\s*/i,'').replace(/\s*[|·•]\s*(?:详情|详情页|details?|read more).*$/i,'').replace(/\s+/g,' ').trim();
    if(title.length>250)title=title.split(/\s{2,}|\n|\r/)[0].slice(0,250).trim();
    if(!title||/^(?:details?|read more|下载|download|查看|查看详情)$/i.test(title))continue;
    stats.nameSourceCounts[kind]=(stats.nameSourceCounts[kind]||0)+1;
    return title;
  }
  return '';
}
function parseOneLibSearch(html,base,stats={}){
  if(!html)return [];
  const result=[],seen=new Set();Object.assign(stats,{totalAnchors:[...String(html).matchAll(/<a\b/gi)].length,safeUrlAccepted:0,rejectedDifferentOrigin:0,rejectedUnsafeUrl:0,detailPathAccepted:0,detailPathRejected:0,nameRecognized:0,nameSourceCounts:{heading:0,data:0,'image-alt':0,label:0,text:0,'url-slug':0},finalCandidateCount:0,detailCandidateCount:0});
  for(const block of H.blocks(html,'a',attrs=>Boolean(attrs.href))){
    let parsed;try{parsed=new URL(block.attrs.href,base);}catch{stats.rejectedUnsafeUrl=(stats.rejectedUnsafeUrl||0)+1;continue;}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port){stats.rejectedUnsafeUrl=(stats.rejectedUnsafeUrl||0)+1;continue;}
    if(parsed.origin!==new URL(base).origin){stats.rejectedDifferentOrigin=(stats.rejectedDifferentOrigin||0)+1;continue;}
    const target=parsed.href;stats.safeUrlAccepted=(stats.safeUrlAccepted||0)+1;
    if(!oneLibDetailPath(parsed.pathname)){stats.detailPathRejected=(stats.detailPathRejected||0)+1;continue;}
    stats.detailPathAccepted=(stats.detailPathAccepted||0)+1;
    const title=titleFromAnchor(block.attrs,block.body,parsed.pathname,stats);if(!title||title.length>250)continue;stats.nameRecognized=(stats.nameRecognized||0)+1;
    const key=parsed.pathname;if(seen.has(key))continue;seen.add(key);
    const img=block.body.match(/<(?:img|source)\b[^>]*>/i)?.[0],attrs=img?H.attributes(img):{};
    const cover=attrs.src||attrs['data-src']||attrs.srcset?.split(/\s+/)[0]||'';
    let safeCover='';try{const image=new URL(cover,base);if(image.protocol==='https:'&&!image.username&&!image.password)safeCover=image.href;}catch{}
    result.push({id:'onelib-'+key.replace(/[^\w-]+/g,'-').replace(/^-|-$/g,''),providerId:key,detailUrl:target,name:title,cover:safeCover,storeUrl:target,metadataSource:'1lib',genres:[],detailsUnavailable:true});
    if(result.length>=12)break;
  }
  stats.finalCandidateCount=result.length;stats.detailCandidateCount=stats.detailPathAccepted||0;
  if(!result.length&&!noResults(html))throw new SyntaxError('1lib 搜索页结构无法识别');
  return result;
}
function parseSearch(html,id,base=origins[id],stats={}){
  if(id==='onelib')return parseOneLibSearch(html,base,stats);
  if(!html)return [];
  const blocks=H.blocks(html,'div',a=>/^sr-\d+$/.test(a.id||'')),result=[];
  for(const block of blocks){const link=H.attributes(block.body.match(/<a\b[^>]*>/i)?.[0]||'').href,target=url(link,origins.tstrs);if(!target||result.some(v=>v.storeUrl===target))continue;const title=H.text(block.body.match(/<b[^>]*>([\s\S]*?)<\/b>/i)?.[1]);if(!title)continue;result.push({id:'tstrs-'+new URL(target).pathname.split('/')[2],name:title,storeUrl:target,detailsUnavailable:true});}
  if(!result.length&&!noResults(html))throw new SyntaxError('书籍搜索页结构无法识别');
  return result.slice(0,5);
}
function field(value){const text=H.text(value);return /^(?:【)?(?:未找到(?:作者|出版社)?信息|暂无(?:简介|描述|信息)|无简介)(?:】)?$/.test(text)?'':text;}
function meta(html,key){
  const wanted=key.toLowerCase();
  for(const match of String(html||'').matchAll(/<meta\b[^>]*>/gi)){const attrs=H.attributes(match[0]);if([attrs.property,attrs.name,attrs.itemprop].some(value=>String(value||'').toLowerCase()===wanted))return attrs.content||'';}
  return '';
}
function labeled(html,...labels){
  const wanted=new Set(labels.map(value=>value.toLowerCase()));
  for(const row of H.blocks(html,'tr',()=>true)){
    const cells=[...row.body.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(match=>H.text(match[1]));
    if(cells.length>1&&wanted.has(cells[0].replace(/[：:]$/,'').toLowerCase()))return cells.slice(1).join('、');
  }
  for(const row of H.blocks(html,'dt',()=>true)){const label=H.text(row.body);if(wanted.has(label.replace(/[：:]$/,'').toLowerCase()))return field(row.body);}
  for(const match of String(html||'').matchAll(/<(?:div|span|p|li)\b[^>]*>([\s\S]*?)<\/(?:div|span|p|li)>/gi)){
    const text=H.text(match[1]);const divider=text.search(/[：:]/);if(divider>0&&wanted.has(text.slice(0,divider).trim().toLowerCase()))return text.slice(divider+1).trim();
  }
  return '';
}
function parseOneLibDetail(html,seed,base){
  if(!html)return seed;
  const data=H.structured(html,'Book')[0]||{},props={};
  for(const match of String(html).matchAll(/<([a-z][\w:-]*)\b([^>]*\bitemprop\s*=\s*["'][^"']+["'][^>]*)>([\s\S]*?)<\/\1>/gi)){const attrs=H.attributes('<'+match[1]+' '+match[2]+'>');if(!props[attrs.itemprop])props[attrs.itemprop]=H.text(attrs.content||attrs.href||match[3]);}
  const person=value=>[value].flat().filter(Boolean).map(item=>field(typeof item==='string'?item:item.name)).filter(Boolean).join('、');
  const heading=H.text(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
  const name=field(data.name||props.name||meta(html,'og:title')||heading||meta(html,'twitter:title'))||seed.name;
  const description=field(data.description||props.description||meta(html,'og:description')||meta(html,'description'));
  const author=person(data.author||data.creator)||props.author||labeled(html,'作者','作者信息','author','authors','creator');
  const publisher=person(data.publisher)||props.publisher||labeled(html,'出版社','出版者','publisher');
  const rawIsbn=String(data.isbn||props.isbn||labeled(html,'ISBN','ISBN-13','ISBN-10')||''),isbn=require('./metadata-enrichment').isbn(rawIsbn);
  const pages=require('./metadata-enrichment').count(String(data.numberOfPages||props.numberOfPages||labeled(html,'页数','页','pages')||''));
  const releaseDate=field(data.datePublished||props.datePublished||labeled(html,'出版日期','出版时间','published','publication date'));
  const image=typeof data.image==='string'?data.image:data.image?.url||props.image||meta(html,'og:image')||meta(html,'twitter:image');
  let cover='';try{if(image){const target=new URL(image,base);if(target.protocol==='https:'&&!target.username&&!target.password)cover=target.href;}}catch{}
  const genres=[data.genre,props.genre].flat().filter(Boolean).map(H.text);
  const known=Boolean(description||author||publisher||isbn||pages||releaseDate||cover||data.name||props.name);
  return {...seed,name,description,developer:author,publisher,isbn,releaseDate,pages,genres,cover,storeUrl:seed.detailUrl||seed.storeUrl,metadataSource:'1lib',detailsUnavailable:!known};
}
function parseDetail(html,seed,id='tstrs',base=origins[id]){
  if(id==='onelib')return parseOneLibDetail(html,seed,base);
  if(!html)return seed;const data=H.structured(html,'Book')[0];if(!data?.name)throw new SyntaxError('书籍详情缺少可识别的公开 Book 元数据');const person=v=>[v].flat().filter(Boolean).map(v=>field(typeof v==='string'?v:v.name)).filter(Boolean).join('、');const description=H.blocks(html,'p',a=>a.itemprop==='description').map(v=>field(v.body)).sort((a,b)=>b.length-a.length)[0]||field(data.description);let cover='';try{const u=new URL(typeof data.image==='string'?data.image:data.image?.url);if(u.protocol==='https:'&&!u.username&&!u.password)cover=u.href;}catch{}return {...seed,name:H.text(data.name),description,developer:person(data.author),publisher:person(data.publisher),isbn:require('./metadata-enrichment').isbn(String(data.isbn||'')),releaseDate:H.text(data.datePublished),pages:require('./metadata-enrichment').count(String(data.numberOfPages||'')),genres:[data.genre].flat().filter(v=>typeof v==='string').map(H.text),cover,detailsUnavailable:!description};
}
function renderedPage(value,fallbackUrl=''){return typeof value==='string'?{html:value,finalUrl:fallbackUrl}:{html:String(value?.html||''),finalUrl:String(value?.finalUrl||fallbackUrl||'')};}
function diagnoseSearchFailure(requestUrl,finalUrl,html,context,stats){require('./metadata-book-diagnostics').write('onelib',requestUrl,finalUrl,html,verificationPage(html),context,stats);}
async function search({html,emit=()=>{},sourceHome=()=>'',sourceVerified=()=>false,renderHtml=async()=>({})},query,id){
  const fallback=origins[id];if(!fallback)throw Error('未知书籍源');
  const home=sourceHome()||fallback,homeUrl=safeSiteUrl(home,home)||fallback,origin=new URL(homeUrl).origin;
  let target;
  if(id==='tstrs')target=origin+'/search?q='+encodeURIComponent(query);
  else{const current=new URL(homeUrl),searchPath=/^\/(?:s|search)(?:\/|$)/i.test(current.pathname);if(searchPath&&decodeURIComponent(current.pathname.split('/').pop()||'')===String(query))target=current.href;else target=oneLibSearchUrl(query,homeUrl);}
  if(id==='onelib')return searchOneLib({html,emit,sourceHome,sourceVerified,renderHtml},query,target);
  let page=await html(target,9000),rows=[];
  try{if(page)rows=parseSearch(page,id,target);}
  catch(error){if(!(error instanceof SyntaxError))throw error;throw error;}
  for(const row of rows){Runtime.check();emit(row);}return rows;
}
async function searchOneLib({html,emit,sourceHome,sourceVerified=()=>false,renderHtml},query,target){
  const checkpoint=html.timeoutCheckpoint?.()??0,verified=typeof sourceVerified==='function'?Boolean(sourceVerified()):Boolean(sourceVerified);
  const context=html.diagnosticContext;let stats={parseLayer:'search-results'};context?.log?.({phase:'parse.start',parseLayer:'search-results',requestUrl:target,verified});
  let rows=[],page='',pageBase=target,renderedAttempted=false,parsed=false,challenge=false,lastPage='',lastPageBase=target,parseError=null;
  const inspectRendered=async()=>{
    renderedAttempted=true;const rendered=renderedPage(await renderHtml(target,8500,context),target);Runtime.check();page=rendered.html;pageBase=safePageUrl(rendered.finalUrl||target,target);if(page){lastPage=page;lastPageBase=pageBase;}
    if(verificationPage(page)){challenge=true;Runtime.recordFailure({kind:'verification',status:200,host:new URL(pageBase).hostname,label:'需验证',message:'1lib 返回浏览器验证或登录页面。'});return;}
    if(!page)return;
    try{rows=parseSearch(page,'onelib',pageBase,stats);parsed=true;}catch(error){if(!(error instanceof SyntaxError))throw error;parseError=error;}
  };
  if(verified){await inspectRendered();if(challenge)return [];}
  if(!parsed){
    const requestHome=sourceHome()||target;page=await html(target,verified?2600:3000);Runtime.check();if(page){lastPage=page;lastPageBase=target;}
    if(verificationPage(page)){Runtime.recordFailure({kind:'verification',status:200,host:new URL(target).hostname,label:'需验证',message:'1lib 返回浏览器验证或登录页面。'});return [];}
    if(page){
      const latestHome=sourceHome(),responseBase=latestHome&&latestHome!==requestHome?latestHome:target;
      try{rows=parseSearch(page,'onelib',responseBase,stats);pageBase=responseBase;parsed=true;}catch(error){if(!(error instanceof SyntaxError))throw error;parseError=error;}
    }
  }
  if(!parsed&&!renderedAttempted){await inspectRendered();if(challenge)return [];}
  if(!parsed&&lastPage){
    const formStats={},detectedFormTarget=require('./metadata-search-form').buildGetSearchUrl(lastPage,query,lastPageBase,formStats),formTarget=oneLibRouteForGetForm(detectedFormTarget,query,lastPageBase);
    if(formTarget&&formTarget!==target){
      context?.log?.({phase:'search.form-retry',parseLayer:'search-results',requestUrl:formTarget,verified,formCount:formStats.formCount,searchFormCandidateCount:formStats.searchFormCandidateCount});
      const retry=renderedAttempted||verified?renderedPage(await renderHtml(formTarget,8500,context),formTarget):renderedPage(await html(formTarget,3000),formTarget);Runtime.check();page=retry.html;pageBase=safePageUrl(retry.finalUrl||formTarget,formTarget);
      if(page){lastPage=page;lastPageBase=pageBase;if(verificationPage(page)){challenge=true;Runtime.recordFailure({kind:'verification',status:200,host:new URL(pageBase).hostname,label:'需验证',message:'1lib 返回浏览器验证或登录页面。'});}else{const retryStats={parseLayer:'search-results'};try{rows=parseSearch(page,'onelib',pageBase,retryStats);stats=retryStats;parsed=true;parseError=null;}catch(error){if(!(error instanceof SyntaxError))throw error;stats=retryStats;parseError=error;}}}
      if(challenge)return [];
    }
  }
  if(parsed)html.clearRecoveredTimeoutsSince?.(checkpoint);
  else if(lastPage){diagnoseSearchFailure(target,pageBase,lastPage,context,stats);context?.log?.({phase:'parse.failed',parseLayer:'search-results',errorName:parseError?.name||'SyntaxError',errorMessage:parseError?.message||'1lib 搜索页结构无法识别'});throw parseError||new SyntaxError('1lib 搜索页结构无法识别');}
  else if(page){diagnoseSearchFailure(target,pageBase,page,context,stats);context?.log?.({phase:'parse.failed',parseLayer:'search-results',errorName:parseError?.name||'SyntaxError',errorMessage:parseError?.message||'1lib 搜索页结构无法识别'});throw parseError||new SyntaxError('1lib 搜索页结构无法识别');}
  if(parsed)context?.log?.({phase:rows.length?'parse.success':'source.empty',parseLayer:'search-results',resultCount:rows.length,finalCandidateCount:rows.length,requestUrl:target,finalUrl:pageBase});
  for(const row of rows){Runtime.check();emit(row);}return rows;
}
async function resolveCandidate({html,sourceHome=()=>'',sourceVerified=()=>false,renderHtml=async()=>({})},candidate,id){
  const fallback=origins[id];if(!fallback)return candidate;const base=sourceHome()||fallback,siteOrigin=new URL(base).origin;
  const target=id==='onelib'?safeSiteUrl(candidate?.detailUrl||candidate?.storeUrl,base):url(candidate?.storeUrl,siteOrigin);if(!target)return candidate;
  if(id==='onelib')return resolveOneLib({html,sourceHome,sourceVerified,renderHtml},candidate,target);
  let page=await html(target,9000),parseBase=target;
  if(!page)return candidate;
  try{return parseDetail(page,candidate,id,parseBase);}catch(error){Runtime.recordFailure({kind:'parse',status:200,host:new URL(parseBase).hostname,label:'解析失败',message:error.message});return candidate;}
}
async function resolveOneLib({html,sourceHome=()=>'',sourceVerified=()=>false,renderHtml=async()=>({})},candidate,target){
  const verified=typeof sourceVerified==='function'?Boolean(sourceVerified()):Boolean(sourceVerified);
  const context=html.diagnosticContext;context?.log?.({phase:'parse.start',operation:'resolve',parseLayer:'detail',requestUrl:target,verified});
  let renderedAttempted=false,best=null,lastError=null,hadPage=false,challenge=false;
  const inspect=async(page,base)=>{
    if(!page)return null;hadPage=true;
    if(verificationPage(page)){challenge=true;Runtime.recordFailure({kind:'verification',status:200,host:new URL(base).hostname,label:'需验证',message:'1lib 详情页要求验证或登录。'});return null;}
    try{const detail=parseDetail(page,candidate,'onelib',base);best=detail;if(!detail.detailsUnavailable)return detail;}
    catch(error){if(!(error instanceof SyntaxError))throw error;lastError=error;}
    return null;
  };
  if(verified){
    renderedAttempted=true;const rendered=renderedPage(await renderHtml(target,8500,context),target);Runtime.check();const base=safePageUrl(rendered.finalUrl||target,target),detail=await inspect(rendered.html,base);if(challenge)return {...candidate,detailsUnavailable:true};if(detail)return detail;
  }
  const page=await html(target,verified?2600:3000,context);Runtime.check();const latestHome=sourceHome();let pageBase=target;try{if(latestHome&&new URL(latestHome).origin!==new URL(target).origin)pageBase=safePageUrl(latestHome,target);}catch{}
  const httpDetail=await inspect(page,pageBase);if(challenge)return {...candidate,detailsUnavailable:true};if(httpDetail)return httpDetail;
  if(!renderedAttempted){
    renderedAttempted=true;const rendered=renderedPage(await renderHtml(target,8500,context),target);Runtime.check();const base=safePageUrl(rendered.finalUrl||target,target),detail=await inspect(rendered.html,base);if(challenge)return {...candidate,detailsUnavailable:true};if(detail)return detail;
  }
  if(lastError&&hadPage){Runtime.recordFailure({kind:'parse',status:200,host:new URL(target).hostname,label:'解析失败',message:lastError.message});}
  context?.log?.({phase:lastError?'parse.failed':'parse.success',operation:'resolve',parseLayer:'detail',resultCount:best&&!best.detailsUnavailable?1:0,errorName:lastError?.name||'',errorMessage:lastError?.message||'',requestUrl:target});return best||candidate;
}
module.exports={search,parseSearch,parseDetail,resolveCandidate,origins};
