function rememberRowOverride(row,key,value){if(!row.scanInfo)return;row.scanInfo.userOverrides={...row.scanInfo.userOverrides,[key]:value};}
function installScanOptions(job){importNetworkControls(job,$('localRootList'));}
function renderScanEvidence(el,row){
 if(!row.scanInfo){renderScanLaunchChoice(el,row);return;}
 const typeName=t=>TYPE_NAMES[t]||({comic:'漫画',video:'影视',software:'非游戏软件',unknown_application:'用途未确定的程序',unknown_file:'待识别文件'}[t])||t,boundaryName=t=>({individual_file:'独立文件',individual_application:'独立应用入口',application_installation:'同一安装的多个入口',resource_package:'独立资源包',image_collection:'图片集合',resource_series:'系列资源'}[t])||t;
 const info=row.scanInfo,details=document.createElement('details');details.className='scan-evidence';
 const summary=document.createElement('summary');summary.textContent='为什么这样分类'+(row.scanInfo?.userOverrides?.type?' · 已人工选择类型':row.directoryProposal?' · 按目录归组':row.reviewRequired?' · 待确认':'');details.append(summary);
 const add=(label,value)=>{if(value==null||value==='')return;const line=document.createElement('p');const strong=document.createElement('b');strong.textContent=label+'：';line.append(strong,document.createTextNode(String(value)));details.append(line);};
 if(row.scanInfo?.userOverrides?.type)add('人工选择类型',typeName(row.scanInfo.userOverrides.type));
 add('边界可信度',Math.round((row.boundary?.confidence||0)*100)+'% · '+boundaryName(row.boundary?.kind));add('类型可信度',Math.round((row.classification?.confidence||0)*100)+'% · '+typeName(row.classification?.type));add('名称可信度',Math.round((row.naming?.confidence||0)*100)+'%');add('分类依据',row.classification?.reason);
 add('安装位置',info.installation?.root);add('入口归属',info.entries?.map(e=>LocalModel.base(e.path)+'（'+({primary:'主程序',launcher:'启动器',tool:'辅助工具'}[e.role]||'待确认')+'）').join('、'));
 add('原始目录',row.naming?.rawDirectoryName);add('原始文件',row.naming?.rawPathName);add('编号线索',row.naming?.codeHints?.join('、'));add('版本标签',row.naming?.versionTags?.join('、'));
 add('候选类型',row.classification?.candidates?.map(c=>typeName(c.type)+' '+Math.round(c.score*100)+'%').join('；'));add('标题候选',row.naming?.candidates?.join('；'));
 for(const evidence of row.evidence||[])add(evidence.rule,evidence.detail+' · '+evidence.source);
 add('冲突',row.classification?.conflicts?.join('；'));add('人工修正',Object.entries(info.userOverrides||{}).map(([k,v])=>k+' = '+v).join('；'));
 el.append(details);

 renderScanLaunchChoice(el,row);
}
function renderScanLaunchChoice(el,row){
 const folder=document.createElement('button');folder.type='button';folder.className='text-button';folder.textContent='打开目录';folder.title='打开文件所在目录';folder.onclick=async()=>{try{await native.revealLocal(row.localPath);}catch(e){showToast(e.message,'error');}};el.querySelector('.local-type').before(folder);
 if(['game','software','unknown_application'].includes(row.type)&&!row.explicitFile){
  const select=document.createElement('select');select.className='scan-launch-choice';select.setAttribute('aria-label','更换启动入口');select.title=row.localPath||'';
  const files=LocalModel.mergeFiles(row.localFiles||[],row.localPath?[{path:row.localPath,name:LocalModel.base(row.localPath)}]:[]);
  for(const file of files.filter(f=>!row.scanInfo?.entries?.some(e=>LocalModel.pathKey(e.path)===LocalModel.pathKey(f.path)&&e.role==='tool')||LocalModel.pathKey(f.path)===LocalModel.pathKey(row.localPath))){const option=document.createElement('option');option.value=file.path;option.textContent='启动：'+file.name;option.title=file.path;select.append(option);}
  select.add(new Option('选择其他启动文件…',''));select.value=row.localPath||files[0]?.path||'';
  select.onchange=async()=>{try{let value=select.value;if(!value){const result=await native.pickResourcePath('file',row.localPath);if(!result?.ok||!result.value){select.value=row.localPath;return;}value=result.value;}row.localPath=value;rememberRowOverride(row,'localPath',value);row.localFiles=LocalModel.mergeFiles(row.localFiles,[{path:value,name:LocalModel.base(value)}]);renderLocalRows(localImportSession);}catch(error){select.value=row.localPath;showToast(error.message,'error');}};el.querySelector('.local-row-options').append(select);
 }
}
function renderScanSummary(job,result){
 $('scanResultDetails')?.remove();const host=document.createElement('div');host.id='scanResultDetails';
 const skipped=document.createElement('details');skipped.className='scan-skipped';skipped.innerHTML='<summary>为什么跳过文件 / 目录（'+(result.skipped||[]).length+'）</summary>';const list=document.createElement('div');
 for(const entry of (result.skipped||[]).slice(0,1000)){const p=document.createElement('p');p.textContent=entry.path+' — '+entry.reason;list.append(p);}skipped.append(list);host.append(skipped);$('localScanWarnings').after(host);
}
