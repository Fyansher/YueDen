module.exports=async({w,js,check,until,root,windows,wait})=>{
 const fs=require('node:fs'),path=require('node:path'),JSZip=require('../../player-deps/node_modules/jszip'),f=await require('../../tests/media-fixtures.cjs')(root),zip=new JSZip();for(let i=0;i<40;i++)zip.file(i+'.png',f.png);fs.writeFileSync(f.comic,await zip.generateAsync({type:'nodebuffer'}));
 await js(w,`(async()=>{state=await native.saveLibrary({items:[{id:'comicseek',type:'manga',name:'漫画拖动测试',localPath:${JSON.stringify(f.comic)},localFiles:[{path:${JSON.stringify(f.comic)},name:'sample.cbz'}]}],categories:[]});await native.launchReader('comicseek')})()`);await until(()=>windows.length>1);const r=windows.at(-1);await until(()=>js(r,'mediaSession?.controller?.pageCount===40'));
 for(const flow of ['single','double','scroll']){
  await js(r,`mediaSession.options.comicMode='${flow}';mediaSession.controller.resize();void 0`);await wait(200);
  for(const ratio of [.85,.25]){const b=await js(r,"document.querySelector('.reader-progress').getBoundingClientRect().toJSON()"),x=t=>Math.round(b.left+b.width*t),y=Math.round(b.top+b.height/2);
   r.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:x(.02),y});for(let i=1;i<=12;i++){r.webContents.sendInputEvent({type:'mouseMove',button:'left',x:x(.02+(ratio-.02)*i/12),y:y-100});await wait(20);}r.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x(ratio),y:y-100});await wait(1300);
   const actual=await js(r,'mediaSession.controller.currentPage()');check(flow+' 漫画到指定页 '+actual,actual===1+Math.round(ratio*39));check('松手后解除拖动层',await js(r,"!document.querySelector('.reader-progress-drag-shield')"));
  }
 }
 await js(r,"mediaSession.options.comicMode='single';mediaSession.controller.resize();document.querySelector('.reader-progress').focus();void 0");r.webContents.sendInputEvent({type:'keyDown',keyCode:'END'});r.webContents.sendInputEvent({type:'keyUp',keyCode:'END'});await wait(300);check('键盘End可以到末页',await js(r,'mediaSession.controller.currentPage()===40'));
 fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/reader-seek-2.25.27.png'),(await r.webContents.capturePage()).toPNG());
};
