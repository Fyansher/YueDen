/* Translate real response failures; never retain URLs, API keys or response bodies. */
const Runtime=require('./metadata-runtime');
function classify(status,body='',host='') {
 const raw=typeof body==='string'?body:JSON.stringify(body);
 if(/Checking your browser|<form[^>]+(?:name|id)=["']sec["'][\s\S]*?action=["']\/c["']/i.test(raw))return {kind:'verification',status,host,label:'需验证',message:'来源返回浏览器验证页，未取得详情；不会将验证页当作简介或空结果。'};
 if(isAgeGate(raw))return {kind:'verification',status,host,label:'需验证',message:'来源要求在官方网站确认年龄或访问资格；请自行在浏览器完成验证。其他分区的结果仍可使用。'};
 if(/temporarily disabled|severe stability issues/i.test(raw))return {kind:'service',status,host,label:'服务停用',message:'来源官方暂时停用了接口；可选其他来源，服务恢复后再重试。'};
 if((host==='api.jikan.moe'&&status>=500)||/Jikan failed to connect/i.test(raw))return {kind:'upstream',status,host,label:'上游故障',message:'Jikan 无法连接 MyAnimeList（HTTP '+status+'）；这是来源上游故障，非 0 条结果。其他来源仍独立查询，可稍后重试。'};
 if(/点我继续浏览|请点击下方按钮继续浏览|cf-chl-|Just a moment|机器人验证|访问异常/i.test(raw))return {kind:'verification',status,host,label:'需验证',message:'来源要求在浏览器中验证或登录，部分公开字段仍可使用。'};
 if(status===429)return {kind:'quota',status,host,label:/steampowered|steamcommunity/.test(host)?'请求过于频繁':'额度受限',message:/googleapis/.test(host)?'Google Books 请求额度不足；可在设置填写有可用额度的 API Key，或选用豆瓣 / Open Library。':'来源限制了请求频率，请稍后重试。'};
 if(status===401||status===403||/\bForbidden\b.{0,100}permission to access/is.test(raw))return {kind:'denied',status,host,label:'访问受限',message:'来源拒绝了当前访问（HTTP '+status+'）；可在浏览器确认访问权限，或选用其他来源。'};
 if(status>=500)return {kind:'server',status,host,label:'服务故障',message:'来源服务异常（HTTP '+status+'），请稍后重试。'};
 if(status===0)return {kind:'network',status,host,label:'连接失败',message:'无法连接来源，请检查系统网络或代理设置后重试。'};
 return {kind:'request',status,host,label:'请求失败',message:'来源返回请求错误（HTTP '+status+'）。'};
}
function transportFailure(error,url){Runtime.check();if(['TimeoutError','AbortError'].includes(error?.name)){const issue={kind:'timeout',status:0,host:new URL(url).hostname,label:'超时',message:'来源请求超时，已终止本次请求；可稍后重试。'};Runtime.recordFailure(issue);return issue;}return fail(0,'',url);}
function isAgeGate(body){return /<title>[^<]*(?:年齢認証|年齢確認|Age Verification|年龄确认|年齡確認)/i.test(body);}
function fail(status,body,url){const issue=classify(status,body,new URL(url).hostname);Runtime.recordFailure(issue);return issue;}
async function readResponse(response,url,asText=false){
 require('./steam-request-policy').observe(url,response);
 const body=await response.text();
 if(!response.ok){fail(response.status,body,url);return asText?'':null;}
 if(asText){if(/Checking your browser|<form[^>]+(?:name|id)=["']sec["'][\s\S]*?action=["']\/c["']/i.test(body)||isAgeGate(body)||/点我继续浏览|请点击下方按钮继续浏览|cf-chl-|Just a moment|机器人验证|访问异常|<title>Forbidden/i.test(body)){fail(response.status,body,url);return '';}return body;}
 try{const value=JSON.parse(body);if(value?.error||value?.errors){fail(value.error?.code||value.errors?.[0]?.status||response.status,value,url);return null;}return value;}catch{Runtime.recordFailure({kind:'parse',status:response.status,host:new URL(url).hostname,label:'解析失败',message:'来源返回了无法解析的数据'});return null;}
}
function summary(issues){const first=issues.find(i=>i.kind==='service')||issues[0];return first?{statusLabel:first.label,message:[...new Set(issues.map(i=>i.message))].join(' ')}:{};}
module.exports={classify,fail,transportFailure,readResponse,summary};
