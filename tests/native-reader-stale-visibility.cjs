module.exports=async({w,js,check,until,root,windows,wait})=>{
 const f=await require('../../tests/media-fixtures.cjs')(root);
 for(const [type,file]of [['manga',f.comic],['book',f.pdf]]){
 await js(w,`(async()=>{state=await native.saveLibrary({items:[{id:'stale-${type}',type:'${type}',name:'过期可见回调测试',localPath:${JSON.stringify(file)},localFiles:[{path:${JSON.stringify(file)},name:'fixture'}]}],categories:[]});await native.launchReader('stale-${type}')})()`);await until(()=>windows.some(r=>r!==w&&!r.isDestroyed()));const r=windows.filter(r=>r!==w&&!r.isDestroyed()).at(-1);await until(()=>js(r,'!!mediaSession?.controller'));
 await js(r,"window.oldVisibility=[];window.RealIntersectionObserver=IntersectionObserver;window.IntersectionObserver=class extends RealIntersectionObserver{constructor(cb,options){super(cb,options);if(options?.root?.id==='readerViewport')oldVisibility.push(cb);}};mediaSession.options.flow='scroll';mediaSession.options.comicMode='scroll';mediaSession.controller.resize();void 0");await wait(300);
 await js(r,"window.oldTarget=document.querySelector('#readerViewport').firstElementChild;window.staleCallback=oldVisibility.at(-1);mediaSession.controller.jump(1);void 0");await wait(400);const expected=await js(r,'mediaSession.controller.currentPage()');check(type+' 已在末页',await js(r,'mediaSession.controller.currentPage()===mediaSession.controller.pageCount'));
 await js(r,"staleCallback([{isIntersecting:true,intersectionRatio:1,target:oldTarget}]);void 0");await wait(100);check(type+' 过期可见回调不能改回第一页',await js(r,`mediaSession.controller.currentPage()===${expected}`));
 }
};
