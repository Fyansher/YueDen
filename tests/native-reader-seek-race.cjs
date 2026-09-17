module.exports=async({w,js,check,until,root,windows,wait})=>{
 const f=await require('../../tests/media-fixtures.cjs')(root),file=process.env.UM_EPUB_SAMPLE||f.epub;
 await js(w,`(async()=>{state=await native.saveLibrary({items:[{id:'seekrace',type:'book',name:'跳转回归',localPath:${JSON.stringify(file)},localFiles:[{path:${JSON.stringify(file)},name:'sample.epub'}]}],categories:[]});await native.launchReader('seekrace')})()`);
 await until(()=>windows.length>1);const r=windows.at(-1);await until(()=>js(r,'mediaSession?.controller?.pageCount>2'));
 for(const flow of ['page','double','scroll']){
  await js(r,`$('readerFlow').value='${flow}';$('readerFlow').dispatchEvent(new Event('change'));void 0`);await wait(300);await until(()=>js(r,'mediaSession.controller.pageCount>2&&!document.querySelector(".reader-progress").disabled'));
  await js(r,"window.seekTrace=[];for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','input'])document.querySelector('.reader-progress').addEventListener(name,e=>seekTrace.push({name,x:e.clientX,y:e.clientY,value:e.target.value,disabled:e.target.disabled}),true);void 0");for(const ratio of [.83,.41,.96,.55]){
   const b=await js(r,"document.querySelector('.reader-progress').getBoundingClientRect().toJSON()");const y=Math.round(b.top+b.height/2),x=t=>Math.round(b.left+b.width*t);
   r.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:x(.3),y});
   for(let i=1;i<=12;i++){r.webContents.sendInputEvent({type:'mouseMove',button:'left',x:x(.3+(ratio-.3)*i/12),y:y-(i>4?140:0)});await wait(15);}
   r.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x(ratio),y:y-140});await wait(1500);
   const actual=await js(r,'mediaSession.controller.ratio()');if(Math.abs(actual-ratio)>=.035)require('node:fs').writeFileSync(require('node:path').resolve(__dirname,'../docs/test-results/seek-debug.json'),JSON.stringify(await js(r,"({trace:window.seekTrace,progress:document.querySelector('.reader-progress').outerHTML})"),null,2));check(flow+' 快速拖动 '+ratio+' 实际 '+actual,Math.abs(actual-ratio)<.035);
  }
 }
};
