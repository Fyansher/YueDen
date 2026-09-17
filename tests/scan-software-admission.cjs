const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),app=require('./app-module.cjs'),{fixture,pe}=require('../../tests/scan-fixtures.cjs');
const scan=(f,type='game',options={})=>app('scan-pipeline').scan([f.root],type,{online:false,...options});
test('修改器借用真实游戏的PE产品名也不成为游戏、不与同名游戏合并',async()=>{
 const f=await fixture();await f.put('Mixed/Lunar Voyage.exe',pe('Lunar Voyage'));await f.put('Mixed/Lunar Voyage_Data/data');await f.put('Mixed/steam_appid.txt','12345');await f.put('Mixed/LunarVoyageTrainer-1.2.exe',pe('Lunar Voyage'));
 const r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].localFiles.length,1);assert.ok(r.candidates.some(i=>i.classification.type==='software'&&i.localPath.includes('Trainer')));
});
test('随机品牌加速器软件包的更新器、内嵌工具不溢出为游戏候选',async()=>{
 const f=await fixture();await f.put('SwiftNet/SwiftNet.exe',pe('SwiftNet 游戏加速器'));await f.put('SwiftNet/Update.exe',pe('SwiftNet 游戏加速器'));await f.put('SwiftNet/runtime.dll','runtime');await f.put('SwiftNet/bin/Odd.exe',pe(''));await f.put('SwiftNet/toolbox/Helper.exe',pe('Auxiliary'));await f.put('SwiftNet/manual.pdf','%PDF-1.5');
 const r=await scan(f);assert.equal(r.items.length,0);assert.ok(r.candidates.filter(i=>i.localPath.endsWith('.exe')).every(i=>i.classification.type==='software'));assert.ok(r.skipped.some(i=>i.reasonCode==='non-game-application'));
});
test('软件包内独立游戏的配套数据边界不被软件归属覆盖',async()=>{
 const f=await fixture();await f.put('CloudText/CloudText.exe',pe('CloudText 翻译器'));await f.put('CloudText/runtime.dll','runtime');await f.put('CloudText/Novel/Novel.exe',pe('Novel'));await f.put('CloudText/Novel/Novel_Data/data');await f.put('CloudText/Novel/steam_appid.txt','94567');
 const r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].name,'Novel');
});
test('三个编辑工具不因服务同一游戏合并，真实未知游戏不因目录混有工具被过滤',async()=>{
 const f=await fixture();await f.put('Mixed/RoseShopEditor.exe',pe('Rose Shop Editor'));await f.put('Mixed/RoseMealEditor.exe',pe('Rose Meal Editor'));await f.put('Mixed/RoseTrainer-v1.0.exe',pe('Rose'));await f.put('Mixed/春の丘/春の丘.exe',pe(''));
 const r=await scan(f);assert.equal(r.items.length,1);assert.ok(r.items[0].localPath.endsWith('春の丘.exe'));assert.equal(r.candidates.filter(i=>i.classification.type==='software').length,3);
});
test('目录、DLL或游戏名含有工具关键词不足以判为软件，用户修正优先',async()=>{
 const f=await fixture();await f.put('Trainer Adventures/Play.exe',pe('Trainer Adventures'));await f.put('Trainer Adventures/editor.dll','lib');const r=await scan(f);assert.equal(r.items.length,1);
 const g=await fixture();const file=await g.put('Tool/Runner.exe',pe('Runner 翻译器'));const old={id:'old',type:'game',name:'手动游戏',localPath:file,localFiles:[{path:file}],scanInfo:{userOverrides:{type:'game',name:'手动游戏'}}};assert.equal((await scan(g,'game',{existingItems:[old]})).items[0].type,'game');
});
test('游戏和全部模式对软件分类一致，游戏名称不靠内部ProductName独断',async()=>{
 const f=await fixture();await f.put('Tool/ExampleTrainer-2.0.exe',pe('Example'));const a=await scan(f),b=await scan(f,'all');assert.equal(a.items.length,0);assert.deepEqual(a.candidates.map(i=>i.classification),b.candidates.map(i=>i.classification));
});
test('已识别的软件不送去游戏联网搜索，不能靠同名Steam结果翻回游戏',async()=>{
 const f=await fixture();await f.put('SampleTrainer-v2.exe',pe('Sample'));let calls=0;const r=await scan(f,'game',{online:true,identitySearch:async()=>{calls++;return [{name:'Sample',steamAppId:'12345'}];}});assert.equal(calls,0);assert.equal(r.items.length,0);
});
test('维护程序依有效入口与清单数据识别，不因文件名单独排除',async()=>{
 const f=await fixture();await f.put('Package/maintenancetool.exe',pe(''));await f.put('Package/components.xml','<Packages/>');await f.put('Package/maintenancetool.dat','data');await f.put('Package/maintenancetool.ini','[Maintenance]');assert.equal((await scan(f)).items.length,0);
 const g=await fixture();await g.put('maintenancetool.exe',pe(''));assert.equal((await scan(g)).items.length,1);
});
test('已核对软件目录内真实未知游戏的独立边界仍可人工确认',async()=>{
 const f=await fixture();await f.put('Translated/Translated.exe',pe('Translated 翻译器'));await f.put('Translated/runtime.dll','runtime');await f.put('Translated/春の丘/春の丘.exe',pe(''));assert.equal((await scan(f)).items.length,1);
});
test('脚本游戏通过格式签名及配套结构识别，不对具体游戏名做特例',async()=>{
 const f=await fixture();await f.put('任意标题/任意标题.exe',pe(''));await f.put('任意标题/krmovie.dll','runtime');await f.put('任意标题/savedata/keep','');await f.put('任意标题/data.xp3',Buffer.from([88,80,51,13,10,32,10,26,139,103,1]));
 let r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].classification.type,'game');assert.equal(r.items[0].reviewRequired,false);
 await f.put('任意标题/data.xp3','bad header');r=await scan(f);assert.notEqual(r.items[0].classification.type,'game');
});
test('软件根目录旁置有独立产品与厂商证据的程序，不能被整包排除',async()=>{
 const f=await fixture();await f.put('NetTool/NetTool.exe',pe('NetTool 加速器'));await f.put('NetTool/runtime.dll','runtime');await f.put('NetTool/Separate Product.exe',pe('Separate Product'));const r=await scan(f);assert.equal(r.items.length,1);assert.equal(r.items[0].name,'Separate Product');
});
