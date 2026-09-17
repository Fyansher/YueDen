// A verified distribution layout owns component trees, not adjacent game installs.
const path=require('node:path'),layouts=require('./scan-platform-layouts.json').layouts;
async function scopes(dir,rows,{summary,product}){
 async function exists(relative,kind){let current=dir,entries=rows;const parts=relative.split('/');for(let i=0;i<parts.length;i++){const row=entries.find(r=>r.name.toLowerCase()===parts[i].toLowerCase()&&r.kind===(i===parts.length-1?kind:'directory'));if(!row)return false;current=path.join(current,row.name);if(i<parts.length-1)entries=await summary(current);}return current;}
 const result=[];
 for(const layout of layouts){
  if(!rows.some(r=>r.kind==='directory'&&r.name.toLowerCase()===layout.entry.split('/')[0].toLowerCase()))continue;
  try{const entry=await exists(layout.entry,'file');if(!entry||!(await product(entry)).validPe)continue;
   let matched=true;for(const required of layout.directories)if(!await exists(required,'directory')){matched=false;break;}if(!matched)continue;
   for(const owned of layout.owned){const root=await exists(owned,'directory');if(root)result.push({root,entry,reason:'平台发行结构、有效入口及配套目录一致：'+layout.id,componentTree:true});}
  }catch(e){if(e.name==='AbortError')throw e;}
 }
 return result;
}
module.exports={scopes};
