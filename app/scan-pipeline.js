/* One evidence pipeline, independent of the selected library. No spawned programs. */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Model=require('./local-model'),Meta=require('./scan-metadata'),Names=require('./scan-naming'),Types=require('./scan-classification'),Policy=require('./scan-policy'),Boundaries=require('./scan-boundaries'),{context}=require('./scan-context');
const idFor=value=>crypto.createHash('sha256').update(Model.pathKey(value)).digest('hex').slice(0,20);
const engine=r=>r.kind==='directory'&&/(?:_Data$|^Engine$|^MonoBleedingEdge$)/i.test(r.name);

async function scan(roots,filter='all',options={}){
 const ctx=context({...options,filter,budget:{...options.budget,...(options.maxFiles?{maxFiles:options.maxFiles}:{})}}),summaries=new Map(),visited=new Set(),products=new Map(),resources=[],softwareScopes=[],attachments=[],attachmentTrees=[],ignored={wallpaperDirectories:0,auxiliaryFiles:0,nonPageImages:0};
 const summary=async dir=>{if(summaries.has(dir))return summaries.get(dir);const rows=await ctx.summary(dir);if(rows.length<=10000){summaries.set(dir,rows);if(summaries.size>64)summaries.delete(summaries.keys().next().value);}return rows;};
 let lastRowsAt=0,liveQueue=Promise.resolve(),liveError;
 const liveRow=row=>{if(!options.liveMetadata||!options.online||!options.identitySearch||row.naming.volume!=null||row.metadata.series||row.classification.type==='video'||row.classification.type==='unknown_application'||row.classification.type==='software'||row.classification.type==='game')return;liveQueue=liveQueue.then(async()=>{if(liveError)return;ctx.check();await require('./scan-matching').enrich([row],ctx);row.liveMetadataChecked=true;const rows=require('./scan-grouping').group(structuredClone(resources),options.existingItems,filter).filter(r=>filter==='all'||Types.canonicalType(r.type)===Types.canonicalType(filter));options.onProgress?.({checked:ctx.metrics.files,found:rows.length,phase:'资料已核对 '+row.name,rows});}).catch(e=>{liveError=e;});};
 const progress=phase=>options.onProgress?.({checked:ctx.metrics.files,found:resources.length,phase,bytes:ctx.metrics.bytes});
 const record=(file,reasonCode,reason,extra)=>ctx.skip(file,reasonCode,reason,extra);
 async function fileInfo(file){const s=await fs.stat(file);return {path:file,name:path.basename(file),size:s.size,mtimeMs:s.mtimeMs};}
 async function product(file){if(products.has(Model.pathKey(file)))return products.get(Model.pathKey(file));try{const metadata=await Meta.product(file,ctx);products.set(Model.pathKey(file),metadata);return metadata;}catch(error){if(error.name==='AbortError'||error.code==='SCAN_BUDGET')throw error;record(file,'unreadable-product',error.message);return {validPe:false,error:error.message};}}
 async function make(file,kind,metadata={},boundary={},evidence=[],localFiles){
  const root=['resource_package','image_collection'].includes(boundary.kind)?boundary.root:path.dirname(file),rules=Names.scopedRules(options.rules,root,file,metadata),conflictingNames=new Set(rules.map(r=>r.title).filter(Boolean)).size>1,rule=conflictingNames?undefined:rules[0];
  for(const matched of rules)evidence.push({rule:matched.id,source:matched.source,detail:'已验证规则，作用范围：'+matched.scope});
  if(kind==='images')metadata={...metadata,originalCollectionName:path.basename(root),imageRatio:1};
  if(metadata.container)evidence.push({rule:'container-and-embedded-metadata',source:file,detail:'容器：'+metadata.container+'；主题：'+(metadata.subject||'未提供')+'；嵌入标题：'+(metadata.title||'未提供')});
  const naming=Names.naming(file,{packageRoot:root,metadata,rule}),classification=Types.classify({kind,file,metadata,evidence,rules});
  if(evidence.some(e=>e.rule==='script-runtime-package')&&path.basename(file,'.exe')===path.basename(root)&&naming.source==='original-path')naming.confidence=.85;
  if(conflictingNames)classification.conflicts.push('多个已确认规则给出不同标题，保留原名并请确认');
  if(classification.conflicts.length)naming.confidence=Math.min(naming.confidence,.5);
  const files=localFiles||[await fileInfo(file)],boundaryInfo={kind:'individual_file',confidence:.98,root:file,ownedPaths:[file],...boundary};
  const id=idFor(boundaryInfo.kind==='resource_package'?boundaryInfo.root+'|package':kind==='images'?root+'|images':file);
  const automatic={name:naming.displayTitle,type:Types.uiType(classification.type),localPath:file},scanInfo={schema:1,identity:id,automatic,userOverrides:{},boundary:boundaryInfo,classification,naming,evidence,metadata,scannedAt:new Date().toISOString()};
  if(kind==='application')scanInfo.entries=files.filter(f=>/\.exe$/i.test(f.path)).map(f=>require('./application-identity').facts(f.path,products.get(Model.pathKey(f.path))||metadata));
  const existing=(options.existingItems||[]).find(i=>i.scanInfo?.identity===id||Model.members(i).some(f=>files.some(v=>Model.pathKey(v.path)===Model.pathKey(f.path))));
  const overrides={...(existing?.scanInfo?.userOverrides||{})};if(existing){for(const key of ['name','type','localPath'])if(existing[key]&&(!existing.scanInfo?.automatic||existing[key]!==existing.scanInfo.automatic[key]))overrides[key]=existing[key];}
  scanInfo.userOverrides=overrides;
  const reviewRequired=boundaryInfo.confidence<.8||classification.confidence<.8||naming.confidence<.7||classification.type.startsWith('unknown')||classification.conflicts.length>0;
  const row={id,...automatic,...overrides,originalName:naming.rawPathName,naming,classification,boundary:boundaryInfo,evidence,metadata,identifiers:metadata.identifiers||{},scanInfo,reviewRequired,localFiles:files,warnings:[...classification.conflicts,...(metadata.error?[metadata.error]:[])]};
  if(kind==='application'&&metadata.validPe&&metadata.identifiers?.steam&&!overrides.type&&require('./application-identity').role(file,metadata)!=='tool'&&classification.type==='software'){row.type='game';row.reviewRequired=false;row.scanInfo.automatic.type='game';row.scanInfo.steamLibraryAdmission=true;row.evidence.push({rule:'steam-library-admission',source:file,detail:'按用户偏好，有本地Steam产品身份的软件也可收进游戏栏目；保留其真实软件分类'});}
  resources.push(row);if(options.onProgress&&Date.now()-lastRowsAt>=80){lastRowsAt=Date.now();const snapshot=require('./scan-grouping').group(structuredClone(resources),options.existingItems,filter).filter(r=>filter==='all'||Types.canonicalType(r.type)===Types.canonicalType(filter));options.onProgress({checked:ctx.metrics.files,found:snapshot.length,phase:'已识别 '+row.name,rows:snapshot});}liveRow(row);return row;
 }
 async function inspect(file,attachmentOf=null){
  ctx.check();const ext=path.extname(file).toLowerCase();let kind,metadata={};
  try{
   if(ext==='.exe'){kind='application';metadata=await Meta.product(file,ctx);}
   else if(Model.video.test(file)){kind='video';metadata=await Meta.media(file,ctx);}
   else if(Model.books.test(file)||/\.(zip|cbz)$/i.test(file)){kind='publication';metadata=await Meta.publication(file,ctx);}
   else{return record(file,'unsupported-content','不是独立可识别资源格式；未读取正文');}
   if(metadata.container==='image-archive'&&!metadata.pages)return record(file,'archive-without-pages','归档中没有可阅读的图片页');
  }catch(error){if(error.name==='AbortError'||error.code==='SCAN_BUDGET')throw error;metadata={container:'invalid',error:error.message};kind=kind||'publication';}
  const row=await make(file,kind,metadata);if(attachmentOf){row.attachmentOf=attachmentOf;row.reviewRequired=true;row.selected=false;}return row;
 }
 async function visit(dir,depth=0){
  ctx.check();if(visited.has(Model.pathKey(dir)))return;visited.add(Model.pathKey(dir));if(depth>ctx.budget.maxDepth){record(dir,'depth-budget','超出扫描深度预算');return;}
  let rows;try{rows=await summary(dir);}catch(error){if(error.code==='SCAN_BUDGET'||error.name==='AbortError')throw error;record(dir,'permission-or-missing','目录无法读取：'+error.message);if(error.code==='SCAN_DIRECTORY_LIMIT')ctx.warnings.push(error.message);return;}
  if(Policy.wallpaperPath(dir)){ignored.wallpaperDirectories++;record(dir,'wallpaper-project','Wallpaper Engine 产品内容目录，不是书刊');return;}
  const project=rows.find(r=>r.kind==='file'&&r.name.toLowerCase()==='project.json');
  if(project){try{const p=JSON.parse((await ctx.read(path.join(dir,project.name),32768)).toString('utf8'));if(['scene','video','web'].includes(p.type)&&p.file&&(p.preview||p.workshopid||p.general)){ignored.wallpaperDirectories++;record(dir,'wallpaper-project','项目清单声明为壁纸，内部素材归属壁纸项目');return;}}catch(error){if(error.code==='SCAN_BUDGET')throw error;}}
  for(const row of rows)if(row.kind==='link')record(path.join(dir,row.name),'symbolic-link','跳过符号链接 / 联接，避免循环与越出扫描范围');
  softwareScopes.push(...await require('./scan-platform-ownership').scopes(dir,rows,{summary,product}));
  const direct=rows.filter(r=>r.kind==='file'&&/\.exe$/i.test(r.name)),programs=[];
  for(const r of direct){const file=path.join(dir,r.name);programs.push({file,metadata:await product(file)});}
  // Binary siblings and launcher references are read only, shared by all scan modes.
  const structural=await Boundaries.inspect(dir,rows,{ctx,summary,product});programs.push(...structural.programs);
  for(const p of programs){const reason=require('./scan-software-evidence').purpose(p.metadata,p.file,rows);if(reason)p.metadata={...p.metadata,softwarePurpose:reason};}
  const softwareScope=require('./scan-software-ownership').scope(dir,rows,programs);if(softwareScope)softwareScopes.push(softwareScope);
  const scriptRuntime=await require('./scan-script-runtime').detect(dir,rows,programs,ctx);if(scriptRuntime){structural.cohesive=true;structural.launch=scriptRuntime.main.file;structural.evidence.push({rule:scriptRuntime.rule,source:scriptRuntime.source,detail:scriptRuntime.detail});}
  const family= require('./scan-entry-family').evidence(dir,rows,programs);if(family){structural.cohesive=true;structural.launch=family.main.file;structural.evidence.push({rule:family.rule,source:family.source,detail:family.detail});}
  let steamId='';const steam=rows.find(r=>r.kind==='file'&&r.name.toLowerCase()==='steam_appid.txt');if(steam){const raw=(await ctx.read(path.join(dir,steam.name),128)).toString('utf8').trim();if(/^\d{1,10}$/.test(raw))steamId=raw;}
  const installation=await require('./scan-installation').installed(dir,rows,ctx,summary);
  const payload=await Boundaries.pairedPayload(dir,rows,programs,ctx);
  const partition=require('./scan-package-partition').partition(dir,rows,programs,{installation,structural,payload,rules:options.rules});
  const separatePrograms=partition?.separate||[];
   if(partition){programs.splice(0,programs.length,...partition.owned);if(partition.pairedData){structural.cohesive=true;structural.launch=partition.anchor.file;structural.evidence.push({rule:'paired-data-config',source:partition.anchor.file,detail:'有效入口与同名数据、配置形成局部边界，独立软件不撤销该边界'});}}
  const paired=programs.some(p=>rows.some(r=>r.kind==='directory'&&r.name.toLowerCase()===path.basename(p.file,'.exe').toLowerCase()+'_data'));
  const nonTools=programs.filter(p=>!Boundaries.auxiliary(p)&&(!family||p.file===family.main.file));
  const cores=nonTools.filter(p=>require('./application-identity').role(p.file,p.metadata)==='primary');
  const primaryPrograms=cores.length?cores:nonTools;
  const AI=require('./application-identity'),distinctProducts=new Set(primaryPrograms.map(p=>AI.product(p.metadata.productName)).filter(Boolean)),foreignPublications=rows.some(r=>r.kind==='file'&&/\.(epub|cbz|mobi|azw3)$/i.test(r.name));
  const metadataConflict=primaryPrograms.some((p,i)=>primaryPrograms.slice(i+1).some(q=>AI.conflict(AI.facts(p.file,p.metadata),AI.facts(q.file,q.metadata))));
  const knownRule=programs.some(p=>Names.scopedRules(options.rules,dir,p.file,p.metadata).length),cohesive=!metadataConflict&&programs.some(p=>p.metadata.validPe)&&(installation||paired||payload||structural.cohesive||steamId&&rows.some(engine)||distinctProducts.size===1&&programs.length>1&&primaryPrograms.every(p=>AI.product(p.metadata.productName))||knownRule&&programs.length===1&&rows.some(r=>r.kind==='file'&&r.name.toLowerCase()===path.basename(programs[0].file,'.exe').toLowerCase()+'.deps.json'));
  let helperBarriers=[];if(cohesive){const nested=await require('./scan-entry-family').helpers(dir,rows,{summary,product,products:[...distinctProducts],knownEntries:programs.map(p=>p.file),independent:partition?.independent,familyKey:family?.controller?path.basename(family.main.file,'.exe').replace(/(?:boot|launcher|login)$/i,''):''});helperBarriers=nested.foreignPaths;for(const p of nested)if(!programs.some(v=>v.file===p.file))programs.push(p);}
  const foreign=cohesive?helperBarriers[0]||await Boundaries.foreignChild(dir,rows,summary,programs):null;
  const own=cohesive&&distinctProducts.size<2&&(!foreignPublications&&!foreign||Boolean(partition));
  if(cohesive&&!own)record(dir,'mixed-boundary-conflict','存在独立出版物、其他应用或子资源，不吞并该混合目录',{conflict:foreign||'独立产品证据冲突'});
  if(own){
   const rank=p=>({primary:0,launcher:1,tool:2}[AI.role(p.file,p.metadata)])*10+AI.variant(p.file);
   programs.sort((a,b)=>rank(a)-rank(b)||a.file.split(/[\\/]/).length-b.file.split(/[\\/]/).length||a.file.localeCompare(b.file));const main=programs.find(p=>p.file===(installation?.launch||structural.launch)&&!Boundaries.auxiliary(p))||programs.find(p=>!Boundaries.auxiliary(p))||programs[0],evidence=[...structural.evidence,...(payload?[payload]:[])];
   if(family?.controller){const core=programs.filter(p=>require('./scan-entry-family').role(p.file)==='primary'&&p.metadata.productName&&!/launcher|application|TODO/i.test(p.metadata.productName));if(core.length===1)main.metadata={...main.metadata,title:core[0].metadata.productName};}
   if(installation){main.metadata={...main.metadata,title:installation.title||main.metadata.title,identifiers:{...main.metadata.identifiers,...installation.identifiers}};if(installation.type)evidence.push({rule:'installed-product-category',source:installation.source,type:installation.type,detail:'安装位置与产品清单一致，类别由平台安装记录提供'});}
   if(paired||rows.some(engine))evidence.push({rule:'paired-engine-data',source:'directory-summary',detail:'启动入口及配套引擎数据目录'});
   if(rows.some(r=>r.kind==='file'&&/^steam_api(?:64)?\.dll$/i.test(r.name))&&(paired||rows.some(engine)))evidence.push({rule:'engine-steam-runtime',source:dir,detail:'有效程序、配对引擎数据与 Steam 运行库共同支持游戏识别'});
   if(steamId){main.metadata.identifiers={steam:steamId};evidence.push({rule:'steam-appid',source:path.join(dir,steam.name),detail:'Steam 产品标识 '+steamId});}
   const independentPaths=[...separatePrograms.map(p=>p.file),...helperBarriers,...(foreign?[foreign]:[]),...rows.filter(r=>r.kind==='file'&&/\.(epub|cbz|mobi|azw3)$/i.test(r.name)).map(r=>path.join(dir,r.name))];
   const within=(a,b)=>Model.pathKey(a)===Model.pathKey(b)||Model.pathKey(b).startsWith(Model.pathKey(a)+'/');
   const separate=[...new Set(independentPaths)].filter((p,i,all)=>!all.some((other,j)=>i!==j&&within(other,p)&&Model.pathKey(other)!==Model.pathKey(p)));
   const ownedRows=rows.filter(r=>!separate.some(p=>within(path.join(dir,r.name),p)));
   if(separate.length)evidence.push({rule:'partial-package-boundary',source:dir,detail:'保留已有产品边界，只隔离 '+separate.length+' 个独立内容范围；不将整个游戏包拆散'});
   const files=await Promise.all(programs.map(p=>fileInfo(p.file))),owner=await make(main.file,'application',main.metadata,{kind:'resource_package',root:dir,confidence:.94,ownedPaths:[...new Set([...files.map(f=>f.path),...ownedRows.map(r=>path.join(dir,r.name))])]},evidence,files);
   for(const row of ownedRows){const full=path.join(dir,row.name);if(programs.some(p=>p.file===full))continue;record(full,'owned-by-package','该内容属于资源包，不独立入库',{ownerId:owner.id});if(row.kind==='file'&&(Model.books.test(full)||Model.video.test(full)||/\.(zip|cbz)$/i.test(full)))attachments.push({path:full,ownerId:owner.id});}
   if(options.includeAttachments)for(const row of ownedRows.filter(r=>r.kind==='directory'))attachmentTrees.push({path:path.join(dir,row.name),ownerId:owner.id});
   for(const independent of separate){ctx.check();record(independent,'independent-within-package','独立内容单独识别，不撤销父资源归属');try{if((await fs.stat(independent)).isDirectory())await visit(independent,depth+path.relative(dir,independent).split(path.sep).length);else await inspect(independent);}catch(error){if(error.name==='AbortError')throw error;record(independent,'unreadable-independent',error.message);}}
   progress('边界确认');return;
  }
  const audioFiles=rows.filter(r=>r.kind==='file'&&/\.(mp3|flac|wav|m4a|aac|ogg|opus|wma|ape)$/i.test(r.name));
  const audioArt=new Set(audioFiles.length?rows.filter(r=>r.kind==='file'&&/^(?:cover|folder|front|back|artwork)(?:[-_ ]?\d+)?\.(jpe?g|png|webp)$/i.test(r.name)).map(r=>r.name):[]);
  for(const name of audioArt)record(path.join(dir,name),'audio-artwork','同目录音频作品的封面资料，不独立作为漫画收录');
  const pageImages=rows.filter(r=>r.kind==='file'&&Model.images.test(r.name)&&!audioArt.has(r.name));
  if(pageImages.length>=2&&!programs.length){
   const comicFile=rows.find(r=>r.kind==='file'&&/^ComicInfo\.xml$/i.test(r.name));let xml='';if(comicFile)xml=(await ctx.read(path.join(dir,comicFile.name),65536)).toString('utf8');
   const files=await Promise.all(pageImages.map(r=>fileInfo(path.join(dir,r.name))));await make(files[0].path,'images',{title:Meta.tag(xml,'Title')||Meta.tag(xml,'Series'),series:Meta.tag(xml,'Series'),volume:Number(Meta.tag(xml,'Number'))||null,comicInfo:Boolean(xml),pages:files.length},{kind:'image_collection',root:dir,confidence:.9,ownedPaths:files.map(f=>f.path)},[{rule:'image-sequence',source:'directory-summary',detail:'多张图片仅说明是图片集合；不凭尺寸 / 比例判定漫画'}],files);
  }
  for(const row of rows){ctx.check();const full=path.join(dir,row.name);if(row.kind==='link'||audioArt.has(row.name))continue;
   if(row.kind==='directory'){if(/^(?:\.git|node_modules|\$RECYCLE.BIN|System Volume Information)$/i.test(row.name)){record(full,'system-or-development-tree','系统 / 依赖目录，不扫描');continue;}await visit(full,depth+1);}
   else if(row.kind==='file'){
    if(pageImages.some(i=>i.name===row.name)){if(pageImages.length<2){ignored.nonPageImages++;record(full,'single-image','单张图片没有独立出版物证据');}continue;}
    if(Policy.auxiliaryFile(row.name)){ignored.auxiliaryFiles++;record(full,'auxiliary-document','说明类文件，默认不独立收录');attachments.push({path:full,ownerId:null});continue;}
    if(programs.some(p=>p.file===full)){const p=programs.find(p=>p.file===full);await make(full,'application',p.metadata,{kind:'individual_application',root:full,confidence:.9,ownedPaths:[full]},[{rule:'application-entry',source:'pe-header',detail:'仅确认此入口，不吞并混合目录'}]);}
    else await inspect(full);
   }
  }progress('特征识别');
 }
 try{for(const root of roots||[]){ctx.check();let real;try{real=await fs.realpath(root);const s=await fs.stat(real);if(!s.isDirectory()&&options.explicitFiles&&s.isFile()){await inspect(real);continue;}if(!s.isDirectory()){record(root,'not-directory','扫描入口必须是文件夹');continue;}}catch(error){record(root,'permission-or-missing','目录无法访问：'+error.message);continue;}await visit(real);}
  if(options.includeAttachments){
   const attachmentVisited=new Set();
   async function attachedTree(dir,ownerId,depth=0){
    ctx.check();if(depth>Math.min(6,ctx.budget.maxDepth)||attachmentVisited.has(Model.pathKey(dir)))return;attachmentVisited.add(Model.pathKey(dir));
    let rows;try{rows=await summary(dir);}catch(error){if(error.name==='AbortError'||error.code==='SCAN_BUDGET')throw error;record(dir,'unreadable-attachment',error.message);return;}
    const pages=rows.filter(r=>r.kind==='file'&&Model.images.test(r.name));
    if(pages.length){const files=await Promise.all(pages.map(r=>fileInfo(path.join(dir,r.name))));const row=await make(files[0].path,'images',{originalCollectionName:path.basename(dir)},{kind:'image_collection',root:dir,confidence:.85,ownedPaths:files.map(f=>f.path)},[{rule:'optional-package-attachment',source:dir,detail:'用户选择列出资源包中的附属图片集合，未推断为漫画'}],files);row.attachmentOf=ownerId;row.reviewRequired=true;row.selected=false;}
    for(const row of rows){const file=path.join(dir,row.name);if(row.kind==='directory')await attachedTree(file,ownerId,depth+1);else if(row.kind==='file'&&(Model.books.test(file)||Model.video.test(file)||/\.(zip|cbz)$/i.test(file)))attachments.push({path:file,ownerId});}
   }
   for(const tree of attachmentTrees)await attachedTree(tree.path,tree.ownerId);
   for(const a of attachments)await inspect(a.path,a.ownerId||'auxiliary');
  }
 }catch(error){if(error.name==='AbortError')throw error;ctx.warnings.push(error.message);}
 await liveQueue;if(liveError)throw liveError;
 // Human overrides are independent of automatic classification and survive rescans.
 require('./scan-software-ownership').apply(resources,softwareScopes);
 let grouped=require('./scan-grouping').group(resources,options.existingItems,filter);
 grouped=require('./scan-application-entries').mergeEntries(grouped,{existingItems:options.existingItems});
 if(options.directoryPreview)grouped=require('./scan-directory-preview').group(grouped,options.existingItems);
 if(options.online&&options.identitySearch)await require('./scan-matching').enrich(grouped.filter(row=>!row.liveMetadataChecked),ctx);
 grouped=require('./scan-application-entries').mergeEntries(grouped,{existingItems:options.existingItems});
 const selected=Types.canonicalType(filter),matches=row=>filter==='all'||!filter||Types.canonicalType(row.type)===selected;
 if(selected==='game')for(const row of grouped.filter(r=>r.type==='software')){const info={path:row.localPath,reasonCode:'non-game-application',reason:row.classification.reason};ctx.skipped.unshift(info);if(ctx.skipped.length>10000)ctx.skipped.pop();}
 const items=grouped.filter(row=>options.explicitFiles||matches(row)&&!row.attachmentOf||options.includeAttachments&&row.attachmentOf&&matches(row));
 // Unknown applications remain explicit, unselected review candidates in the game workflow.
 if(selected==='game')for(const row of grouped){if(!items.includes(row)&&row.classification.type==='unknown_application'&&!row.attachmentOf){items.push({...row,type:'game',reviewRequired:true,selected:false,warnings:[...row.warnings,'仅确认应用入口，尚未确认游戏身份，请核对后导入']});}}
 if(['book','manga'].includes(filter))for(const row of grouped){if(!items.includes(row)&&['unknown_collection','document'].includes(row.classification.type)&&!row.attachmentOf&&row.metadata?.container&&!['invalid','unknown-publication',...(filter==='manga'?['text']:[])].includes(row.metadata.container))items.push(row);}
 const pending=grouped.filter(row=>row.reviewRequired&&!items.includes(row)&&(row.classification.type.startsWith('unknown')||row.classification.candidates.some(v=>v.type===selected)));
 return {metadataPhaseCompleted:Boolean(options.online&&options.liveMetadata),items,candidates:grouped,pending,skipped:ctx.skipped,attachments,warnings:ctx.warnings,checked:ctx.metrics.files,ignored,metrics:{...ctx.metrics,durationMs:Date.now()-ctx.started},pipelineVersion:1};
}
module.exports={scan};
