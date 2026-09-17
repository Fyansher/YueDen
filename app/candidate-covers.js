/* Same validated local image cache for search thumbnails and selected entries.
   Small bounded queue, cancellation per search, no base64 travelling into UI. */
function createCandidateCovers({request,compact,concurrency=4,lookup=()=>'',remember=()=>{},exists=()=>true,forget=()=>{}}) {
  const cache=new Map(),failed=new Map(),pending=new Map(),controllers=new Map(),retired=new Set(),queue=[];let active=0;
  const pump=()=>{while(active<concurrency&&queue.length){const job=queue.shift();active++;Promise.resolve().then(job.work).then(job.resolve,()=>job.resolve('')).finally(()=>{active--;pump();});}};
  const enqueue=work=>new Promise(resolve=>{queue.push({work,resolve});pump();});
  function cancel(owner,id) {
    const prefix=String(owner)+':';
    for(const [key,controller]of controllers)if(id?key===prefix+id:key.startsWith(prefix)){controller.abort();controllers.delete(key);retired.add(key);}
    if(id)retired.add(prefix+id);while(retired.size>500)retired.delete(retired.values().next().value);
  }
  async function resolve(values,{owner='preview',id='default'}={}) {
    const key=owner+':'+id;if(retired.has(key))return '';
    if(!controllers.has(key))controllers.set(key,new AbortController());const signal=controllers.get(key).signal;
    const urls=[...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==='string'&&v.length<6000&&/^(https:\/\/|um-cover:\/\/image\/)/i.test(v)))].slice(0,8);
    for(const url of urls){const saved=lookup(url);if(saved&&exists(saved))cache.set(url,saved);if(cache.has(url)&&!exists(cache.get(url)))cache.delete(url);}
    // Only the preferred direction may short-circuit. A cached portrait must not
    // win over a valid landscape URL that has not been downloaded yet.
    const preferred=urls[0];if(preferred&&(cache.has(preferred)||preferred.startsWith('um-cover:')&&exists(preferred)))return cache.get(preferred)||preferred;
    const taskKey=key+'|'+urls.join('|');if(pending.has(taskKey))return pending.get(taskKey);
    const task=enqueue(async()=>{
      for(const url of urls){if(signal.aborted)return '';if(cache.has(url))return cache.get(url);if(url.startsWith('um-cover:')){if(exists(url))return url;continue;}
        if(Date.now()-(failed.get(url)||0)<30000)continue;let data;try{data=await request(url,4500,signal);}catch{data=null;}if(signal.aborted)return '';if(!data){failed.set(url,Date.now());while(failed.size>1500)failed.delete(failed.keys().next().value);continue;}failed.delete(url);
        const ref=compact(data);if(!/^um-cover:/.test(ref||''))continue;cache.set(url,ref);remember(url,ref);while(cache.size>1500)cache.delete(cache.keys().next().value);return ref;
      }return '';
    });pending.set(taskKey,task);try{return await task;}finally{pending.delete(taskKey);}
  }
  return {resolve,cancel,forget:url=>{cache.delete(url);failed.delete(url);forget(url);},cached:url=>{const ref=cache.get(url)||lookup(url);return ref&&exists(ref)?ref:'';}};
}
module.exports={createCandidateCovers};
