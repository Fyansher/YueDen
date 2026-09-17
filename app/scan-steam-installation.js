const path=require('node:path');
async function installed(dir,rows,ctx,summary){
 const common=path.dirname(dir);if(path.basename(common).toLowerCase()!=='common')return null;
 const steamapps=path.dirname(common);if(path.basename(steamapps).toLowerCase()!=='steamapps')return null;
 ctx.steamRecords??=new Map();
 if(!ctx.steamRecords.has(steamapps)){
  const records=new Map();ctx.steamRecords.set(steamapps,records);
  let files;try{files=await summary(steamapps);}catch(e){if(e.name==='AbortError')throw e;return null;}
  for(const row of files.filter(r=>r.kind==='file'&&/^appmanifest_\d+\.acf$/i.test(r.name))){
   ctx.check();try{const source=path.join(steamapps,row.name),text=(await ctx.read(source,65536)).toString('utf8');
    const field=k=>text.match(new RegExp('"'+k+'"\\s*"([^"\\r\\n]*)"','i'))?.[1]||'';
    const appid=field('appid'),folder=field('installdir');if(!/^\d+$/.test(appid)||row.name.toLowerCase()!=='appmanifest_'+appid+'.acf'||!folder||path.basename(folder)!==folder)continue;
    records.set(folder.toLowerCase(),{title:field('name'),identifiers:{steam:appid},type:'game',source});
   }catch(e){if(e.name==='AbortError')throw e;}
  }
 }
 return ctx.steamRecords.get(steamapps).get(path.basename(dir).toLowerCase())||null;
}
module.exports={installed};
