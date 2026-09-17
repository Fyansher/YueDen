/* Directory-oriented import proposals, not assertions of product identity.
 * Never change classification merely because two executables share a directory.
 */
const path=require('node:path'),crypto=require('node:crypto'),Model=require('./local-model'),Identity=require('./application-identity');
const root=r=>r.boundary?.kind==='resource_package'?r.boundary.root:r.scanInfo?.installation?.root||path.dirname(r.localPath);
function group(rows,existing=[]){
 const buckets=new Map(),out=[];
 const anchored=r=>{const directory=Identity.key(path.basename(root(r))),stem=Identity.key(path.basename(r.localPath,'.exe')),product=Identity.product(r.metadata?.productName);return r.boundary?.kind==='resource_package'||[stem,product].some(k=>k.length>=3&&directory.startsWith(k));};
 const anchors=rows.filter(r=>!r.attachmentOf&&anchored(r)&&['game','unknown_application'].includes(r.classification?.type)&&Identity.role(r.localPath,r.metadata)!=='tool').map(root).sort((a,b)=>a.length-b.length);
 const contains=(a,b)=>Model.pathKey(a)===Model.pathKey(b)||Model.pathKey(b).startsWith(Model.pathKey(a)+'/');
 const known=rows.filter(r=>r.classification?.type==='game').map(root).sort((a,b)=>b.length-a.length);
 const proposalRoot=row=>row.classification?.type==='game'?root(row):known.find(a=>contains(a,root(row)))||anchors.find(a=>contains(a,root(row)))||root(row);
 const manual=r=>existing.filter(i=>(i.scanGrouping?.manual||i.identityDecisions?.some(d=>d.action==='separate'))&&Model.members(i).some(f=>Model.members(r).some(g=>Model.pathKey(f.path)===Model.pathKey(g.path))));
 for(const row of rows){
  if(row.attachmentOf||!['game','unknown_application'].includes(row.classification?.type)){out.push(row);continue;}
  const key=Model.pathKey(proposalRoot(row));if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);
 }
 for(const members of buckets.values()){
  // Existing deliberate partitions and distinct platform products must survive rescans.
  const ids=new Set(members.map(r=>r.identifiers?.steam||r.steamAppId).filter(Boolean));
  if(members.length===1){const row=members[0];out.push({...row,directoryProposal:true});continue;}
  if(ids.size>1||new Set(members.flatMap(manual).map(i=>i.id)).size>1){out.push(...members);continue;}
  const ranked=[...members].sort((a,b)=>Number(b.classification.type==='game')-Number(a.classification.type==='game')||Number(Identity.role(a.localPath,a.metadata)==='tool')-Number(Identity.role(b.localPath,b.metadata)==='tool')||root(a).length-root(b).length||Model.natural(a.localPath,b.localPath));
  const main=ranked[0],files=members.reduce((all,r)=>Model.mergeFiles(all,Model.members(r)),[]),directory=proposalRoot(main);
  const id=crypto.createHash('sha256').update(Model.pathKey(directory)+'|directory-preview').digest('hex').slice(0,20);
  const evidence=[...members.flatMap(r=>r.evidence||[]),{rule:'directory-import-proposal',source:directory,detail:'同目录程序合为一组供导入确认；这是目录归组，不证明所有程序属于同一作品。可展开核对或取消导入。'}];
  const info={...structuredClone(main.scanInfo||{}),identity:id,entries:members.flatMap(r=>r.scanInfo?.entries||[]),evidence};
  out.push({...main,id,localFiles:files,scanInfo:info,evidence,reviewRequired:true,directoryProposal:true,selected:main.classification.type==='game'||members.some(r=>r.scanInfo?.userOverrides?.type)?undefined:false,warnings:[...new Set(members.flatMap(r=>r.warnings||[]))]});
 }
 return out.sort((a,b)=>Model.natural(root(a),root(b))||Model.natural(a.localPath,b.localPath));
}
module.exports={group};
