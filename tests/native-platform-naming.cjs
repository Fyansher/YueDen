module.exports=async({w,js,check,until,root})=>{
 const fs=require('node:fs'),path=require('node:path'),{pe}=require('../../tests/scan-fixtures.cjs');
 const run=c=>js(w,'(async()=>{'+c+'})()');
 await run("activeView='game';settings.scanOnline=false;render();await openLocalImport('game');");
 const platform=await run("return await native.previewLocal(['D:/Game/Epic Games'],'game',{online:false})");
 check('实际平台目录通过生产IPC扫描为0游戏候选',platform.items.length===0);
 const games=await run("return await native.previewLocal(['D:/Game/Epic'],'game',{online:false})");
 check('实际Epic游戏目录通过生产IPC仍保留5个游戏',games.items.length===5);
 const folder=path.join(root,'标题核对');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'Run.exe'),pe('appid_646570'));
 const offline=await run(`return await native.previewLocal([${JSON.stringify(folder)}],'game',{online:false})`);
 check('离线扫描不把AppID占位作为标题',offline.items[0].name==='标题核对');
 const result=await run(`return await native.previewLocal([${JSON.stringify(folder)}],'game',{online:true})`);
 fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/native-platform-public-query.json'),JSON.stringify({id:'646570',name:result.items[0]?.name,resolved:Boolean(result.items[0]?.resolvedMetadata),warnings:result.items[0]?.warnings},null,2));
 check('真实联网扫描按646570查询并取得非占位游戏名称',result.items[0]?.resolvedMetadata?.steamAppId==='646570'&&result.items[0].name!=='标题核对'&&!/^appid/i.test(result.items[0].name));
 await run('closeLocalImport()');
};
