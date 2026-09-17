/* Public, read-only storefront contracts. Epic's catalogue mirror is labelled;
   it is not represented as an official Epic API. No login/captcha workarounds. */
const Text=require('./metadata-text'),Runtime=require('./metadata-runtime');
const clean=v=>Text.text(v||'').replace(/\s+/g,' ').trim(),arr=v=>Array.isArray(v)?v:[];
const exclude=v=>/\b(dlc|demo|soundtrack|season pass|expansion pass|upgrade|press|playtest|beta)\b|追加内容|追加內容|追加コンテンツ|体验版|體驗版|试玩|试用|体験版|原声带|原聲帶/i.test(v||'');
const media=(v,roles)=>arr(v).find(m=>roles.test(m.role||m.type||''))?.url||'';
const epicGenre=value=>/^(动作|冒险|动作冒险|角色扮演|角色扮演游戏|策略|回合制策略|即时战略|模拟|模拟经营|生存|恐怖|解谜|益智|射击|第一人称射击|第三人称射击|平台游戏|平台|竞速|赛车|体育|格斗|音乐|节奏|视觉小说|卡牌|桌游|休闲|独立|街机|开放世界|类魂|Roguelike|Roguelite|Action|Adventure|Action-Adventure|RPG|Strategy|Simulation|Survival|Horror|Puzzle|Shooter|Platformer|Racing|Sports|Fighting|Music|Card Game|Casual|Indie|Open World)$/i.test(value);
// SHA256 of the official PS getSearchResults operation, sorted/printed using
// its public client's convention (GraphQL 14, final LF), verified 2026-09-11.
const PS_SEARCH_HASH='4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa';
function psRows(data,locale='zh-hans-hk',region='香港'){return arr(data?.data?.universalSearch?.results).filter(v=>!exclude(v.name)&&(v.__typename==='Concept'||['FULL_GAME','GAME_BUNDLE','PREMIUM_EDITION','PREORDER','PRE_ORDER'].includes(v.storeDisplayClassification))).map(v=>({id:'ps-'+v.id,name:clean(v.name),cover:media(v.media,/MASTER|GAMEHUB_COVER_ART|PORTRAIT/)||v.media?.[0]?.url||'',coverPortrait:media(v.media,/PORTRAIT|MASTER/),coverLandscape:media(v.media,/GAMEHUB_COVER_ART|BACKGROUND|SCREENSHOT/),storeRegion:region,storeUrl:'https://store.playstation.com/'+locale+'/'+(v.__typename==='Concept'?'concept/':'product/')+v.id,platforms:['ps'],ratingSource:'PlayStation',ratingMax:5,genres:[]}));}
function epicRows(data,terms,relevance){
 const entries=arr(data?.offers).filter(v=>v.offerType==='BASE_GAME'&&!exclude(v.title)&&!v.isCodeRedemptionOnly).map(v=>{
  const slug=v.offerMappings?.find(m=>['productHome','offer'].includes(m.pageType))?.pageSlug||v.catalogNs?.mappings?.find(m=>m.pageType==='productHome')?.pageSlug||v.productSlug;
  return {id:'epic-'+v.namespace+'-'+v.id,offerId:v.id,namespace:v.namespace,name:clean(v.title),description:clean(v.description),developer:clean(v.developerDisplayName),publisher:clean(v.publisherDisplayName||v.seller?.name),cover:media(v.keyImages,/OfferImageTall|DieselGameBoxTall/)||v.keyImages?.[0]?.url||'',coverPortrait:media(v.keyImages,/OfferImageTall|DieselGameBoxTall/),coverLandscape:media(v.keyImages,/OfferImageWide|DieselStoreFrontWide/),releaseDate:(v.releaseDate||'').slice(0,10),genres:arr(v.tags).map(t=>clean(t.name)).filter(epicGenre).slice(0,12),storeUrl:slug&&/^[\w/-]+$/.test(slug)?'https://store.epicgames.com/zh-CN/p/'+slug:'',platforms:['epic'],ratingSource:'Epic Games',ratingMax:5,metadataSource:'Epic Games（egdata）',storeRegion:'全球目录',regionalAvailability:{allowed:arr(v.countriesWhitelist),excluded:arr(v.countriesBlacklist)},_mapped:arr(v.offerMappings).length>0};
 }).filter(v=>v.storeUrl&&relevance(v,terms)>0);
 // The index includes old regional offer records. Prefer mapped Chinese records
 // of the same namespace/product; never merge distinct remasters or sequels.
 const unique=new Map();for(const v of entries){const key=v.namespace+'|'+v.storeUrl,old=unique.get(key);if(!old||Number(v._mapped)>Number(old._mapped)||(v._mapped===old._mapped&&/[\u3400-\u9fff]/.test(v.description)&&!/[\u3400-\u9fff]/.test(old.description)))unique.set(key,v);}
 return [...unique.values()].map(({_mapped,...v})=>v);
}
function dlsiteDetail(entry,html){
 const heading=html.match(/<h1[^>]*id=["']work_name["'][^>]*>([\s\S]*?)<\/h1>/i);if(!heading)return {...entry,detailsUnavailable:true};
 const table=html.match(/<table[^>]*id=["']work_outline["'][^>]*>([\s\S]*?)<\/table>/i)?.[1]||'';
 const values={};for(const m of table.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi))values[clean(m[1])]=m[2];
 const released=clean(values['发售日']||values['販売日']||values['販賣日']).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
 const description=html.match(/<div[^>]*itemprop=["']description["'][^>]*>([\s\S]*?)<!--\s*spec\s*-->/i)?.[1]||'';
 const genreBlock=values['分类']||values['ジャンル']||'',genres=[...genreBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>clean(m[1]));
 // Only product microdata, not visitors' individual review scores.
 const rating=html.match(/itemprop=["']ratingValue["'][^>]*content=["']([\d.]+)["']/i)?.[1];
 return {...entry,name:clean(heading[1]),description:clean(description)||entry.description||'',releaseDate:released?released[1]+'-'+released[2].padStart(2,'0')+'-'+released[3].padStart(2,'0'):entry.releaseDate||'',genres:[...new Set([...entry.genres,...genres])],externalRating:rating||entry.externalRating||'',ratingSource:'DLsite',ratingMax:5,detailsUnavailable:false};
}
function psDetail(entry,html){
 const nodes=[];const walk=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>45)return;if(v.__typename==='Product'||v.__typename==='Concept')nodes.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x,depth+1);};
 for(const script of html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(script[1]));}catch{}}
 const id=entry.id.replace(/^ps-/,''),concept=nodes.find(v=>v.__typename==='Concept'&&String(v.id)===id);
 const products=arr(concept?.products).map(p=>String(p.__ref||p.id||'').replace(/^Product:/,''));
 const matches=nodes.filter(v=>v.__typename==='Product'&&(String(v.id)===id||products.includes(String(v.id))));
 const out={...entry};for(const v of matches){
  const description=arr(v.descriptions).find(d=>d.type==='LONG')?.value;if(description)out.description=clean(description);
  if(v.publisherName)out.publisher=clean(v.publisherName);if(v.developerName)out.developer=clean(v.developerName);
  if(v.releaseDate){const time=new Date(v.releaseDate).getTime();out.releaseDate=Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,10):'';}
  if(arr(v.localizedGenres).length)out.genres=v.localizedGenres.map(g=>clean(g.value));
  const rating=v.starRating;if(rating?.totalRatingsCount>0&&Number(rating.averageRating)>=0&&Number(rating.averageRating)<=5){out.externalRating=String(rating.averageRating);out.ratingSource='PlayStation';out.ratingMax=5;}
 }
 out.detailsUnavailable=!matches.length&&!out.description;return out;
}
function createStorefrontAdapters({json,text,parallel,detail,relevance}){
 async function playstation(query,emit,terms=[query]){
  const entries=new Map();let successes=0,failures=0;
  const regions=[['hk','zh','zh-hans-hk','香港'],['us','en','en-us','美国'],['jp','ja','ja-jp','日本'],['gb','en','en-gb','英国']];
  const publish=(batch,rank)=>{for(const item of batch){const previous=entries.get(item.id);const links={...previous?.regionalLinks,[regions[rank][0].toUpperCase()]:item.storeUrl};if(!previous||rank<previous._regionRank)entries.set(item.id,{...item,regionalLinks:links,_regionRank:rank});else previous.regionalLinks=links;}emit([...entries.values()].map(({_regionRank,...v})=>v));};
  await Promise.all(regions.map(async([country,language,locale,label],rank)=>{
   let cursor='';const seen=new Set();
   try{for(let offset=0;offset<240;offset+=24){
    Runtime.check();const variables={countryCode:country,languageCode:language,pageSize:24,pageOffset:offset,searchTerm:query,nextCursor:cursor};
    const url='https://web.np.playstation.com/api/graphql/v1/op?operationName=getSearchResults&variables='+encodeURIComponent(JSON.stringify(variables))+'&extensions='+encodeURIComponent(JSON.stringify({persistedQuery:{version:1,sha256Hash:PS_SEARCH_HASH}}));
    const data=await json(url,8500,{headers:{'Content-Type':'application/json','x-psn-store-locale-override':locale==='zh-hans-hk'?'zh-Hans-HK':locale}});
    const result=data?.data?.universalSearch;if(!Array.isArray(result?.results))throw Error('地区公开检索未成功');successes++;
    publish(psRows(data,locale,label).filter(entry=>relevance(entry,terms)>0),rank);
    const signature=result.results.map(v=>v.id).join('|');if(seen.has(signature)||result.pageInfo?.isLast||!result.results.length)break;seen.add(signature);cursor=result.next||'';
   }}catch{Runtime.check();failures++;}
  }));
  if(!successes)throw Error('PlayStation 公开目录暂不可用');
  const values=[...entries.values()].map(({_regionRank,...v})=>v),complete=new Map(values.map(v=>[v.id,v]));
  await parallel(values,async entry=>{const html=await text(entry.storeUrl,6500),result=psDetail(await detail(entry,html),html);if(failures)result.detailsUnavailable=true;complete.set(result.id,result);emit([...complete.values()]);return result;});
  return [...complete.values()];
 }
 async function epic(query,emit,terms){
  const all=[];let gotResponse=false;
  for(let page=1;page<=4;page++){
   const data=await json('https://api.egdata.app/search/v2/search?country=CN&locale=zh-CN',9000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:query,offerType:'BASE_GAME',page,limit:50})});
   if(!Array.isArray(data?.offers))throw Error('Epic 公开目录索引未成功');gotResponse=true;all.push(...data.offers);emit(epicRows({offers:all},terms,relevance));if(data.offers.length<50||page*50>=data.total)break;
  }
  if(!gotResponse)throw Error('Epic 目录不可用');
  const entries=epicRows({offers:all},terms,relevance);
  return parallel(entries,async entry=>{const polls=await json('https://api.egdata.app/offers/'+encodeURIComponent(entry.offerId)+'/polls',5500);const rating=Number(polls?.averageRating);return {...entry,externalRating:polls?.averageRating!=null&&rating>0&&rating<=5?String(rating):'',ratingMax:5,ratingSource:'Epic Games'};});
 }
 return {playstation,epic};
}
module.exports={createStorefrontAdapters,psRows,epicRows,dlsiteDetail,psDetail,PS_SEARCH_HASH};
