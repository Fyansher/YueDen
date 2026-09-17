const path=require('node:path'),crypto=require('node:crypto'),Model=require('./local-model');
function identity(root,type,title){return crypto.createHash('sha256').update(Model.pathKey(root)+'|series|'+type+'|'+title).digest('hex').slice(0,20);}
function episode(raw){const m=raw.match(/^(.*?)\s*(?:S(\d{1,2})\s*E(\d{1,4})|第\s*(\d+)\s*[集话話])(?:\s*[-._ ].*)?$/i);return m&&{title:m[1].trim(),season:Number(m[2]||1),episode:Number(m[3]||m[4])};}
function group(rows,existingItems=[],filter='all'){
 const groups=new Map(),out=[];
 for(const row of rows){
  const publication=['book','comic'].includes(row.classification.type)||['unknown_collection','document'].includes(row.classification.type)&&row.metadata.container&&!['invalid','unknown-publication'].includes(row.metadata.container);if((!publication&&row.classification.type!=='video')||row.attachmentOf){out.push(row);continue;}
  const ep=row.classification.type==='video'?episode(path.basename(row.localPath,path.extname(row.localPath))):null;
  const title=ep?.title||row.metadata.series||(row.naming.volume!=null?row.naming.seriesTitle||require('./scan-naming').parse(row.naming.rawPathName.replace(/\.[^.]+$/,'')).displayTitle:'');
  if(!title){out.push(row);continue;}
  const parent=row.boundary.kind==='image_collection'?path.dirname(row.boundary.root):path.dirname(row.localPath),key=Model.pathKey(parent)+'|'+row.classification.type+'|'+title+'|'+(row.metadata.author||'')+'|'+(row.naming.versionTags||[]).join(',');
  let target=groups.get(key);const files=row.localFiles.map(f=>({...f,...(ep?{season:ep.season,episode:ep.episode}:{}),volume:row.metadata.volume??row.naming.volume}));
  if(!target){target=row;target.localFiles=files;groups.set(key,target);out.push(target);target._seriesTitle=title;target._seriesRoot=parent;}
  else {target.localFiles=Model.mergeFiles(target.localFiles,files);target.boundary.ownedPaths.push(...row.boundary.ownedPaths);target.evidence.push(...row.evidence);target.reviewRequired||=row.reviewRequired;}
 }
 for(const row of groups.values()){
  if(row.localFiles.length>1&&(row.boundary.kind!=='image_collection'||row.boundary.ownedPaths.length>row.metadata.pages)){
   row.id=identity(row._seriesRoot,row.classification.type,row._seriesTitle+'|'+(row.metadata.author||'')+'|'+(row.naming.versionTags||[]).join(','));row.scanInfo.identity=row.id;row.scanInfo.automatic.name=row._seriesTitle;
   row.boundary.kind='resource_series';row.boundary.root=row._seriesRoot;row.naming.displayTitle=row._seriesTitle;
   const previous=existingItems.find(i=>i.scanInfo?.identity===row.id);Object.assign(row.scanInfo.userOverrides,previous?.scanInfo?.userOverrides||{});
   row.name=row.scanInfo.userOverrides.name||row._seriesTitle;for(const key of ['type','localPath'])if(row.scanInfo.userOverrides[key])row[key]=row.scanInfo.userOverrides[key];
   row.evidence.push({rule:'explicit-series',source:'embedded-series / explicit-volume-or-episode',detail:'按明确系列、卷号 / 剧集标记归组；普通数字不删除'});
  }delete row._seriesTitle;delete row._seriesRoot;
 }return out;
}
module.exports={group,episode};
