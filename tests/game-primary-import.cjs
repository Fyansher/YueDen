const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {mergeMetadata}=require('../app/metadata-merge');
const SteamResults=require('../app/steam-search-results');
const GameSources=require('../app/game-sources');
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

test('game source integration joins translated aliases and preserves each source ranking',async()=>{
 const steamRows=[
  {id:'275850',steamAppId:'275850',name:"No Man's Sky",type:'game',storeUrl:'https://store.steampowered.com/app/275850/'},
  {id:'999001',steamAppId:'999001',name:"No Man's Sky: DLC Pack",type:'game',storeUrl:'https://store.steampowered.com/app/999001/'}
 ];
 const service=GameSources.createGameSources({
  json:async url=>url.startsWith('https://api.bgm.tv/v0/search/subjects')?{data:[{id:42,type:4,name_cn:'无人深空',name:"No Man's Sky",date:'2016-08-12',tags:[]},{id:43,type:4,name_cn:'无人深空 DLC',name:"No Man's Sky DLC",date:'2016-08-12',tags:[{name:'DLC'}]}]}:[],
  text:async()=>'',steam:async(_query,emit)=>{emit(steamRows);return steamRows;},
  aliases:()=>[],settings:()=>({metadataPrimarySourceByType:{game:'steam'}})
 });
 const bundle=await service.search("No Man's Sky");assert.equal(bundle.integrated[0].id,'275850');assert.equal(bundle.integrated[0].storeUrl,'https://store.steampowered.com/app/275850/');assert.equal(bundle.sources.find(source=>source.id==='steam').items.some(item=>item.id==='999001'),true);assert.equal(bundle.sources.find(source=>source.id==='bangumi').items.some(item=>item.providerId==='43'),false);
});

test('Steam provider order is retained even when localized titles do not match the query text',()=>{
 const rows=SteamResults.preserveCandidateOrder([{id:'1551360',name:'极限竞速：地平线 5'},{id:'1001',name:'Forza Horizon 5 DLC'},{id:'1002',name:'Forza Horizon 5'}]);assert.deepEqual(rows.map(row=>row.id),['1551360','1001','1002']);
});

test('Steam autocomplete hit is shown in provider order without triggering slower fallbacks',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=source.indexOf('async function steamSearch'),end=source.indexOf('\nfunction decodeSteamHtml',start),sandbox={
  SteamSearchResults:SteamResults,MetadataText:{text:value=>value},steamRelevance:()=>0,
  steamSuggestSearch:async()=>[{id:'1551360',name:'极限竞速：地平线 5'},{id:'1001',name:'Forza Horizon 5 DLC'}],
  fetchJson:async()=>{throw Error('slower fallback should not run');},steamPagedSearch:async()=>{throw Error('paged fallback should not run');}
 };
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.search=steamSearch;',sandbox);
 const emitted=[],rows=await sandbox.search('Forza Horizon 5',value=>emitted.push(value));
 assert.deepEqual(Array.from(rows,row=>row.id),['1551360','1001']);
 assert.deepEqual(Array.from(emitted.at(-1),row=>row.id),['1551360','1001']);
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
