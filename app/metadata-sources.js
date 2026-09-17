/* Independent online adapters + conservative complementing. No offline metadata. */
const {createProviders,elementBody,isbn,count,norm,relevance}=require('./metadata-enrichment');
const {mergeMetadata,stamp,isbnKey}=require('./metadata-merge');
const Text=require('./metadata-text');
const Runtime=require('./metadata-runtime');
const clean=value=>Text.text(value??'').replace(/[ \t]+/g,' ').trim();
const arr=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values.filter(Boolean))];
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
function createSourceSearch({json,text,settings=()=>({}),pace=350}) {
  const slots=new Map(),inflight=new Map();
  async function limited(url,options={},asText=false) {
    if(pace){const schedule=Runtime.slots(slots),host=new URL(url).hostname,min=/itunes/.test(host)?3100:/jikan|openlibrary/.test(host)?Math.max(400,pace):pace;const start=Math.max(Date.now(),schedule.get(host)||0);schedule.set(host,start+min);if(start>Date.now())await Runtime.delay(start-Date.now());}
    Runtime.check();try{return await(asText?text(url,8000):json(url,8000,options));}catch{Runtime.check();return asText?'':null;}
  }
  async function map(values,work,onEntry=()=>{}) {const output=new Array(values.length);let cursor=0;await Promise.all(Array.from({length:Math.min(3,values.length)},async()=>{while(cursor<values.length){Runtime.check();const i=cursor++;try{output[i]=await work(values[i]);if(output[i])onEntry(output[i]);}catch{Runtime.check();output[i]=null;}}}));return output.filter(Boolean);}
  async function runSource(id,label,type,query,run,onEntries=()=>{}) {
    return Runtime.withDiagnostics(async issues=>{
    let failures=0,requests=0;
    const get=async(url,options={})=>{requests++;const result=await limited(url,options);if(result===null||result?.errors||result?.error){failures++;return null;}return result;};
    const html=async url=>{requests++;const result=await limited(url,{},true);if(!result){failures++;return '';}return result;};
    const arriving=new Map(),emit=entry=>{Runtime.check();if(!entry?.id)return;if(id==='bangumi'&&type==='movie'&&entry.episodes!==1)return;const value=stamp({...entry,genres:genres(entry.genres),...(id==='bangumi'&&type==='movie'?{scope:'film'}:{})},label,type);arriving.set(String(value.id),value);onEntries([...arriving.values()]);};
    const raw=createProviders({json:(url,timeout,options)=>get(url,options),text:html,onEntry:emit});
    let items=[];try{items=await run({get,html,raw,emit},query);}catch(error){Runtime.check();failures++;if(error instanceof SyntaxError)Runtime.recordFailure({kind:'parse',status:200,host:id,label:'解析失败',message:error.message});items=[...arriving.values()];}
    items=uniqueRecords(items).map(entry=>stamp({...entry,genres:genres(entry.genres)},label,type));
    const partial=failures>0||items.some(item=>item.detailsUnavailable);
    return {id,label,items,state:items.length?(partial?'partial':'ok'):failures?'unavailable':'empty',message:items.length&&partial?'部分详情暂不可用；显示已取得的字段，可切换其他来源补充。':!items.length&&failures?'请求失败或平台暂时限制访问，可稍后重试。':!items.length?'此来源未返回匹配条目。':'',requests,...require('./metadata-network').summary(issues)};
    });
  }
  async function doubanMovie({get,html,emit},query,type='movie') {
    const payload=await get('https://movie.douban.com/j/subject_suggest?q='+encodeURIComponent(query));
    return map(arr(payload).slice(0,10),async seed=>{
      const id=String(seed.id||seed.url?.match(/subject\/(\d+)/)?.[1]||'');if(!/^\d+$/.test(id))return null;
      const url='https://movie.douban.com/subject/'+id+'/',[abstract,page]=await Promise.all([get('https://movie.douban.com/j/subject_abstract?subject_id='+id),html(url)]);
      const subject=abstract?.subject||{},rows=infoRows(page),getInfo=(...labels)=>infoField(rows,...labels);
      const namesHtml=page.match(/property=["']v:itemreviewed["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]||'',fullName=clean(namesHtml);
      const name=seed.title||subject.title||fullName||query;
      const original=fullName.startsWith(name)?fullName.slice(name.length).trim():'';
      const types=unique([...arr(subject.types),...getInfo('类型').split(/\s*\/\s*/)]);
      if(type==='anime'&&types.length&&!types.some(value=>/动画|动漫|Animation/i.test(value)))return null;
      const summary=require('./metadata-html').summary(page,'movie')||subject.summary||subject.intro||subject.synopsis||'';
      const externalRating=page.match(/property=["']v:average["'][^>]*>\s*([\d.]+)/i)?.[1]||String(subject.rate||'');
      return {id:'douban-movie-'+id,name,originalName:original,aliases:unique([original,...getInfo('又名').split(/\s*\/\s*/)]),cover:seed.img||'',genres:types,developer:getInfo('导演')||arr(subject.directors).join('、'),publisher:'',cast:getInfo('主演').split(/\s*\/\s*/).filter(Boolean).length?getInfo('主演').split(/\s*\/\s*/):arr(subject.actors),episodes:count(getInfo('集数'))||count(String(subject.episodes_count||'')),releaseDate:getInfo('上映日期','首播').match(/\d{4}(?:-\d{2})?(?:-\d{2})?/)?.[0]||subject.release_year||seed.year||'',description:clean(summary),externalRating,ratingSource:'豆瓣',ratingMax:10,storeUrl:url,scope:scope(name),identifiers:{imdb:getInfo('IMDb').match(/tt\d+/)?.[0]},detailsUnavailable:!clean(summary)||!rows.length&&!Object.keys(subject).length};
    },emit);
  }
  async function tvmaze({get,emit},query) {
    const payload=await get('https://api.tvmaze.com/search/shows?q='+encodeURIComponent(query));
    return map(arr(payload).slice(0,6),async({show})=>{
      if(!show?.id)return null;
      const [cast,crew,episodes]=await Promise.all([get('https://api.tvmaze.com/shows/'+show.id+'/cast'),get('https://api.tvmaze.com/shows/'+show.id+'/crew'),get('https://api.tvmaze.com/shows/'+show.id+'/episodes')]);
      return {id:'tvmaze-'+show.id,name:show.name,cover:show.image?.original||show.image?.medium||'',genres:show.genres,developer:unique(arr(crew).filter(person=>/Director/i.test(person.type)).map(person=>person.person?.name)).join('、'),publisher:show.network?.name||show.webChannel?.name||'',cast:unique(arr(cast).map(person=>person.person?.name)),episodes:Array.isArray(episodes)?episodes.length:null,releaseDate:show.premiered||'',description:clean(show.summary),externalRating:show.rating?.average!=null?String(show.rating.average):'',ratingSource:'TVmaze',ratingMax:10,storeUrl:show.url,scope:'series',identifiers:{imdb:show.externals?.imdb}};
    },emit);
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
    return map(entries,async entry=>({...entry,ratingSource:'MyAnimeList',ratingMax:10,identifiers:{mal:entry.providerId},editionKind:type==='manga'?'系列':'',cast:type==='anime'?await raw.jikanCast(entry):[]}),emit);
  }
  async function search(type,query,{onProgress}={}) {
    query=String(query||'').trim();if(!query)return {integrated:[],sources:[]};
    const key=Symbol(type+query);
    const task=(async()=>{
      const publication=['book','manga'].includes(type),specs=[];
      const add=(id,label,run)=>specs.push({id,label,run});
      if(publication){add('douban','豆瓣读书',({raw},q)=>raw.doubanSearch(q));add('bangumi','Bangumi',({raw},q)=>raw.bangumiPublication(q,type));add('openlibrary','Open Library',({raw},q)=>raw.openLibrarySearch(q));add('googlebooks','Google Books',googleBooks);}
      if(type==='book'){add('tstrs','SaltyLeo 的书架',(io,q)=>require('./book-catalog-sources').search(io,q,'tstrs'));add('onelib','1lib 公开书目',(io,q)=>require('./book-catalog-sources').search(io,q,'onelib'));}
      if(type==='anime'){add('bangumi','Bangumi',({raw},q)=>raw.bangumiSearch(q,type));add('douban','豆瓣电影',(io,q)=>doubanMovie(io,q,type));}
      if(type==='anime'||type==='manga'){add('myanimelist','MyAnimeList',(io,q)=>mal(io,q,type));add('anilist','AniList',(io,q)=>anilist(io,q,type));}
      if(type==='movie'){add('douban','豆瓣电影',doubanMovie);add('bangumi','Bangumi（动画电影）',async({raw},q)=>(await raw.bangumiSearch(q,'anime')).filter(entry=>entry.episodes===1).map(entry=>({...entry,scope:'film'})));add('tvmaze','TVmaze',tvmaze);add('itunes','Apple iTunes',itunes);}
      if(type==='anime'||type==='manga')add('kitsu','Kitsu',(io,q)=>require('./public-media-sources').kitsu(io,q,type));
      if(type==='movie'||type==='anime')add('seedhub','SeedHub',(io,q)=>require('./seedhub-metadata').search(io,q,type));
      if(type==='movie')add('wikidata','Wikidata',require('./public-media-sources').wikidata);
      const sources=specs.map(spec=>({id:spec.id,label:spec.label,items:[],state:'loading',message:'正在获取…'}));
      // Never briefly publish a novel as a manga while waiting for type proof.
      const visibleSources=()=>sources.map(source=>source.id==='douban'&&type==='manga'?{...source,items:source.items.filter(entry=>/漫画|マンガ|comic|manga/i.test([entry.name,...arr(entry.genres)].join(' '))||sources.find(s=>s.id==='bangumi')?.items.some(other=>norm(other.developer)&&norm(other.developer)===norm(entry.developer)&&norm(other.name)===norm(entry.name)))}:source);
      const publish=()=>{Runtime.check();const visible=visibleSources();onProgress?.({type,query,integrated:mergeMetadata(visible,type),sources:structuredClone(visible),loading:true});};publish();
      await Promise.all(specs.map(async(spec,index)=>{
        const result=await runSource(spec.id,spec.label,type,query,spec.run,items=>{sources[index].items=items;publish();});
        sources[index]=result;publish();
      }));
      // Expand failed foreign-language lookups with names returned by live sources,
      // not a local dictionary of presumed translations.
      const aliases=unique(sources.flatMap(source=>source.items.filter(entry=>relevance(entry,query)===100).slice(0,2).flatMap(entry=>[entry.originalName,...arr(entry.aliases)]))).filter(name=>norm(name)!==norm(query)&&name.length>2).sort((a,b)=>Number(/^[\x00-\x7f’]+$/.test(b))-Number(/^[\x00-\x7f’]+$/.test(a))).slice(0,2);
      await Promise.all(sources.filter(source=>aliases.length&&!source.items.length&&source.state==='empty'&&['myanimelist','anilist','kitsu','tvmaze','itunes','openlibrary'].includes(source.id)).map(async source=>{
        const spec=specs.find(spec=>spec.id===source.id);
        source.state='loading';publish();for(const alias of aliases){const extra=await runSource(source.id,source.label,type,alias,spec.run,items=>{source.items=items;publish();});source.requests=(source.requests||0)+extra.requests;Object.assign(source,extra);publish();if(extra.items.length)break;}
      }));
      if(publication){
        const codes=unique([isbn(query),...sources.flatMap(source=>source.items.map(entry=>entry.isbn))].map(isbnKey)).slice(0,8),target=sources.find(source=>source.id==='openlibrary');
        if(codes.length&&target){const previous=target.items;target.state='loading';publish();const extra=await runSource('openlibrary','Open Library',type,query,({raw})=>map(codes,code=>raw.byIsbn(code)),items=>{target.items=uniqueRecords([...previous,...items]);publish();});target.items=uniqueRecords([...target.items,...extra.items]);target.state=target.items.length?(extra.state==='unavailable'?'partial':'ok'):extra.state;target.message=extra.state==='unavailable'?'部分 ISBN 查询暂不可用。':'';publish();}
        const google=sources.find(source=>source.id==='googlebooks');
        if(codes.length&&['ok','empty','partial'].includes(google?.state)){const extra=await runSource('googlebooks','Google Books',type,query,io=>map(codes.slice(0,3),code=>googleBooks(io,'isbn:'+code)).then(groups=>groups.flat()));google.items=uniqueRecords([...google.items,...extra.items]);if(google.items.length){google.state='ok';google.message='';}}
        // A manga adaptation is not the source novel, even with an identical title.
        if(type==='manga'){const douban=sources.find(source=>source.id==='douban'),known=sources.find(source=>source.id==='bangumi').items;douban.items=douban.items.filter(entry=>/漫画|マンガ|comic|manga/i.test([entry.name,...arr(entry.genres)].join(' '))||known.some(other=>norm(other.developer)&&norm(other.developer)===norm(entry.developer)&&norm(other.name)===norm(entry.name)));if(!douban.items.length&&douban.state==='ok'){douban.state='empty';douban.message='没有确认属于漫画类型的匹配条目。';}}
      }
      const integrated=mergeMetadata(sources,type).sort((a,b)=>relevance(b,query)-relevance(a,query)||Number(cn(b.name))-Number(cn(a.name))||['isbn','pages','translator','description','cover'].filter(key=>b[key]).length-['isbn','pages','translator','description','cover'].filter(key=>a[key]).length);
      const emptyHints={tvmaze:'TVmaze 仅收录剧集；当前名称没有匹配剧集，电影可选择豆瓣或 Wikidata。',itunes:'Apple 公开电影目录未返回匹配条目，可选择豆瓣或 Wikidata。',bangumi:type==='movie'?'Bangumi 此处仅收录动画电影；未找到匹配的动画电影。':''};
      for(const source of sources)if(source.state==='empty'&&emptyHints[source.id])source.message=emptyHints[source.id];
      Runtime.check();return {query,type,integrated,sources,loading:false};
    })();inflight.set(key,task);try{return await task;}finally{inflight.delete(key);}
  }
  return {search};
}
module.exports={createSourceSearch,infoRows,infoField,genres};
