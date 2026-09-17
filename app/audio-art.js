const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process');
async function find(file,store,signal,embedded=true){if(!store)return '';const dir=path.dirname(file);for(const name of ['cover.jpg','cover.png','folder.jpg','folder.png','front.jpg']){try{const p=path.join(dir,name),s=await fs.stat(p);if(s.isFile()&&s.size<8*1024*1024)return store.saveBuffer(await fs.readFile(p));}catch{}}
 if(!embedded)return '';
 try{const buffer=await new Promise((resolve,reject)=>execFile(path.join(__dirname,'codec/bin/ffmpeg.exe'),['-v','error','-protocol_whitelist','file,pipe','-i',file,'-map','0:v:0','-frames:v','1','-vf','scale=800:800:force_original_aspect_ratio=decrease','-f','image2pipe','-c:v','mjpeg','pipe:1'],{encoding:'buffer',windowsHide:true,timeout:5000,maxBuffer:4*1024*1024,signal},(e,out)=>e?reject(e):resolve(out)));return store.saveBuffer(buffer);}catch{return '';}}
module.exports={find};
