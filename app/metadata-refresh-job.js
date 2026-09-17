const Runtime=require('./metadata-runtime');
function create({refresh,timeoutMs=30000}){const jobs=new Map();return {
 cancel(owner,id){const job=jobs.get(owner);if(job?.jobId===id){job.status='cancelled';Runtime.cancel('refresh:'+owner,id);jobs.delete(owner);} },
 async run(owner,jobId,item){if(typeof jobId!=='string'||!jobId||jobId.length>100)throw Error('无效刷新任务');if(jobs.has(owner))return {status:'busy',item};const job={jobId,status:'loading',currentItem:item.id};jobs.set(owner,job);
 try{return await Runtime.run('refresh:'+owner,jobId,()=>Runtime.withDiagnostics(async issues=>{const next=await refresh(item);Runtime.check();const issue=issues[0];return {jobId,item:next,status:JSON.stringify(next)===JSON.stringify(item)?(issue?({quota:'rate-limited',parse:'parse-error',timeout:'timeout',server:'upstream-failure',upstream:'upstream-failure'}[issue.kind]||'http-error'):'empty'):'success',issues};}),false,false,timeoutMs)}catch(error){if(error.name==='AbortError'||error.name==='TimeoutError')return {jobId,item,status:error.name==='AbortError'?'cancelled':'timeout'};throw error}finally{if(jobs.get(owner)===job)jobs.delete(owner)}
 }
}}module.exports={create};
