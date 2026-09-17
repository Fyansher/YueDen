module.exports=async({w,js,check,until,root,appDir})=>{
 const fs=require('node:fs'),path=require('node:path'),{pe}=require('../../tests/scan-fixtures.cjs');
 const run=c=>js(w,'(async()=>{'+c+'})()'),parent=path.join(root,'collection'),folder=path.join(parent,'RootTitle');fs.mkdirSync(folder,{recursive:true});
 for(const n of ['wb.exe','custom.exe','replayview.exe'])fs.writeFileSync(path.join(folder,n),pe(n.replace('.exe','')));
 await run(`activeView='game';settings.scanOnline=false;settings.localResourceRoots={game:[${JSON.stringify(parent)}]};render();await openLocalImport('game');$('localScan').click()`);
 await until(()=>js(w,'!localImportSession.busy&&localImportSession.rows.length>0'));
 check('生产扫描入口：一子目录一项、三入口归属、短名回退',await js(w,"localImportSession.rows.length===1&&localImportSession.rows[0].name==='Root Title'&&localImportSession.rows[0].localFiles.length===3&&localImportSession.rows[0].localPath.endsWith('wb.exe')"));
 check('普通目录项默认可导入，不需要判别软件类型',await js(w,'localImportSession.rows[0].selected'));
 await run("$('localCommit').click()");await until(()=>js(w,'!localImportSession.busy&&localImportSession.rows[0].imported'));
 check('实际保存三入口仅一条资源',await js(w,'state.items.length===1&&state.items[0].localFiles.length===3'));
 await run("closeLocalImport();state.items[0].name='人工名称';state.items[0].rating=4.5;state=await native.saveLibrary(state);await openLocalImport('game');$('localScan').click()");await until(()=>js(w,'!localImportSession.busy&&localImportSession.rows.length>0'));
 check('重扫保留人工名称及身份',await js(w,"localImportSession.rows.length===1&&localImportSession.rows[0].name==='人工名称'"));
 await run("$('localCommit').click()");await until(()=>js(w,'!localImportSession.busy'));
 await run('closeLocalImport();state=await native.loadLibrary();render()');check('重扫导入与重新加载不重复、不丢评分',await js(w,'state.items.length===1&&state.items[0].rating===4.5'));
 const epic=await run("return await native.previewLocal(['D:/Game/Epic'],'game',{online:false})");check('真实Epic目录五项且每项对应一个直接子目录',epic.items.length===5&&new Set(epic.items.map(i=>i.boundary.root)).size===5);check('真实Epic没有wb/appid标题',epic.items.every(i=>!/^wb$|^appid/i.test(i.name)));
 const steamParent=path.join(root,'steam-collection'),game=path.join(steamParent,'IdentityFallback');fs.mkdirSync(game,{recursive:true});fs.writeFileSync(path.join(game,'Run.exe'),pe('appid_646570'));fs.writeFileSync(path.join(game,'steam_appid.txt'),'646570');
 await run(`settings.scanOnline=true;settings.localResourceRoots.game=[${JSON.stringify(steamParent)}];await openLocalImport('game');$('localScan').click()`);await until(()=>js(w,'localImportSession.rows.length>0'));check('联网尚未结束，扫描卡片已在真实界面显示',await js(w,'localImportSession.busy&&!!document.querySelector("[data-local-row]")'));await until(()=>js(w,'!localImportSession.busy'));const result=await run('const items=localImportSession.rows;closeLocalImport();return {items}');check('真实Steam按AppID联网补全而非占位名称',result.items[0]?.resolvedMetadata?.steamAppId==='646570'&&!/^appid|IdentityFallback/i.test(result.items[0].name));
 await run(`settings.scanOnline=false;settings.localResourceRoots.game=[${JSON.stringify(parent)}];await openLocalImport('game');$('localScan').click()`);await until(()=>js(w,'!localImportSession.busy'));await run("const details=document.querySelector('.local-existing');if(details)details.open=true");fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/scanner-folder-policy.png'),(await w.webContents.capturePage()).toPNG());await run('closeLocalImport()');
};
