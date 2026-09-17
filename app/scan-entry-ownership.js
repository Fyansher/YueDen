/* Installation ownership runs before network matching. Display titles are not identity. */
const path=require('node:path'),crypto=require('node:crypto'),Model=require('./local-model'),Identity=require('./application-identity');
const application=r=>['game','software','unknown_application'].includes(r.classification?.type||r.type)||['game','software','unknown_application'].includes(r.type);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex').slice(0,20);
const binaryRoot=dir=>dir.replace(/(?:[\\/](?:bin|binaries|win64|win32|x64|x86|exe64|exe32))+$/i,'');
function facts(row){const stored=row.scanInfo?.entries||[],metadata=row.metadata||row.scanInfo?.metadata||{};return Model.members(row).filter(f=>/\.exe$/i.test(f.path)).map(f=>Identity.facts(f.path,stored.find(e=>Model.pathKey(e.path)===Model.pathKey(f.path))?.metadata||metadata));}
const ids=r=>({...r.scanInfo?.metadata?.identifiers,...r.metadata?.identifiers,...r.identifiers,...(r.steamAppId?{steam:String(r.steamAppId)}:{})});
function conflict(a,b){
 if((a.classification?.type==='software')!==(b.classification?.type==='software'))return true;
 if(['game','software'].includes(a.classification?.type)&&['game','software'].includes(b.classification?.type)&&a.classification.type!==b.classification.type)return true;
 const ai=ids(a),bi=ids(b);if(Object.keys(ai).some(k=>ai[k]&&bi[k]&&String(ai[k])!==String(bi[k])))return true;
 for(const k of ['name','type'])if(a.scanInfo?.userOverrides?.[k]&&b.scanInfo?.userOverrides?.[k]&&a[k]!==b[k])return true;
 return facts(a).some(x=>facts(b).some(y=>Identity.conflict(x,y)));
}
function rootOf(r){return r.scanInfo?.installation?.root||(['resource_package','application_installation'].includes(r.boundary?.kind)?r.boundary.root:binaryRoot(path.dirname(r.localPath||'')));}
function tokens(r){return [...new Set([...Object.entries(ids(r)).filter(([k,v])=>v&&['steam','epic','verifiedProduct','gog'].includes(k)).map(([k,v])=>'id:'+k+':'+v),...facts(r).filter(f=>f.productKey).map(f=>'pe:'+f.productKey)])];}
function mergeEntries(input,{existingItems=[]}={}){
 const rows=input.filter(r=>application(r)&&!r.attachmentOf),groups=[],index=new Map(),fileOwners=new Map();
 const add=(key,g)=>{if(!index.has(key))index.set(key,new Set());index.get(key).add(g);};
 const indexGroup=(g,r)=>{for(const t of tokens(r))add(t+'|'+Model.pathKey(rootOf(r)),g);for(const f of Model.members(r))fileOwners.set(Model.pathKey(f.path),g);};
 const owner=r=>existingItems.filter(i=>i.scanGrouping?.manual&&Model.members(i).some(f=>Model.members(r).some(v=>Model.pathKey(v.path)===Model.pathKey(f.path))));
 const blocked=(r,g)=>{const mine=owner(r),others=g.rows.flatMap(owner);return mine.length&&others.length&&mine.some(a=>others.some(b=>a.id!==b.id))||g.rows.some(other=>conflict(r,other));};
 // Resolve concrete company/edition identities before anonymous launchers; no wildcard bridges.
 const specificity=r=>facts(r).reduce((n,f)=>Math.max(n,Number(Boolean(f.companyKey))+Number(Boolean(f.versionKey))),0);
 rows.sort((a,b)=>Model.pathKey(rootOf(a)).length-Model.pathKey(rootOf(b)).length||specificity(b)-specificity(a)||Model.pathKey(a.localPath).localeCompare(Model.pathKey(b.localPath)));
 for(const row of rows){
  const candidates=new Set();for(const f of Model.members(row)){const g=fileOwners.get(Model.pathKey(f.path));if(g?.active)candidates.add(g);}
  for(const t of tokens(row)){let ancestor=rootOf(row);for(let level=0;level<=6;level++){for(const g of index.get(t+'|'+Model.pathKey(ancestor))||[])if(g.active)candidates.add(g);const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}}
  const valid=[...candidates].filter(g=>!blocked(row,g)&&!(row.boundary?.kind==='resource_package'&&g.rows.some(r=>Model.pathKey(rootOf(r))!==Model.pathKey(rootOf(row)))));
  const compatible=valid.every((a,i)=>valid.slice(i+1).every(b=>a.rows.every(x=>b.rows.every(y=>!conflict(x,y)))));
  let group=compatible&&valid.length?valid[0]:null;if(!group){group={rows:[],active:true};groups.push(group);}
  if(compatible)for(const extra of valid.slice(1)){group.rows.push(...extra.rows);extra.active=false;for(const r of extra.rows)indexGroup(group,r);}
  group.rows.push(row);indexGroup(group,row);
 }
 const out=[];
 for(const g of groups.filter(g=>g.active)){
  const members=g.rows,entries=[...new Map(members.flatMap(facts).map(e=>[Model.pathKey(e.path),e])).values()];
  const root=members.map(rootOf).sort((a,b)=>a.length-b.length)[0],files=members.reduce((all,r)=>Model.mergeFiles(all,Model.members(r)),[]);
  const prior=existingItems.filter(i=>Model.members(i).some(f=>files.some(v=>Model.pathKey(v.path)===Model.pathKey(f.path))));
  const explicit=prior.find(i=>i.scanInfo?.userOverrides?.localPath&&files.some(f=>Model.pathKey(f.path)===Model.pathKey(i.localPath)));
  const ranked=[...entries].sort((a,b)=>({primary:0,launcher:1,tool:2}[a.role]-{primary:0,launcher:1,tool:2}[b.role])||Identity.variant(a.path)-Identity.variant(b.path)||a.path.split(/[\\/]/).length-b.path.split(/[\\/]/).length||Model.natural(a.path,b.path));
  const packageRow=members.find(r=>r.boundary?.kind==='resource_package'&&entries.some(e=>e.path===r.localPath&&e.role!=='tool'));
  const chosen=explicit?.localPath||packageRow?.localPath||ranked[0]?.path||members[0].localPath;
  const main=members.find(r=>Model.pathKey(r.localPath)===Model.pathKey(chosen))||members[0],target={...main,localFiles:files,localPath:chosen};
  const info=structuredClone(main.scanInfo||{userOverrides:{}}),best=ranked.find(e=>e.productKey)||ranked[0];
  const productKey=best?.productKey||'',companyKey=best?.companyKey||'',versionKey=ranked.find(e=>e.role==='primary'&&e.versionKey)?.versionKey||'';
  const installation={schema:1,root,id:hash(Model.pathKey(root)+'|'+(productKey||tokens(main).join('|')||Model.pathKey(chosen))+'|'+companyKey+'|'+versionKey),productKey,companyKey,versionKey,confidence:productKey||main.boundary?.kind==='resource_package'?.94:.6};
  info.entries=entries;info.installation=installation;info.userOverrides={...info.userOverrides};
  if(members.length>1){
   target.id=installation.id;target.boundary={kind:'application_installation',root,confidence:.94,ownedPaths:files.map(f=>f.path)};
   target.evidence=[...members.flatMap(r=>r.evidence||[]),{rule:'installation-product-entries',source:root,detail:'同安装范围内产品证据一致，合并启动入口；未按名称或目录名合并'}];
   target.warnings=[...new Set(members.flatMap(r=>r.warnings||[]))];
   const classified=members.find(r=>['game','software'].includes(r.classification?.type));if(classified){target.classification=classified.classification;target.type=classified.type;}
   if(best?.productKey&&(!target.naming||target.naming.source==='original-path')){target.name=best.metadata.productName;target.naming={...target.naming,displayTitle:target.name,source:'pe-product',confidence:.9};}
   info.identity=target.id;info.boundary=target.boundary;info.evidence=target.evidence;
  }
  for(const old of prior)for(const k of ['name','type','localPath'])if(old.scanInfo?.userOverrides?.[k]&&!info.userOverrides[k])info.userOverrides[k]=old.scanInfo.userOverrides[k];
  info.automatic={...info.automatic};for(const k of ['name','type','localPath'])if(!Object.hasOwn(info.userOverrides,k)||!Object.hasOwn(info.automatic,k))info.automatic[k]=target[k];for(const k of ['name','type','localPath'])if(info.userOverrides[k])target[k]=info.userOverrides[k];
  if(target.classification)target.reviewRequired=target.classification.type.startsWith('unknown')||target.classification.conflicts?.length>0||(target.naming?.confidence||0)<.7;
  info.classification=target.classification;info.naming=target.naming;target.scanInfo=info;if(!target.id)target.id=installation.id;out.push(target);
 }
 const order=new Map();input.forEach((r,i)=>Model.members(r).forEach(f=>{if(!order.has(Model.pathKey(f.path)))order.set(Model.pathKey(f.path),i);}));
 const rank=r=>Math.min(...Model.members(r).map(f=>order.get(Model.pathKey(f.path))??Infinity));
 return require('./scan-manual-groups').partition([...out,...input.filter(r=>!application(r)||r.attachmentOf)],existingItems).sort((a,b)=>rank(a)-rank(b));
}
module.exports={mergeEntries,facts,rootOf,conflict};
