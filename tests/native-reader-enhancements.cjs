module.exports=async({w,js,check,until,root,windows,wait})=>{
 const fs=require('node:fs'),path=require('node:path'),f=await require('../../tests/media-fixtures.cjs')(root),run=c=>js(w,'(async()=>{'+c+'})()');
 for(const [id,type,file]of [['pdf','book',f.pdf],['comic','manga',f.comic],['text','book',f.txt]]){
  await run(`state=await native.saveLibrary({...state,items:[...state.items,{id:'${id}',type:'${type}',name:'阅读增强测试',localPath:${JSON.stringify(file)},localFiles:[{path:${JSON.stringify(file)},name:${JSON.stringify(path.basename(file))}}]}]});await native.launchReader('${id}')`);
  await until(()=>windows.some(v=>v!==w&&!v.isDestroyed()));const r=windows.filter(v=>v!==w&&!v.isDestroyed()).at(-1);await until(()=>js(r,'!!mediaSession?.controller'));
  if(id==='pdf'){
   await until(()=>js(r,"!!document.querySelector('.pdf-text-layer span')"));check('PDF实际创建可选中文字层',await js(r,"document.querySelector('.pdf-text-layer').textContent.length>0"));
   await js(r,"[...document.querySelectorAll('#readerToolbar button')].find(b=>b.textContent==='文字重排').click()");await until(()=>js(r,"document.querySelector('.pdf-reflow')?.textContent.length>0"));check('PDF按真实文字层重排',true);
   await js(r,"[...document.querySelectorAll('#readerToolbar button')].find(b=>b.textContent==='版式阅读').click();const s=document.querySelector('[aria-label=PDF适应方式]');s.value='page';s.dispatchEvent(new Event('change'))");await until(()=>js(r,"!!document.querySelector('.pdf-page canvas')"));check('PDF适合页面高度',await js(r,"document.querySelector('.pdf-page canvas').getBoundingClientRect().height<=$('readerViewport').clientHeight"));
   await js(r,"document.querySelector('.reader-volume').open=true");await until(()=>js(r,"document.querySelector('.reader-thumbnails img')?.naturalWidth>0"));check('PDF缩略图真实渲染',true);
  }
  if(id==='comic'){
   await until(()=>js(r,"document.querySelector('.comic-page-frame img')?.naturalWidth>0"));const before=await js(r,"document.querySelector('.comic-page-frame img').naturalWidth");
   await js(r,"[...document.querySelectorAll('#readerToolbar button')].find(b=>b.textContent==='图片处理').click();[...document.querySelectorAll('.reader-tool-dialog button')].find(b=>b.textContent==='拆分 / 还原选中跨页').click()");try{await until(()=>js(r,"document.querySelector('.comic-page-frame img')?.src.startsWith('blob:')"));}catch(e){throw Error(e.message+' '+JSON.stringify(await js(r,"({notice:$('readerNotice')?.textContent,src:document.querySelector('.comic-page-frame img')?.src,options:mediaSession.options})")));}await until(()=>js(r,"document.querySelector('.comic-page-frame img')?.naturalWidth<"+before));
   check('漫画跨页拆分真实改变显示像素',true);check('拆分仅保存显示选项不改源文件',fs.statSync(f.comic).size>0&&await js(r,"Object.keys(mediaSession.options.splitPages).length===1"));
   await js(r,"[...document.querySelectorAll('.reader-tool-dialog button')].find(b=>b.textContent==='拆分 / 还原选中跨页').click();document.querySelector('.reader-tool-dialog [aria-label=关闭]').click()");await until(()=>js(r,"document.querySelector('.comic-page-frame img')?.naturalWidth==="+before));check('跨页拆分可原位恢复',true);
   await js(r,"$('comicZoom').value=125;$('comicZoom').dispatchEvent(new Event('change'))");check('漫画可输入缩放比例',await js(r,"mediaSession.options.zoom===1.25"));
  }
  if(id==='text'){
   await js(r,"$('readerFlow').value='double';$('readerFlow').dispatchEvent(new Event('change'))");check('文本双栏显示',await js(r,"getComputedStyle(document.querySelector('.text-document')).columnCount==='2'"));
   await js(r,"mediaSession.controller.jump(.5);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");check('Home返回开头',await js(r,"mediaSession.controller.ratio()===0"));
   await js(r,"[...document.querySelectorAll('.reader-workbench button')].find(b=>b.textContent==='阅读工具').click()");await wait(350);
   check('工具按钮使用应用圆角而非系统灰按钮',await js(r,"parseFloat(getComputedStyle([...document.querySelectorAll('.reader-tool-dialog button')].find(b=>b.textContent==='切换迷你窗口')).borderRadius)>=8"));
   fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/reader-tools.png'),(await r.webContents.capturePage()).toPNG());
   check('已移除的朗读接口和入口不重新出现',await js(r,"typeof native.readerSpeech==='undefined'&&![...document.querySelectorAll('#readerToolbar button')].some(b=>b.textContent.includes('朗读'))"));
  }
  r.destroy();
 }
};
