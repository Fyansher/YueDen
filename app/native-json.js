/* Retry transport errors within the original timeout; never retry access denials. */
const Runtime=require('./metadata-runtime'),Network=require('./metadata-network');
async function nativeJson(fetch,url,timeoutMs,options={}){
 const Jikan=require('./jikan-policy'),blocked=Jikan.blocked(url);if(blocked){Network.fail(blocked,'',url);return null;}
 const deadline=Date.now()+timeoutMs;
 for(let attempt=0;attempt<2;attempt++){
  Runtime.check();if(options.signal?.aborted)throw Object.assign(Error('已取消获取'),{name:'AbortError'});
  const remaining=deadline-Date.now();if(remaining<100)break;
  try{
   const budget=attempt===0?Math.max(100,Math.floor(remaining*.7)):remaining;
   const response=await fetch(url,{method:options.method||'GET',body:options.body,headers:{Accept:'application/json',...options.headers},signal:Runtime.combine(AbortSignal.timeout(budget),Runtime.signal(),options.signal)});
   Jikan.observe(url,response.status);
   // A valid 403/504 is a provider response, not a broken transport. Preserve its cause.
   return await Network.readResponse(response,url);
  }catch(error){Runtime.check();if(options.signal?.aborted)throw error;if(attempt===0&&deadline-Date.now()>250)await Runtime.delay(120);}
 }
 Network.fail(0,'',url);return null;
}
module.exports={nativeJson};
