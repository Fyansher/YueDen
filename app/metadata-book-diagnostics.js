const Html=require('./metadata-html'),Network=require('./metadata-network');

function pageAddress(value){
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)return '';return url.hostname.toLowerCase()+url.pathname.slice(0,500);}catch{return '';}
}
function hasBookSchema(page){
  for(const match of String(page||'').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const visit=value=>Array.isArray(value)?value.some(visit):Boolean(value&&typeof value==='object'&&([value['@type']].flat().includes('Book')||(value['@graph']&&visit(value['@graph']))));if(visit(JSON.parse(match[1])))return true;}catch{}
  }
  return false;
}
function verificationReason(page,title=''){
  const value=String(page||'')+' '+String(title||'');
  if(/diamwall/i.test(value))return 'diamwall';if(/cloudflare|cf-chl-|just a moment|please wait|请稍候|请稍后|正在检查浏览器|正在验证浏览器|checking your browser|verifying your browser/i.test(value))return 'cloudflare';
  if(/captcha|验证码|机器人验证|verify you are human/i.test(value))return 'captcha';if(/登录后|log\s*in|sign\s*in|login required|请先登录/i.test(value))return 'login-required';
  if(/access denied|访问被拒/i.test(value))return 'access-denied';if(/age gate|age verification|age confirmation|verify your age|年齢認証|年齢確認|年龄确认|年龄验证/i.test(value))return 'age-gate';return 'unknown';
}
function safeTitle(value,query=''){
  let title=Html.text(value||'').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]');
  if(/\b(?:welcome(?: back)?|hello|signed in as|logged in as|login as)\b|欢迎|您好|登录用户/i.test(title))return '[account page]';
  if(query&&query.length>1)title=title.replace(new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),'[search term]');
  return title.slice(0,160);
}
function safeHttps(value,base){try{const url=new URL(value,base);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url:null;}catch{return null;}}
function summarize(sourceId,requestUrl,finalUrl,page,context={},filterStats={}){
  const html=String(page||''),title=safeTitle(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',context.query),anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)],forms=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)],requestHost=(()=>{try{return new URL(requestUrl).hostname.toLowerCase();}catch{return '';}})();
  const links=[],pathPrefixCounts={};
  for(const match of anchors){const attrs=Html.attributes('<a '+match[1]+'>'),url=safeHttps(attrs.href,finalUrl);if(!url)continue;const first=url.pathname.split('/').filter(Boolean)[0]||'',key=first?'/'+first+'/*':'/',countKey=!pathPrefixCounts[key]&&Object.keys(pathPrefixCounts).length>=100?'/other/*':key;pathPrefixCounts[countKey]=(pathPrefixCounts[countKey]||0)+1;
    if(links.length<20){const tags=[...match[2].matchAll(/<([a-z][\w:-]*)\b/gi)].map(item=>item[1].toLowerCase());links.push({...(url.hostname.toLowerCase()===requestHost?{}:{host:url.hostname.toLowerCase()}),pathname:url.pathname.slice(0,300),className:String(attrs.class||'').slice(0,120),childTags:[...new Set(tags)].slice(0,20),textLength:Html.text(match[2]).length});}
  }
  const formRows=forms.slice(0,8).map(match=>{const attrs=Html.attributes('<form '+match[1]+'>'),action=safeHttps(attrs.action||finalUrl,finalUrl),inputs=[...match[2].matchAll(/<input\b[^>]*>/gi)].slice(0,20).map(input=>{const item=Html.attributes(input[0]);return {name:String(item.name||'').slice(0,100),type:String(item.type||'text').slice(0,40)};});return {method:String(attrs.method||'get').toLowerCase().slice(0,12),...(action?{actionHost:action.hostname.toLowerCase(),actionPath:action.pathname.slice(0,300)}:{}),inputs};});
  const searchFormCandidateCount=forms.filter(match=>{const attrs=Html.attributes('<form '+match[1]+'>'),method=String(attrs.method||'get').toLowerCase(),action=safeHttps(attrs.action||finalUrl,finalUrl),inputs=[...match[2].matchAll(/<input\b[^>]*>/gi)].map(input=>Html.attributes(input[0]));return method==='get'&&Boolean(action)&&inputs.some(input=>input.name&&(!input.type||/^(?:text|search)$/i.test(input.type))&&/^(?:q|query|keyword|search|title|term)$/i.test(input.name)||input.name&&/^(?:text|search)$/i.test(input.type||''));}).length;
  const challenge=Network.isVerificationPage(html);
  return {sourceId,requestUrl,finalUrl,pageTitle:title,htmlLength:html.length,verificationHit:challenge,verificationReason:challenge?verificationReason(html,title):'',anchorCount:anchors.length,formCount:forms.length,jsonLdBook:hasBookSchema(html),detailCandidateCount:Number(filterStats.detailCandidateCount||0),searchFormCandidateCount:Number(filterStats.searchFormCandidateCount??searchFormCandidateCount),links,pathPrefixCounts,forms:formRows,hasNextData:/__NEXT_DATA__/i.test(html),hasNuxtData:/__NUXT(?:_DATA__)?__/i.test(html),hasJsonLd:/application\/ld\+json/i.test(html),hasReactRoot:/(?:data-reactroot|id=["']root["'])/i.test(html),hasVueRoot:/data-v-[\da-f]+|__VUE__/i.test(html),scriptCount:[...html.matchAll(/<script\b/gi)].length,parserFilters:filterStats};
}
function write(sourceId,requestUrl,finalUrl,page,verificationHit=false,context={},filterStats={}){
  const title=safeTitle(String(page||'').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',context.query),summary=summarize(sourceId,requestUrl,finalUrl,page,context,filterStats);summary.verificationHit=Boolean(verificationHit||summary.verificationHit);summary.verificationReason=summary.verificationHit?verificationReason(page,title):'';
  if(typeof context?.log==='function')context.log({phase:'parse.summary',parseLayer:filterStats.parseLayer||'search-results',...summary});
  return summary;
}
module.exports={write,summarize,pageAddress,hasBookSchema,verificationReason,safeTitle};
