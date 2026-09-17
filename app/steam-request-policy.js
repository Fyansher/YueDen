// One request lane across scans/editors; a denial is never retried through another transport.
const Runtime=require('./metadata-runtime');
function create({runtime=Runtime,now=Date.now,spacing=1500}={}){
 let tail=Promise.resolve(),next=0,blockedUntil=0,status=0;const cache=new Map();
 const applies=url=>/(^|\.)(steampowered\.com|steamcommunity\.com)$/.test(new URL(url).hostname);
 function observe(url,response){if(!applies(url)||![403,429].includes(response.status))return;status=response.status;const header=response.headers?.get?.('retry-after'),seconds=Number(header);const retry=header?(Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now()):0;blockedUntil=Math.max(blockedUntil,now()+Math.max(15*60*1000,Math.min(24*3600000,retry||0)));}
 function run(url,work,empty=null){if(!applies(url))return work();const task=tail.catch(()=>{}).then(async()=>{
  runtime.check();const cached=cache.get(url);if(cached&&cached.until>now())return structuredClone(cached.value);
  if(now()<blockedUntil){runtime.recordFailure({kind:status===429?'quota':'denied',status,host:new URL(url).hostname,label:'暂缓请求',message:'Steam 访问受限，已暂停自动请求；约 '+Math.ceil((blockedUntil-now())/60000)+' 分钟后可重试。403 不一定由频率导致。'});return empty;}
  await runtime.delay(Math.max(0,next-now()));runtime.check();const started=now();try{const value=await work();if(value!==null&&value!==undefined&&value!==''){cache.set(url,{value:structuredClone(value),until:now()+300000});while(cache.size>500)cache.delete(cache.keys().next().value);}return value;}finally{next=Math.max(next,started+spacing);}
 });tail=task.then(()=>{},()=>{});return task;}
 return {run,observe,applies};
}
module.exports={...create(),create};
