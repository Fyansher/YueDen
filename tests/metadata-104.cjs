const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {mergeMetadata,isbnKey}=require('../app/metadata-merge');
const Runtime=require('../app/metadata-runtime');
const Network=require('../app/metadata-network');

const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');
const renderer=fs.readFileSync(path.join(__dirname,'../app/renderer.js'),'utf8');
const resultUi=fs.readFileSync(path.join(__dirname,'../app/metadata-results.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/package.json'),'utf8'));

test('editor identity is compact, existing cover controls remain, and YueDen version is 1.0.6',()=>{
  const form=html.slice(html.indexOf('<form id="editorForm">'),html.indexOf('</form>',html.indexOf('<form id="editorForm">')));
  assert.ok(form.indexOf('class="editor-top"')<form.indexOf('class="editor-fields"'));
  for(const token of ['id="coverPreview"','id="editCoverBtn"','id="fieldName"','id="fieldType"','id="steamAppIdField"','id="metadataBtn"','id="metadataCoverage"'])assert.ok(form.includes(token),token);
  assert.ok(form.includes('⌁ 获取元数据'));
  assert.match(renderer,/game&&platforms\.includes\('steam'\)/);
  assert.equal(pkg.version,'1.0.6');
  assert.equal(pkg.buildId,'1.0.6');
  assert.match(html,/<small>1\.0\.6<\/small>/);
});

test('chosen primary source stays the baseline and other sources fill blanks only',()=>{
  const rows=mergeMetadata([
    {id:'secondary',items:[{id:'secondary-1',name:'同一游戏',metadataSource:'Secondary',description:'次来源简介',externalRating:'9.2',ratingSource:'Other',storeUrl:'https://example.test/store',releaseDate:'2020-01-01'}]},
    {id:'primary',items:[{id:'primary-1',name:'同一游戏',metadataSource:'Primary',description:'主来源简介',externalRating:'7.5',ratingSource:'Main',releaseDate:'2020-01-01'}]}
  ],'game','primary');
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,'primary-1');
  assert.equal(rows[0].description,'主来源简介');
  assert.equal(rows[0].externalRating,'7.5');
  assert.equal(rows[0].storeUrl,'https://example.test/store');
  assert.equal(rows[0].fieldSources.storeUrl,'Secondary');
  assert.equal(rows[0].fieldSources.description,'Primary');
});

test('switching the primary changes the baseline and an absent preference falls back without mutation',()=>{
  const groups=[
    {id:'alpha',items:[{id:'a',name:'同一游戏',metadataSource:'Alpha',externalRating:'7.1',releaseDate:'2020-01-01'}]},
    {id:'beta',items:[{id:'b',name:'同一游戏',metadataSource:'Beta',externalRating:'8.6',releaseDate:'2020-01-01'}]}
  ];
  assert.equal(mergeMetadata(groups,'game','alpha')[0].id,'a');
  assert.equal(mergeMetadata(groups,'game','beta')[0].id,'b');
  const saved={game:'missing'};
  assert.equal(mergeMetadata(groups,'game',saved.game)[0].id,'a');
  assert.deepEqual(saved,{game:'missing'});
  assert.equal(mergeMetadata(groups,'game','alpha')[0].externalRating,'7.1');
});

test('edition merge equates ISBN-10 and ISBN-13 but isolates different and ambiguous versions',()=>{
  assert.equal(isbnKey('7536692935'),'9787536692930');
  const matching=mergeMetadata([
    {id:'catalog',items:[{id:'a',name:'同一本书',developer:'张三',isbn:'7536692935',description:'主摘要'}]},
    {id:'edition',items:[{id:'b',name:'同一本书',developer:'张三',isbn:'9787536692930',publisher:'出版社',translator:'李四',pages:302,releaseDate:'2008-06-01',cover:'https://img.test/book.jpg'}]}
  ],'book','catalog');
  assert.equal(matching.length,1);
  assert.equal(matching[0].publisher,'出版社');
  assert.equal(matching[0].translator,'李四');
  assert.equal(matching[0].pages,302);
  assert.equal(matching[0].isbn,'7536692935');

  const different=mergeMetadata([
    {id:'primary',items:[{id:'p',name:'同一本书',developer:'张三',isbn:'9787536692930',publisher:'第一版出版社',pages:300}]},
    {id:'other-edition',items:[{id:'q',name:'同一本书',developer:'张三',isbn:'9787536692947',publisher:'第二版出版社',translator:'王五',pages:400,releaseDate:'2024-01-01',cover:'https://img.test/other.jpg'}]}
  ],'book','primary');
  assert.equal(different.length,2);
  const selected=different.find(row=>row.id==='p');
  assert.equal(selected.publisher,'第一版出版社');
  assert.equal(selected.pages,300);
  assert.equal(selected.translator,undefined);
  assert.equal(selected.cover,undefined);

  const ambiguous=mergeMetadata([
    {id:'primary',items:[{id:'unknown',name:'同一本书',developer:'张三',description:'主摘要'}]},
    {id:'edition-a',items:[{id:'a',name:'同一本书',developer:'张三',isbn:'9787536692930',publisher:'甲出版社',pages:300,releaseDate:'2008-06-01',cover:'https://img.test/a.jpg'}]},
    {id:'edition-b',items:[{id:'b',name:'同一本书',developer:'张三',isbn:'9787536692947',publisher:'乙出版社',pages:400,releaseDate:'2024-01-01',cover:'https://img.test/b.jpg'}]}
  ],'book','primary');
  const unknown=ambiguous.find(row=>row.id==='unknown');
  assert.ok(unknown);
  assert.equal(unknown.isbn,undefined);
  assert.equal(unknown.publisher,undefined);
  assert.equal(unknown.pages,undefined);
  assert.equal(unknown.releaseDate,undefined);
  assert.equal(unknown.cover,undefined);
  assert.ok(unknown._matchedCandidates.some(row=>row.ambiguous));

  const manga=mergeMetadata([
    {id:'bangumi',items:[{id:'series',name:'漫画作品',developer:'作者',editionKind:'系列',metadataSource:'Bangumi',aliases:['作品别名']}]},
    {id:'catalog',items:[{id:'volume',name:'漫画作品',developer:'作者',editionKind:'edition',isbn:'9787536692930',publisher:'单行本出版社',pages:180,cover:'https://img.test/volume.jpg',metadataSource:'书目源',aliases:['另一译名']}]}
  ],'manga','bangumi');
  const series=manga.find(row=>row.id==='series');
  assert.equal(manga.length,2);
  assert.deepEqual(series.aliases,['作品别名','另一译名']);
  assert.equal(series.isbn,undefined);
  assert.equal(series.publisher,undefined);
  assert.equal(series.pages,undefined);
  assert.equal(series.cover,undefined);
});

test('old settings retain per-type source defaults and source selector is limited to integrated results',()=>{
  assert.match(main,/metadataPrimarySourceByType:\s*\{\s*game:'steam',\s*movie:'douban',\s*anime:'bangumi',\s*manga:'bangumi',\s*book:'douban'/);
  assert.match(main,/metadataPrimarySourceByType:\{\.\.\.initialSettings\.metadataPrimarySourceByType,\.\.\.\(saved\.metadataPrimarySourceByType\|\|\{\}\)\}/);
  assert.match(main,/metadataPrimarySourceByType:\{\.\.\.initialSettings\.metadataPrimarySourceByType,\.\.\.\(legacy\.metadataPrimarySourceByType\|\|\{\}\)\}/);
  assert.match(resultUi,/主来源/);
  assert.ok(/native\.integrateMetadataSources\(type,selected,sourceGroups,payload\?\.query\|\|''\)/.test(resultUi));
  assert.ok(/group\?\.id!==?'integrated'/.test(resultUi));
});

test('TVmaze search stays lightweight; cast, crew and episode requests happen after selection',async()=>{
  const calls=[];
  const Search=require('../app/metadata-sources').createSourceSearch({pace:0,json:async url=>{
    calls.push(url);
    if(url==='https://api.tvmaze.com/search/shows?q='+encodeURIComponent('轻量剧集'))return [{show:{id:81,name:'轻量剧集',genres:['Drama'],url:'https://www.tvmaze.com/shows/81',premiered:'2020-01-01',rating:{average:8}}}];
    if(url.endsWith('/cast'))return [{person:{name:'演员'}}];
    if(url.endsWith('/crew'))return [{type:'Director',person:{name:'导演'}}];
    if(url.endsWith('/episodes'))return [{id:1},{id:2}];
    return null;
  },text:async()=>''});
  const found=await Search.search('movie','轻量剧集');
  const row=found.sources.find(source=>source.id==='tvmaze').items[0];
  assert.ok(row);
  assert.equal(calls.some(url=>/\/(cast|crew|episodes)$/.test(url)),false);
  const detail=await Search.resolveCandidate(row);
  assert.deepEqual(detail.cast,['演员']);
  assert.equal(detail.developer,'导演');
  assert.equal(detail.episodes,2);
  assert.equal(calls.filter(url=>/\/(cast|crew|episodes)$/.test(url)).length,3);
});

test('Bangumi subject, cast and staff endpoints wait until a specific result is selected',async()=>{
  const calls=[];
  const providers=require('../app/metadata-enrichment').createProviders({json:async url=>{
    calls.push(url);
    if(url.startsWith('https://api.bgm.tv/v0/search/subjects?'))return {data:[{id:31,type:2,name:'Selected Work',name_cn:'选中作品',date:'2020-01-01',images:{large:'https://img.test/cover.jpg'},tags:[{name:'动画'}]}]};
    if(url==='https://api.bgm.tv/v0/subjects/31')return {id:31,type:2,name:'Selected Work',name_cn:'选中作品',date:'2020-01-01',summary:'完整简介',rating:{score:8.1},tags:[{name:'动画'}],images:{large:'https://img.test/cover.jpg'}};
    if(url.endsWith('/characters'))return [];
    if(url.endsWith('/persons'))return [];
    return null;
  },text:async()=>''});
  const rows=await providers.bangumiSearch('选中作品','anime');
  assert.equal(rows.length,1);
  assert.equal(calls.some(url=>/\/subjects\/31(?:\/characters|\/persons)?$/.test(url)),false);
  const detail=await providers.bangumiDetail({id:31,name:'选中作品'},'anime','选中作品');
  assert.equal(detail.description,'完整简介');
  assert.ok(calls.includes('https://api.bgm.tv/v0/subjects/31'));
  assert.ok(calls.includes('https://api.bgm.tv/v0/subjects/31/characters'));
  assert.ok(calls.includes('https://api.bgm.tv/v0/subjects/31/persons'));
});

test('Douban book and movie candidates defer subject pages until selection',async()=>{
  const calls=[];
  const moviePage='<span property="v:itemreviewed">测试电影</span><div id="info">导演: 导演甲<br>类型: 剧情<br>上映日期: 2020-01-01</div><div id="link-report"><span property="v:summary">电影完整简介</span></div>';
  const bookPage='<div id="info">作者: 作者乙<br>出版社: 测试出版社<br>ISBN: 9787536692930<br>页数: 302</div><div id="link-report"><div class="intro">书籍完整简介</div></div>';
  const Search=require('../app/metadata-sources').createSourceSearch({pace:0,json:async url=>{
    calls.push(url);
    if(url.startsWith('https://movie.douban.com/j/subject_suggest'))return [{id:'123',title:'测试电影',year:'2020'}];
    if(url.startsWith('https://book.douban.com/j/subject_suggest'))return [{id:'456',title:'测试书',author_name:'作者乙'}];
    if(url.includes('subject_abstract?subject_id=123'))return {subject:{title:'测试电影',types:['剧情'],directors:['导演甲'],rate:'8.2'}};
    return null;
  },text:async url=>{calls.push(url);return url==='https://movie.douban.com/subject/123/'?moviePage:url==='https://book.douban.com/subject/456/'?bookPage:'';}});
  const movie=await Search.search('movie','测试电影'),film=movie.sources.find(source=>source.id==='douban').items[0];
  assert.equal(film.detailsUnavailable,true);
  assert.equal(calls.some(url=>url==='https://movie.douban.com/subject/123/'||url.includes('subject_abstract?subject_id=123')),false);
  const fullFilm=await Search.resolveCandidate(film);
  assert.equal(fullFilm.description,'电影完整简介');
  assert.equal(fullFilm.developer,'导演甲');
  assert.equal(calls.filter(url=>url==='https://movie.douban.com/subject/123/'||url.includes('subject_abstract?subject_id=123')).length,2);

  const book=await Search.search('book','测试书'),title=book.sources.find(source=>source.id==='douban').items[0];
  assert.equal(title.detailsUnavailable,true);
  assert.equal(calls.includes('https://book.douban.com/subject/456/'),false);
  const fullBook=await Search.resolveCandidate(title);
  assert.equal(fullBook.isbn,'9787536692930');
  assert.equal(fullBook.pages,302);
  assert.equal(fullBook.description,'书籍完整简介');
  assert.equal(calls.filter(url=>url==='https://book.douban.com/subject/456/').length,1);
});

test('Open Library search does not expand each candidate until one is selected',async()=>{
  const calls=[];
  const Search=require('../app/metadata-sources').createSourceSearch({pace:0,json:async url=>{
    calls.push(url);
    if(url.startsWith('https://openlibrary.org/search.json?'))return {docs:[{key:'OL123W',title:'版本书',author_name:['作者'],isbn:[],first_publish_year:2001}]};
    if(url==='https://openlibrary.org/works/OL123W/editions.json?limit=20')return {size:1,entries:[{key:'/books/OL123M',title:'版本书',isbn_13:['9787536692930'],publishers:['出版社'],number_of_pages:302,publish_date:'2001',covers:[123]}]};
    if(url==='https://openlibrary.org/works/OL123W.json')return {title:'版本书',description:{value:'详情摘要'}};
    return null;
  },text:async()=>''});
  const found=await Search.search('book','版本书');
  const row=found.sources.find(source=>source.id==='openlibrary').items[0];
  assert.ok(row);
  assert.equal(calls.some(url=>/\/editions\.json|\/works\/OL123W\.json/.test(url)),false);
  const detail=await Search.resolveCandidate(row);
  assert.equal(detail.isbn,'9787536692930');
  assert.equal(detail.publisher,'出版社');
  assert.equal(detail.pages,302);
  assert.ok(calls.some(url=>url.includes('/editions.json')));

  const providers=require('../app/metadata-enrichment').createProviders({json:async url=>{
    if(url.includes('/search.json?'))return {docs:[{key:'OL900W',title:'多版本作品',author_name:['同一作者'],isbn:[],cover_i:90}]};
    if(url.includes('/works/OL900W/editions.json'))return {size:3,entries:[{key:'/books/OL900A',isbn_13:['9787536692930'],publishers:['甲社'],number_of_pages:200},{key:'/books/OL900B',isbn_13:['9787536692947'],publishers:['乙社'],number_of_pages:400}]};
    if(url==='https://openlibrary.org/works/OL900W.json')return {description:{value:'作品级简介'},subjects:['奇幻']};
    return null;
  },text:async()=>''});
  const work=(await providers.openLibrarySearch('多版本作品'))[0];
  assert.equal(work.publisher,undefined);
  assert.equal(work.pages,undefined);
  const selected=await providers.resolveCandidate({...work,_sourceId:'openlibrary'},'book');
  assert.equal(selected.description,'作品级简介');
  assert.equal(selected.isbn,undefined);
  assert.equal(selected.publisher,undefined);
  assert.equal(selected.pages,undefined);
  assert.equal(selected.releaseDate,undefined);
  assert.equal(selected.cover,work.cover);
});

test('Z-Library follows only its verified same-origin GET search route and fetches details on selection',async()=>{
  const calls=[];
  const home='<form action="/search" method="get"><input type="search" name="q"></form>';
  const results='<a href="/book/123">公开书目</a>';
  const details='<script type="application/ld+json">'+JSON.stringify({'@type':'Book',name:'公开书目',description:'公开摘要',isbn:'9787536692930',publisher:{name:'出版社'},numberOfPages:302})+'</script>';
  const Search=require('../app/metadata-sources').createSourceSearch({pace:0,json:async()=>null,text:async url=>{
    calls.push(url);
    if(url==='https://zh.zlib.bz/')return home;
    if(url.startsWith('https://zh.zlib.bz/search?'))return results;
    if(url==='https://zh.zlib.bz/book/123')return details;
    return '';
  }});
  const found=await Search.search('book','公开书目');
  const row=found.sources.find(source=>source.id==='zlibrary').items[0];
  assert.equal(found.sources.find(source=>source.id==='zlibrary').searchUrl,'https://zh.zlib.bz/s/'+encodeURIComponent('公开书目'));
  assert.ok(row);
  assert.equal(calls.includes('https://zh.zlib.bz/book/123'),false);
  assert.equal(calls.some(url=>url.includes('zh.zlib.bz/search?q=%E5%85%AC%E5%BC%80%E4%B9%A6%E7%9B%AE')),true);
  const detail=await Search.resolveCandidate(row);
  assert.equal(detail.isbn,'9787536692930');
  assert.equal(detail.publisher,'出版社');
  assert.equal(calls.filter(url=>url==='https://zh.zlib.bz/book/123').length,1);
  assert.equal(require('../app/zlibrary-metadata').safeUrl('https://evil.test/book/1'),'');
  assert.equal(require('../app/zlibrary-metadata').safeUrl('http://zh.zlib.bz/book/1'),'');
});

test('Z-Library challenge and failed HTTP responses stay unavailable, not empty matches',async()=>{
  const Search=require('../app/metadata-sources').createSourceSearch({pace:0,json:async()=>null,text:async url=>url==='https://zh.zlib.bz/'?'<title>Checking your browser</title>':''});
  const found=await Search.search('book','挑战页面');
  const source=found.sources.find(row=>row.id==='zlibrary');
  assert.equal(source.state,'unavailable');
  assert.equal(source.statusLabel,'需验证');
  await Runtime.withDiagnostics(async issues=>{
    const value=await Network.readResponse(new Response('Service unavailable',{status:503}),'https://zh.zlib.bz/',true);
    assert.equal(value,'');
    assert.equal(issues[0].kind,'server');
  });
});

test('Z-Library timeout is isolated from successful book sources',async()=>{
  const Search=require('../app/metadata-sources').createSourceSearch({pace:0,json:async url=>url==='https://book.douban.com/j/subject_suggest?q='+encodeURIComponent('独立书源')?[{id:'81',title:'独立书源',author_name:'作者'}]:null,text:async url=>{
    if(url==='https://zh.zlib.bz/')throw Object.assign(new Error('timeout'),{name:'TimeoutError'});
    return '';
  }});
  const found=await Search.search('book','独立书源');
  assert.equal(found.sources.find(source=>source.id==='douban').items[0].name,'独立书源');
  assert.equal(found.sources.find(source=>source.id==='zlibrary').state,'unavailable');
  await Runtime.withDiagnostics(async issues=>{
    const value=Network.transportFailure(Object.assign(new Error('timeout'),{name:'TimeoutError'}),'https://zh.zlib.bz/');
    assert.equal(value.kind,'timeout');
    assert.equal(issues[0].host,'zh.zlib.bz');
  });
});

test('Steam search stays lightweight and selected candidates retain lazy detail lookup',()=>{
  const begin=main.indexOf('async function steamSearch');
  const end=main.indexOf('\nfunction decodeSteamHtml',begin);
  const searchCode=main.slice(begin,end);
  assert.match(searchCode,/preserveCandidateOrder/);
  assert.match(searchCode,/steamRelevance/);
  assert.doesNotMatch(searchCode,/steamAppDetailsBatch|onlyBaseGames/);
  assert.doesNotMatch(searchCode,/steamui|SteamUI/);
  for(const endpoint of ['steamSuggestSearch(query,country)','steamPagedSearch(query,country)'])assert.ok(searchCode.includes(endpoint),endpoint);
  assert.match(searchCode,/searchRegion\('hk'\)/);assert.match(searchCode,/searchRegion\('us'\)/);assert.match(main,/steamSuggestSearch\(query,country='hk'\)/);assert.match(main,/cc=\$\{String\(country\)\.toUpperCase\(\)\}/);
  assert.doesNotMatch(main,/steamUiBrowserSearch|steamUiResults|steamui\.com/i);
  const typeStart=main.indexOf('async function steamAppDetailsBatch');
  const typeCheck=main.slice(typeStart,main.indexOf('async function steamAppDetails(appid)',typeStart));
  assert.match(typeCheck,/store\.steampowered\.com\/api\/appdetails\?appids=/);
  const detail=main.slice(main.indexOf('async function steamByAppId'),main.indexOf('async function metadataSearchSteam'));
  assert.match(detail,/knownDetail \|\| await steamAppDetails\(appid\)/);
  assert.match(detail,/detail\.type\|\|''\)\.toLowerCase\(\) !== 'game'/);
  assert.match(detail,/steamReviewData/);
  assert.match(main,/async function resolveMetadataCandidate\(candidate\)/);
  assert.match(main,/SteamCandidateResolution\.resolveOrKeep/);
  assert.doesNotMatch(main,/这是 Steam DLC，已从游戏本体候选中排除/);
  assert.ok(/candidate\.integrated&&Array\.isArray\(candidate\._matchedCandidates\)[\s\S]{0,180}gameSources\.resolveCandidate/.test(main));
  assert.match(main,/MetadataRuntime\.run\(event\.sender\.id,id,\(\)=>resolveMetadataCandidate\(candidate\)/);
  assert.match(renderer,/metadataDetailRequestId/);
  assert.match(renderer,/metadataOwner|metadataSession/);
});

test('integrated Steam selection resolves only matched missing fields and preserves combined provenance',async()=>{
  const calls=[];
  const Sources=require('../app/game-sources').createGameSources({
    json:async url=>{calls.push(url);if(url==='https://api.bgm.tv/v0/subjects/7')return {name_cn:'整合作品',name:'Combined Work',date:'2020-04-01',tags:[{name:'动作'}],rating:{score:8.3}};return null;},
    text:async()=>'',steam:async()=>[],settings:()=>({metadataPrimarySourceByType:{game:'steam'}})
  });
  const candidate={id:'123',steamAppId:'123',name:'整合作品',releaseDate:'2020-04-01',platforms:['steam'],genres:[],integrated:true,metadataSource:'Steam + Bangumi 游戏',_sourceId:'steam',fieldSources:{name:'Steam',releaseDate:'Steam'},_matchedCandidates:[{sourceId:'bangumi',candidate:{id:'bgm-game-7',providerId:'7',name:'整合作品',releaseDate:'2020-04-01',genres:[],detailsUnavailable:true}}]};
  const result=await Sources.resolveCandidate(candidate);
  assert.deepEqual(result.genres,['动作']);
  assert.equal(result.metadataSource,'Steam + Bangumi 游戏');
  assert.equal(result.fieldSources.genres,'Bangumi 游戏');
  assert.equal(calls.filter(url=>/subjects\/7$/.test(url)).length,1);
  assert.equal(Object.hasOwn(result,'_matchedCandidates'),false);
});

test('Nintendo, PlayStation, Epic and DLsite defer product detail requests until selection',async()=>{
  const score=require('../app/game-sources').score,query='Test Game';
  const nintendoCalls=[],nintendoPages=[];
  const Nintendo=require('../app/nintendo-search').createNintendoSearch({json:async url=>{nintendoCalls.push(url);if(url.includes('nintendo.com/hk/api/search'))return {items:[{hardwareCategory:'Nintendo Switch',nsuid:'100',title:query,pageLinkCustom:'https://www.nintendo.com/hk/software/100'}]};return null;},text:async url=>{nintendoPages.push(url);return '<html>selected</html>';},parallel:async(values,work)=>Promise.all(values.map(work)),detail:entry=>({...entry,description:'Nintendo detail'}),relevance:entry=>score(entry,[query]),exclude:()=>false});
  const nintendoRows=await Nintendo(query,()=>{},[query]);
  assert.equal(nintendoRows.length,1);
  assert.equal(nintendoCalls.length,1);
  assert.deepEqual(nintendoPages,[]);
  assert.equal((await Nintendo.resolve(nintendoRows[0])).description,'Nintendo detail');
  assert.equal(nintendoPages.length,1);

  const psCalls=[],psPages=[],epicCalls=[];
  const adapters=require('../app/storefront-adapters').createStorefrontAdapters({json:async url=>{
    if(url.includes('store.playstation.com')||url.includes('web.np.playstation.com')){psCalls.push(url);return {data:{universalSearch:{results:[{id:'P1',name:query,__typename:'Concept',media:[]}]}}};}
    epicCalls.push(url);if(url.includes('/search/v2/search'))return {offers:[{namespace:'ns1',id:'offer1',offerType:'BASE_GAME',title:query,productSlug:'test-game',keyImages:[]}],total:1};return {averageRating:4.5};
  },text:async url=>{psPages.push(url);return '<html>selected</html>';},parallel:async(values,work)=>Promise.all(values.map(work)),detail:entry=>entry,relevance:entry=>score(entry,[query])});
  const psRows=await adapters.playstation(query,()=>{},[query]);
  assert.equal(psRows.length,1);
  assert.equal(psCalls.length,1);
  assert.equal(psPages.length,0);
  await adapters.playstation.resolve(psRows[0]);
  assert.equal(psPages.length,1);
  const epicRows=await adapters.epic(query,()=>{},[query]);
  assert.equal(epicRows.length,1);
  assert.equal(epicCalls.filter(url=>url.includes('/polls')).length,0);
  await adapters.epic.resolve(epicRows[0]);
  assert.equal(epicCalls.filter(url=>url.includes('/polls')).length,1);

  const dlsiteCalls=[];
  const games=require('../app/game-sources').createGameSources({json:async()=>null,text:async url=>{dlsiteCalls.push(url);return url.includes('/fsr?')?'<dl class="work_img_main"><div data-worktype="ACT"></div><div class="work_name"><a href="https://www.dlsite.com/home/work/product_id/RJ123.html">Test Game</a></div><div class="maker_name"><a>Maker</a></div></dl>':'<h1 id="work_name">Test Game detail</h1>';},steam:async()=>[]});
  const dlsiteRows=await games.dlsite(query,()=>{},[query]);
  assert.equal(dlsiteRows.length,1);
  assert.equal(dlsiteCalls.length,3);
  assert.equal(dlsiteRows[0].name,query);
  await games.resolveCandidate({...dlsiteRows[0],mediaType:'game',_sourceId:'dlsite'});
  assert.equal(dlsiteCalls.length,4);
});

test('editor cancellation still guards late detail results and leaves manual fields protected',()=>{
  assert.ok(/epoch!==metadataSelectionEpoch\|\|editorId!==owner\|\|\$\('fieldType'\)\.value!==type\|\|\$\('editorBackdrop'\)\.classList\.contains\('hidden'\)/.test(renderer));
  assert.ok(/if\(changed\(id\)\|\|key==='playtime'&&valueFor\(id\)!==''\)continue/.test(renderer));
  assert.match(main,/metadata:resolveCandidate/);
  assert.match(main,/MetadataRuntime\.cancel\(event\.sender\.id,id\)/);
});
