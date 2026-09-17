/* Read-only bounded discovery and audio probing. Never executes scanned files. */
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{randomUUID}=require('node:crypto');
const Audio=require('./audio-model');
const extensions=/\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff|aif|wma|ape)$/i;
const probeCache=new Map();
async function probe(file,signal){
 const stat=await fs.stat(file),cacheKey=file+'|'+stat.size+'|'+stat.mtimeMs;if(probeCache.has(cacheKey))return probeCache.get(cacheKey);
 const info=await new Promise((resolve,reject)=>execFile(path.join(__dirname,'codec/bin/ffprobe.exe'),['-v','error','-protocol_whitelist','file,pipe','-probesize','1048576','-analyzeduration','2000000','-show_entries','format=duration:format_tags:stream=codec_type,codec_name,sample_rate,channels:stream_tags','-of','json',file],{windowsHide:true,timeout:8000,maxBuffer:512*1024,signal},(error,stdout)=>{if(error)return reject(Error(signal?.aborted?'已取消扫描':'音频信息无法读取'));try{resolve(JSON.parse(stdout));}catch{reject(Error('音频信息格式无效'));}}));
 const stream=info.streams?.find(s=>s.codec_type==='audio');if(!stream)throw Error('没有音轨');const tags=Object.fromEntries(Object.entries({...stream.tags,...info.format?.tags}).map(([k,v])=>[k.toLowerCase(),v]));const value={hasCover:info.streams?.some(s=>s.codec_type==='video'),tags,duration:Number(info.format?.duration)||0,codec:stream.codec_name,sampleRate:Number(stream.sample_rate)||0,channels:Number(stream.channels)||0};if(probeCache.size>5000)probeCache.clear();probeCache.set(cacheKey,value);return value;
}
async function scan(roots,{signal,onProgress=()=>{},onCandidate=()=>{},kind='music',coverStore}={}){
 const files=[],warnings=[],seen=new Set(),fileSeen=new Set();let dirs=0,visited=0;
 async function walk(target,depth){
  signal?.throwIfAborted();if(depth>12||visited>=30000||files.length>=5000||dirs>=3000){if(!warnings.includes('扫描范围较大，未检查的内容请分批导入'))warnings.push('扫描范围较大，未检查的内容请分批导入');return;}
  try{const stat=await fs.lstat(target);if(stat.isSymbolicLink())return;if(stat.isFile()){visited++;if(extensions.test(target)&&!fileSeen.has(target.toLowerCase())){fileSeen.add(target.toLowerCase());files.push({path:target,size:stat.size,mtimeMs:stat.mtimeMs});}return;}
   if(!stat.isDirectory())return;const real=await fs.realpath(target);if(seen.has(real.toLowerCase()))return;seen.add(real.toLowerCase());dirs++;
   const entries=await fs.readdir(target,{withFileTypes:true});
   // Application boundary remains detected even in audio mode. Nested game assets stay attached.
   if(entries.some(e=>e.isFile()&&/\.exe$/i.test(e.name))&&entries.some(e=>/(_Data$|^(?:Engine|Binaries|UnityPlayer\.dll|steam_api(?:64)?\.dll|resources\.pak)$)/i.test(e.name))){warnings.push('跳过应用包内附属音频：'+path.basename(target));return;}
   for(const entry of entries){if(!entry.isSymbolicLink()&&(entry.isDirectory()||entry.isFile()&&extensions.test(entry.name)))await walk(path.join(target,entry.name),depth+1);}
  }catch(error){if(signal?.aborted)throw error;warnings.push('无法访问：'+path.basename(target));}
 }
 for(const root of roots)await walk(root,0);const groups=new Map();let count=0;
 const infos=new Map();let cursor=0;await Promise.all(Array.from({length:Math.min(3,files.length)},async()=>{while(cursor<files.length){signal?.throwIfAborted();const file=files[cursor++];try{infos.set(file.path,await probe(file.path,signal));}catch(error){if(signal?.aborted)throw error;warnings.push(path.basename(file.path)+'：'+error.message);}onProgress({done:++count,total:files.length,name:path.basename(file.path)});}}));
 for(const file of files){signal?.throwIfAborted();const info=infos.get(file.path);if(!info)continue;
  const tags=info.tags,album=String(tags.album||''),artist=String(tags.album_artist||tags.albumartist||''),dir=path.dirname(file.path);
  // Without an embedded album tag each file is a separate candidate, never the entire root.
  const key=album?dir.replace(/[\\/](?:CD|Disc|Disk)\s*\d+$/i,'')+'\0'+album+'\0'+artist:kind==='asmr'?dir:file.path;
  if(!groups.has(key))groups.set(key,{id:randomUUID(),type:'audio',name:album||(kind==='asmr'?path.basename(dir):path.basename(file.path,path.extname(file.path))),status:'未听',localPath:file.path,localFiles:[],audio:{kind,collectionKind:kind==='asmr'?'work':album?'album':'single',artists:tags.artist?[String(tags.artist)]:[],albumArtists:artist?[artist]:[],tracks:[],sources:[]}});
  const work=groups.get(key),sid=randomUUID();if(info.hasCover)work._embeddedCover=file.path;work.localFiles.push({...file,name:path.basename(file.path)});work.audio.sources.push({id:sid,kind:'local',localPath:file.path});work.audio.tracks.push({id:randomUUID(),albumTitle:album,title:String(tags.title||path.basename(file.path,path.extname(file.path))),artists:tags.artist?[String(tags.artist)]:[],discNumber:parseInt(tags.disc)||1,trackNumber:parseInt(tags.track)||0,durationSeconds:info.duration,codec:info.codec,sampleRate:info.sampleRate,channels:info.channels,sourceRefs:[sid]});
 }
 for(const item of groups.values()){if(kind==='music'&&item.audio.tracks.length===1){item.audio.collectionKind='single';item.name=item.audio.tracks[0].title;}signal?.throwIfAborted();item.cover=await require('./audio-art').find(item._embeddedCover||item.localPath,coverStore,signal,Boolean(item._embeddedCover));delete item._embeddedCover;if(kind==='asmr'){item.audio.creators=item.audio.artists;item.audio.artists=[];item.audio.albumArtists=[];}item.audio.tracks.sort((a,b)=>a.discNumber-b.discNumber||a.trackNumber-b.trackNumber||a.title.localeCompare(b.title,'zh',{numeric:true}));onCandidate({...item,audio:Audio.normalize(item.audio)});}
 return {items:[...groups.values()].map(item=>{item.audio.tracks.sort((a,b)=>a.discNumber-b.discNumber||a.trackNumber-b.trackNumber||a.title.localeCompare(b.title,'zh',{numeric:true}));return {...item,audio:Audio.normalize(item.audio)};}),warnings};
}
module.exports={scan,probe,extensions};
