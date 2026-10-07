/* Translate real response failures; never retain URLs, API keys or response bodies. */
const Runtime=require('./metadata-runtime');
function isVerificationPage(body){
 const raw=typeof body==='string'?body:JSON.stringify(body??'');
 if(/Checking your browser|Verifying your browser|DiamWall|Access Denied|<form[^>]+(?:name|id)=["']sec["'][\s\S]*?action=["']\/c["']|cf-chl-|Just a moment|点我继续浏览|请点击下方按钮继续浏览|机器人验证|访问异常/i.test(raw)||isAgeGate(raw))return true;
 if(/<(?:title|h1|h2)\b[^>]*>[^<]*(?:captcha|verify you are human|human verification|security check|please wait|请稍候|请稍后|正在检查浏览器|正在验证浏览器|登录|sign[ -]?in|log[ -]?in|age verification|年龄验证|年龄确认|年齢確認)[^<]*<\//i.test(raw))return true;
 if(/(?:captcha|recaptcha).{0,40}(?:required|challenge|verify|verification)|(?:verify|verification).{0,40}(?:human|browser|captcha|security check)|login required|authentication required|sign[ -]?in required|please (?:log|sign) in to (?:continue|view|access)|请先登录|登录后(?:继续|查看|访问|搜索|阅读)|年龄验证(?:后|是必要)|age verification required/i.test(raw))return true;
 const passwordForm=/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(raw);
 return passwordForm&&/(?:please\s+(?:log|sign)\s+in\s+to\s+(?:continue|view|access|search)|(?:login|authentication)\s+required|请先登录|登录后(?:继续|查看|访问|搜索|阅读)|需要登录(?:后|才能)|ログインしてください|ログインして続ける)/i.test(raw);
}
function classify(status,body='',host='') {
 const raw=typeof body==='string'?body:JSON.stringify(body);
 if(isVerificationPage(raw))return {kind:'verification',status,host,label:'需验证',message:isAgeGate(raw)?'来源要求在官方网站确认年龄或访问资格；请自行在浏览器完成验证。其他来源仍可继续使用。':'来源返回了浏览器验证或登录页面；请在内置网页完成处理后重试。'};
 if(/temporarily disabled|severe stability issues/i.test(raw))return {kind:'service',status,host,label:'服务停用',message:'来源官方暂时停用了接口；可选其他来源，服务恢复后再重试。'};
 if((host==='api.jikan.moe'&&status>=500)||/Jikan failed to connect/i.test(raw))return {kind:'upstream',status,host,label:'上游故障',message:'Jikan 无法连接 MyAnimeList（HTTP '+status+'）；这是来源上游故障，非 0 条结果。其他来源仍独立查询，可稍后重试。'};
 if(status===429)return {kind:'quota',status,host,label:/steampowered|steamcommunity/.test(host)?'请求过于频繁':'额度受限',message:/googleapis/.test(host)?'Google Books 请求额度不足；可在设置填写有可用额度的 API Key，或选用豆瓣 / Open Library。':'来源限制了请求频率，请稍后重试。'};
 if(status===401||status===403||/\bForbidden\b.{0,100}permission to access/is.test(raw))return {kind:'denied',status,host,label:'访问受限',message:'来源拒绝了当前访问（HTTP '+status+'）；可在浏览器确认访问权限，或选用其他来源。'};
 if(status>=500)return {kind:'server',status,host,label:'服务故障',message:'来源服务异常（HTTP '+status+'），请稍后重试。'};
 if(status===0)return {kind:'network',status,host,label:'连接失败',message:'无法连接来源，请检查系统网络或代理设置后重试。'};
 return {kind:'request',status,host,label:'请求失败',message:'来源返回请求错误（HTTP '+status+'）。'};
}
function transportFailure(error,url){Runtime.check();if(['TimeoutError','AbortError'].includes(error?.name)){const issue={kind:'timeout',status:0,host:new URL(url).hostname,label:'超时',message:'来源请求超时，已终止本次请求；可稍后重试。'};Runtime.recordFailure(issue);return issue;}return fail(0,'',url);}
function isAgeGate(body){return /<(?:title|h1)\b[^>]*>[^<]*(?:年齢認証|年齢確認|Age Verification|Age Confirmation|年龄确认|年龄验证|年齡確認)[^<]*<\//i.test(body);}
function fail(status,body,url){const issue=classify(status,body,new URL(url).hostname);Runtime.recordFailure(issue);return issue;}
async function readResponse(response,url,asText=false,onObserved){
 require('./steam-request-policy').observe(url,response);
 const responseUrl=(()=>{try{const value=new URL(response.url||url);return value.protocol==='https:'?value.href:url;}catch{return url;}})();
 const body=await response.text();
 const verificationHit=isVerificationPage(body),verificationReason=verificationHit?require('./metadata-book-diagnostics').verificationReason(body,''):'';try{onObserved?.({status:response.status,finalUrl:responseUrl,bodyLength:body.length,verificationHit,verificationReason});}catch{}
 // Keep the challenged request origin as the verification host. The browser
 // must reopen the original request, then its final redirect can be recorded
 // and reused by the same source session on retry.
 if(!response.ok){fail(response.status,body,verificationHit?url:responseUrl);return asText?'':null;}
 if(verificationHit){fail(response.status,body,url);return asText?'':null;}
 if(asText){if(/<title>Forbidden/i.test(body)){fail(response.status,body,responseUrl);return '';}return body;}
 try{const value=JSON.parse(body);if(value?.error||value?.errors){fail(value.error?.code||value.errors?.[0]?.status||response.status,value,responseUrl);return null;}return value;}catch{Runtime.recordFailure({kind:'parse',status:response.status,host:new URL(responseUrl).hostname,label:'解析失败',message:'来源返回了无法解析的数据'});return null;}
}
function summary(issues){const verification=issues.find(i=>i.kind==='verification'),first=verification||issues.find(i=>i.kind==='service')||issues[0];return first?{statusLabel:first.label,message:[...new Set(issues.map(i=>i.message))].join(' '),...(verification?{verificationRequired:true,verificationHost:verification.host}: {})}:{};}
module.exports={classify,fail,transportFailure,readResponse,summary,isVerificationPage};
