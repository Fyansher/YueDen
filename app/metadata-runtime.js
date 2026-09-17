/* Per-window cancellation and short-lived verified response cache. No disk cache,
   no account access, no sharing an abort controller between editor sessions. */
const {AsyncLocalStorage}=require('node:async_hooks');
let cacheRevision=0;
const context=new AsyncLocalStorage(),cache=new Map(),jobs=new Map(),backgroundPending=new Map();
function memo(key,work){check();key=cacheRevision+':'+key;const pending=context.getStore()?.pending||backgroundPending;if(pending.has(key))return pending.get(key);const promise=Promise.resolve().then(work);pending.set(key,promise);promise.finally(()=>{if(pending.get(key)===promise)pending.delete(key);}).catch(()=>{});return promise;}
function slots(fallback){return context.getStore()?.slots||fallback;}
function withDiagnostics(work){return context.run({...context.getStore(),issues:[]},()=>work(context.getStore().issues));}
function recordFailure(issue){const issues=context.getStore()?.issues;if(issues&&issues.length<20&&!issues.some(i=>i.kind===issue.kind&&i.host===issue.host))issues.push(issue);}
const aborted=()=>Object.assign(new Error('已取消获取'),{name:'AbortError'});
function signal(){return context.getStore()?.signal;}
function check(){const s=signal();if(s?.aborted)throw s.reason?.name==='TimeoutError'?s.reason:aborted();}
function delay(ms){check();const s=signal();return new Promise((resolve,reject)=>{const done=()=>{s?.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(done,Math.max(0,ms));const cancel=()=>{clearTimeout(timer);s?.removeEventListener('abort',cancel);reject(aborted());};s?.addEventListener('abort',cancel,{once:true});});}
function combine(...signals){const available=signals.filter(Boolean);if(AbortSignal.any)return AbortSignal.any(available);const controller=new AbortController();for(const s of available){if(s.aborted)controller.abort();else s.addEventListener('abort',()=>controller.abort(),{once:true});}return controller.signal;}
async function cached(key,work,{ttl=300000,accept=value=>value!==null&&value!==undefined&&value!==''}={}) {
  check();const revision=cacheRevision,previous=cache.get(key);
  if(!context.getStore()?.force&&previous&&previous.expires>Date.now())return structuredClone(previous.value);
  const value=await memo(key,work);check();
  if(revision===cacheRevision&&accept(value)){cache.set(key,{value:structuredClone(value),expires:Date.now()+ttl});while(cache.size>2500)cache.delete(cache.keys().next().value);}
  return value;
}
function cancel(owner,id){const key=owner+':'+id,job=jobs.get(key);if(job){job.abort();jobs.delete(key);}return true;}
function cancelOwner(owner){for(const key of jobs.keys())if(key.startsWith(owner+':')){jobs.get(key).abort();jobs.delete(key);}}
async function run(owner,id,work,force=false,parallel=false,timeoutMs=0){parallel?cancel(owner,id):cancelOwner(owner);const controller=new AbortController(),key=owner+':'+id;jobs.set(key,controller);try{const active=timeoutMs?combine(controller.signal,AbortSignal.timeout(timeoutMs)):controller.signal;return await context.run({signal:active,force,pending:new Map(),slots:new Map()},()=>new Promise((resolve,reject)=>{const stop=()=>reject(active.reason?.name==='TimeoutError'?active.reason:aborted());active.addEventListener('abort',stop,{once:true});Promise.resolve().then(()=>{check();return work(active)}).then(value=>{active.removeEventListener('abort',stop);if(!active.aborted)resolve(value);},error=>{active.removeEventListener('abort',stop);reject(error)});}));}finally{if(jobs.get(key)===controller)jobs.delete(key);}}
module.exports={signal,check,delay,combine,cached,memo,slots,run,cancel,cancelOwner,withDiagnostics,recordFailure,cacheSize:()=>Buffer.byteLength(JSON.stringify([...cache])),clearCache:()=>{cacheRevision++;cache.clear();backgroundPending.clear();}};
