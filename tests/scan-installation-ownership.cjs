const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const app=require('./app-module.cjs'),{fixture,pe}=require('../../tests/scan-fixtures.cjs');
const scan=(f,options={},filter='all')=>app('scan-pipeline').scan([f.root],filter,{online:false,...options});
test('混合目录按产品分组：相同产品多个 EXE 不因旁边另有产品而拆散',async()=>{
 const f=await fixture();for(const [file,title]of [['A.exe','Orchard Voyage'],['A_dx12.exe','Orchard Voyage'],['B.exe','Silver Meadow']])await f.put('Mixed/'+file,pe(title));
 const r=await scan(f);assert.equal(r.items.length,2);assert.equal(r.items.find(i=>i.name==='Orchard Voyage').localFiles.length,2);assert.equal(r.items.find(i=>i.name==='Silver Meadow').localFiles.length,1);
});
test('未知应用亦可归组，嵌套任意目录中的同产品入口与上层主体关联',async()=>{
 const f=await fixture();for(const file of ['Run.exe','vendor/account/Start.exe','alternate/Render.exe'])await f.put('Install/'+file,pe('Violet Passage'));
 const r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].localFiles.length,3);assert.equal(r.items[0].classification.type,'unknown_application');
 assert.ok(r.items[0].scanInfo.installation?.id);assert.equal(r.items[0].scanInfo.entries.length,3);
});
test('普通旧式资源包不要求指定 DAT/CFG 配对，有效主体和辅助入口共享配套内容',async()=>{
 const f=await fixture();await f.put('Old/Play.exe',pe(''));await f.put('Old/settings.exe',pe(''));await f.put('Old/replayviewer.exe',pe(''));await f.put('Old/shared.dll');await f.put('Old/resources.pak');
 const r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].localFiles.length,3);assert.match(r.items[0].localPath,/Play.exe$/);
});
test('明确包中嵌套辅助入口不另建卡片，无公司或完整产品名仍继承包身份',async()=>{
 const f=await fixture();await f.put('Install/Main.exe',pe('Azure Orchard'));await f.put('Install/Main_Data/payload');await f.put('Install/steam_appid.txt','24680');await f.put('Install/support/settings.exe',pe(''));await f.put('Install/auth/vendor/login.exe',pe(''));
 const r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].localFiles.length,3);assert.equal(r.items[0].reviewRequired,false);
});
test('同名同产品的并列安装保持独立，嵌套不同产品与出版物也不吞并',async()=>{
 const f=await fixture();await f.put('Library/CopyA/Start.exe',pe('Same Title'));await f.put('Library/CopyB/Start.exe',pe('Same Title'));await f.put('Library/CopyA/Editor/Editor.exe',pe('Independent Editor'));await f.put('Library/CopyA/Novel.txt','text');
 const r=await scan(f);assert.equal(r.items.filter(i=>i.classification.type==='unknown_application').length,3);assert.equal(r.items.filter(i=>i.name==='Same Title').length,2);
});
test('泛用引擎产品名、仅相同目录名、未知无证据入口不得自动吞并',async()=>{
 const f=await fixture();await f.put('Mixed/One.exe',pe('Electron'));await f.put('Mixed/Two.exe',pe('Electron'));await f.put('Unknown/a.exe',pe(''));await f.put('Unknown/b.exe',pe(''));
 const r=await scan(f);assert.equal(r.items.length,4);assert.ok(r.items.every(i=>i.reviewRequired));
});
test('同产品不同公司与不同版本不得通过中间启动器传递误合并',()=>{
 const make=(file,company,version)=>({id:file,type:'unknown_application',localPath:file,localFiles:[{path:file}],metadata:{validPe:true,productName:'Shared Title',companyName:company,productVersion:version},boundary:{kind:'individual_application',root:file,ownedPaths:[file]},warnings:[],evidence:[],scanInfo:{userOverrides:{}}});
 const rows=[make('D:/Install/A.exe','Studio One','1.0'),make('D:/Install/Launcher.exe','',''),make('D:/Install/B.exe','Studio Two','2.0')];
 const r=app('scan-application-entries').mergeEntries(rows);assert.equal(r.length,3);
 const versions=[make('D:/Install/A.exe','Studio','1.0'),make('D:/Install/B.exe','Studio','2.0')];assert.equal(app('scan-application-entries').mergeEntries(versions).length,2);
});
test('多个扫描根和输入顺序不能产生同路径重复入口',async()=>{
 const f=await fixture();await f.put('Install/Run.exe',pe('Autumn Radio'));await f.put('Install/deep/vendor/Run.exe',pe('Autumn Radio'));
 const roots=[path.join(f.root,'Install/deep'),path.join(f.root,'Install')];const a=await app('scan-pipeline').scan(roots,'game'),b=await app('scan-pipeline').scan([...roots].reverse(),'game');
 assert.equal(a.items.length,1);assert.equal(a.items[0].localFiles.length,2);assert.equal(a.items[0].id,b.items[0].id);assert.equal(new Set(a.items.flatMap(i=>i.localFiles.map(f=>f.path))).size,2);
});
test('人工拆分应用后扫描不能重新吞并，名字、入口与分组决定保留',async()=>{
 const f=await fixture();await f.put('Install/Main.exe',pe('Manual Choice'));await f.put('Install/Alternative.exe',pe('Manual Choice'));const first=(await scan(f)).items[0];
 const lib=app('library-relations').split({items:[{...first,type:'game',rating:4,noteUrl:'obsidian://local'}]},first.id,[first.localFiles[1].path]);lib.items[1].name='我的独立入口';
 const r=await scan(f,{existingItems:lib.items});assert.equal(r.items.length,2);assert.ok(r.items.some(i=>i.name==='我的独立入口'));assert.ok(r.items.every(i=>i.localFiles.length===1));
});
test('只有既有另一个入口时，用同安装产品证据补充来源，不凭同名跨安装合并',()=>{
 const root='D:/Install',metadata={validPe:true,productName:'Verified Local Product',companyName:'Studio'};
 const make=file=>({type:'game',name:'Same Name',localPath:file,localFiles:[{path:file}],scanInfo:{metadata,installation:{root,productKey:'verifiedlocalproduct',companyKey:'studio',confidence:.94}}});
 const a=make(root+'/A.exe'),b=make(root+'/B.exe');assert.equal(app('resource-identity').compare(a,b).status,'match');
 const c=make('D:/Other/B.exe');c.scanInfo.installation.root='D:/Other';assert.notEqual(app('resource-identity').compare(a,c).status,'match');
});
test('不依赖特定名字：多种层级、图形后端入口与工具角色变体均稳定归属',async()=>{
 const f=await fixture();for(let n=0;n<16;n++){const title='Generated Product '+n,base='Library/Product'+n;await f.put(base+'/Run.exe',pe(title));await f.put(base+'/renderer'+n+'/backend'+n+'/Variant.exe',pe(title));await f.put(base+'/Other'+n+'.exe',pe('Independent '+n));}
 const r=await scan(f);assert.equal(r.items.length,32);for(let n=0;n<16;n++){assert.equal(r.items.find(i=>i.name==='Generated Product '+n).localFiles.length,2);assert.equal(r.items.find(i=>i.name==='Independent '+n).localFiles.length,1);}
});
test('版本资源包作为嵌套安装时有独立边界，不被上层相同产品吞并',async()=>{
 const f=await fixture();for(const dir of ['Install','Install/Legacy']){await f.put(dir+'/Run.exe',pe('Nested Editions'));await f.put(dir+'/Run_Data/data');}
 const r=await scan(f);assert.equal(r.items.length,2);assert.ok(r.items.every(i=>i.localFiles.length===1));
});
test('保持独立的人工决定不只依赖手动拆分入口，普通整理决定也应保留',async()=>{
 const f=await fixture();const a=await f.put('Install/A.exe',pe('Preserve Decisions')),b=await f.put('Install/B.exe',pe('Preserve Decisions'));
 const old=[{id:'a',type:'game',name:'A',localPath:a,localFiles:[{path:a}]},{id:'b',type:'game',name:'B',localPath:b,localFiles:[{path:b}]}];const lib=app('library-relations').decide({items:old},'a','b','separate');
 const r=await scan(f,{existingItems:lib.items});assert.equal(r.items.length,2);assert.ok(r.items.every(i=>i.localFiles.length===1));
});
test('相同厂商不同产品的辅助工具名不成为合并桥，主入口不选卸载器',()=>{
 const role=app('application-identity').role;for(const s of ['AlphaRepair.exe','ABCConfig.exe','UnityCrashHandler64.exe','VendorLoginComServer.exe','uninst.exe','ReplayViewer.exe'])assert.equal(role(s),'tool',s);
 assert.equal(role('EOSBootstrapper.exe'),'launcher');assert.equal(role('Crash Bandicoot.exe'),'primary');assert.equal(app('scan-boundaries').auxiliary({file:'Crash Bandicoot.exe'}),false);
});
test('嵌套深处发现独立产品时边界冲突向上回传，不能被父资源包吞掉',async()=>{
 const f=await fixture();await f.put('Install/Run.exe',pe('Outer Product'));await f.put('Install/Run_Data/data');await f.put('Install/extras/vendor/program/Tool.exe',pe('Independent Deep Product'));
 const r=await scan(f);assert.equal(r.items.length,2);assert.ok(r.items.some(i=>i.name==='Independent Deep Product'));
});
test('人工分组后新增入口仍独立待处理，剩余组不能指向已分配给其他组的入口',()=>{
 const G=app('scan-manual-groups'),row={id:'auto',name:'Auto',type:'game',localPath:'D:/x/A.exe',localFiles:[{path:'D:/x/A.exe'},{path:'D:/x/B.exe'}],scanInfo:{identity:'auto',automatic:{name:'Auto',type:'game',localPath:'D:/x/A.exe'}}};
 const owner={id:'auto',name:'Manual',type:'game',localPath:'D:/x/A.exe',localFiles:[{path:'D:/x/A.exe'}],scanGrouping:{manual:true,paths:['D:/x/A.exe']},identityKey:'manual:auto'};
 const r=G.partition([row],[owner]);assert.equal(r.length,2);assert.equal(new Set(r.map(i=>i.id)).size,2);assert.ok(r.every(i=>i.localFiles.some(f=>f.path===i.localPath)));
});
test('归组先于联网，同资源多入口只查询一次，联网确认不会重新拆开入口',async()=>{
 const f=await fixture();for(const file of ['Run.exe','vendor/account/Play.exe'])await f.put('Install/'+file,pe('Network Fixture Product'));
 const queries=[];const r=await scan(f,{online:true,identitySearch:async q=>{queries.push(q.name);assert.deepEqual(Object.keys(q).sort(),['name','signal','type']);return {sources:[{id:'steam',items:[{name:'Network Fixture Product',steamAppId:'987654',metadataSource:'模拟测试源'}]}]};}});
 assert.equal(queries.length,1);assert.equal(r.items.length,1);assert.equal(r.items[0].localFiles.length,2);assert.equal(r.items[0].classification.type,'game');assert.equal(r.items[0].reviewRequired,false);
});
