const fs=require('node:fs'),path=require('node:path');
module.exports=async({w,js,check,until,root,windows,wait})=>{
 const f=await require('../../tests/media-fixtures.cjs')(root),results=[];
 for(const [type,file] of [['epub',process.env.UM_EPUB_SAMPLE||f.epub],['txt',f.txt],['pdf',f.pdf],['comic',f.comic]]){
  if(!file)continue;
  const start=Date.now();
  await js(w,`(async()=>{state=await native.saveLibrary({items:[{id:'perf-${type}',type:'${type==='comic'?'manga':'book'}',name:'性能测试',localPath:${JSON.stringify(file)},localFiles:[{path:${JSON.stringify(file)},name:${JSON.stringify(path.basename(file))}}]}],categories:[]});await native.launchReader('perf-${type}')})()`);
  await until(()=>windows.some(r=>!r.isDestroyed()&&r!==w));const r=windows.filter(r=>!r.isDestroyed()&&r!==w).at(-1);
  await until(()=>js(r,`mediaSession?.data?.id==='perf-${type}'&&!!mediaSession.controller`));const openMs=Date.now()-start;
  await js(r,"window.perfMutations=0;window.perfObserver=new MutationObserver(ms=>perfMutations+=ms.length);perfObserver.observe(document.querySelector('.reader-progress-percent').parentElement,{childList:true,subtree:true});");
  await until(()=>js(r,'mediaSession.controller.pageCount>0'));const paginationMs=Date.now()-start;
  await wait(500);await js(r,'perfMutations=0');await wait(2000);
  const idle=await js(r,'({mutations:perfMutations})');await js(r,'perfObserver.disconnect();void 0');
  const flip=Date.now();await js(r,'mediaSession.controller.pageTo(2)');await wait(100);
  const observedPage=await js(r,'mediaSession.controller.currentPage()');if(observedPage!==2)fs.writeFileSync(path.resolve(__dirname,'../docs/test-results/reader-performance-debug.json'),JSON.stringify(await js(r,"({file:mediaSession.file,total:mediaSession.controller.pageCount,ratio:mediaSession.controller.ratio(),options:mediaSession.options,host:document.querySelector('#readerViewport').className,fn:String(mediaSession.controller.pageTo),capture:String(mediaSession.controller.capture)})"),null,2));check(type+' 翻页仍可用（实际 '+observedPage+'）',observedPage===2);
  if(process.env.UM_PERF_LABEL!=='before')check(type+' 静置不反复改写进度界面',idle.mutations===0);
  if(type==='txt'&&process.env.UM_PERF_LABEL!=='before'){await js(r,"mediaSession.options.flow='scroll';mediaSession.controller.resize();window.savedArticle=document.querySelector('.text-document');mediaSession.controller.jump(.6)");check('TXT 滚动跳转复用正文 DOM',await js(r,"savedArticle===document.querySelector('.text-document')"));}
  results.push({type,bytes:fs.statSync(file).size,openMs,paginationMs,idle,flipMs:Date.now()-flip});
 }
 fs.writeFileSync(path.resolve(__dirname,'../docs/test-results/reader-performance-'+(process.env.UM_PERF_LABEL==='before'?'before':'after')+'.json'),JSON.stringify({finished:new Date().toISOString(),runtime:process.versions,results},null,2));
};
