const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
function createPathPicker({app,run=execFile}){
 const memory=require('./dialog-memory').create(()=>app.getPath('userData'));let lastPath=memory.get('resource')||app.getPath('documents');const pending=new Map();
 return {show(parent,initial=lastPath,multiple=false){
  const key=parent?.id||0;if(pending.has(key))return pending.get(key);
  const task=new Promise(resolve=>{
   const binary=path.join(__dirname,'native','ResourcePicker.exe');if(!fs.existsSync(binary)){resolve({ok:false,message:'Windows 文件选择组件缺失，请重新解压完整程序包'});return;}
   const handle=parent&&!parent.isDestroyed()?parent.getNativeWindowHandle():null,owner=handle?(handle.length>=8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE())):'0';
   const args=[owner,Buffer.from(initial||lastPath,'utf8').toString('base64'),...(multiple?['--multiple']:[])];
   let child;const cancel=()=>{child?.kill();resolve({canceled:true,paths:[]});};
   child=run(binary,args,{windowsHide:true,encoding:'utf8',maxBuffer:1024*1024},(error,stdout,stderr)=>{
    parent?.removeListener('closed',cancel);if(error){resolve({ok:false,message:'文件选择未完成：'+(stderr?.trim()||error.message)});return;}
    const paths=[...new Set(String(stdout||'').split(/\r?\n/).filter(Boolean).map(value=>Buffer.from(value,'base64').toString('utf8')).filter(value=>path.isAbsolute(value)&&fs.existsSync(value)))];
    if(!paths.length){resolve({canceled:true,paths:[]});return;}lastPath=fs.statSync(paths[0]).isDirectory()?paths[0]:path.dirname(paths[0]);memory.set('resource',paths[0]);resolve({ok:true,value:paths[0],paths:multiple?paths:paths.slice(0,1)});
   });parent?.once('closed',cancel);
  });pending.set(key,task);task.finally(()=>pending.delete(key));return task;
 }};
}
module.exports={createPathPicker};
