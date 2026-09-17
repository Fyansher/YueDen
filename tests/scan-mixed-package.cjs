const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),app=require('./app-module.cjs'),{fixture,pe}=require('../../tests/scan-fixtures.cjs');
const scan=(f,type='all',options={})=>app('scan-pipeline').scan([f.root],type,{online:false,...options});
test('已确认游戏包旁有独立软件，不撤销游戏边界，也不让辅助文件变成资源',async()=>{
 const f=await fixture();for(const [name,title]of [['Game.exe','Amber Voyage'],['Game_gl.exe','Amber Voyage'],['Config.exe','Configuration Utility'],['Translator.exe','Independent Translator']])await f.put('Install/'+name,pe(title));
 await f.put('Install/Game_Data/content');await f.put('Install/steam_appid.txt','246810');await f.put('Install/manual.pdf','%PDF-1.5');await f.put('Install/intro.mp4',Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]));
 const rules=[{id:'verified-tool',scope:path.join(f.root,'Install'),productName:'Independent Translator',type:'software',verified:true,source:'fixture verified product'}];
 const r=await scan(f,'all',{rules});assert.equal(r.items.length,2);const game=r.items.find(i=>i.type==='game');assert.ok(game);assert.equal(game.localFiles.length,3);assert.ok(r.items.some(i=>i.type==='software'));
 const games=await scan(f,'game',{rules});assert.equal(games.items.length,1);assert.equal(games.items[0].localFiles.length,3);
 assert.ok(r.skipped.some(i=>i.path.endsWith('manual.pdf')&&i.ownerId===game.id));
});
test('深层独立软件只隔离自身，不拆散父游戏及其已归属启动项',async()=>{
 const f=await fixture();await f.put('Root/Main.exe',pe('Rose Journey'));await f.put('Root/Main_dx12.exe',pe('Rose Journey'));await f.put('Root/Main_Data/content');await f.put('Root/steam_appid.txt','123456');await f.put('Root/extras/vendor/app/Edit.exe',pe('Different Editor'));await f.put('Root/support/settings.exe',pe(''));
 const r=await scan(f);assert.equal(r.items.length,2);const game=r.items.find(i=>i.type==='game');assert.ok(game);assert.equal(game.localFiles.length,3);assert.ok(r.items.some(i=>i.name==='Different Editor'));
});
test('已验证软件即使命名为 config 也不能仅凭工具角色归给游戏',async()=>{
 const f=await fixture();await f.put('Root/Main.exe',pe('Game Work'));await f.put('Root/Main_Data/content');await f.put('Root/config.exe',pe('Independent Configuration Editor'));await f.put('Root/steam_appid.txt','23456');
 const rules=[{id:'confirmed-software',scope:path.join(f.root,'Root'),productName:'Independent Configuration Editor',verified:true,type:'software',source:'verified fixture'}];
 const r=await scan(f,'all',{rules});assert.equal(r.items.length,2);assert.equal(r.items.find(i=>i.type==='game').localFiles.length,1);assert.equal(r.items.find(i=>i.type==='software').localFiles.length,1);
});
test('两个独立的配套游戏并排不能把所有入口都归给第一个',async()=>{
 const f=await fixture();for(const name of ['First','Second']){await f.put('Mixed/'+name+'.exe',pe(name+' Work'));await f.put('Mixed/'+name+'_Data/content');}const r=await scan(f);assert.equal(r.items.length,2);assert.ok(r.items.every(i=>i.localFiles.length===1));
});
test('扫描模式不改变包归属，附属内容按用户选择才列出',async()=>{
 const f=await fixture();await f.put('Mixed/Main.exe',pe('Core Work'));await f.put('Mixed/Main_Data/data');await f.put('Mixed/Editor/Tool.exe',pe('Standalone Editor'));await f.put('Mixed/manual.pdf','%PDF-1.5');
 const a=await scan(f),b=await scan(f,'book');assert.deepEqual(a.candidates.map(i=>[i.name,i.localFiles.map(f=>f.path)]),b.candidates.map(i=>[i.name,i.localFiles.map(f=>f.path)]));assert.equal(b.items.length,0);
 assert.ok((await scan(f,'all',{includeAttachments:true})).candidates.some(i=>i.attachmentOf&&i.localPath.endsWith('manual.pdf')));
});
test('不借助作品名单，PE功能描述等多项正向证据可识别独立软件，缺证据不强判',async()=>{
 const f=await fixture();await f.put('Game.exe',pe('Evening Journey'));await f.put('Game_Data/content');await f.put('steam_appid.txt','93847');await f.put('Tool.exe',pe('Language Helper','Translation application'));await f.put('settings.exe',pe('Settings Utility'));
 const all=await scan(f);assert.equal(all.items.length,2);assert.equal(all.items.find(i=>i.type==='software').name,'Language Helper');assert.equal(all.items.find(i=>i.type==='game').localFiles.length,2);assert.equal((await scan(f,'game')).items.length,1);
 const Types=app('scan-classification');assert.equal(Types.classify({kind:'application',metadata:{validPe:true,productName:'Mystery',fileDescription:'Translation application'}}).type,'unknown_application');
});
test('同名数据和配置的旧式包混有独立软件，不依赖引擎目录或具体游戏名',async()=>{
 const f=await fixture();await f.put('Root/r71.exe',pe(''));await f.put('Root/r71.dat','payload');await f.put('Root/r71.cfg','config');await f.put('Root/custom.exe',pe(''));await f.put('Root/replayview.exe',pe(''));await f.put('Root/Editor.exe',pe('Text Suite','Text editor'));
 const r=await scan(f);assert.equal(r.items.length,2);assert.equal(r.items.find(i=>i.type==='unknown_application').localFiles.length,3);assert.equal(r.items.find(i=>i.type==='software').localFiles.length,1);
});
test('同一辅助目录混有软件和游戏配置器，也只隔离软件文件',async()=>{
 const f=await fixture();await f.put('Root/Main.exe',pe('Clear Sky'));await f.put('Root/Main_Data/content');await f.put('Root/steam_appid.txt','145678');await f.put('Root/tools/settings.exe',pe(''));await f.put('Root/tools/config.exe',pe('Standalone Translator','Translation application'));
 const r=await scan(f);assert.equal(r.items.length,2);assert.equal(r.items.find(i=>i.type==='game').localFiles.length,2);assert.equal(r.items.find(i=>i.type==='software').localFiles.length,1);
});
