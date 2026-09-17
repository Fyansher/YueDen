const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
function installReaderOcr(ipcMain,owned){
 const jobs=new Map();
 ipcMain.handle('reader:ocrCancel',event=>{owned(event);jobs.get(event.sender.id)?.kill();return true;});
 ipcMain.handle('reader:ocr',async(event,url)=>{
  const win=owned(event),owner=event.sender.id;if(process.platform!=='win32')throw Error('本地 OCR 需要 Windows');
  if(typeof url!=='string'||url.length>12*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url))throw Error('无效或过大的页面图片');
  if(jobs.has(owner))throw Error('上一项文字识别尚未结束');
  const image=require('electron').nativeImage.createFromDataURL(url);if(image.isEmpty())throw Error('无法读取页面图片');
  const size=image.getSize();if(size.width>2500||size.height>2500)throw Error('识别图片边长超过2500像素');
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'um-reader-ocr-')),file=path.join(dir,'page.png');await fs.promises.writeFile(file,image.toPNG(),{flag:'wx'});
  let child,close;
  try{return await new Promise((resolve,reject)=>{let output='',errors='';child=cp.spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',fs.readFileSync(path.join(__dirname,'reader-ocr.ps1'),'utf8')],{windowsHide:true,stdio:['pipe','pipe','pipe']});jobs.set(owner,child);const timeout=setTimeout(()=>child.kill(),30000);close=()=>child.kill();win.once('closed',close);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',v=>{output+=v;if(output.length>1024*1024)child.kill();});child.stderr.on('data',v=>errors=(errors+v).slice(-5000));child.on('error',e=>{clearTimeout(timeout);reject(e);});child.on('exit',code=>{clearTimeout(timeout);if(code!==0)return reject(Error('本地 OCR 未完成：'+(errors.trim()||'已取消或超过30秒')));try{resolve(require('./reader-ocr-model').mergeOcrLanguages(JSON.parse(output.replace(/^\uFEFF/,''))));}catch{reject(Error('OCR 返回内容无效'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({file}));});}
  finally{jobs.delete(owner);if(close&&!win.isDestroyed())win.removeListener('closed',close);await fs.promises.unlink(file).catch(()=>{});await fs.promises.rmdir(dir).catch(()=>{});}
 });
}
module.exports={installReaderOcr};
