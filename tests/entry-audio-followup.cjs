const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),appModule=require('./app-module.cjs'),{fixture,pe}=require('../../tests/scan-fixtures.cjs');
test('随机产品编号的主程序与配置录像工具依配套数据归组，不靠游戏名',async()=>{
 const f=await fixture();for(const name of ['product47','custom','replayview'])await f.put(name+'.exe',pe(''));await f.put('product47.dat');await f.put('product47.cfg');
 const r=await appModule('scan-pipeline').scan([f.root],'game',{online:false});assert.equal(r.items.length,1);assert.equal(r.items[0].localFiles.length,3);assert.match(r.items[0].localPath,/product47.exe$/);
 await f.put('Independent.exe',pe('Unrelated Product'));const mixed=await appModule('scan-pipeline').scan([f.root],'game',{online:false});assert.ok(mixed.items.length>1);
});
test('嵌套登录入口归属有控制器和修复器的安装，不以登录目录冒充产品名',async()=>{
 const f=await fixture();await f.put('Root/ExampleBoot.exe',pe('Generic Launcher'));await f.put('Root/ExampleRepair.exe',pe('Generic Launcher'));await f.put('Root/local.xml','<version/>');
 await f.put('Root/game/Example.exe',pe('An Actual Product'));await f.put('Root/vendor/login/Launcher.exe',pe(''));
 const r=await appModule('scan-pipeline').scan([path.join(f.root,'Root')],'game',{online:false});assert.equal(r.items.length,1);assert.equal(r.items[0].name,'An Actual Product');assert.equal(r.items[0].localFiles.length,4);
});
test('歌词查询严格使用音轨名，不用专辑名，来源歧义不盲选',async()=>{
 const calls=[];const lyrics=appModule('audio-lyrics-providers').create({music:{lyrics:async()=>({kind:'none',text:''})},json:async url=>{calls.push(url);if(url.includes('/search/'))return {result:{songs:[{id:1,name:'Track title',artists:[{name:'Artist'}],duration:100000}]}};return {lrc:{lyric:'[00:01]test'}};}});
 const r=await lyrics({name:'Album not song',audio:{kind:'music',artists:['Artist']}},{title:'Track title',durationSeconds:100},undefined,'netease');
 assert.equal(r.source,'网易云音乐');assert.ok(decodeURIComponent(calls[0]).includes('Track title'));assert.ok(!decodeURIComponent(calls[0]).includes('Album not song'));
 assert.equal((await lyrics({name:'Album',audio:{kind:'music'}},{title:''})).kind,'none');
});
test('电台类型及其独立播放上下文在持久化模型保留',()=>{
 const model=appModule('audio-model'),context=appModule('audio-context');assert.equal(model.normalize({kind:'radio'}).kind,'radio');
 const s=context.switchTo(context.normalize({activeContext:'music',queue:[]}), 'radio');assert.equal(context.normalize(s).activeContext,'radio');
});
