// XP3 signature: https://github.com/krkrz/krkrz/blob/master/base/XP3Archive.cpp
// Read only fixed header bytes; never extract archives or execute scripts.
const path=require('node:path'),AI=require('./application-identity');
async function detect(dir,rows,programs,ctx){
 const primary=programs.filter(p=>p.metadata.validPe&&AI.role(p.file,p.metadata)==='primary'&&!p.metadata.softwarePurpose);if(primary.length!==1)return null;
 if(!rows.some(r=>r.kind==='directory'&&r.name.toLowerCase()==='savedata')||!rows.some(r=>r.kind==='file'&&/^kr(?:movie|flash)\.dll$/i.test(r.name)))return null;
 for(const r of rows.filter(r=>r.kind==='file'&&/\.xp3$/i.test(r.name)).slice(0,4)){
  const file=path.join(dir,r.name);try{const header=await ctx.read(file,11);if(header.equals(Buffer.from([88,80,51,13,10,32,10,26,139,103,1])))return {main:primary[0],rule:'script-runtime-package',source:file,detail:'有效程序、XP3格式头、配套运行模块及存档目录共同支持游戏包'};}catch(e){if(e.name==='AbortError'||e.code==='SCAN_BUDGET')throw e;}
 }return null;
}
module.exports={detect};
