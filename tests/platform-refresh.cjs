const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PlatformModel=require('../app/platform-model'),LocalModel=require('../app/local-model'),SteamLibraryArt=require('../app/steam-library-art');

function createRefresh({search,resolve=value=>value,settings={metadataPrimarySourceByType:{game:'steam',book:'douban'}},match=(item,candidates)=>candidates[0]||null}){
 const source=fs.readFileSync(require.resolve('../app/main.js'),'utf8'),start=source.indexOf('async function refreshItemMetadata('),end=source.indexOf('\nfunction backupRoot()',start);
 return vm.runInNewContext('('+source.slice(start,end).trim()+')',{
  metadataSearchSources:search,loadSettings:()=>settings,refreshMatch:match,resolveMetadataCandidate:resolve,normaliseItem:value=>value,PlatformModel,MetadataRuntime:{check(){}},
  require:id=>id==='./local-model'?LocalModel:id==='./steam-library-art'?SteamLibraryArt:require(id)
 });
}

test('game refresh searches the configured primary and Bangumi only, then preserves played platforms and status',async()=>{
 const calls=[],candidate={id:'steam-1',name:'Same',_sourceId:'steam',platforms:['steam'],metadataSource:'Steam'},bangumi={id:'bgm-game-1',name:'Same',_sourceId:'bangumi',platforms:['pc','ns'],metadataSource:'Bangumi'};
 const refresh=createRefresh({search:async(type,query,options)=>{calls.push({type,query,sourceIds:options.sourceIds});return {integrated:[candidate],sources:[{id:'steam',items:[candidate]},{id:'bangumi',items:[bangumi]}]};}});
 const item={type:'game',name:'Same',status:'已完成',platforms:['steam'],platformsExplicit:true,playedPlatforms:['steam']},next=await refresh(item);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{type:'game',query:'Same',sourceIds:['steam','bangumi']}]);
 assert.deepEqual(Array.from(next.platforms),['steam','pc','ns']);assert.deepEqual(Array.from(next.playedPlatforms),['steam']);assert.equal(next.status,'已完成');assert.equal(next.platformsExplicit,false);
});

test('manual game platforms skip the Bangumi supplement',async()=>{
 let queried;const candidate={id:'steam-1',name:'Same',_sourceId:'steam',platforms:['pc'],metadataSource:'Steam'},refresh=createRefresh({search:async(type,query,options)=>{queried=options.sourceIds;return {integrated:[candidate],sources:[]};}});
 await refresh({type:'game',name:'Same',platforms:['pc'],platformsManual:true});assert.deepEqual(Array.from(queried),['steam']);
});

test('book refresh queries only its primary and a targeted field source when edition fields are missing',async()=>{
 const calls=[],primary={id:'douban-1',name:'The Book',metadataSource:'豆瓣读书',description:'summary'},extra={id:'google-1',name:'The Book',metadataSource:'Google Books',isbn:'9780306406157',pages:100,publisher:'Press'};
 const refresh=createRefresh({search:async(type,query,options)=>{calls.push(options.sourceIds);const row=options.sourceIds[0]==='douban'?primary:extra;return {integrated:[row],sources:[]};}});
 const next=await refresh({type:'book',name:'The Book'});
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['douban'],['googlebooks']]);assert.equal(next.isbn,extra.isbn);assert.equal(next.pages,100);assert.equal(next.publisher,'Press');
});
