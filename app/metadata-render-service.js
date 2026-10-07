function create({readRenderedDom,sourceLocations,network,runtime,fetchText}){
 return async function renderHtml(sourceId,url,timeout,diagnosticContext){
  const started=Date.now(),effectiveTimeout=Math.max(100,Number(timeout)||8500),bookSource=['onelib','zlibrary'].includes(sourceId),browserTimeout=Math.max(500,Math.min(bookSource?7500:5000,effectiveTimeout-(bookSource?700:2000)));
  let result={html:'',finalUrl:url},renderError=null;
  try{result=await readRenderedDom(url,{timeoutMs:browserTimeout,signal:runtime?.signal?.(),diagnosticContext});}
  catch(error){runtime?.check?.();renderError=error;}
  const finalUrl=result?.finalUrl||url,verificationHit=Boolean(result?.verificationHit||network.isVerificationPage(result?.html||''));
  let requestedHost='';try{requestedHost=new URL(url).hostname;}catch{}
  if(sourceId&&requestedHost&&finalUrl)sourceLocations.record(sourceId,requestedHost,finalUrl,verificationHit?{verified:false}:{});
  if(verificationHit){
   let host=requestedHost;try{host=new URL(finalUrl).hostname;}catch{}
   runtime.recordFailure({kind:'verification',status:0,host,label:'需验证',message:'来源返回了浏览器验证或登录页面；请在内置网页完成处理后重试。'});
   return {...result,html:String(result?.html||''),finalUrl,verificationHit:true};
  }
  if(!String(result?.html||'').trim()){
   const remaining=effectiveTimeout-(Date.now()-started);
   if(remaining>100){
    diagnosticContext?.log?.({phase:'render.http-fallback-start',requestUrl:url,remainingMs:remaining,renderErrorName:renderError?.name||'',renderErrorMessage:renderError?.message||''});
    const html=await fetchText(url,remaining,sourceId,diagnosticContext);
    diagnosticContext?.log?.({phase:'render.http-fallback-end',requestUrl:url,durationMs:Date.now()-started,resultLength:String(html||'').length});
    if(html){result={...result,html,finalUrl:result?.finalUrl||url,readMode:'same-session-http-fallback'};renderError=null;}
   }
   if(!String(result?.html||'').trim()&&renderError&&remaining<=100)network.transportFailure(renderError,url);
  }
  if(sourceId&&requestedHost&&result?.finalUrl)sourceLocations.record(sourceId,requestedHost,result.finalUrl);
  return result;
 };
}
module.exports={create};
