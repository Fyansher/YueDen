/* Generic package evidence: no product-title or numbered-game rules. */
const path=require('node:path');
const Identity=require('./application-identity'),role=Identity.role;
function evidence(dir,rows,programs){
 const valid=programs.filter(p=>p.metadata.validPe),primary=valid.filter(p=>role(p.file,p.metadata)!=='tool');if(primary.length!==1||valid.length<2)return null;
 const main=primary[0];if(valid.some(p=>p!==main&&p.metadata.companyName&&main.metadata.companyName&&p.metadata.companyName!==main.metadata.companyName))return null;const stem=path.basename(main.file,'.exe'),names=new Set(rows.filter(r=>r.kind==='file').map(r=>r.name.toLowerCase()));
 const paired=names.has(stem.toLowerCase()+'.dat')&&names.has(stem.toLowerCase()+'.cfg');
 const sharedRuntime=rows.some(r=>r.kind==='file'&&/\.(dll|so)$/i.test(r.name));
 const payload=rows.some(r=>r.kind==='directory'&&/^(?:data|assets|resources|content)$/i.test(r.name)||r.kind==='file'&&/\.(pak|pck|dat|arc|xp3|bin|wad|rpa)$/i.test(r.name));
 const sharedPackage=valid.every(p=>p===main||role(p.file,p.metadata)==='tool')&&sharedRuntime&&payload;
 const family=stem.replace(/(?:boot|launcher|login)$/i,'');
 const controller=family.length>=3&&role(main.file)==='launcher'&&valid.some(p=>role(p.file)==='tool'&&path.basename(p.file).toLowerCase().startsWith(family.toLowerCase()))&&rows.some(r=>r.kind==='directory')&&rows.some(r=>r.kind==='file'&&/\.(xml|ini|json)$/i.test(r.name));
 return paired||controller||sharedPackage?{main,controller,rule:'entry-family-payload',source:dir,detail:sharedPackage?'单一主程序、辅助工具、共享运行库与资源数据共同确定安装边界':paired?'单一主程序、同名数据和配置、辅助工具共同确定安装边界':'同族启动器与修复工具、配置和目录结构共同确定安装边界'}:null;
}
async function helpers(dir,rows,options,depth=0){
 const {summary,product,familyKey='',products=[],knownEntries=[]}=options,programs=[];programs.foreignPaths=[];if(depth>=6){programs.foreignPaths=rows.filter(r=>r.kind==='directory').map(r=>path.join(dir,r.name));return programs;}
 for(const row of rows.filter(r=>r.kind==='directory'&&!/^(?:.*_Data|Engine|MonoBleedingEdge|data|assets|content|resources|download|update_pack|\.git|node_modules)$/i.test(r.name))){
  const child=path.join(dir,row.name);let entries;try{entries=await summary(child);}catch(e){if(e.name==='AbortError')throw e;programs.foreignPaths.push(child);continue;}
  const found=[];for(const e of entries.filter(e=>e.kind==='file'&&/\.exe$/i.test(e.name))){const file=path.join(child,e.name),metadata=await product(file);found.push({file,metadata});}
  const nestedInstall=entries.some(e=>e.kind==='directory'&&e.name.toLowerCase()==='.egstore')||found.some(p=>role(p.file,p.metadata)==='primary'&&entries.some(e=>e.kind==='directory'&&e.name.toLowerCase()===path.basename(p.file,'.exe').toLowerCase()+'_data'));
  if(nestedInstall&&!require('./scan-boundaries').binaryFolder(row)){programs.foreignPaths.push(child);continue;}
  const accepted=found.filter(p=>!options.independent?.(p)&&(knownEntries.includes(p.file)||role(p.file,p.metadata)!=='primary'||products.includes(Identity.product(p.metadata.productName))||familyKey&&path.basename(p.file).toLowerCase().startsWith(familyKey.toLowerCase())));
  if(found.length&&!accepted.length){programs.foreignPaths.push(child);continue;}
  programs.push(...accepted);programs.foreignPaths.push(...found.filter(p=>!accepted.includes(p)).map(p=>p.file));
  programs.foreignPaths.push(...entries.filter(e=>e.kind==='file'&&/\.(epub|mobi|azw3|cbz)$/i.test(e.name)).map(e=>path.join(child,e.name)));
  const nested=await helpers(child,entries,options,depth+1);programs.push(...nested);programs.foreignPaths.push(...nested.foreignPaths);
 }return programs;
}
module.exports={role,evidence,helpers};
