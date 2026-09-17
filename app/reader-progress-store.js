/* Single writer per process; never delete the previous valid record to replace it. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function createProgressStore(file,{io=fs.promises,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let tail=Promise.resolve();
 function read(){try{const value=JSON.parse(fs.readFileSync(file(),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('记录结构无效');return value;}catch(e){if(e.code==='ENOENT')return {};throw Error('阅读记录损坏，已停止覆盖：'+e.message);}}
 function save(id,value){
  if(typeof id!=='string'||!id||id.length>150||['__proto__','constructor','prototype'].includes(id))return Promise.reject(Error('条目标识无效'));
  const snapshot=structuredClone(value);
  const task=tail.then(async()=>{
   const data=read();if(snapshot.annotationSchema===1&&data[id]&&data[id].annotationSchema!==1){try{await io.copyFile(file(),file()+'.before-annotations-v1.json',fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}}data[id]={...data[id],...snapshot,lastOpenedAt:new Date().toISOString()};
   const json=JSON.stringify(data);if(json.length>8*1024*1024)throw Error('阅读记录超过安全限制');
   const target=file(),temp=target+'.'+crypto.randomUUID()+'.tmp';await io.mkdir(path.dirname(target),{recursive:true});
   const handle=await io.open(temp,'wx');try{await handle.writeFile(json,'utf8');await handle.sync();}finally{await handle.close();}
   for(let attempt=0;;attempt++){try{await io.rename(temp,target);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=7){e.message+='；原记录保留，待恢复记录：'+temp;throw e;}await wait(Math.min(500,40*2**attempt));}}
   return data[id];
  });tail=task.catch(()=>{});return task;
 }
 return {read,save,flush:()=>tail};
}
module.exports={createProgressStore};
