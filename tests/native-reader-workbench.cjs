module.exports=async({w,js,check,until,root,windows,wait})=>{
 const fs=require('node:fs'),path=require('node:path'),f=await require('../../tests/media-fixtures.cjs')(root),sample=process.env.UM_EPUB_SAMPLE||f.epub;
 const run=c=>js(w,'(async()=>{'+c+'})()');
 await run(`state=await native.saveLibrary({items:[{id:'book',name:'阅读测试',type:'book',localPath:${JSON.stringify(sample)},localFiles:[{path:${JSON.stringify(sample)},name:'book.epub'}]},{id:'text',name:'文本测试',type:'book',localPath:${JSON.stringify(f.txt)},localFiles:[{path:${JSON.stringify(f.txt)},name:'test.txt'}]}],categories:[]});await native.launchReader('book')`);
 await until(()=>windows.some(v=>v!==w&&!v.isDestroyed()));const r=windows.filter(v=>v!==w&&!v.isDestroyed()).at(-1);await until(()=>js(r,'!!mediaSession?.controller'));
 if(process.env.UM_EPUB_SAMPLE){
 check('卷名只显示一次且折叠整合在同一行',await js(r,"(()=>{const group=document.querySelector('.reader-chapter-group');return group&&group.querySelectorAll(':scope>summary').length===1&&![...group.children].some(el=>el.tagName==='BUTTON'&&el.textContent===group.firstChild.textContent)})()"));
 await js(r,"document.querySelector('.reader-chapter-group').open=false");check('折叠隐藏子章节',await js(r,"[...document.querySelector('.reader-chapter-group').children].slice(1).every(el=>!el.getBoundingClientRect().height)"));
 }
 await js(r,"document.querySelector('.reader-color-trigger').click()");
 check('色盘包含饱和度明度平面和图标重置',await js(r,"!!document.querySelector('.reader-color-dialog canvas')&&!!document.querySelector('.reader-color-dialog #readerResetBackground svg')&&!document.querySelector('.reader-color-menu')"));
 await js(r,"window.originalColor=bookAppearance(mediaSession).background;const hex=document.querySelector('.reader-color-dialog [type=text]');hex.value='#224466';hex.dispatchEvent(new Event('change'))");
 check('实际色盘更改底色',await js(r,"readerThemeSettings(mediaSession).color==='#224466'"));
 await js(r,"$('readerResetBackground').click()");check('色盘内部重置恢复当前主题',await js(r,"bookAppearance(mediaSession).background===originalColor"));
 await js(r,"document.querySelector('.reader-color-dialog [aria-label=关闭]').click();addReaderNote(mediaSession)");
 await wait(350);check('笔记弹窗正文有统一内边距且不盖标题栏',await js(r,"(()=>{const body=document.querySelector('.reader-note-dialog .reader-dialog-body'),b=body.getBoundingClientRect(),area=body.querySelector('textarea').getBoundingClientRect();return area.left>=b.left+16&&document.querySelector('.reader-note-dialog').getBoundingClientRect().top>=document.querySelector('.titlebar').getBoundingClientRect().bottom})()"));
 await js(r,"document.querySelector('.reader-note-dialog textarea').value='真正保存的笔记';document.querySelector('.reader-note-dialog .primary-button').click()");await until(()=>js(r,"!document.querySelector('.reader-note-dialog')"));
 check('笔记持久保存而非空按钮',JSON.parse(fs.readFileSync(path.join(root,'reader-progress.json'))).book.bookmarks.some(x=>x.note==='真正保存的笔记'));
 await js(r,"[...document.querySelectorAll('#readerToolbar button')].find(b=>b.textContent==='阅读背景').click()");
 check('背景预览和操作位于同一主题弹窗',await js(r,"!!document.querySelector('#readerBackgroundDialog .reader-background-preview')&&!!document.querySelector('#readerBackgroundDialog .reader-dialog-body input')"));
 await js(r,"$('readerBackgroundDialog').querySelector('[aria-label=关闭]').click()");
 check('全文搜索引擎真实找到内容',await js(r,"(async()=>{const text=await mediaSession.controller.text(),word=text.replace(/\\s/g,'').slice(0,1);return !word||((await mediaSession.controller.search(word,()=>true)).length>0)})()"));
 await js(r,"(async()=>{await mediaSession.controller.jump(.5)})()");await wait(200);check('进度跳转改变阅读位置',await js(r,"mediaSession.controller.currentPage()>1"));
 await js(r,"native.readerWindowCommand('topmost',true)");check('真实窗口置顶',r.isAlwaysOnTop());await js(r,"native.readerWindowCommand('topmost',false)");
 check('库内多标签入口读取真实资源',await js(r,"(async()=>{const list=await native.readerCatalog();return list.length===2&&list.some(x=>x.id==='text')})()"));
 await js(r,"openMedia('text')");await until(()=>js(r,"mediaSession?.data.id==='text'&&!!mediaSession.controller"));check('切换资源保留两个阅读标签',await js(r,"document.querySelectorAll('.reader-tab').length===2"));
 await js(r,"[...document.querySelectorAll('.reader-workbench button')].find(b=>b.textContent==='阅读工具').click()");
 await wait(350);const shot=path.resolve(__dirname,'../docs/screenshots/reader-workbench.png');fs.writeFileSync(shot,(await r.webContents.capturePage()).toPNG());
 await js(r,"document.querySelector('.reader-tool-dialog').remove()");
 const ocr=await js(r,"(async()=>{const c=document.createElement('canvas');c.width=700;c.height=180;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,700,180);x.fillStyle='black';x.font='60px Arial';x.fillText('HELLO READER',30,110);return native.readerOcr(c.toDataURL())})()");check('Windows 本地 OCR 实际识别测试图片',ocr.text.toUpperCase().includes('HELLO'));
 r.destroy();
};
