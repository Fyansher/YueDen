const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Cover=require('../app/cover-completion');
const Steam=require('../app/steam-library-art');

test('integrated metadata keeps the primary landscape art and fills a portrait from the same matched work',async()=>{
  const dimensions=new Map([['https://img.test/steam.jpg',{width:920,height:430}],['https://img.test/bangumi.jpg',{width:600,height:900}]]);
  const entry={id:'steam-1',type:'game',name:'同一作品',_sourceId:'steam',cover:'https://img.test/steam.jpg',coverLandscape:'https://img.test/steam.jpg',metadataSource:'Steam',fieldSources:{cover:'Steam',coverLandscape:'Steam'}};
  const matches=[{sourceId:'bangumi',candidate:{id:'bgm-1',name:'同一作品',cover:'https://img.test/bangumi.jpg',metadataSource:'Bangumi 游戏',fieldSources:{cover:'Bangumi 游戏'}}}];
  const result=await Cover.complete(entry,matches,async url=>dimensions.has(url)?{dimensions:dimensions.get(url)}:null);
  assert.equal(result.coverLandscape,'https://img.test/steam.jpg');
  assert.equal(result.coverPortrait,'https://img.test/bangumi.jpg');
  assert.equal(result.fieldSources.coverPortrait,'Bangumi 游戏');
  assert.match(result.metadataSource,/Steam \+ Bangumi 游戏/);
  assert.equal(result.cover,'');
});

test('failed source art is replaced by a verified same-direction match; square art stays common',async()=>{
  const portrait='https://img.test/portrait.jpg',square='https://img.test/square.jpg';
  const entry={id:'work',type:'movie',name:'影片',_sourceId:'douban',coverPortrait:'https://img.test/dead.jpg',fieldSources:{coverPortrait:'豆瓣电影'},metadataSource:'豆瓣电影'};
  const matches=[{sourceId:'tvmaze',candidate:{name:'影片',cover:portrait,fieldSources:{cover:'TVmaze'},metadataSource:'TVmaze'}},{sourceId:'itunes',candidate:{name:'影片',cover:square,fieldSources:{cover:'Apple iTunes'},metadataSource:'Apple iTunes'}}];
  const result=await Cover.complete(entry,matches,async url=>url===portrait?{dimensions:{width:600,height:900}}:url===square?{dimensions:{width:800,height:800}}:null);
  assert.equal(result.coverPortrait,portrait);
  assert.equal(result.fieldSources.coverPortrait,'TVmaze');
  assert.equal(result.cover,square);
});

test('ambiguous publication covers stay isolated until the selected edition has an ISBN',async()=>{
  const matches=[{sourceId:'catalog',ambiguous:true,candidate:{name:'书名',cover:'https://img.test/edition.jpg',fieldSources:{cover:'书目源'}}}];
  const inspect=async()=>({dimensions:{width:600,height:900}});
  const unknown=await Cover.complete({name:'书名',_sourceId:'bangumi'},matches,inspect);
  const identified=await Cover.complete({name:'书名',isbn:'9787536692930',_sourceId:'bangumi'},matches,inspect);
  assert.equal(unknown.coverPortrait,undefined);
  assert.equal(identified.coverPortrait,'https://img.test/edition.jpg');
});

test('Steam library artwork URLs come from returned asset metadata and old flat URLs can be recognized',()=>{
  const payload={response:{store_items:[{appid:2623190,assets:{asset_url_format:'steam/apps/2623190/${FILENAME}?t=1786648304',library_capsule_2x:'b52322f78cbdc7e6c267d873056abba7916f7ff3/library_600x900_2x.jpg'}}]}};
  assert.equal(Steam.portraitUrl(payload,'2623190'),'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2623190/b52322f78cbdc7e6c267d873056abba7916f7ff3/library_600x900_2x.jpg?t=1786648304');
  const request=decodeURIComponent(Steam.requestUrl('2623190').split('input_json=')[1]);
  assert.deepEqual(JSON.parse(request),{ids:[{appid:2623190}],context:{country_code:'HK',language:'schinese'},data_request:{include_assets:true}});
  assert.equal(Steam.legacyPortraitAppId(['https://cdn.akamai.steamstatic.com/steam/apps/3636770/library_600x900.jpg']),'3636770');
  assert.equal(Steam.legacyPortraitAppId(['https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3636770/abc/library_600x900.jpg']),'');
  assert.equal(Steam.portraitUrl(payload,'bad-id'),'');
});

test('Steam metadata prefers current asset templates and never emits a retired flat portrait URL',()=>{
  const payload={response:{store_items:[{appid:2584270,assets:{asset_url_format:'steam/apps/2584270/${FILENAME}?t=12',library_capsule_2x:'https://cdn.akamai.steamstatic.com/steam/apps/2584270/library_600x900.jpg',library_600x900_2x:'a258/hash/library_600x900_2x.jpg'}}]}};
  assert.equal(Steam.portraitUrl(payload,'2584270'),'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2584270/a258/hash/library_600x900_2x.jpg?t=12');
  const legacyOnly={response:{store_items:[{appid:3681010,assets:{library_capsule_2x:'https://cdn.akamai.steamstatic.com/steam/apps/3681010/library_600x900.jpg'}}]}};
  assert.equal(Steam.portraitUrl(legacyOnly,'3681010'),'');
  legacyOnly.response.store_items[0].assets.asset_url_format='steam/apps/3681010/${FILENAME}?t=31';
  assert.equal(Steam.portraitUrl(legacyOnly,'3681010'),'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3681010/library_600x900.jpg?t=31');
});

test('Steam library artwork lookups batch app IDs and map returned assets back to each game',()=>{
  const url=decodeURIComponent(Steam.requestUrl(['3636770','3934250','3636770']).split('input_json=')[1]);
  assert.deepEqual(JSON.parse(url),{ids:[{appid:3636770},{appid:3934250}],context:{country_code:'HK',language:'schinese'},data_request:{include_assets:true}});
  const payload={response:{store_items:[{appid:3934250,assets:{asset_url_format:'steam/apps/3934250/${FILENAME}',library_capsule:'f393/library_600x900.jpg'}},{appid:3636770,assets:{asset_url_format:'steam/apps/3636770/${FILENAME}',library_capsule:'f363/library_600x900.jpg'}}]}};
  assert.deepEqual([...Steam.portraitUrls(payload,['3636770','3934250'])],[['3636770','https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3636770/f363/library_600x900.jpg'],['3934250','https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3934250/f393/library_600x900.jpg']]);
});

test('Steam candidate paths no longer fabricate a flat portrait URL and both resolver families use shared completion',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');
  const game=fs.readFileSync(path.join(__dirname,'../app/game-sources.js'),'utf8');
  const metadata=fs.readFileSync(path.join(__dirname,'../app/metadata-sources.js'),'utf8');
  assert.doesNotMatch(main,/cdn\.akamai\.steamstatic\.com\/steam\/apps\/['"`].*library_600x900/);
  assert.match(main,/steamLibraryPortraits\(appid\)/);
  assert.match(main,/else resolved=await completeMetadataCovers\(resolved,candidate\)/);
  assert.match(main,/legacySteamPortrait&&detail\.coverPortrait/);
  assert.match(game,/completeCovers\(base,candidate\)/);
  assert.match(metadata,/completeCovers\(base,candidate\)/);
});
