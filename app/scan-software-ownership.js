// A software install owns its dependencies, not every game beside it.
const path=require('node:path'),AI=require('./application-identity'),Model=require('./local-model');
const inside=(root,file)=>Model.pathKey(file).startsWith(Model.pathKey(root)+'/');
function scope(dir,rows,programs){
 const key=AI.key(path.basename(dir)).replace(/\d+(?:\d)*$/,'');
 const anchor=programs.find(p=>p.metadata.softwarePurpose&&(AI.key(path.basename(p.file,'.exe')).length>=2&&key.startsWith(AI.key(path.basename(p.file,'.exe')))||AI.product(p.metadata.productName)&&key.startsWith(AI.product(p.metadata.productName))||rows.some(r=>r.kind==='file'&&r.name.toLowerCase()===path.basename(p.file,'.exe').toLowerCase()+'.deps.json')));
 // A branded updater may establish the install when a matching product is nested.
 const updater=programs.find(p=>p.metadata.softwarePurpose&&/\.Updater\.exe$/i.test(p.file)&&key.startsWith(AI.key(path.basename(p.file).split('.')[0])));
 const main=anchor||updater;
 if(!main)return null;
 const structure=rows.some(r=>r.kind==='directory')||rows.some(r=>r.kind==='file'&&/\.(dll|dat|json|cfg)$/i.test(r.name));
 return structure?{root:dir,entry:main.file,reason:main.metadata.softwarePurpose}:null;
}
function apply(rows,scopes){
 const independent=rows.filter(r=>r.classification.type==='game'||r.scanInfo?.userOverrides?.type==='game'||r.boundary.kind==='resource_package'&&r.classification.type==='unknown_application');
 for(const row of rows){
  if(row.scanInfo?.userOverrides?.type||row.scanInfo?.steamLibraryAdmission||row.classification.type==='game')continue;
  const owner=scopes.filter(s=>inside(s.root,row.localPath)).sort((a,b)=>b.root.length-a.root.length)[0];if(!owner)continue;
  // An otherwise unlabelled, self-named primary in a separate child folder can be
  // an independent game; do not turn a mixed directory into a blanket exclusion.
  const parent=path.dirname(row.localPath),stem=AI.key(path.basename(row.localPath,'.exe'));
  const component=/[\\/](?:bin\d*|binaries|tools?|toolbox|ocr|runtime|runtimes|lib|libs|resources|addon|hooks|plugins?|platforms|mbcef\d*|rdr|speed|driver|console|hostcap|tap-driver|cache|temp)(?:[\\/]|$)/i.test(path.relative(owner.root,row.localPath).replace(/^/,'/'));
  if(!owner.componentTree&&row.classification.type==='unknown_application'&&!component&&row.localPath!==owner.entry&&AI.role(row.localPath,row.metadata)==='primary'&&String(row.metadata.companyName||'').trim()&&AI.product(row.metadata.productName)===stem)continue;
  if(!owner.componentTree&&independent.some(r=>inside(owner.root,r.localPath)&&r.boundary.kind==='resource_package'&&(r===row||inside(r.boundary.root,row.localPath))&&(!component||r.classification.type==='game'||r.evidence.some(e=>['static-launch-reference','paired-data-config','paired-product-payload','engine-steam-runtime'].includes(e.rule)))))continue;
  if(!owner.componentTree&&row.classification.type==='unknown_application'&&parent!==owner.root&&!component&&AI.role(row.localPath,row.metadata)==='primary'&&stem===AI.key(path.basename(parent)))continue;
  const evidence={rule:'software-owned-content',source:owner.entry,detail:'所属软件安装的组件 / 附属内容：'+owner.reason};
  row.evidence.push(evidence);row.classification={type:'software',confidence:.9,candidates:[{type:'software',score:.9}],reason:evidence.detail,conflicts:[]};row.type='software';row.reviewRequired=false;row.scanInfo.classification=row.classification;row.scanInfo.automatic.type='software';row.scanInfo.softwareOwner=owner;
 }
 return rows;
}
module.exports={scope,apply};
