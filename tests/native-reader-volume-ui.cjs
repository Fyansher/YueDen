module.exports=async({w,js,check,until,root,windows,wait})=>{
 const fs=require('node:fs'),path=require('node:path'),f=await require('../../tests/media-fixtures.cjs')(root);const second=path.join(root,'第二卷.cbz');fs.copyFileSync(f.comic,second);
 await js(w,`(async()=>{state=await native.saveLibrary({items:[{id:'vol',type:'manga',name:'卷导航',localPath:${JSON.stringify(f.comic)},localFiles:[{path:${JSON.stringify(f.comic)},name:'第一卷'},{path:${JSON.stringify(second)},name:'第二卷'}]}],categories:[]});await native.launchReader('vol')})()`);await until(()=>windows.length>1);const r=windows.at(-1);await until(()=>js(r,'!!mediaSession?.controller'));
 check('顶部不重复显示页码输入',await js(r,"!$('comicPage').getBoundingClientRect().height"));check('图片按原始压缩卷分组而非每页一卷',await js(r,"document.querySelectorAll('.reader-volume').length===2"));
 check('漫画卷默认折叠且未加载缩略图',await js(r,"[...document.querySelectorAll('.reader-volume')].every(g=>!g.open)&&!document.querySelector('.reader-volume img')"));
 await js(r,"document.querySelector('.reader-volume').open=true");await until(()=>js(r,"document.querySelector('.reader-volume img')?.naturalWidth>0"));
 check('缩略图在对应卷内并显示小页码',await js(r,"(()=>{const b=document.querySelector('.reader-volume .reader-thumbnails button');return b.querySelector('span').textContent==='1'&&getComputedStyle(b.querySelector('span')).position==='absolute'&&parseFloat(getComputedStyle(b.querySelector('span')).fontSize)<=11})()"));
 await js(r,"document.querySelectorAll('.reader-volume .reader-thumbnails button')[1].click()");check('缩略图点击实际跳页',await js(r,'mediaSession.controller.currentPage()===2'));
 await js(r,"const p=document.querySelector('.reader-progress');p.value=600;p.dispatchEvent(new Event('input'))");await wait(300);check('进度拖动不等松手立即跳页',await js(r,'mediaSession.controller.currentPage()===4'));
 await js(w,"state.items.forEach(i=>i.playtime=2);renderUsageChart()");check('使用时长图为圆环而非实心饼图',await js(w,"(()=>{const s=getComputedStyle(document.querySelector('.usage-pie'),'::after');return s.content!=='none'&&parseFloat(s.left)>0&&s.borderRadius==='50%'})()"));
 fs.writeFileSync(path.resolve(__dirname,'../docs/screenshots/reader-volume-navigation.png'),(await r.webContents.capturePage()).toPNG());
};
