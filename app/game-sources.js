/* Public storefront/catalogue adapters. Product ratings are never age ratings.
   Unavailable stores stay visible as unavailable; no fabricated offline results. */
const Text=require('./metadata-text'),Runtime=require('./metadata-runtime'),Platform=require('./platform-model');
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
const {infoValue,norm}=require('./metadata-enrichment'),{stamp,mergeMetadata}=require('./metadata-merge');
const arr=v=>Array.isArray(v)?v:[],clean=v=>Text.text(v||'').replace(/\s+/g,' ').trim(),unique=a=>[...new Set(a.filter(Boolean))];
const badName=name=>/\bR18DLC\b|\b(DLC|DEMO|soundtrack|season pass|expansion pass|upgrade pass)\b|追加内容|追加內容|追加コンテンツ|ダウンロードコンテンツ|サウンドトラック|体験版|扩展票|擴充票|升级通行证|升級通行證|体验版|體驗版|试玩版|試玩版|原声带|原聲帶/i.test(name||'');
const DLSITE_SECTIONS=Object.freeze([
 ['home','全年龄同人'],['soft','全年龄商业游戏'],['maniax','成人向同人'],['pro','成人向商业游戏'],
 ['girls','乙女向同人'],['girls-pro','乙女商业游戏'],['bl','BL 同人'],['bl-pro','BL 商业游戏'],['app','手机游戏']
].map(([id,label])=>Object.freeze({id,label})));
function dlsiteSearchUrl(query,section='home',page=1){
 if(!DLSITE_SECTIONS.some(v=>v.id===section))throw Error('未知的 DLsite 分区');
 const url=new URL('https://www.dlsite.com/'+section+'/fsr'),params=new URLSearchParams({keyword:query,'work_type_category[0]':'game','order[0]':'match_d',page:String(page),locale:'zh_CN'});
 // These storefronts default to books even with the game type filter. Their
 // official game navigation explicitly selects the commercial PC catalogue.
 if(['girls-pro','bl-pro'].includes(section)){params.set('work_category[0]','pc');params.set(section==='girls-pro'?'is_tl':'is_bl','1');}
 url.search=params;return url.href;
}
function safeUrl(value,base){if(typeof value!=='string'||!value.trim())return '';try{const url=new URL(Text.decode(value),base);return url.protocol==='https:'?url.href:'';}catch{return '';}}
function scriptObjects(html){
 const out=[];for(const m of html.matchAll(/<script[^>]*(?:type=["']application\/(?:ld\+json|json)["'])[^>]*>([\s\S]*?)<\/script>/gi)){try{out.push(JSON.parse(m[1]));}catch{}}
 return out;
}
function walk(value,visit,depth=0){if(!value||typeof value!=='object'||depth>50)return;visit(value);for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,visit,depth+1);}
function gameTerms(query){
 const families=[['塞尔达','薩爾達','ゼルダ','Zelda'],['旷野之息','曠野之息','Breath of the Wild'],['王国之泪','王國之淚','Tears of the Kingdom'],['马里奥','玛利欧','瑪利歐','Mario'],['异度之刃','異度神劍','Xenoblade'],['血源','Bloodborne'],['宇宙机器人','宇宙機器人','Astro Bot'],['恶魔之魂','惡魔靈魂','Demon’s Souls'],['心灵杀手','心靈殺手','Alan Wake'],['最终幻想','最終幻想','FINAL FANTASY']];
 const values=[query];for(const family of families){const matched=family.find(term=>norm(query)===norm(term));if(matched)values.push(...family);}
 return unique(values);
}
function oneEdit(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return edits+(a.length-i)+(b.length-j)<=1;}
// A typo may match a complete title/token, never an arbitrary prefix. In
// particular "onesot" must not accept "OneShotRogue" or storefront recommendations.
function score(entry,terms){
 const names=[entry.name,entry.originalName,...arr(entry.aliases)].filter(Boolean);
 return Math.max(0,...terms.map(term=>{const n=norm(term);if(!n)return 0;
  return Math.max(0,...names.map(raw=>{const name=norm(raw);if(!name)return 0;if(name===n)return 150;
   const english=/^[a-z0-9 ]+$/i.test(clean(term));
   if(name.includes(n)){
    // Keep series searches, but do not confuse Roman numerals (X / XV / XVI).
    if(english&&/[\s]+(?:[ivx]+|\d+)$/i.test(clean(term))){const escaped=clean(term).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');return new RegExp('(?:^|\\b)'+escaped+'(?=$|[^a-z0-9])','i').test(String(raw).normalize('NFKC'))?80:0;}
    return 80;
   }
   if(/^[a-z]{5,12}$/i.test(clean(term))){const tokens=[name,...String(raw).match(/[a-z]{5,}/gi)||[]].map(norm);if(tokens.some(token=>oneEdit(n,token)))return 35;}
   return 0;
  }));
 }));
}
function parseNintendo(html){
 const values=[];for(const m of html.matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)){try{const payload=JSON.parse(m[1])[1];for(const line of payload.split('\n')){const i=line.indexOf(':');if(i<0)continue;try{walk(JSON.parse(line.slice(i+1)),v=>{if(v.title&&v.hardwareCategory&&v.link)values.push(v);});}catch{}}}catch{}}
 return [...new Map(values.map(v=>[v.nsuid||v.link,v])).values()];
}
function dlsiteRows(html){
 const rows=[];for(const m of html.matchAll(/<dl\b[^>]*class=["'][^"']*\bwork_img_main\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/gi)){
  const block=m[1],kind=block.match(/data-worktype=["']([^"']+)["']/i)?.[1]||block.match(/work_type\/([A-Z]+)/)?.[1];
  // The server request already selects the game catalogue. A new/absent type
  // code must not discard a game (ACN=action, DNV=digital novel, etc.). Reject
  // only explicitly non-game products, never an evolving positive whitelist.
  if(/^(?:SOU|MUS|MOV|ICG|MCG|NRE|NOV|MNG|TOL|IMT)$/i.test(kind||''))continue;
  const link=block.match(/class=["'][^"']*\bwork_name\b[^"']*["'][\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i),id=link?.[1]?.match(/product_id\/([A-Z]+\d+)/)?.[1];
  if(!id||!link)continue;
  const image=block.match(/['"]((?:https?:)?\/\/img\.dlsite\.(?:jp|com)\/[^'"]+_img_main\.(?:webp|jpg))['"]/i)?.[1];
  const maker=block.match(/class=["']maker_name["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1];
  rows.push({id:'dlsite-'+id,name:clean(link[2]),developer:clean(maker),cover:safeUrl(image,'https://www.dlsite.com'),storeUrl:link[1],platforms:['dlsite'],genres:[({ADV:'冒险',ACT:'动作',ACN:'动作',RPG:'RPG',SLN:'模拟',SLG:'策略',PZL:'解谜',QIZ:'解谜',TBL:'桌面',SHT:'射击',STG:'射击'})[kind]||'游戏']});
 }return rows;
}
function createGameSources({json,text,steam,aliases=()=>[],settings=()=>({}),diagnostics=()=>{}}) {
 const requestScope=new AsyncLocalStorage(),track=fn=>(...args)=>{const context=requestScope.getStore();if(context)context.requestCount++;return fn(...args);};
 json=track(json);text=track(text);steam=track(steam);
 async function parallel(values,work){const output=[];let cursor=0;await Promise.all(Array.from({length:Math.min(values.length,4)},async()=>{while(cursor<values.length){Runtime.check();const value=await work(values[cursor++]);if(value)output.push(value);}}));return output;}
 async function detail(entry,html){
  let product;for(const object of scriptObjects(html))walk(object,node=>{if(!product&&['Product','VideoGame','SoftwareApplication'].includes(node['@type'])&&node.name&&score({name:node.name},[entry.name])>0)product=node;});
  const image=html.match(/<meta[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const description=product?.description||html.match(/<meta[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const rating=product?.aggregateRating;return {...entry,description:clean(description)||entry.description||'',cover:entry.cover||safeUrl(image,entry.storeUrl),releaseDate:entry.releaseDate||product?.datePublished||'',externalRating:rating?.ratingValue!=null?String(rating.ratingValue):entry.externalRating||'',ratingMax:rating?.bestRating?Number(rating.bestRating):entry.ratingMax,ratingSource:entry.ratingSource||'',developer:entry.developer||clean(product?.author?.name)};
 }
 async function bangumi(query,emit,terms=[query]){
  const response=await json('https://api.bgm.tv/v0/search/subjects?limit=20',8000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:query,sort:'match',filter:{type:[4]}})});
  if(!Array.isArray(response?.data))throw Error('Bangumi 游戏暂不可用');
  const entries=arr(response.data).filter(v=>v.type===4).map(seed=>({id:'bgm-game-'+seed.id,providerId:String(seed.id),name:seed.name_cn||seed.name,originalName:seed.name||'',cover:seed.images?.large||seed.images?.common||'',genres:arr(seed.tags).map(x=>x.name).slice(0,8),developer:infoValue(seed,['开发','开发商','遊戲開發者','开发者']),releaseDate:seed.date||'',description:clean(seed.summary),storeUrl:'https://bgm.tv/subject/'+seed.id,ratingSource:'Bangumi',ratingMax:10,detailsUnavailable:true})).filter(entry=>score(entry,terms)>0&&!badName(entry.name)&&!entry.genres.some(tag=>/^DLC|资料片|資料片$/.test(tag)));
  emit(entries);return entries;
 }
 const nintendo=require('./nintendo-search').createNintendoSearch({json,text,parallel,detail,relevance:score,exclude:badName});
 const {playstation,epic}=require('./storefront-adapters').createStorefrontAdapters({json,text,parallel,detail,relevance:score});
 async function dlsite(query,emit,terms=[query]){
  const found=new Map();let responses=0;
  for(const division of DLSITE_SECTIONS){Runtime.check();try{
   const html=await text(dlsiteSearchUrl(query,division.id,1),8000);if(!html)continue;responses++;
   for(const entry of dlsiteRows(html).filter(v=>!badName(v.name)&&score(v,terms)>0)){const actual=new URL(entry.storeUrl,'https://www.dlsite.com').pathname.split('/')[1];if(!found.has(entry.id))found.set(entry.id,{...entry,providerId:entry.id.replace(/^dlsite-/,'').split('/')[0],storeSection:DLSITE_SECTIONS.find(v=>v.id===actual)?.label||division.label});}
   emit([...found.values()]);const quality=[...found.values()].map(v=>score(v,terms));if(quality.some(value=>value>=150)||quality.filter(value=>value>=80).length>=3)break;
  }catch{Runtime.check();Runtime.recordFailure({kind:'network',status:0,host:'www.dlsite.com',label:'部分分区失败',message:division.label+'连接失败，其他分区继续检索。'});}}
  if(!responses)throw Error('DLsite 目录暂不可用');return [...found.values()].slice(0,40);
 }
 async function search(query,{onProgress}={}){
  const terms=unique([...gameTerms(query),...aliases(query)]);
  const typo=/^[a-z]{5,}$/i.test(query)&&terms.some(t=>norm(t)!==norm(query)&&oneEdit(norm(t),norm(query))),filterTerms=typo?[query]:terms;
  const primary=()=>settings()?.metadataPrimarySourceByType?.game||'steam',sources=[],integrated=()=>mergeMetadata(sources,'game',primary()),emitBundle=()=>{Runtime.check();onProgress?.({type:'game',query,sources:structuredClone(sources),integrated:integrated(),loading:sources.some(s=>s.state==='loading')});};
  const specs=[['steam','Steam',(q,emit)=>steam(q,emit)],['bangumi','Bangumi 游戏',bangumi],['nintendo','Nintendo Switch',nintendo],['playstation','PlayStation',playstation],['epic','Epic Games（egdata）',epic],['dlsite','DLsite',dlsite]];
  const officialSearch={nintendo:'https://www.nintendo.com/hk/search?k='+encodeURIComponent(query),playstation:'https://store.playstation.com/zh-hans-hk/search/'+encodeURIComponent(query),epic:'https://store.epicgames.com/zh-CN/browse?q='+encodeURIComponent(query)+'&sortBy=relevancy&sortDir=DESC&count=40',dlsite:dlsiteSearchUrl(query)};
  const contexts=new Map();for(const [id,label]of specs){const context={runId:randomUUID(),sourceId:id,mediaType:'game',operation:'search',query,queryLength:String(query||'').length,requestCount:0,started:Date.now()};contexts.set(id,context);try{diagnostics({...context,phase:'source.start',verified:false});}catch{}sources.push({id,label,items:[],state:'loading',message:'正在获取…',searchUrl:officialSearch[id]||'',...(id==='dlsite'?{searchLinks:DLSITE_SECTIONS.map(section=>({label:section.label,url:dlsiteSearchUrl(query,section.id)}))}:{})});}emitBundle();
  await Promise.all(specs.map(([id,label,run])=>Runtime.withDiagnostics(async issues=>{
   const group=sources.find(s=>s.id===id),context=contexts.get(id);let failures=0;
   const publish=items=>{Runtime.check();group.items=[...new Map(arr(items).filter(entry=>id==='steam'?Boolean(entry?.id&&entry?.name):score(entry,filterTerms)>0&&!badName(entry.name)).map(entry=>[entry.id,stamp(entry,label,'game',id)])).values()];emitBundle();};
   try{
    let items=await requestScope.run(context,()=>run(query,publish,terms));
    // Also search the mapped original title even when the Chinese query returns
    // a coincidental partial hit (e.g. 月蚀-血源崛起 must not hide Bloodborne).
    if(['nintendo','playstation','epic','dlsite','bangumi'].includes(id)){
      const aliases=terms.filter(term=>term!==query&&/^[\x00-\x7f’]+$/.test(term)).slice(0,1);
      const scores=items.map(entry=>score(entry,filterTerms));if(!scores.some(value=>value>=150)&&scores.filter(value=>value>=80).length<3)for(const term of aliases){const existing=items;const more=await requestScope.run(context,()=>run(term,batch=>publish([...existing,...batch]),terms));items=[...new Map([...existing,...more].map(entry=>[entry.id,entry])).values()];}
    }
    publish(items);group.state=group.items.length?'ok':'empty';group.message=group.items.length?'':'未找到匹配的游戏本体。';
   }catch(error){context.error=error;if(Runtime.signal()?.aborted)throw error;failures++;group.state=group.items.length?'partial':'unavailable';group.message=group.items.length?'部分详情未能获取，可选择已取得的结果。':'此平台目录暂不可用，可切换 Bangumi 游戏等来源。';}
   if(issues.length){context.issue=issues[0];Object.assign(group,require('./metadata-network').summary(issues));if(!group.items.length)group.state='unavailable';else group.state='partial';}
   emitBundle();
  })));
  // Query translations discovered in the live Bangumi response across stores.
  // These are search terms only, never offline candidates or assumed metadata.
  const liveTitles=unique((sources.find(s=>s.id==='bangumi')?.items||[]).filter(entry=>{const s=score(entry,filterTerms);return s===150||s===35;}).slice(0,2).flatMap(entry=>[entry.originalName,...arr(entry.aliases)])).filter(term=>String(term).length>2&&String(term).length<=100&&!terms.some(old=>norm(old)===norm(term))).slice(0,2);
  if(liveTitles.length){
   terms.push(...liveTitles);
   await Promise.all(specs.filter(([id])=>['steam','nintendo','playstation','epic','dlsite'].includes(id)).map(async([id,label,run])=>{
    const group=sources.find(s=>s.id===id),scores=group.items.map(item=>score(item,filterTerms));if(id==='steam'&&group.items.length||scores.some(value=>value>=150)||scores.filter(value=>value>=80).length>=3)return;
    const previousState=group.state,existing=new Map(group.items.map(item=>[item.id,item]));group.state='loading';emitBundle();
    const publish=batch=>{for(const item of batch)if(score(item,filterTerms)>0&&!badName(item.name))existing.set(item.id,stamp(item,label,'game'));group.items=[...existing.values()];emitBundle();};
    try{for(const title of liveTitles.slice(0,1))publish(await requestScope.run(contexts.get(id),()=>run(title,publish,terms)));group.state=group.items.length?'ok':'empty';group.message=group.items.length?'':'未找到匹配的游戏本体。';}
    catch(error){Runtime.check();contexts.get(id).error=error;group.state=group.items.length?'partial':previousState==='empty'?'empty':'unavailable';group.message=group.items.length?'原名补充检索暂不可用，已保留取得的结果。':previousState==='empty'?'未找到匹配的游戏本体；补充原名查询未能完成。':'此平台目录暂不可用。';}emitBundle();
   }));
  }
  for(const [id,context]of contexts){const group=sources.find(source=>source.id===id),phase=group.state==='empty'?'source.empty':['unavailable','partial'].includes(group.state)?'source.failed':'source.success';try{diagnostics({...context,query,phase,status:group.state,durationMs:Date.now()-context.started,requestCount:context.requestCount,resultCount:group.items.length,errorName:context.error?.name||(context.issue?String(context.issue.kind||'Request')+'Error':''),errorMessage:context.error?.message||context.issue?.message||'',verificationHit:false});}catch{}}
  return {query,type:'game',sources,integrated:integrated(),loading:false};
 }
 async function resolveOne(candidate,sourceId){
  let detail=candidate;
  if(sourceId==='bangumi'){
   const id=String(candidate.providerId||candidate.id||'').replace(/^bgm-game-/,'');if(/^\d+$/.test(id)){const v=await json('https://api.bgm.tv/v0/subjects/'+id,8000),inf=keys=>infoValue(v||{},keys),rawPlatforms=inf(['游戏平台','平台']).split(/[、,，/]/);if(v)detail={...candidate,providerId:id,name:v.name_cn||v.name||candidate.name,originalName:v.name||candidate.originalName,aliases:inf(['别名']).split('、'),developer:inf(['开发','开发商','遊戲開發者','开发者']),publisher:inf(['发行','发行商','發行商']),releaseDate:v.date||'',description:clean(v.summary),cover:v.images?.large||v.images?.common||candidate.cover,genres:arr(v.tags).map(x=>x.name).slice(0,12),platforms:unique(rawPlatforms.map(Platform.normalize)),storeUrl:'https://bgm.tv/subject/'+id,externalRating:v.rating?.score?String(v.rating.score):'',ratingSource:'Bangumi',ratingMax:10,detailsUnavailable:false};}
  }else if(sourceId==='nintendo'&&nintendo.resolve)detail=await nintendo.resolve(candidate);
  else if(sourceId==='playstation'&&playstation.resolve)detail=await playstation.resolve(candidate);
  else if(sourceId==='epic'&&epic.resolve)detail=await epic.resolve(candidate);
  else if(sourceId==='dlsite'){
   let url;try{url=new URL(candidate.storeUrl);if(!/^https:$/.test(url.protocol)||!/(?:^|\.)dlsite\.com$/.test(url.hostname))return candidate;url.searchParams.set('locale','zh_CN');}catch{return candidate;}
   const page=await text(url.href,6500);if(page)detail=require('./storefront-adapters').dlsiteDetail(candidate,page);
  }
  const label=({steam:'Steam',bangumi:'Bangumi 游戏',nintendo:'Nintendo Switch',playstation:'PlayStation',epic:'Epic Games（egdata）',dlsite:'DLsite'})[sourceId]||candidate.metadataSource||'';
  const stamped=stamp({...candidate,...detail},label,'game',sourceId);stamped.metadataSource=candidate.integrated?(candidate.metadataSource||label):label;stamped.fieldSources={...(candidate.fieldSources||{})};
  for(const key of ['name','description','developer','publisher','releaseDate','genres','cover','coverPortrait','coverLandscape','externalRating','storeUrl','platforms','platformLinks','steamAppId'])if((Array.isArray(detail[key])?detail[key].length:detail[key]!==undefined&&detail[key]!==null&&detail[key]!=='')&&(!candidate[key]||JSON.stringify(candidate[key])!==JSON.stringify(detail[key])))stamped.fieldSources[key]=label;
  return stamped;
 }
 async function resolveCandidate(candidate){
  if(!candidate||typeof candidate!=='object')return null;const sourceId=candidate._sourceId||candidate.sourceId||'';
  const observed=async(seed,id)=>{const context={runId:randomUUID(),sourceId:id,mediaType:'game',operation:'resolve',query:seed?.name||'',queryLength:String(seed?.name||'').length,requestCount:0,started:Date.now()};try{diagnostics({...context,phase:'source.start',verified:false});}catch{}try{const value=await requestScope.run(context,()=>resolveOne(seed,id)),empty=Boolean(value?.detailsUnavailable);try{diagnostics({...context,phase:empty?'source.empty':'source.success',status:empty?'details-unavailable':'ok',durationMs:Date.now()-context.started,requestCount:context.requestCount,resultCount:empty?0:1,verificationHit:false});}catch{}return value;}catch(error){try{diagnostics({...context,phase:'source.failed',status:'failed',durationMs:Date.now()-context.started,requestCount:context.requestCount,resultCount:0,errorName:error?.name||'Error',errorMessage:error?.message||''});}catch{}throw error;}};
  let base=await observed(candidate,sourceId);
  if(candidate.integrated&&Array.isArray(candidate._matchedCandidates))for(const match of candidate._matchedCandidates){if(['description','developer','publisher','releaseDate','externalRating','cover'].every(key=>Array.isArray(base[key])?base[key].length:base[key]))break;const extra=await observed(match.candidate,match.sourceId),merged=mergeMetadata([{id:sourceId,items:[base]},{id:match.sourceId,items:[extra]}],'game',sourceId).find(row=>String(row.id)===String(base.id));if(merged)base=merged;}
  const output={...base};delete output._matchedCandidates;delete output._sourceId;return output;
 }
 return {search,dlsite,resolveCandidate};
}
module.exports={createGameSources,parseNintendo,dlsiteRows,dlsiteSearchUrl,DLSITE_SECTIONS,gameTerms,score,badName};
