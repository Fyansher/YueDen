/* User-selected parent -> one direct child directory per resource. No software classifier. */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Model=require('./local-model'),AI=require('./application-identity'),Meta=require('./scan-metadata'),Names=require('./scan-naming'),{context}=require('./scan-context');
async function scan(roots,type,options={}){
 const ctx=context({...options,filter:'game'}),items=[],seen=new Set();
 let pending=Promise.resolve(),networkError;
 const enrich=row=>{pending=pending.then(async()=>{if(networkError)return;ctx.check();await require('./scan-matching').enrich([row],ctx);emit(row,'资料已核对 '+row.name);}).catch(e=>{networkError=e;});};
 const emit=(row,phase)=>options.onProgress?.({checked:ctx.metrics.files,found:items.length,phase,row});
 for(const parent of roots){let children;try{children=await ctx.summary(parent);}catch(e){if(e.name==='AbortError')throw e;ctx.skip(parent,'unreadable-directory',e.message);continue;}
  for(const child of children.filter(r=>r.kind==='directory')){
   ctx.check();const root=path.join(parent,child.name),key=Model.pathKey(root);if(seen.has(key))continue;seen.add(key);
   if(/^steamworks(?: shared| common redistributables| sdk)?$/i.test(child.name)){ctx.skip(root,'steam-shared-runtime','Steam共享运行库，不建立游戏卡片');continue;}
   const entries=[],steamIds=new Set();let installation;
   async function visit(dir,depth=0){ctx.check();if(depth>24){ctx.skip(dir,'depth-limit','目录层级过深，未继续读取');return;}let rows;try{rows=await ctx.summary(dir);}catch(e){if(e.name==='AbortError')throw e;ctx.skip(dir,'unreadable-directory',e.message);return;}
    if(depth===0)installation=await require('./scan-installation').installed(root,rows,ctx,ctx.summary);
    for(const r of rows){ctx.check();const file=path.join(dir,r.name);if(r.kind==='link'){ctx.skip(file,'symbolic-link','不跟随链接');continue;}
     if(r.kind==='directory'){await visit(file,depth+1);continue;}
     if(r.kind!=='file')continue;
     if(/^steam_appid\.txt$/i.test(r.name)){try{const id=(await ctx.read(file,128)).toString('utf8').trim();if(/^\d{1,10}$/.test(id)&&id!=='480')steamIds.add(id);}catch(e){if(e.name==='AbortError')throw e;}continue;}
     if(!/\.exe$/i.test(r.name))continue;
     try{const metadata=await Meta.product(file,ctx),stat=await fs.stat(file);entries.push({...AI.facts(file,metadata),size:stat.size,mtimeMs:stat.mtimeMs,name:r.name});}catch(e){if(e.name==='AbortError')throw e;ctx.skip(file,'metadata-unreadable',e.message);}
    }
   }
   await visit(root);
   if(!entries.some(e=>e.validPe)){ctx.skip(root,'no-launch-entry','未找到有效且非空的 EXE 启动程序，不建立游戏条目');continue;}
   if(installation?.identifiers?.steam==='228980'){ctx.skip(root,'steam-shared-runtime','Steam共享运行库产品，不建立游戏卡片');continue;}
   const helper=e=>/[\\/](?:helpers?|tools?|redist|redistributables|installer|updates?|crashreport|steamworks)(?:[\\/]|$)/i.test(path.sep+path.relative(root,e.path));
   entries.sort((a,b)=>Number(helper(a))-Number(helper(b))||Number(a.role==='tool')-Number(b.role==='tool')||Number(a.path!==installation?.launch)-Number(b.path!==installation?.launch)||a.path.split(path.sep).length-b.path.split(path.sep).length||Model.natural(a.name,b.name));
   const main=entries.find(e=>e.validPe&&e.role!=='tool')||entries.find(e=>e.validPe),file=main?.path||root,metadata={...main?.metadata},id=crypto.createHash('sha256').update(key+'|folder-resource').digest('hex').slice(0,20);
   const steam=installation?.identifiers?.steam||(steamIds.size===1?[...steamIds][0]:'');
   const product=AI.product(metadata.productName),readable=product&&product.length>=5&&!/^(?:steamworks|steamworkscommonredistributables|steamclient|steamapi)/i.test(product);
   const installedTitle=installation?.title&&!/^(?:appid[ _:-]*\d+|未命名资源)/i.test(installation.title)?installation.title:'';
   let name=installedTitle||Names.splitCamel(child.name);
   const naming={...Names.naming(file,{packageRoot:root,metadata}),displayTitle:name,source:installedTitle?'installed-title':'resource-root',confidence:installedTitle?.98:.65};
   const classification={type:'game',confidence:1,candidates:[{type:'game',score:1}],reason:'用户规则：所选目录的每个直接子文件夹是一个资源；不代表已判定程序真实类型',conflicts:[]},localFiles=entries.map(e=>({path:e.path,name:e.name,size:e.size,mtimeMs:e.mtimeMs}));
   const previous=(options.existingItems||[]).find(r=>r.scanInfo?.folderRoot===key||Model.members(r).some(f=>localFiles.some(v=>Model.pathKey(v.path)===Model.pathKey(f.path))));
   const overrides={...previous?.scanInfo?.userOverrides};if(previous)for(const k of ['name','localPath'])if(previous[k]&&previous[k]!==previous.scanInfo?.automatic?.[k])overrides[k]=previous[k];
   const identifiers={...installation?.identifiers,...(steam?{steam}:{})},boundary={kind:'resource_package',root,confidence:1,ownedPaths:[root]},automatic={name,type:'game',localPath:file};
   const row={id,...automatic,...overrides,localFiles,identifiers,metadata:{...metadata,identifiers},naming,classification,boundary,evidence:[],directoryProposal:true,reviewRequired:false,selected:true,warnings:main?[]:['没有找到正常启动程序，可手动选择入口'],scanInfo:{schema:1,identity:id,folderRoot:key,automatic,userOverrides:overrides,entries,classification,naming,boundary,metadata:{...metadata,identifiers}}};
   items.push(row);emit(row,'已扫描 '+name);if(options.online&&options.identitySearch&&options.liveMetadata)enrich(row);
  }
 }
 if(options.online&&options.identitySearch&&!options.liveMetadata)for(const row of items)enrich(row);
 await pending;if(networkError)throw networkError;
 return {metadataPhaseCompleted:Boolean(options.online&&options.liveMetadata),items,candidates:items,pending:[],skipped:ctx.skipped,warnings:ctx.warnings,checked:ctx.metrics.files,ignored:{},metrics:{...ctx.metrics,durationMs:Date.now()-ctx.started},pipelineVersion:2};
}
module.exports={scan};
