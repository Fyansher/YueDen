/* Independent online adapters + conservative complementing. No offline metadata. */
const {createProviders,elementBody,isbn,count,norm,relevance}=require('./metadata-enrichment');
const {mergeMetadata,stamp,isbnKey}=require('./metadata-merge');
const Text=require('./metadata-text');
const Runtime=require('./metadata-runtime');
const {randomUUID}=require('node:crypto');
const buildGetSearchUrl=require('./metadata-search-form').buildGetSearchUrl;
const clean=value=>Text.text(value??'').replace(/[ \t]+/g,' ').trim();
const arr=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values.filter(Boolean))];
const primaryDefaults={game:'steam',movie:'douban',anime:'bangumi',manga:'bangumi',book:'douban'};
const primaryFor=(type,config)=>config?.metadataPrimarySourceByType?.[type]||primaryDefaults[type]||'';
const cn=value=>/[\u3400-\u9fff]/.test(value||'');
const genreNames={Action:'动作',Adventure:'冒险',Comedy:'喜剧',Drama:'剧情',Fantasy:'奇幻',Horror:'恐怖',Mystery:'悬疑',Romance:'爱情','Sci-Fi':'科幻','Science-Fiction':'科幻','Science Fiction':'科幻','Slice of Life':'日常',Sports:'运动',Supernatural:'超自然',Thriller:'惊悚',Animation:'动画',Documentary:'纪录片',Music:'音乐'};
const genres=values=>unique(arr(values).map(value=>genreNames[value]||clean(value)));
const dateOf=d=>d?.year?[d.year,d.month&&String(d.month).padStart(2,'0'),d.day&&String(d.day).padStart(2,'0')].filter(Boolean).join('-'):'';
const scope=name=>/第.{1,4}季|\bseason\s*\d+/i.test(name||'')?'season':'';
function infoRows(html) {
  return elementBody(html,'info').split(/<br\b[^>]*>/gi).map(part=>clean(part).replace(/\s+/g,' ')).filter(Boolean);
}
function infoField(rows,...labels) {for(const label of labels){const row=rows.find(row=>new RegExp('^'+label+'\\s*[:：]').test(row));if(row)return row.replace(new RegExp('^'+label+'\\s*[:：]\\s*'),'');}return '';}
function uniqueRecords(entries) {const seen=new Set();return arr(entries).filter(entry=>{const id=String(entry.id||entry.storeUrl||'');if(!id||seen.has(id))return false;seen.add(id);return true;});}
function createSourceSearch({json,text,settings=()=>({}),pace=350,sourceHome=()=>'',sourceVerified=()=>false,renderHtml=async()=>({html:'',finalUrl:''}),diagnostics=()=>{},bookSourceEndpoints=null}) {
  const slots=new Map(),inflight=new Map();
  const detailProviders=createProviders({json:(url,timeout,options)=>json(url,timeout,options),text:(url,timeout)=>text(url,timeout)});
  function diagnosticContext(sourceId,mediaType,operation,query=''){
    const context={runId:randomUUID(),sourceId,mediaType,operation,query:String(query||''),queryLength:String(query||'').length,verified:Boolean(sourceVerified(sourceId)),requestCount:0};
    context.log=event=>{try{diagnostics({...context,...event,query:context.query});}catch{}};
    return context;
  }
  async function limited(url,options={},asText=false,sourceId='',timeoutMs=8000,context=null) {
    if(pace){const schedule=Runtime.slots(slots),host=new URL(url).hostname,min=/itunes/.test(host)?3100:/jikan|openlibrary/.test(host)?Math.max(400,pace):pace;const start=Math.max(Date.now(),schedule.get(host)||0);schedule.set(host,start+min);if(start>Date.now())await Runtime.delay(start-Date.now());}
    Runtime.check();try{return await(asText?text(url,timeoutMs,sourceId,context):json(url,timeoutMs,options,sourceId,context));}catch{Runtime.check();return asText?'':null;}
  }
  async function map(values,work,onEntry=()=>{}) {const output=new Array(values.length);let cursor=0;await Promise.all(Array.from({length:Math.min(3,values.length)},async()=>{while(cursor<values.length){Runtime.check();const i=cursor++;try{output[i]=await work(values[i]);if(output[i])onEntry(output[i]);}catch{Runtime.check();output[i]=null;}}}));return output.filter(Boolean);}
  async function runSource(id,label,type,query,run,onEntries=()=>{}) {
    return Runtime.withDiagnostics(async issues=>{
    let failures=0,requests=0,lastError=null;const started=Date.now(),context=diagnosticContext(id,type,'search',query);
    context.log({phase:'source.start',queryLength:context.queryLength,verified:context.verified});
    const get=async(url,options={})=>{requests++;const result=await limited(url,options,false,id,8000,context);if(result===null||result?.errors||result?.error){failures++;return null;}return result;};
    const htmlAttempts=[];
    const html=async(url,timeout=8000,requestContext=context)=>{requests++;const captured=await Runtime.captureFailures(()=>limited(url,{},true,id,timeout,requestContext));const result=captured.value;htmlAttempts.push({captured,failed:!result});if(!result){failures++;return '';}return result;};
    html.diagnosticContext=context;
    html.timeoutCheckpoint=()=>htmlAttempts.length;
    html.clearRecoveredTimeoutsSince=checkpoint=>{const start=Math.max(0,Number(checkpoint)||0),attempts=htmlAttempts.splice(start);for(const attempt of attempts)if(attempt.failed)failures=Math.max(0,failures-attempt.captured.discardTimeouts());else attempt.captured.discardTimeouts();};
    const arriving=new Map(),emit=entry=>{Runtime.check();if(!entry?.id)return;if(id==='bangumi'&&type==='movie'&&entry.episodes!==1)return;const value=stamp({...entry,genres:genres(entry.genres),...(id==='bangumi'&&type==='movie'?{scope:'film'}:{})},label,type,id);arriving.set(String(value.id),value);onEntries([...arriving.values()]);};
    const raw=createProviders({json:(url,timeout,options)=>get(url,options),text:html,onEntry:emit});
    let items=[],recoveredBookSource=false;try{
      const bookSource=['onelib','zlibrary'].includes(id),initialHome=sourceHome(id)||({onelib:'https://zh.1lib.sk/',zlibrary:'https://zh.zlib.bz/'}[id]||''),tried=new Set();
      let endpoints=bookSource?bookSourceEndpoints?.candidates(id,initialHome)||[initialHome]:[null],attempt=0;
      while(true){
        const home=bookSource?endpoints.find(value=>value&&!tried.has(new URL(value).origin)):null;if(bookSource&&!home)break;
        const origin=bookSource?new URL(home).origin:'';if(bookSource)tried.add(origin);const issueStart=issues.length,verifiedForHome=bookSource?Boolean(sourceVerified(id))&&(!initialHome||new URL(initialHome).origin===origin):Boolean(sourceVerified(id));
        try{
          const found=await run({get,html,raw,emit,sourceHome:()=>bookSource?home:sourceHome(id),sourceVerified:()=>verifiedForHome,buildGetSearchUrl,renderHtml:(url,timeout,requestContext=context)=>renderHtml(id,url,timeout,requestContext)},query);
          if(Array.isArray(found)&&found.length){items=found;recoveredBookSource=bookSource&&initialHome&&new URL(initialHome).origin!==origin;break;}
          const attemptIssues=issues.slice(issueStart),needsFailover=attemptIssues.some(issue=>['timeout','network','server','request','denied','parse'].includes(issue.kind));
          if(bookSource&&!attemptIssues.length&&initialHome&&new URL(initialHome).origin!==origin)recoveredBookSource=true;
          if(!bookSource||!needsFailover||attemptIssues.some(issue=>issue.kind==='verification')){items=Array.isArray(found)?found:[];break;}
          if(++attempt>=4){items=Array.isArray(found)?found:[];break;}
          if(attempt===1&&bookSourceEndpoints?.refresh){await bookSourceEndpoints.refresh(true);endpoints=[...endpoints,...bookSourceEndpoints.candidates(id,initialHome)];}
        }catch(error){
          const attemptIssues=issues.slice(issueStart);
          if(!bookSource||attemptIssues.some(issue=>issue.kind==='verification')||attempt>=3)throw error;
          if(error instanceof SyntaxError){context.log({phase:'parse.failed',parseLayer:'search-results',errorName:error.name,errorMessage:error.message,requestHost:new URL(home).hostname});Runtime.recordFailure({kind:'parse',status:200,host:new URL(home).hostname,label:'解析失败',message:error.message});}
          if(!attempt) {attempt++;if(bookSourceEndpoints?.refresh){await bookSourceEndpoints.refresh(true);endpoints=[...endpoints,...bookSourceEndpoints.candidates(id,initialHome)];}}
          else {attempt++;}
        }
      }
      if(recoveredBookSource){issues.splice(0);failures=0;}
    }catch(error){Runtime.check();failures++;lastError=error;if(error instanceof SyntaxError){context.log({phase:'parse.failed',parseLayer:id==='onelib'||id==='zlibrary'?'search-results':'source-parser',errorName:error.name,errorMessage:error.message});Runtime.recordFailure({kind:'parse',status:200,host:id,label:'解析失败',message:error.message});}items=[...arriving.values()];}
    items=uniqueRecords(items).map(entry=>stamp({...entry,genres:genres(entry.genres)},label,type,id));
    const failed=failures>0||issues.length>0,partial=items.length>0&&failed;
    const state=items.length?(partial?'partial':'ok'):failed?'unavailable':'empty',result={id,label,items,state,message:items.length&&partial?'部分搜索请求暂不可用；已保留可识别的候选。':!items.length&&failed?'请求失败、验证页或平台暂时限制访问，可稍后重试。':!items.length?'此来源未返回匹配条目。':'',requests,...require('./metadata-network').summary(issues)};
    const phase=state==='empty'?'source.empty':state==='unavailable'?'source.failed':'source.success';
    const issue=issues[0];context.log({phase,status:state,durationMs:Date.now()-started,requestCount:requests,resultCount:items.length,errorName:lastError?.name||(issue?String(issue.kind||'Request')+'Error':failed?'RequestError':''),errorMessage:lastError?.message||issue?.message||(failed?result.message:''),verificationHit:issues.some(item=>item.kind==='verification')});
    return result;
    });
  }
  async function doubanMovie({get,html,emit},query,type='movie') {
    const payload=await get('https://movie.douban.com/j/subject_suggest?q='+encodeURIComponent(query));
    const entries=arr(payload).slice(0,10).map(seed=>{
      const id=String(seed.id||seed.url?.match(/subject\/(\d+)/)?.[1]||'');if(!/^\d+$/.test(id))return null;
      const url='https://movie.douban.com/subject/'+id+'/';
      return {id:'douban-movie-'+id,providerId:id,name:clean(seed.title||query),cover:seed.img||'',releaseDate:String(seed.year||''),storeUrl:url,scope:'film',metadataSource:'豆瓣电影',detailsUnavailable:true};
    }).filter(Boolean);entries.forEach(emit);return entries;
  }
  async function tvmaze({get,emit},query) {
    const payload=await get('https://api.tvmaze.com/search/shows?q='+encodeURIComponent(query));
    const entries=arr(payload).slice(0,6).map(({show})=>{
      if(!show?.id)return null;
      return {id:'tvmaze-'+show.id,providerId:String(show.id),name:show.name,cover:show.image?.original||show.image?.medium||'',genres:show.genres,developer:'',publisher:show.network?.name||show.webChannel?.name||'',cast:[],episodes:null,releaseDate:show.premiered||'',description:clean(show.summary),externalRating:show.rating?.average!=null?String(show.rating.average):'',ratingSource:'TVmaze',ratingMax:10,storeUrl:show.url,scope:'series',identifiers:{imdb:show.externals?.imdb},detailsUnavailable:true};
    }).filter(Boolean);entries.forEach(emit);return entries;
  }
  async function itunes({get},query) {
    const payload=await get('https://itunes.apple.com/search?term='+encodeURIComponent(query)+'&country=tw&media=movie&entity=movie&limit=12');
    return arr(payload?.results).filter(entry=>entry.kind==='feature-movie').map(entry=>({id:'itunes-'+entry.trackId,name:entry.trackName,developer:entry.artistName||'',genres:entry.primaryGenreName?[entry.primaryGenreName]:[],releaseDate:(entry.releaseDate||'').slice(0,10),description:clean(entry.longDescription||entry.shortDescription),cover:entry.artworkUrl100||'',storeUrl:entry.trackViewUrl,scope:'film'}));
  }
  async function googleBooks({get},query) {
    const key=settings().googleBooksApiKey;
    const payload=await get('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent(query)+'&maxResults=12&printType=books'+(key?'&key='+encodeURIComponent(key):''));
    return arr(payload?.items).map(item=>{const v=item.volumeInfo||{},codes=arr(v.industryIdentifiers);return {id:'google-books-'+item.id,name:v.title||'',originalName:v.subtitle?String(v.title)+': '+v.subtitle:'',developer:arr(v.authors).join('、'),publisher:v.publisher||'',isbn:isbn(codes.find(code=>code.type==='ISBN_13')?.identifier||codes.find(code=>code.type==='ISBN_10')?.identifier),pages:count(String(v.pageCount||'')),releaseDate:v.publishedDate||'',description:clean(v.description),genres:v.categories||[],cover:(v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'').replace(/^http:/,'https:'),externalRating:v.averageRating!=null?String(v.averageRating):'',ratingSource:'Google Books',ratingMax:5,storeUrl:v.canonicalVolumeLink||v.infoLink||''};});
  }
  async function anilist({get},query,type) {
    const payload=await get('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'query ($search:String,$type:MediaType){ Page(page:1,perPage:6){ media(search:$search,type:$type){ id idMal title{native romaji english} synonyms format coverImage{extraLarge large} bannerImage description(asHtml:false) genres episodes startDate{year month day} averageScore siteUrl studios(isMain:true){nodes{name}} staff(perPage:20){edges{role node{name{full native}}}} characters(perPage:25){edges{voiceActors(language:JAPANESE){name{full native}}}} } } }',variables:{search:query,type:type==='anime'?'ANIME':'MANGA'}})});
    return arr(payload?.data?.Page?.media).filter(info=>type!=='manga'||info.format!=='NOVEL').map(info=>{
      const staff=arr(info.staff?.edges),personNames=roles=>unique(staff.filter(person=>roles.test(person.role)).map(person=>person.node?.name?.native||person.node?.name?.full));
      return {id:'anilist-'+info.id,name:info.title?.native||info.title?.english||info.title?.romaji||'',originalName:info.title?.native||'',aliases:unique([info.title?.english,info.title?.romaji,...arr(info.synonyms)]),developer:personNames(type==='anime'?/^Director$/:/^(Story|Art|Story & Art|Original Creator)$/).join('、'),publisher:type==='anime'?arr(info.studios?.nodes).map(studio=>studio.name).join('、'):'',cast:type==='anime'?unique(arr(info.characters?.edges).flatMap(character=>arr(character.voiceActors).map(actor=>actor.name?.native||actor.name?.full))):[],cover:info.coverImage?.extraLarge||info.coverImage?.large||'',coverLandscape:info.bannerImage||'',description:clean(info.description),genres:info.genres,episodes:type==='anime'?info.episodes:null,releaseDate:dateOf(info.startDate),externalRating:info.averageScore!=null?String(info.averageScore):'',ratingSource:'AniList',ratingMax:100,storeUrl:info.siteUrl,editionKind:type==='manga'?'系列':'',identifiers:{mal:info.idMal,anilist:info.id}};
    });
  }
  async function mal({raw,emit},query,type) {
    const entries=await raw.jikanSearch(query,type);
    const candidates=entries.map(entry=>({...entry,ratingSource:'MyAnimeList',ratingMax:10,identifiers:{mal:entry.providerId},editionKind:type==='manga'?'系列':''}));candidates.forEach(emit);return candidates;
  }
  async function search(type,query,{onProgress}={}) {
    query=String(query||'').trim();if(!query)return {integrated:[],sources:[]};
    const key=Symbol(type+query);
    const task=(async()=>{
      const publication=['book','manga'].includes(type),specs=[];
      const add=(id,label,run,searchUrl)=>specs.push({id,label,run,searchUrl});
      if(publication){add('douban','豆瓣读书',({raw},q)=>raw.doubanSearch(q));add('bangumi','Bangumi',({raw},q)=>raw.bangumiPublication(q,type));add('openlibrary','Open Library',({raw},q)=>raw.openLibrarySearch(q));add('googlebooks','Google Books',googleBooks);}
      if(type==='book'){add('tstrs','SaltyLeo 的书架',(io,q)=>require('./book-catalog-sources').search(io,q,'tstrs'));add('onelib','1lib 公开书目',(io,q)=>require('./book-catalog-sources').search(io,q,'onelib'),(q,home)=>new URL('/s/'+encodeURIComponent(q),home||'https://zh.1lib.sk/').href);add('zlibrary','Z-Library',(io,q)=>require('./zlibrary-metadata').search(io,q),(q,home)=>new URL('/s/'+encodeURIComponent(q),home||'https://zh.zlib.bz/').href);}
      if(type==='anime'){add('bangumi','Bangumi',({raw},q)=>raw.bangumiSearch(q,type));add('douban','豆瓣电影',(io,q)=>doubanMovie(io,q,type));}
      if(type==='anime'||type==='manga'){add('myanimelist','MyAnimeList',(io,q)=>mal(io,q,type));add('anilist','AniList',(io,q)=>anilist(io,q,type));}
      if(type==='movie'){add('douban','豆瓣电影',doubanMovie);add('bangumi','Bangumi（动画电影）',async({raw},q)=>(await raw.bangumiSearch(q,'anime')).filter(entry=>entry.episodes===1).map(entry=>({...entry,scope:'film'})));add('tvmaze','TVmaze',tvmaze);add('itunes','Apple iTunes',itunes);}
      if(type==='anime'||type==='manga')add('kitsu','Kitsu',(io,q)=>require('./public-media-sources').kitsu(io,q,type));
      if(type==='movie'||type==='anime')add('seedhub','SeedHub',(io,q)=>require('./seedhub-metadata').search(io,q,type));
      if(type==='movie')add('wikidata','Wikidata',require('./public-media-sources').wikidata);
      const sourceUrl=spec=>spec.searchUrl?spec.searchUrl(query,sourceHome(spec.id)):'';
      const sources=specs.map(spec=>({id:spec.id,label:spec.label,items:[],state:'loading',message:'正在获取…',...(spec.searchUrl?{searchUrl:sourceUrl(spec)}:{})}));
      // Never briefly publish a novel as a manga while waiting for type proof.
      const visibleSources=()=>sources.map(source=>source.id==='douban'&&type==='manga'?{...source,items:source.items.filter(entry=>/漫画|マンガ|comic|manga/i.test([entry.name,...arr(entry.genres)].join(' '))||sources.find(s=>s.id==='bangumi')?.items.some(other=>norm(other.developer)&&norm(other.developer)===norm(entry.developer)&&norm(other.name)===norm(entry.name)))}:source);
      const publish=()=>{Runtime.check();const visible=visibleSources();onProgress?.({type,query,integrated:mergeMetadata(visible,type,primaryFor(type,settings())),sources:structuredClone(visible),loading:true});};publish();
      await Promise.all(specs.map(async(spec,index)=>{
        const result=await runSource(spec.id,spec.label,type,query,spec.run,items=>{sources[index].items=items;publish();});
        sources[index]={...result,...(spec.searchUrl?{searchUrl:sourceUrl(spec)}:{})};publish();
      }));
      // Expand failed foreign-language lookups with names returned by live sources,
      // not a local dictionary of presumed translations.
      const aliases=unique(sources.flatMap(source=>source.items.filter(entry=>relevance(entry,query)===100).slice(0,2).flatMap(entry=>[entry.originalName,...arr(entry.aliases)]))).filter(name=>norm(name)!==norm(query)&&name.length>2).sort((a,b)=>Number(/^[\x00-\x7f’]+$/.test(b))-Number(/^[\x00-\x7f’]+$/.test(a))).slice(0,2);
      await Promise.all(sources.filter(source=>aliases.length&&!source.items.length&&source.state==='empty'&&['myanimelist','anilist','kitsu','tvmaze','itunes','openlibrary'].includes(source.id)).map(async source=>{
        const spec=specs.find(spec=>spec.id===source.id);
        source.state='loading';publish();for(const alias of aliases){const extra=await runSource(source.id,source.label,type,alias,spec.run,items=>{source.items=items;publish();});source.requests=(source.requests||0)+extra.requests;Object.assign(source,extra);publish();if(extra.items.length)break;}
      }));
      if(publication){
        // A manga adaptation is not the source novel, even with an identical title.
        if(type==='manga'){const douban=sources.find(source=>source.id==='douban'),known=sources.find(source=>source.id==='bangumi').items;douban.items=douban.items.filter(entry=>/漫画|マンガ|comic|manga/i.test([entry.name,...arr(entry.genres)].join(' '))||known.some(other=>norm(other.developer)&&norm(other.developer)===norm(entry.developer)&&norm(other.name)===norm(entry.name)));if(!douban.items.length&&douban.state==='ok'){douban.state='empty';douban.message='没有确认属于漫画类型的匹配条目。';}}
      }
      const primary=primaryFor(type,settings());
      const integrated=mergeMetadata(sources,type,primary).sort((a,b)=>relevance(b,query)-relevance(a,query)||Number(b._sourceId===primary)-Number(a._sourceId===primary)||Number(cn(b.name))-Number(cn(a.name))||['isbn','pages','translator','description','cover'].filter(key=>b[key]).length-['isbn','pages','translator','description','cover'].filter(key=>a[key]).length);
      const emptyHints={tvmaze:'TVmaze 仅收录剧集；当前名称没有匹配剧集，电影可选择豆瓣或 Wikidata。',itunes:'Apple 公开电影目录未返回匹配条目，可选择豆瓣或 Wikidata。',bangumi:type==='movie'?'Bangumi 此处仅收录动画电影；未找到匹配的动画电影。':''};
      for(const source of sources)if(source.state==='empty'&&emptyHints[source.id])source.message=emptyHints[source.id];
      Runtime.check();return {query,type,integrated,sources,loading:false};
    })();inflight.set(key,task);try{return await task;}finally{inflight.delete(key);}
  }
  async function resolveBookCandidate(seed,sourceId,context){
    const active=seed.detailUrl||seed.storeUrl||sourceHome(sourceId),endpoints=bookSourceEndpoints?.candidates(sourceId,active)||[active],previous=[];let last=seed,attempt=0;
    for(const home of endpoints){
      if(!home||attempt>=4)break;
      const origin=new URL(home).origin,verified=Boolean(sourceVerified(sourceId))&&new URL(active).origin===origin;
      const targetSeed={...seed};
      try{const base=new URL(home),existing=new URL(seed.detailUrl||seed.storeUrl);if(existing.origin!==base.origin){const local=new URL(existing.pathname+existing.search,base);if(seed.detailUrl)targetSeed.detailUrl=local.href;if(seed.storeUrl)targetSeed.storeUrl=local.href;}}catch{}
      const capture=await Runtime.captureFailures(async()=>{
        const html=async(url,timeout)=>{if(context)context.requestCount++;return text(url,timeout,sourceId,context);};html.diagnosticContext=context;
        const io={html,sourceHome:()=>home,sourceVerified:()=>verified,renderHtml:(url,timeout)=>{if(context)context.requestCount++;return renderHtml(sourceId,url,timeout,context);}};
        return sourceId==='onelib'?require('./book-catalog-sources').resolveCandidate(io,targetSeed,sourceId):require('./zlibrary-metadata').resolve(io,targetSeed);
      });
      last=capture.value||seed;const failures=capture.failures();
      if(last.detailsUnavailable===false||!last.detailsUnavailable&&!failures.length){for(const old of previous)old.discardFailures();return last;}
      if(failures.some(issue=>issue.kind==='verification')){for(const old of previous)old.discardFailures();return last;}
      if(!failures.length){for(const old of previous)old.discardFailures();return last;}
      previous.push(capture);attempt++;
      if(attempt===1&&bookSourceEndpoints?.refresh)await bookSourceEndpoints.refresh(true);
    }
    return last;
  }
  async function resolveSingle(candidate,sourceId,type,context=null) {
    const seed={...candidate,_sourceId:sourceId};let detail=seed;
    const requestJson=(url,timeout,options)=>{if(context)context.requestCount++;return json(url,timeout,options,sourceId,context);},requestText=(url,timeout)=>{if(context)context.requestCount++;return text(url,timeout,sourceId,context);};
    if(['bangumi','openlibrary','myanimelist'].includes(sourceId)||sourceId==='douban'&&type==='book')detail=await createProviders({json:requestJson,text:requestText}).resolveCandidate(seed,type)||seed;
    else if(sourceId==='douban'&&['movie','anime'].includes(type)){
      const id=String(seed.providerId||seed.id||'').replace(/^douban-movie-/,'');
      if(/^\d+$/.test(id)){
        const [abstract,page]=await Promise.all([requestJson('https://movie.douban.com/j/subject_abstract?subject_id='+id,7000),requestText('https://movie.douban.com/subject/'+id+'/',7000)]);
        const subject=abstract?.subject||{},rows=infoRows(page),getInfo=(...labels)=>infoField(rows,...labels),fullName=clean(page.match(/property=["']v:itemreviewed["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]||''),name=seed.name||subject.title||fullName;
        const original=fullName.startsWith(name)?fullName.slice(name.length).trim():'';
        const types=unique([...arr(subject.types),...getInfo('类型').split(/\s*\/\s*/)]),summary=require('./metadata-html').summary(page,'movie')||subject.summary||subject.intro||subject.synopsis||'';
        detail={...seed,name,originalName:original,aliases:unique([original,...getInfo('又名').split(/\s*\/\s*/)]),genres:types,developer:getInfo('导演')||arr(subject.directors).join('、'),cast:getInfo('主演').split(/\s*\/\s*/).filter(Boolean).length?getInfo('主演').split(/\s*\/\s*/):arr(subject.actors),episodes:count(getInfo('集数'))||count(String(subject.episodes_count||'')),releaseDate:getInfo('上映日期','首播').match(/\d{4}(?:-\d{2})?(?:-\d{2})?/)?.[0]||subject.release_year||seed.releaseDate||'',description:clean(summary),externalRating:page.match(/property=["']v:average["'][^>]*>\s*([\d.]+)/i)?.[1]||String(subject.rate||''),ratingSource:'豆瓣',ratingMax:10,scope:scope(name),identifiers:{imdb:getInfo('IMDb').match(/tt\d+/)?.[0]},detailsUnavailable:!clean(summary)&&!rows.length&&!Object.keys(subject).length};
        if(type==='anime'&&types.length&&!types.some(value=>/动画|动漫|Animation/i.test(value)))detail={...seed,detailsUnavailable:true};
      }
    } else if(sourceId==='tvmaze'){
      const id=String(seed.providerId||'').replace(/^tvmaze-/,'');if(/^\d+$/.test(id)){
        const [cast,crew,episodes]=await Promise.all([requestJson('https://api.tvmaze.com/shows/'+id+'/cast',7000),requestJson('https://api.tvmaze.com/shows/'+id+'/crew',7000),requestJson('https://api.tvmaze.com/shows/'+id+'/episodes',7000)]);
        detail={...seed,developer:unique(arr(crew).filter(person=>/Director/i.test(person.type)).map(person=>person.person?.name)).join('、'),cast:unique(arr(cast).map(person=>person.person?.name)),episodes:Array.isArray(episodes)?episodes.length:null,detailsUnavailable:!Array.isArray(cast)&&!Array.isArray(episodes)};
      }
    } else if(sourceId==='seedhub')detail=await require('./seedhub-metadata').resolve({html:requestText},seed,type)||seed;
    else if(sourceId==='tstrs'){const html=async(url,timeout)=>requestText(url,timeout);html.diagnosticContext=context;detail=await require('./book-catalog-sources').resolveCandidate({html,sourceHome:()=>sourceHome(sourceId),sourceVerified:()=>Boolean(sourceVerified(sourceId)),renderHtml:(url,timeout)=>{context.requestCount++;return renderHtml(sourceId,url,timeout,context);}},seed,sourceId)||seed;}
    else if(['onelib','zlibrary'].includes(sourceId))detail=await resolveBookCandidate(seed,sourceId,context)||seed;
    const label=({douban:type==='book'?'豆瓣读书':'豆瓣电影',bangumi:'Bangumi',openlibrary:'Open Library',googlebooks:'Google Books',tstrs:'SaltyLeo 的书架',onelib:'1lib 公开书目',zlibrary:'Z-Library',tvmaze:'TVmaze',seedhub:'SeedHub',myanimelist:'MyAnimeList',anilist:'AniList',kitsu:'Kitsu',itunes:'Apple iTunes',wikidata:'Wikidata'})[sourceId]||candidate.metadataSource||sourceId;
    const stamped=stamp({...seed,...detail},label,type,sourceId),present=value=>Array.isArray(value)?value.length>0:value!==null&&value!==undefined&&value!=='';
    stamped.metadataSource=candidate.integrated?(candidate.metadataSource||label):label;
    stamped.fieldSources={...(candidate.fieldSources||{})};
    for(const key of ['name','description','developer','publisher','translator','releaseDate','isbn','pages','cast','episodes','genres','cover','coverPortrait','coverLandscape','externalRating','storeUrl','platforms','platformLinks','steamAppId'])if(present(detail[key])){if(!present(candidate[key])||JSON.stringify(candidate[key])!==JSON.stringify(detail[key]))stamped.fieldSources[key]=label;else stamped.fieldSources[key]||=candidate.fieldSources?.[key]||label;}
    return stamped;
  }
  async function resolveCandidate(candidate) {
    if(!candidate||typeof candidate!=='object')return null;
    const type=candidate.mediaType||candidate.type||'game',sourceId=candidate._sourceId||candidate.sourceId||'';
    const resolveObserved=async(seed,id)=>{const context=diagnosticContext(id,type,'resolve',seed?.name||''),started=Date.now();context.log({phase:'source.start',verified:context.verified});try{const value=await resolveSingle(seed,id,type,context),failed=Boolean(value?.detailsUnavailable);context.log({phase:failed?'source.empty':'source.success',status:failed?'details-unavailable':'ok',durationMs:Date.now()-started,requestCount:context.requestCount,resultCount:failed?0:1});return value;}catch(error){context.log({phase:'source.failed',status:'failed',durationMs:Date.now()-started,requestCount:context.requestCount,resultCount:0,errorName:error?.name||'Error',errorMessage:error?.message||''});throw error;}};
    let base=await resolveObserved(candidate,sourceId);
    if(!candidate.integrated||!Array.isArray(candidate._matchedCandidates)||!candidate._matchedCandidates.length)return base;
    const needs=type==='game'?['description','developer','publisher','releaseDate','externalRating','cover']:['book','manga'].includes(type)?['description','genres','isbn','publisher','translator','releaseDate','pages','cover']:['description','cast','episodes','developer','externalRating','cover'];
    for(const match of candidate._matchedCandidates){
      if(needs.every(key=>Array.isArray(base[key])?base[key].length:base[key]))break;
      if(!match?.sourceId||!match.candidate)continue;
      const extra=await resolveObserved(match.candidate,match.sourceId);
      if(match.ambiguous&&!base.isbn){for(const key of ['isbn','publisher','translator','releaseDate','pages','cover','coverPortrait','coverLandscape'])delete extra[key];}
      const merged=mergeMetadata([{id:sourceId,items:[base]},{id:match.sourceId,items:[extra]}],type,sourceId);
      const next=merged.find(row=>String(row.id)===String(base.id));if(next)base=next;
    }
    const output={...base};delete output._matchedCandidates;delete output._sourceId;return output;
  }
  return {search,resolveCandidate};
}
module.exports={createSourceSearch,infoRows,infoField,genres};
