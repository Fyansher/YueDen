const test=require('node:test'),assert=require('node:assert/strict');
const SteamResults=require('../app/steam-search-results');
const SteamCandidateResolution=require('../app/steam-candidate-resolution');
const ImportQueue=require('../app/import-metadata-queue');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');

test('Steam keeps source order and does not fetch every candidate detail',()=>{
 const rows=Array.from({length:100},(_,index)=>({id:String(index+1),name:'FINAL FANTASY VII DLC '+index,sourceProductType:'dlc'}));
 rows.push({id:'1001',name:'FINAL FANTASY VII',steamAppId:'1001'});
 const games=SteamResults.preserveCandidateOrder(rows);
 assert.equal(games.length,40);
 assert.equal(games[0].id,'1');
 assert.equal(games.some(row=>row.id==='1001'),false);
 assert.ok(games.some(row=>row.sourceProductType==='dlc'));
 const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=main.indexOf('async function steamSearch'),end=main.indexOf('\nfunction decodeSteamHtml',start),search=main.slice(start,end);
 assert.match(search,/preserveCandidateOrder/);
 assert.doesNotMatch(search,/steamRelevance/);
 assert.doesNotMatch(search,/steamAppDetailsBatch|onlyBaseGames/);
});

test('Steam detail request failure keeps the selected search candidate usable for import',async()=>{
 const seed={id:'1001',steamAppId:'1001',name:'FINAL FANTASY VII',storeUrl:'https://store.steampowered.com/app/1001/'};
 const result=await SteamCandidateResolution.resolveOrKeep(seed,async()=>{throw Object.assign(new Error('HTTP 400'),{name:'requestError'});});
 assert.equal(result.value,seed);
 assert.equal(result.detailed,false);
 assert.equal(result.error.message,'HTTP 400');
});

test('local import commits a searched Steam candidate when its optional detail request fails',async()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../app/local-import-ui.js'),'utf8'),toasts=[],saved=[],elements=new Map();
 const candidate={id:'1001',steamAppId:'1001',name:'FINAL FANTASY VII',storeUrl:'https://store.steampowered.com/app/1001/',metadataSource:'Steam'};
 const row={id:'local-row',name:'FINAL FANTASY VII',type:'game',selected:true,action:'new',localPath:'C:\\Games\\FFVII',localFiles:[{path:'C:\\Games\\FFVII\\game.exe',name:'game.exe'}],metadataBundle:{integrated:[candidate],sources:[]}};
 const state={items:[],categories:[]};
 const LocalModel={members:item=>item.localFiles||[],pathKey:value=>String(value||'').toLowerCase(),same:()=>false,mergeFiles:(_,files)=>files,fillMissing:(current,incoming)=>{const next={...current};for(const [key,value]of Object.entries(incoming))if(next[key]==null||next[key]===''||Array.isArray(next[key])&&!next[key].length)next[key]=value;return next;},automaticCandidate:(_name,_type,bundle)=>bundle.integrated[0]||null};
 const sandbox={
  state,settings:{disguiseEnabled:false},structuredClone,crypto,
  native:{saveLibrary:async value=>{saved.push(structuredClone(value));return value;},resolveLocalMetadataCandidate:async(_id,value)=>(await SteamCandidateResolution.resolveOrKeep(value,async()=>{throw Object.assign(new Error('HTTP 400'),{name:'requestError'});})).value,prepareLocalCandidate:async value=>value},
  LocalModel,StatusModel:{normalize:()=>''},ResourceIdentity:{key:()=>''},LibraryRelations:{},
  showToast:(message)=>toasts.push(message),renderLibrary:()=>{},renderLocalRows:()=>{},localRowMessage:()=>{},localImportProgress:()=>{},finishPendingImportedMetadata:async()=>{},
  prefetchLocalMetadata:()=>[Promise.resolve({bundle:row.metadataBundle})],
  $:id=>{if(!elements.has(id))elements.set(id,{textContent:'',remove(){}});return elements.get(id);}
 };
 vm.createContext(sandbox);
 vm.runInContext(ui+'\nglobalThis.localImportProgress=()=>{};globalThis.localRowMessage=()=>{};globalThis.renderLocalRows=()=>{};globalThis.__commitLocalRows=commitLocalRows;',sandbox);
 await sandbox.__commitLocalRows({closed:false,committing:false,ignoreAll:false,liveMetadata:true,rows:[row],type:'game'},()=>{});
 assert.equal(saved.length,2,JSON.stringify({toasts,row,state:sandbox.state.items}));
 assert.equal(sandbox.state.items.length,1);
 assert.equal(sandbox.state.items[0].steamAppId,'1001');
 assert.equal(row.imported,true);
 assert.ok(toasts.some(message=>message.startsWith('导入完成：')));
 assert.ok(toasts.every(message=>!message.startsWith('导入失败：')));
});

test('cancelled candidate resolution is not reported as successful scraping',async()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../app/local-import-ui.js'),'utf8'),toasts=[],messages=[],saved=[],elements=new Map();
 const candidate={id:'candidate-1',name:'候选作品',description:'候选简介',metadataSource:'Fixture'};
 const row={id:'local-row',name:'本地作品',type:'movie',selected:true,action:'new',localPath:'C:\\Movies\\Fixture',localFiles:[{path:'C:\\Movies\\Fixture\\movie.mp4',name:'movie.mp4'}],metadataBundle:{integrated:[candidate],sources:[]}};
 const state={items:[],categories:[]};
 const LocalModel={members:item=>item.localFiles||[],pathKey:value=>String(value||'').toLowerCase(),same:()=>false,mergeFiles:(_,files)=>files,fillMissing:(current,incoming)=>{const next={...current};for(const [key,value]of Object.entries(incoming))if(next[key]==null||next[key]===''||Array.isArray(next[key])&&!next[key].length)next[key]=value;return next;},automaticCandidate:(_name,_type,bundle)=>bundle.integrated[0]||null};
 const sandbox={
  state,settings:{disguiseEnabled:false},structuredClone,crypto,
  native:{saveLibrary:async value=>{saved.push(structuredClone(value));return value;},resolveLocalMetadataCandidate:async()=>({canceled:true}),prepareLocalCandidate:async value=>value},
  LocalModel,StatusModel:{normalize:()=>''},ResourceIdentity:{key:()=>''},LibraryRelations:{},
  showToast:message=>toasts.push(message),renderLibrary:()=>{},renderLocalRows:()=>{},localRowMessage:(_job,_row,message)=>messages.push(message),localImportProgress:()=>{},finishPendingImportedMetadata:async()=>{},pickImportMetadata:async()=>null,
  prefetchLocalMetadata:()=>[Promise.resolve({bundle:row.metadataBundle})],
  $:id=>{if(!elements.has(id))elements.set(id,{textContent:'',remove(){}});return elements.get(id);}
 };
 vm.createContext(sandbox);
 vm.runInContext(ui+'\nglobalThis.localImportProgress=()=>{};globalThis.localRowMessage=()=>{};globalThis.renderLocalRows=()=>{};globalThis.__commitLocalRows=commitLocalRows;',sandbox);
 sandbox.localRowMessage=(_job,_row,message)=>messages.push(message);
 await sandbox.__commitLocalRows({closed:false,committing:false,ignoreAll:false,liveMetadata:true,rows:[row],type:'movie'},()=>{});
 assert.equal(row.metadataApplied,undefined);
 assert.equal(row.metadataPendingAfterImport,false);
 assert.ok(messages.some(message=>message.includes('已忽略元数据选择')));
 assert.ok(toasts.some(message=>message.includes('忽略 1 项')));
 assert.equal(sandbox.state.items[0].description,undefined);
});

test('local import writes fields returned by the selected candidate detail resolver',async()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../app/local-import-ui.js'),'utf8'),saved=[],elements=new Map();
 const candidate={id:'fixture-1',name:'匹配作品',metadataSource:'Fixture'};
 const row={id:'local-row',name:'本地作品',type:'movie',selected:true,action:'new',localPath:'C:\\Movies\\Detail',localFiles:[{path:'C:\\Movies\\Detail\\movie.mp4',name:'movie.mp4'}],metadataBundle:{integrated:[candidate],sources:[]}};
 const state={items:[],categories:[]},LocalModel={members:item=>item.localFiles||[],pathKey:value=>String(value||'').toLowerCase(),same:()=>false,mergeFiles:(_,files)=>files,fillMissing:(current,incoming)=>{const next={...current};for(const [key,value]of Object.entries(incoming))if(next[key]==null||next[key]===''||Array.isArray(next[key])&&!next[key].length)next[key]=value;return next;},automaticCandidate:(_name,_type,bundle)=>bundle.integrated[0]||null};
 const sandbox={state,settings:{disguiseEnabled:false},structuredClone,crypto,LocalModel,StatusModel:{normalize:()=>''},ResourceIdentity:{key:()=>''},LibraryRelations:{},showToast:()=>{},renderLibrary:()=>{},renderLocalRows:()=>{},localRowMessage:()=>{},localImportProgress:()=>{},finishPendingImportedMetadata:async()=>{},prefetchLocalMetadata:()=>[Promise.resolve({bundle:row.metadataBundle})],native:{saveLibrary:async value=>{saved.push(structuredClone(value));return value;},resolveLocalMetadataCandidate:async(_id,value)=>({...value,description:'详情页简介',genres:['剧情'],publisher:'测试发行方'}),prepareLocalCandidate:async value=>value},$:id=>{if(!elements.has(id))elements.set(id,{textContent:'',remove(){}});return elements.get(id);}};
 vm.createContext(sandbox);vm.runInContext(ui+'\nglobalThis.localImportProgress=()=>{};globalThis.localRowMessage=()=>{};globalThis.renderLocalRows=()=>{};globalThis.__commitLocalRows=commitLocalRows;',sandbox);
 await sandbox.__commitLocalRows({closed:false,committing:false,ignoreAll:false,liveMetadata:true,rows:[row],type:'movie'},()=>{});
 assert.equal(sandbox.state.items[0].description,'详情页简介');assert.deepEqual(Array.from(sandbox.state.items[0].genres),['剧情']);assert.equal(sandbox.state.items[0].publisher,'测试发行方');assert.equal(row.metadataApplied,true);
});

test('candidate resolution still propagates explicit cancellation',async()=>{
 const seed={id:'1001',name:'FINAL FANTASY VII'};
 await assert.rejects(()=>SteamCandidateResolution.resolveOrKeep(seed,async()=>{throw Object.assign(new Error('cancelled'),{name:'AbortError'});}),{name:'AbortError'});
});

test('import commit can wait for an in-flight metadata search result',async()=>{
 const row={id:'one',name:'最终幻想7',type:'game',selected:true};let completed=false;
 const queue=ImportQueue.create({rows:()=>[row],eligible:value=>value.selected,query:async()=>{
  await new Promise(resolve=>setTimeout(resolve,25));return {integrated:[{id:'1001',name:'FINAL FANTASY VII'}],sources:[]};
 },apply:(value,bundle)=>{value.metadataBundle=bundle;completed=true;}});
 void queue.resume();await queue.whenIdle();
 assert.equal(completed,true);
 assert.equal(row.metadataBundle.integrated[0].id,'1001');
});

test('import saves local entries without waiting for slow sources and keeps candidate fallback',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../app/local-import-ui.js'),'utf8');
 const commit=ui.slice(ui.indexOf('async function commitLocalRows'),ui.indexOf('async function applyLocalMetadata'));
 assert.ok(commit.indexOf('await saveLocalLibrary(next)')<commit.indexOf('const pending=prefetchLocalMetadata(job,rows)'));
 assert.doesNotMatch(commit,/await job\.metadataQueue\?\.whenIdle\?\.\(\)/);
 assert.match(ui,/来源仍在查询，取得结果后继续补全/);
 assert.match(ui,/if\(row\.metadataError\)\{finish\[i\]\(\{error:Error\(row\.metadataError\)\}\);continue;\}/);
 assert.match(ui,/自动刮削未完成，请确认候选/);
 assert.match(ui,/pickImportMetadata\(job,row,bundle\)/);
});
