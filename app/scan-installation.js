/* Read only the matching installed-product record. Never retain launcher tokens. */
const path=require('node:path');
async function installed(dir,rows,ctx,summary){
 const steam=await require('./scan-steam-installation').installed(dir,rows,ctx,summary);if(steam)return steam;
 if(!rows.some(r=>r.kind==='directory'&&r.name.toLowerCase()==='.egstore'))return null;
 const base=ctx.options.epicManifestDirectory||path.join(process.env.ProgramData||'C:/ProgramData','Epic/EpicGamesLauncher/Data/Manifests');
 let entries;try{entries=await summary(path.join(dir,'.egstore'));}catch(error){if(error.name==='AbortError'||error.code==='SCAN_BUDGET')throw error;return null;}
 for(const entry of entries.filter(r=>r.kind==='file'&&/^[a-f0-9]{32}\.mancpn$/i.test(r.name)).slice(0,8)){
  try{const file=path.join(base,entry.name.replace(/\.mancpn$/i,'.item')),v=JSON.parse((await ctx.read(file,65536)).toString('utf8'));
   if(path.resolve(v.InstallLocation||'').toLowerCase()!==path.resolve(dir).toLowerCase()||v.bIsIncompleteInstall)continue;
   const launch=path.resolve(dir,String(v.LaunchExecutable||'')),rel=path.relative(dir,launch);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))continue;
   const categories=Array.isArray(v.AppCategories)?v.AppCategories:[];
   return {title:String(v.DisplayName||''),launch,identifiers:{epic:String(v.CatalogItemId||v.AppName||'')},type:categories.includes('games')?'game':categories.includes('software')?'software':null,source:file};
  }catch(error){if(error.name==='AbortError'||error.code==='SCAN_BUDGET')throw error;}
 }return null;
}
module.exports={installed};
