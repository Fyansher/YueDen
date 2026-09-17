const fs=require('node:fs/promises'),{AsyncLocalStorage}=require('node:async_hooks');
class ScanCache{
 constructor(){this.values=new Map();this.weight=0;}
 get(key){return this.values.get(key)?.value;}
 set(key,value){this.weight-=this.values.get(key)?.weight||0;const weight=Array.isArray(value)?value.length:1;this.values.delete(key);if(weight<=20000){this.values.set(key,{value,weight});this.weight+=weight;}while(this.values.size>1000||this.weight>20000){const first=this.values.keys().next().value;this.weight-=this.values.get(first).weight;this.values.delete(first);}return value;}
}
const sharedCache=new ScanCache();
function context(options={}){
 // Discovery quotas schedule cooperative batches. Content limits protect each resource, not the whole library.
 const budget={maxFiles:50000,maxDirectories:4000,maxDepth:18,maxBytes:16*1024*1024,maxArchives:32,maxMs:20000,maxEntriesPerDirectory:100000,...options.budget};
 const metrics={files:0,directories:0,bytes:0,archives:0,cacheHits:0,readdir:0,batches:1},started=Date.now(),cache=options.cache||sharedCache,warnings=[],skipped=[],scope=new AsyncLocalStorage();
 let slice={files:0,directories:0,archives:0,started:Date.now()},operations=0;
 const check=()=>{if(options.signal?.aborted)throw Object.assign(Error('已停止扫描'),{name:'AbortError'});};
 const skip=(file,reasonCode,reason,extra={})=>{if(skipped.length<10000)skipped.push({path:file,reasonCode,reason,...extra});};
 async function checkpoint(){
  check();if(budget.maxDirectories<=0||budget.maxFiles<=0||budget.maxMs<=0)throw Object.assign(Error('扫描预算配置必须大于零'),{code:'SCAN_BUDGET'});
  if(slice.files>=budget.maxFiles||slice.directories>=budget.maxDirectories||slice.archives>=budget.maxArchives||Date.now()-slice.started>=budget.maxMs){
   metrics.batches++;slice={files:0,directories:0,archives:0,started:Date.now()};options.onProgress?.({checked:metrics.files,phase:'分批继续扫描 · 第 '+metrics.batches+' 批',bytes:metrics.bytes});await new Promise(resolve=>setImmediate(resolve));check();
  }else if(++operations%128===0){await new Promise(resolve=>setImmediate(resolve));check();}
 }
 const remainingBytes=()=>Math.max(0,budget.maxBytes-(scope.getStore()?.bytes||0));
 function charge(bytes){
  check();if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('无效读取长度');
  if(bytes>remainingBytes()){const message='单个资源的元数据超过安全读取上限，已保留该资源并继续其他资源';if(!warnings.includes(message))warnings.push(message);throw Object.assign(Error(message),{code:'SCAN_CONTENT_BUDGET'});}
  const current=scope.getStore();if(current)current.bytes+=bytes;metrics.bytes+=bytes;
 }
 async function summary(dir){
  await checkpoint();metrics.directories++;slice.directories++;
  const stat=await fs.stat(dir),key='dir|'+dir+'|'+stat.mtimeMs;let rows=cache.get(key);
  if(rows){metrics.cacheHits++;const n=rows.filter(r=>r.kind==='file').length;metrics.files+=n;slice.files+=n;await checkpoint();return rows;}
  rows=[];const handle=await fs.opendir(dir);
  for await(const r of handle){await checkpoint();if(rows.length>=budget.maxEntriesPerDirectory){skip(dir,'directory-entry-limit','单个目录条目数量异常，未完整枚举');throw Object.assign(Error('单个目录条目超过安全上限：'+dir),{code:'SCAN_DIRECTORY_LIMIT'});}if(r.isFile()){metrics.files++;slice.files++;}rows.push({name:r.name,kind:r.isSymbolicLink()?'link':r.isDirectory()?'directory':r.isFile()?'file':'other'});}
  metrics.readdir++;return cache.set(key,rows.sort((a,b)=>a.name.localeCompare(b.name,'zh',{numeric:true})));
 }
 async function read(file,limit=65536,offset=0){check();const handle=await fs.open(file,'r');try{const stat=await handle.stat(),length=Math.max(0,Math.min(limit,stat.size-offset));charge(length);const buffer=Buffer.alloc(length),{bytesRead}=await handle.read(buffer,0,length,offset);return buffer.subarray(0,bytesRead);}finally{await handle.close();}}
 async function cached(file,kind,load){await checkpoint();const stat=await fs.stat(file),key=kind+'|'+file+'|'+stat.size+'|'+stat.mtimeMs,found=cache.get(key);if(found){metrics.cacheHits++;return structuredClone(found);}const result=await scope.run({bytes:0,file},()=>load(stat));cache.set(key,result);return structuredClone(result);}
 async function archive(){if(budget.maxArchives<=0)throw Error('归档检查已禁用');await checkpoint();slice.archives++;metrics.archives++;}
 return {budget,metrics,cache,warnings,skipped,check,checkpoint,skip,summary,read,charge,cached,archive,remainingBytes,options,started};
}
module.exports={context,ScanCache};
