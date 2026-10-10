// One request lane across scans/editors; a denial is never retried through another transport.
const {AsyncResource}=require('node:async_hooks');
const Runtime=require('./metadata-runtime');
function create({runtime=Runtime,now=Date.now,spacing=1500,onDiagnostic=()=>{}}={}){
 let next=0,blockedUntil=0,status=0,active=false,sequence=0;const cache=new Map(),queue=[];
 const applies=url=>/(^|\.)(steampowered\.com|steamcommunity\.com)$/.test(new URL(url).hostname);
 const report=row=>{try{onDiagnostic(row);}catch{}};
 const priority=parsed=>/\/search\/(?:suggest|results)\/?$/i.test(parsed.pathname)?100:/\/api\/appdetails\/?$/i.test(parsed.pathname)?50:/\/IStoreBrowseService\/GetItems\/v1\/?$/i.test(parsed.pathname)?0:20;
 function observe(url,response){if(!applies(url)||![403,429].includes(response.status))return;status=response.status;const header=response.headers?.get?.('retry-after'),seconds=Number(header);const retry=header?(Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now()):0;blockedUntil=Math.max(blockedUntil,now()+Math.max(15*60*1000,Math.min(24*3600000,retry||0)));}
 async function execute(job){const {url,work,empty,parsed,diagnostic,queuedAt}=job;
  try{runtime.check();}catch(error){report({...diagnostic,phase:'steam.request.canceled',queueWaitMs:now()-queuedAt,errorName:error?.name||'Error'});throw error;}
  const cached=cache.get(url);if(cached&&cached.until>now()){report({...diagnostic,phase:'steam.request.complete',queueWaitMs:now()-queuedAt,requestDurationMs:0,cacheHit:true,resultPresent:true});return structuredClone(cached.value);}
  if(now()<blockedUntil){runtime.recordFailure({kind:status===429?'quota':'denied',status,host:parsed.hostname,label:'暂缓请求',message:'Steam 访问受限，已暂停自动请求；约 '+Math.ceil((blockedUntil-now())/60000)+' 分钟后可重试。403 不一定由频率导致。'});report({...diagnostic,phase:'steam.request.skipped',queueWaitMs:now()-queuedAt,status,cacheHit:false,resultPresent:false});return empty;}
  try{await runtime.delay(Math.max(0,next-now()));runtime.check();}catch(error){report({...diagnostic,phase:'steam.request.canceled',queueWaitMs:now()-queuedAt,errorName:error?.name||'Error'});throw error;}
  const started=now(),queueWaitMs=started-queuedAt;try{const value=await work();if(value!==null&&value!==undefined&&value!==''){cache.set(url,{value:structuredClone(value),until:now()+300000});while(cache.size>500)cache.delete(cache.keys().next().value);}report({...diagnostic,phase:'steam.request.complete',queueWaitMs,requestDurationMs:now()-started,cacheHit:false,resultPresent:value!==null&&value!==undefined&&value!==''});return value;}catch(error){report({...diagnostic,phase:'steam.request.failed',queueWaitMs,requestDurationMs:now()-started,errorName:error?.name||'Error',errorMessage:error?.message||''});throw error;}finally{next=Math.max(next,started+spacing);}
 }
 async function pump(){if(active)return;active=true;try{while(queue.length){queue.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);const job=queue.shift();try{const value=await job.resource.runInAsyncScope(()=>execute(job));job.resolve(value);}catch(error){job.reject(error);}finally{job.resource.emitDestroy();}}}finally{active=false;if(queue.length)void pump();}}
 function run(url,work,empty=null){if(!applies(url))return work();const queuedAt=now(),parsed=new URL(url),query=parsed.searchParams.get('term')||'',region=(parsed.searchParams.get('cc')||'').toLowerCase();const diagnostic={sourceId:'steam',mediaType:'game',operation:/\/search\//i.test(parsed.pathname)?'search':'request',phase:'steam.request',requestUrl:url,...(query?{queryLength:query.length}:{}),...(region?{region}:{})};return new Promise((resolve,reject)=>{queue.push({url,work,empty,parsed,diagnostic,queuedAt,priority:priority(parsed),sequence:sequence++,resource:new AsyncResource('YueDenSteamRequest'),resolve,reject});void pump();});}
 return {run,observe,applies};
}
module.exports={...create(),create};
