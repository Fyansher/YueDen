/* Structural evidence only. Scripts are bounded text reads, never evaluated. */
const path=require('node:path');
const binaryFolder=r=>r.kind==='directory'&&/^(?:bin(?:aries|_pc)?|exe(?:32|64)|win(?:32|64)|x64|x86)$/i.test(r.name);
const auxiliary=p=>require('./application-identity').role(p.file,p.metadata)==='tool';
const payloadFolder=r=>r.kind==='directory'&&/(?:_Data$|^Engine$|^MonoBleedingEdge$|^assets$|^content$|^resources$|^data$|^bin_pc$|^\\.egstore$|^mods$)/i.test(r.name);
const within=(root,target)=>{const rel=path.relative(root,target);return rel!==''&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
async function inspect(dir,rows,{ctx,summary,product}){
 const references=[],evidence=[],programs=[];
 for(const row of rows.filter(r=>r.kind==='file'&&/\.(cmd|bat)$/i.test(r.name)).slice(0,8)){
  const file=path.join(dir,row.name);let text;try{text=(await ctx.read(file,16384)).toString('utf8');}catch(e){if(e.code==='SCAN_BUDGET'||e.name==='AbortError')throw e;continue;}
  let cwd=dir;
  for(const line of text.split(/\r?\n/)){
   const cd=line.match(/^\s*(?:cd|pushd)\s+(?:\/d\s+)?["']?%~dp0([^"'\r\n]*)/i);
   if(cd){const target=path.resolve(dir,cd[1].trim().replace(/\\/g,path.sep));if(target===dir||within(dir,target))cwd=target;}
   // Require an actual launch statement; do not infer names from comments/echo.
   if(!/^\s*(?:start\s+|call\s+|["']?(?:%~dp0)?[^\s"']+\.exe)/i.test(line)||/^\s*(?:rem|echo|::)/i.test(line))continue;
   for(const match of line.matchAll(/(?:"([^"]+\.exe)"|\b([\w.\\/-]+\.exe)\b)/gi)){
    const ref=(match[1]||match[2]).replace(/^%~dp0/i,dir+path.sep);if(/[%!&|<>]/.test(ref))continue;
    const target=path.resolve(cwd,ref.replace(/\\/g,path.sep));if(within(dir,target))references.push({file:target,source:file});
   }
  }
 }
 async function binaries(folder,depth=0){let entries;try{entries=await summary(folder);}catch(e){if(e.code==='SCAN_BUDGET'||e.name==='AbortError')throw e;ctx.skip(folder,'permission-or-missing',e.message);return;}
  for(const entry of entries.filter(r=>r.kind==='file'&&/\.exe$/i.test(r.name))){const file=path.join(folder,entry.name);programs.push({file,metadata:await product(file)});}
  if(depth<2)for(const child of entries.filter(binaryFolder))await binaries(path.join(folder,child.name),depth+1);
 }
 for(const row of rows.filter(binaryFolder))await binaries(path.join(dir,row.name));
 const launch=references.find(ref=>programs.some(p=>p.file.toLowerCase()===ref.file.toLowerCase()&&p.metadata.validPe));
 const payload=rows.some(r=>r.kind==='directory'&&/^(?:bin_pc|data|assets|resources|content)$/i.test(r.name));
 if(launch&&payload)evidence.push({rule:'static-launch-reference',source:launch.source,detail:'只读启动引用指向有效程序入口，并有独立配套数据目录'});
 return {programs,references,evidence,launch:launch?.file,cohesive:Boolean(launch&&payload)};
}
async function pairedPayload(dir,rows,programs,ctx){
 for(const p of programs.filter(p=>p.metadata.validPe)){
  const pair=rows.find(r=>r.kind==='file'&&r.name.toLowerCase()===path.basename(p.file,'.exe').toLowerCase()+'.pck');if(!pair)continue;
  const file=path.join(dir,pair.name);try{if((await ctx.read(file,16)).toString('ascii',0,4)==='GDPC')return {rule:'paired-product-payload',source:file,detail:'有效 PE 入口与同名、有效格式的产品数据包'};}catch(e){if(e.code==='SCAN_BUDGET'||e.name==='AbortError')throw e;}
 }return null;
}
async function foreignChild(dir,rows,summary,programs){
 // Light summaries, shared with discovery; never recursively read all payload files.
 for(const row of rows.filter(r=>r.kind==='directory'&&!binaryFolder(r)&&!payloadFolder(r))){
  const child=path.join(dir,row.name);let entries;try{entries=await summary(child);}catch(e){if(e.code==='SCAN_BUDGET'||e.name==='AbortError')throw e;return child;}
  if(entries.some(r=>r.kind==='file'&&/\.(epub|mobi|azw3|cbz|mp4|mkv|webm)$/i.test(r.name))&&!/^(?:assets|content|resources|data|bin_pc)$/i.test(row.name))return child;
  if(entries.some(r=>r.kind==='file'&&/\.exe$/i.test(r.name)&&!programs.some(p=>p.file===path.join(child,r.name))))return child;
 }return null;
}
module.exports={inspect,pairedPayload,foreignChild,binaryFolder,auxiliary,payloadFolder};
