module.exports=async tools=>{
 await require('./native-folder-policy.cjs')(tools);
 const {w,js,check,root}=tools,run=c=>js(w,'(async()=>{'+c+'})()');
 await run("settings.scanOnline=true;await openLocalImport('game')");
 check('新复选框沿用扫描控件，无附属内容旧入口',await js(w,"!!$('scanLiveMetadata')&&!$('scanAttachments')&&$('scanLiveMetadata').checked"));
 await run("$('scanLiveMetadata').click();await new Promise(r=>setTimeout(r,250));closeLocalImport();await openLocalImport('game')");
 check('边扫描边获取关闭状态可保存并重开恢复',await js(w,"!$('scanLiveMetadata').checked&&!localImportSession.liveMetadata"));
 await run(`const job=localImportSession;job.rows=['a','b','c'].map(id=>localPreviewRow({id,name:id,type:'game',directoryProposal:true,localPath:${JSON.stringify(root)}+'/'+id+'.exe',localFiles:[{name:id+'.exe',path:${JSON.stringify(root)}+'/'+id+'.exe'}],warnings:[]},job));renderLocalRows(job);window.beforeOrder=[...document.querySelectorAll('[data-local-row]')].map(e=>e.dataset.localRow).join();window.untouched=document.querySelector('[data-local-row="a"]');job.rows[1].selected=false;job.rows[1].name='联网更新的标题';renderLocalRows(job,true);`);
 check('中间条目更新标题后DOM位置不变，不重建其他卡片',await js(w,"[...document.querySelectorAll('[data-local-row]')].map(e=>e.dataset.localRow).join()===beforeOrder&&document.querySelector('[data-local-row=\"a\"]')===untouched&&!document.querySelector('[data-local-row=\"b\"] .local-check').checked"));
 await run("localImportSession.rows[0].name='最后完成的标题';renderLocalRows(localImportSession,true)");
 check('首项最后获得资料亦不挪到末尾',await js(w,"[...document.querySelectorAll('[data-local-row]')].map(e=>e.dataset.localRow).join()===beforeOrder"));
 await run('closeLocalImport()');
};
