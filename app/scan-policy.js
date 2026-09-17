/* Directory evidence first: never descend into workshop / wallpaper assets.
   Only tiny manifests are read; media files and games are never hashed or run. */
const fs=require('node:fs/promises'),path=require('node:path');
const auxiliary=/^(?:read[ _.-]?me|lisez[ _.-]?moi|license|licence|copying|copyright|changelog|change[ _.-]?log|release[ _.-]?notes|authors|contributors|credits|install|installation|requirements|dependencies|version)(?:[\s._（(\[\-]|$)/i;
const chineseAux=/^(?:使用说明|安装说明|更新日志|更新说明|免责声明|版权声明|运行说明|游戏说明|说明必读|必读|读我|解压密码|解压说明|下载说明|下载必读|资源说明|文件说明|获取更多资源|本站说明)(?:[\s._（(\[\-：:]|$)/;
const wallpaperPath=dir=>/(?:^|[\\/])workshop[\\/](?:content|downloads)[\\/]431960(?:[\\/]|$)/i.test(dir);
const auxiliaryFile=name=>/\.(txt|md|markdown|pdf|html?)$/i.test(name)&&(auxiliary.test(path.basename(name,path.extname(name)))||chineseAux.test(path.basename(name,path.extname(name))));
async function wallpaperDirectory(dir,rows){
 if(wallpaperPath(dir)||rows.some(r=>r.isFile()&&/^(?:wallpaper32|wallpaper64)\.exe$|^scene\.pkg$/i.test(r.name)))return true;
 if(!rows.some(r=>r.isFile()&&r.name.toLowerCase()==='project.json'))return false;
 let handle;try{handle=await fs.open(path.join(dir,'project.json'),'r');const buffer=Buffer.alloc(32768),{bytesRead}=await handle.read(buffer,0,buffer.length,0);const project=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));return ['scene','video','web'].includes(String(project.type).toLowerCase())&&typeof project.file==='string'&&Boolean(project.preview||project.general||project.workshopid);}catch{return false;}finally{await handle?.close();}
}
function imagePages(rows,hint){
 const images=rows.filter(r=>r.isFile()&&/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(r.name)&&!/(?:^|[-_. ])(?:cover|poster|preview|thumbnail|icon|wallpaper|screenshot|fanart)(?:[-_. ]|$)/i.test(r.name));
 // In a manga-specific root an unnumbered album is allowed, but never a lone wallpaper.
 return images.length>=2&&(hint==='manga'||images.filter(r=>/\d/.test(path.basename(r.name,path.extname(r.name)))).length>=2);
}
module.exports={auxiliaryFile,wallpaperDirectory,imagePages,wallpaperPath};
