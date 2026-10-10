const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {mergeMetadata}=require('../app/metadata-merge');
const SteamResults=require('../app/steam-search-results');
const GameSources=require('../app/game-sources');
const PlatformModel=require('../app/platform-model');
const LocalModel=require('../app/local-model');
const {createImportSearch}=require('../app/import-metadata');

test('Steam primary source supplies the merged title and store link for Chinese and original titles',()=>{
 const groups=[
  {id:'steam',label:'Steam',items:[{id:'275850',steamAppId:'275850',name:"No Man's Sky",developer:'Hello Games',platforms:['steam'],storeUrl:'https://store.steampowered.com/app/275850/',metadataSource:'Steam'}]},
  {id:'bangumi',label:'Bangumi 游戏',items:[{id:'bgm-game-42',name:'无人深空',originalName:"No Man's Sky",developer:'Hello Games',releaseDate:'2016-08-12',storeUrl:'https://bgm.tv/subject/42',metadataSource:'Bangumi 游戏'}]}
 ];
 const steam=mergeMetadata(groups,'game','steam');assert.equal(steam.length,1);assert.equal(steam[0].id,'275850');assert.equal(steam[0].name,"No Man's Sky");assert.equal(steam[0].storeUrl,'https://store.steampowered.com/app/275850/');assert.equal(steam[0].platformLinks.steam,'https://store.steampowered.com/app/275850/');assert.ok(steam[0]._matchedCandidates.some(row=>row.sourceId==='bangumi'));
 const bangumi=mergeMetadata(groups,'game','bangumi');assert.equal(bangumi.length,1);assert.equal(bangumi[0].id,'bgm-game-42');assert.equal(bangumi[0].storeUrl,'https://bgm.tv/subject/42');
});

test('integrated ordering is authoritative for auto match; raw Steam rows are not rescored ahead',()=>{
 const integrated=[{id:'top',name:'排序首位',_sourceId:'bangumi'},{id:'second',name:'另一个候选',_sourceId:'steam'}];
 assert.equal(LocalModel.automaticCandidate('完全不同的本地名称','game',{integrated,sources:[{id:'steam',items:[{id:'raw',name:'Steam 原始候选'}]}]}),integrated[0]);
});

test('platform selection cycles release, played, and unselected without treating old data as played',()=>{
 const item={platforms:['steam'],storeUrl:'https://store.steampowered.com/app/1/'};
 assert.equal(PlatformModel.state(item,'steam'),'release');
 const played=PlatformModel.cycle(item,'steam');assert.deepEqual(played.platforms,['steam']);assert.deepEqual(played.playedPlatforms,['steam']);assert.equal(PlatformModel.state({...item,...played},'steam'),'played');
 const cleared=PlatformModel.cycle({...item,...played},'steam');assert.deepEqual(cleared.platforms,[]);assert.deepEqual(cleared.playedPlatforms,[]);assert.deepEqual(PlatformModel.detect({...item,...cleared}),[]);
 assert.deepEqual(PlatformModel.cycle({...item,...cleared},'steam').platforms,['steam']);
 assert.match(PlatformModel.icons({...item,playedPlatforms:['steam']}),/data-platform-state="played"/);
 assert.doesNotMatch(PlatformModel.icons(item),/data-platform-state="played"/);
});

test('game source integration joins translated aliases and preserves each source ranking',async()=>{
 const steamRows=[
  {id:'275850',steamAppId:'275850',name:"No Man's Sky",type:'game',platforms:['steam'],storeUrl:'https://store.steampowered.com/app/275850/'},
  {id:'999001',steamAppId:'999001',name:"No Man's Sky: DLC Pack",type:'game',storeUrl:'https://store.steampowered.com/app/999001/'}
 ];
 const service=GameSources.createGameSources({
  json:async url=>url.startsWith('https://api.bgm.tv/v0/search/subjects')?{data:[{id:42,type:4,name_cn:'无人深空',name:"No Man's Sky",date:'2016-08-12',tags:[],infobox:[{key:'游戏平台',value:[{v:'PC (Windows)'},{v:'Nintendo Switch'}]}]},{id:43,type:4,name_cn:'无人深空 DLC',name:"No Man's Sky DLC",date:'2016-08-12',tags:[{name:'DLC'}]}]}:[],
  text:async()=>'',steam:async(_query,emit)=>{emit(steamRows);return steamRows;},
  aliases:()=>[],settings:()=>({metadataPrimarySourceByType:{game:'steam'}})
 });
 const bundle=await service.search("No Man's Sky");assert.equal(bundle.integrated[0].id,'275850');assert.equal(bundle.integrated[0].storeUrl,'https://store.steampowered.com/app/275850/');assert.deepEqual(bundle.sources.find(source=>source.id==='bangumi').items[0].platforms,['pc','ns']);assert.deepEqual(bundle.integrated[0].platforms,['steam','pc','ns']);assert.equal(bundle.sources.find(source=>source.id==='steam').items.some(item=>item.id==='999001'),true);assert.equal(bundle.sources.find(source=>source.id==='bangumi').items.some(item=>item.providerId==='43'),false);
});

test('selected Steam integration reads Bangumi detail when its search row has no platforms',async()=>{
 let detailRequests=0;const steamRow={id:'1',steamAppId:'1',name:'Example Game',type:'game',platforms:['steam'],description:'Steam description',developer:'Studio',publisher:'Publisher',releaseDate:'2020-01-01',externalRating:'90',cover:'https://img.test/steam.jpg',storeUrl:'https://store.steampowered.com/app/1/'},seed={id:42,type:4,name_cn:'示例游戏',name:'Example Game',date:'2020-01-01',tags:[],infobox:[]};
 const service=GameSources.createGameSources({
  json:async url=>url.startsWith('https://api.bgm.tv/v0/search/subjects')?{data:[seed]}:url==='https://api.bgm.tv/v0/subjects/42'?(detailRequests++,{...seed,summary:'详情',infobox:[{key:'游戏平台',value:[{v:'PC (Windows)'},{v:'Nintendo Switch'}]}]}):[],
  text:async()=>'',steam:async(_query,emit)=>{emit([steamRow]);return [steamRow];},aliases:()=>[],settings:()=>({metadataPrimarySourceByType:{game:'steam'}})
 });
 const bundle=await service.search('Example Game');assert.equal(bundle.integrated[0]._sourceId,'steam');assert.match(bundle.integrated[0].metadataSource,/Steam \+ Bangumi 游戏/);assert.equal(detailRequests,0);
 const resolved=await service.resolveCandidate(bundle.integrated[0]);assert.equal(detailRequests,1);assert.deepEqual(resolved.platforms,['steam','pc','ns']);assert.equal(resolved.storeUrl,steamRow.storeUrl);
});

test('unavailable Bangumi platform detail does not block the selected Steam result',async()=>{
 const steamRow={id:'1',steamAppId:'1',name:'Example Game',type:'game',platforms:['steam'],description:'Steam description',developer:'Studio',publisher:'Publisher',releaseDate:'2020-01-01',externalRating:'90',cover:'https://img.test/steam.jpg',storeUrl:'https://store.steampowered.com/app/1/'},seed={id:42,type:4,name_cn:'示例游戏',name:'Example Game',date:'2020-01-01',tags:[],infobox:[]};
 const service=GameSources.createGameSources({json:async url=>url.startsWith('https://api.bgm.tv/v0/search/subjects')?{data:[seed]}:url==='https://api.bgm.tv/v0/subjects/42'?Promise.reject(Error('Bangumi detail unavailable')):[],text:async()=>'',steam:async(_query,emit)=>{emit([steamRow]);return [steamRow];},aliases:()=>[],settings:()=>({metadataPrimarySourceByType:{game:'steam'}})});
 const bundle=await service.search('Example Game'),resolved=await service.resolveCandidate(bundle.integrated[0]);assert.deepEqual(resolved.platforms,['steam']);assert.equal(resolved.storeUrl,steamRow.storeUrl);
});

test('Steam provider order is retained even when localized titles do not match the query text',()=>{
 const rows=SteamResults.preserveCandidateOrder([{id:'1551360',name:'极限竞速：地平线 5'},{id:'1001',name:'Forza Horizon 5 DLC'},{id:'1002',name:'Forza Horizon 5'}]);assert.deepEqual(rows.map(row=>row.id),['1551360','1001','1002']);
});

test('Steam Hong Kong autocomplete hit with a strong match skips regional fallback',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=source.indexOf('async function steamSearch'),end=source.indexOf('\nfunction decodeSteamHtml',start),sandbox={
  SteamSearchResults:SteamResults,MetadataText:{text:value=>value},steamRelevance:entry=>entry.id==='1551360'?80:0,
  steamSuggestSearch:async(_query,country)=>{assert.equal(country,'hk');return [{id:'1551360',name:'极限竞速：地平线 5'},{id:'1001',name:'Forza Horizon 5 DLC'}];},
  fetchJson:async()=>{throw Error('slower fallback should not run');},steamPagedSearch:async()=>{throw Error('paged fallback should not run');}
 };
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.search=steamSearch;',sandbox);
 const emitted=[],rows=await sandbox.search('Forza Horizon 5',value=>emitted.push(value));
 assert.deepEqual(Array.from(rows,row=>row.id),['1551360','1001']);
 assert.deepEqual(Array.from(emitted.at(-1),row=>row.id),['1551360','1001']);
});

test('Steam weak HK candidates appear immediately and receive one appended US supplement',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=source.indexOf('async function steamSearch'),end=source.indexOf('\nfunction decodeSteamHtml',start),countries=[];let resolveUS;
 const sandbox={
  SteamSearchResults:SteamResults,MetadataText:{text:value=>value},MetadataRuntime:{check(){}},steamRelevance:entry=>entry.id==='2'?80:0,
  steamSuggestSearch:async(_query,country)=>{countries.push(country);if(country==='hk')return [{id:'1',name:'Unrelated result'}];return new Promise(resolve=>{resolveUS=resolve;});},
  fetchJson:async()=>{throw Error('slower fallback should not run');},steamPagedSearch:async()=>{throw Error('paged fallback should not run');}
 };
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.search=steamSearch;',sandbox);
 const emitted=[],pending=sandbox.search('Forza Horizon 5',value=>emitted.push(value));
 for(let i=0;i<4&&!resolveUS;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(countries,['hk','us']);assert.equal(typeof resolveUS,'function');
 assert.deepEqual(Array.from(emitted[0],row=>row.id),['1']);
 resolveUS([{id:'2',name:'Forza Horizon 5'}]);
 const rows=await pending;
 assert.deepEqual(Array.from(rows,row=>row.id),['1','2']);
 assert.deepEqual(Array.from(emitted.at(-1),row=>row.id),['1','2']);
});

test('Steam multi-term lookup shares one US fallback budget',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=source.indexOf('async function metadataSearchSteam'),end=source.indexOf('\nasync function metadataSearch(',start),budgets=[];
 const sandbox={gameSearchTerms:()=>['primary','alias'],steamSearch:async(_term,_publish,budget)=>{budgets.push(budget);return [];},MetadataRuntime:{check(){}},MetadataText:{candidate:value=>value}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.search=metadataSearchSteam;',sandbox);
 assert.equal((await sandbox.search('game','title')).length,0);
 assert.equal(budgets.length,2);assert.equal(budgets[0],budgets[1]);assert.deepEqual({...budgets[0]},{used:false});
});

test('game integration preserves Steam autocomplete order rather than rescoring translated titles',async()=>{
 const steamRows=[{id:'1551360',name:'极限竞速：地平线 5'},{id:'1001',name:'Forza Horizon 5 DLC'},{id:'1002',name:'Forza Horizon 5'}];
 const service=GameSources.createGameSources({json:async()=>({data:[]}),text:async()=>'',steam:async(_query,emit)=>{emit(steamRows);return steamRows;},aliases:()=>[],settings:()=>({metadataPrimarySourceByType:{game:'steam'}})});
 const bundle=await service.search('Forza Horizon 5');
 assert.deepEqual(bundle.sources.find(source=>source.id==='steam').items.map(item=>item.id),['1551360','1001','1002']);
 assert.deepEqual(bundle.integrated.map(item=>item.id),['1551360','1001','1002']);
});

test('import metadata uses the integrated source pipeline and forwards streaming options',async()=>{
 let calls=0,seenOptions;const search=createImportSearch({steam:async()=>{throw Error('raw Steam path must not run');},search:async(type,query,options)=>{calls++;seenOptions=options;return {type,query,integrated:[]};}}),onProgress=()=>{};
 const result=await search('game','作品名',{onProgress});assert.equal(calls,1);assert.equal(seenOptions.onProgress,onProgress);assert.equal(result.query,'作品名');
});
