/* Portable LGPL decoder. Local inputs only; stdout streaming, no source writes. */
const path=require('node:path'),fs=require('node:fs'),{spawn,execFile}=require('node:child_process'),{Readable}=require('node:stream');
function createDecoder(root=path.join(__dirname,'codec','bin')){
 const processes=new Map(),cache=new Map();
 function stop(owner){for(const child of processes.get(owner)||[])child.kill();processes.delete(owner);}
 async function probe(file,owner){const stat=await fs.promises.stat(file),key=file+'|'+stat.size+'|'+stat.mtimeMs;if(cache.has(key))return cache.get(key);if(!fs.existsSync(path.join(root,'ffprobe.exe')))throw Error('兼容解码组件缺失，请重新解压完整程序包');
  const info=await new Promise((resolve,reject)=>{const child=execFile(path.join(root,'ffprobe.exe'),['-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=codec_name,codec_type,width,height:format=duration','-of','json',file],{windowsHide:true,timeout:15000,maxBuffer:1024*1024},(error,stdout)=>{processes.get(owner)?.delete(child);if(error)return reject(Error('无法读取视频编码；文件可能已损坏、受加密保护或已取消'));try{resolve(JSON.parse(stdout));}catch{reject(Error('无法读取视频编码'));}});if(!processes.has(owner))processes.set(owner,new Set());processes.get(owner).add(child);});
  if(!info.streams?.some(s=>s.codec_type==='video'))throw Error('文件没有可播放的视频轨道');const result={duration:Number(info.format?.duration)||0,videoCodec:info.streams.find(s=>s.codec_type==='video')?.codec_name,audioCodec:info.streams.find(s=>s.codec_type==='audio')?.codec_name};cache.set(key,result);while(cache.size>80)cache.delete(cache.keys().next().value);return result;
 }
 function response(file,start,owner,request){
  if(request.method==='HEAD')return new Response(null,{headers:{'Content-Type':'video/webm','Cache-Control':'no-store'}});
  stop(owner);const args=['-hide_banner','-loglevel','error','-nostdin','-readrate','1.5','-ss',String(Math.max(0,Number(start)||0)),'-protocol_whitelist','file,pipe','-i',file,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-vf','scale=w=min(1920\\,iw):h=-2','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-threads','2','-b:v','4000k','-g','60','-c:a','libopus','-b:a','128k','-avoid_negative_ts','make_zero','-f','webm','-cluster_time_limit','1000','-flush_packets','1','pipe:1'];
  const child=spawn(path.join(root,'ffmpeg.exe'),args,{windowsHide:true,stdio:['ignore','pipe','pipe']});processes.set(owner,new Set([child]));let errors='';child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-3000);});child.on('error',()=>child.stdout.destroy(Error('兼容解码器无法启动')));child.on('exit',code=>{processes.get(owner)?.delete(child);if(code&&code!==null)child.stdout.destroy(Error('视频无法解码，文件可能已损坏'));});
  const cancel=()=>child.kill();request.signal?.addEventListener('abort',cancel,{once:true});child.stdout.on('close',()=>{cancel();request.signal?.removeEventListener('abort',cancel);});
  return new Response(Readable.toWeb(child.stdout),{headers:{'Content-Type':'video/webm','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
 }
 return {probe,response,stop};
}
module.exports={createDecoder};
