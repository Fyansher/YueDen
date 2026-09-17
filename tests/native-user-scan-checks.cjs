// User-authorized read-only scan through the actual game-page workflow.
module.exports=async({w,js,check,wait,root,appDir})=>{
 const fs=require('node:fs'),path=require('node:path');
 await js(w,"(async()=>{activeView='game';settings.scanOnline=false;settings.localResourceRoots={...settings.localResourceRoots,game:['D:/Game']};render();await openLocalImport('game');$('localScan').click()})()");
 let ready=false;for(let i=0;i<600;i++){if(await js(w,'!localImportSession.busy&&!!localImportSession.scanResult')){ready=true;break;}await wait(100);}check('游戏页D盘真实目录扫描完成',ready);
 const result=await js(w,"(()=>{const rows=localImportSession.rows;return {count:rows.length,unknown:rows.filter(r=>r.classification.type==='unknown_application').length,paths:rows.flatMap(r=>r.localFiles.map(f=>f.path)),status:$('localScanStatus').textContent}})()");
 const slash=p=>p.replace(/\\/g,'/').toLowerCase();
 const excluded=['/akplatform/','/citra/','/dangotranslator/','/dalamud 中文版卫月框架/','/狩技mod盒子2.3.2/','/hunterpie/','/stardrop/','/smapi 4.1.10 installer/','reshade_setup','mhwshopeditor.exe','mhw-meal-editor.exe','astlibratrainer'];
 check('用户确认的非游戏软件及组件没有进入游戏候选',!result.paths.some(p=>excluded.some(s=>slash(p).includes(s))));
 check('用户确认的真实游戏保留正确启动入口',result.paths.some(p=>slash(p)==='d:/game/春へと続く丘/春へと続く丘.exe'));
 check('用途未知程序不冒充已识别游戏并可展开核对',await js(w,"document.querySelector('.local-uncertain')&&!document.querySelector('.local-uncertain').open&&document.querySelector('.local-uncertain .local-type').selectedOptions[0].textContent==='用途待确认'"));
 check('只扫描未导入，隔离资源库仍为空',await js(w,'state.items.length===0'));
 fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/user-scan-game.png'),(await w.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/native-user-scan-result.json'),JSON.stringify({at:new Date().toISOString(),...result},null,2));
};
