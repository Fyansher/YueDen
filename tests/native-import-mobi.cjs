module.exports=async({w,js,check,until,root,windows,wait})=>{
 const fs=require('node:fs'),path=require('node:path'),{dialog}=require('electron'),run=c=>js(w,'(async()=>{'+c+'})()');
 const exe=path.join(root,'Chosen.exe');fs.writeFileSync(exe,require('../../tests/scan-fixtures.cjs').pe('Chosen'));
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[exe]});
 await run("await openLocalImport('game');await $('localAddFiles').onclick()");
 check('添加文件只进预览，不写库',await js(w,'state.items.length===0&&localImportSession.rows.length===1'));
 check('显式文件不显示更换入口',await js(w,"!$('localImportRows').textContent.includes('更换启动入口')"));
 const folder=path.join(root,'collection','Folder');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'entry.exe'),require('../../tests/scan-fixtures.cjs').pe('Entry'));await run(`window.explicitRows=structuredClone(localImportSession.rows);const scan=await native.previewLocal([${JSON.stringify(path.dirname(folder))}],'game',{online:false});localImportSession.rows=scan.items.map(row=>localPreviewRow(row,localImportSession));renderLocalRows(localImportSession)`);
 check('文件夹候选仍显示更换入口',await js(w,"$('localImportRows').textContent.includes('更换启动入口')"));
 await run("localImportSession.rows=explicitRows;localImportSession.online=false;await $('localCommit').onclick()");
 check('手动导入按钮才写入所选文件',await js(w,'state.items.length===1'));
 await run('closeLocalImport()');
 if(process.env.UM_MOBI_SAMPLE){
  const file=process.env.UM_MOBI_SAMPLE,before=fs.statSync(file);await run(`state=await native.saveLibrary({...state,items:[...state.items,{id:'actual-mobi',name:'实际MOBI验证',type:'book',localPath:${JSON.stringify(file)},localFiles:[{path:${JSON.stringify(file)},name:'实际文件.mobi'}]}]});await native.launchReader('actual-mobi')`);
  await until(()=>windows.some(v=>v!==w&&v.webContents.getURL().endsWith('reader.html')));const reader=windows.find(v=>v!==w&&v.webContents.getURL().endsWith('reader.html'));
  await until(()=>js(reader,"!!mediaSession?.controller||!!document.querySelector('#readerMessage.is-error')"));await wait(500);
  fs.writeFileSync(path.resolve(__dirname,'../test-artifacts/mobi-diagnostic.json'),JSON.stringify(await js(reader,"({message:$('readerMessage')?.textContent,controller:!!mediaSession?.controller,frames:[...document.querySelectorAll('iframe')].map(f=>({type:f.contentDocument?.contentType,textSize:f.contentDocument?.body?.textContent?.length,images:[...f.contentDocument?.querySelectorAll('img')||[]].map(i=>({src:i.getAttribute('src')?.slice(0,20),complete:i.complete,width:i.naturalWidth}))}))})"),null,2));
  check('实际混合MOBI正文图片解码且无源码文本',await js(reader,"[...document.querySelectorAll('iframe')].some(f=>[...f.contentDocument.querySelectorAll('img')].some(i=>i.complete&&i.naturalWidth>0)&&!f.contentDocument.body.textContent.includes('TYPE html'))"));
  await js(reader,"$('readerNext').click()");await wait(500);check('实际漫画可以翻到下一章节',await js(reader,"$('readerPageLabel').textContent.includes('2 / 195')"));
  const scan=await run(`return native.previewLocal([${JSON.stringify(path.dirname(file))}],'manga',{online:false})`);check('实际11卷归并一个漫画条目',scan.items.length===1&&scan.items[0].localFiles.length===11);
  const after=fs.statSync(file);check('实际源文件大小和修改时间不变',before.size===after.size&&before.mtimeMs===after.mtimeMs);
 }
};
