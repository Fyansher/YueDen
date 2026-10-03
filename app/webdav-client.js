const {xml,parseDav}=require('./audio-remote');
const address=require('./webdav-address');
const http=require('node:http');
const https=require('node:https');
const {Readable}=require('node:stream');
function segments(value){const parts=String(value||'').replaceAll('\\','/').split('/').filter(Boolean);if(parts.some(p=>p==='.'||p==='..'))throw Error('WebDAV 目录不能包含 . 或 ..');return parts;}
function endpoint(settings,relative='',root=false){const url=address(settings),parts=[...root?[]:segments(settings.webdavRemotePath),...segments(relative)];url.pathname+=parts.map(encodeURIComponent).join('/');return url;}
function headers(settings,extra={}){return {'Accept-Encoding':'identity',...extra,...settings.webdavUsername?{Authorization:'Basic '+Buffer.from(settings.webdavUsername+':'+(settings.webdavPassword||'')).toString('base64')}: {}};}
function failure(method,status){const detail=status===400?'请求被服务器拒绝，请核对 WebDAV 目录地址（InfiniCLOUD 使用 /dav/）':status===401?'认证失败，请核对连接 ID 和应用专用密码':status===403?'服务器拒绝访问，请核对目录权限':status===404?'远端目录或文件不存在':status===429?'服务被限流，请稍后重试':status>=500?'上游服务故障':status===412?'远端已发生变化，未覆盖，请重新同步':'HTTP 请求失败';const error=Error('WebDAV '+method+' '+detail+'（'+status+'）');error.status=status;return error;}
async function responseDiagnostic(response){
 const headers={};
 for(const name of ['server','dav','allow','etag','last-modified','content-type','content-encoding','vary']){const value=response.headers.get(name);if(value)headers[name]=value.slice(0,160);}
 let body='';
 const reader=response.body?.getReader();
 if(reader){const chunks=[];let size=0;try{while(size<2048){const row=await reader.read();if(row.done)break;const part=row.value.subarray(0,2048-size);chunks.push(Buffer.from(part));size+=part.byteLength;if(part.byteLength<row.value.byteLength){await reader.cancel();break;}}}finally{reader.releaseLock();}body=Buffer.concat(chunks).toString('utf8');}
 body=body.replace(/<[^>]*>/g,' ').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,320);
 return {statusText:String(response.statusText||'').slice(0,120),headers,body};
}
async function xmlText(response){const reader=response.body?.getReader();if(!reader)return response.text();const decoder=new TextDecoder();let result='',bytes=0;try{while(true){const value=await reader.read();if(value.done)break;bytes+=value.value.byteLength;if(bytes>2*1024*1024){await reader.cancel('response too large');throw Error('WebDAV 目录响应超过读取上限');}result+=decoder.decode(value.value,{stream:true});}return result+decoder.decode();}finally{reader.releaseLock();}}
function descendants(node,name){return node.name===name?[node]:node.children.flatMap(child=>descendants(child,name));}
function descendant(node,name){return descendants(node,name)[0]||null;}
function successfulProps(tree){return descendants(tree,'propstat').filter(row=>/\s200\s/.test(descendant(row,'status')?.text||'')).map(row=>descendant(row,'prop')).filter(Boolean);}
function property(props,name){for(const propsNode of props){const found=propsNode.children.find(node=>node.name===name);if(found)return found.text;}return '';}
function resourceLabel(relative=''){
 const value=String(relative||'').replaceAll('\\','/');
 if(/(?:^|\/)\.yueden-condition-check-[a-f0-9]+\.tmp$/i.test(value))return 'condition-probe';
 if(value==='sync-state.json')return 'sync-state';
 if(/^saves\//.test(value))return /\/manifest\.json$/i.test(value)?'save-manifest':'save-data';
 return value?'webdav-resource':'webdav-root';
}
function diagnosticHeaders(response){const result={};for(const name of ['server','dav','allow','etag','last-modified','date','content-type','content-length']){const value=response.headers?.get(name);if(value)result[name]=String(value).slice(0,300);}return result;}
function conditionHeaders(extra={}){const result={};for(const name of ['If-Match','If-None-Match','If-Unmodified-Since','If-Modified-Since','Depth'])if(extra[name]!=null)result[name]=String(extra[name]).slice(0,300);return result;}
function bodyDeadline(response, timeoutMs, method, relative) {
 if (!response.body || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return response;
 const reader=response.body.getReader();let timer=null,timedOut=null,controllerRef=null;
 const clear=()=>{if(timer)clearTimeout(timer);timer=null;};
 const body=new ReadableStream({
  start(controller){controllerRef=controller;},
  pull(controller){
   clear();
   timer=setTimeout(()=>{timedOut=Error(`WebDAV ${method} 响应正文空闲超时：${resourceLabel(relative)}`);timedOut.name='TimeoutError';timedOut.code='YUEDEN_WEBDAV_BODY_TIMEOUT';reader.cancel(timedOut).catch(()=>{});try{controllerRef?.error(timedOut);}catch{}},timeoutMs);
   return reader.read().then(row=>{clear();if(timedOut)throw timedOut;if(row.done){controller.close();}else controller.enqueue(row.value);},error=>{clear();controller.error(error);});
  },
  cancel(reason){clear();return reader.cancel(reason);}
 });
 return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}

function causeCode(error){for(let current=error,depth=0;current&&depth<8;current=current.cause,depth++)if(current.code)return String(current.code);return '';}
function causedError(message,cause,code=''){const error=Error(message,{cause});if(code)error.code=code;return error;}
function freshConnectionFetch(url,init={}){
 const transport=url.protocol==='https:'?https:http;
 return new Promise((resolve,reject)=>{
  const request=transport.request(url,{method:init.method||'GET',headers:init.headers,agent:false,signal:init.signal},incoming=>{
   const responseHeaders=new Headers();
   for(const [name,value] of Object.entries(incoming.headers))if(value!=null)responseHeaders.set(name,Array.isArray(value)?value.join(', '):String(value));
   const body=Readable.toWeb(incoming);
   resolve(new Response(body,{status:incoming.statusCode||502,statusText:incoming.statusMessage||'',headers:responseHeaders}));
  });
  request.once('error',reject);
  if(init.body!=null)request.end(init.body);else request.end();
 });
}
function create({fetch:fetcher=globalThis.fetch,freshFetch=freshConnectionFetch,timeout=15000,bodyTimeout=20000,operationSignal=null,onDiagnostic=()=>{}}={}){
 function report(row){try{onDiagnostic(row);}catch{}}
 async function request(settings,method,relative='',body=null,contentType='',extra={},signal,root=false,directory=false,timeoutMs,bodyTimeoutMs,requestOptions={}){
  const url=endpoint(settings,relative,root);if((method==='MKCOL'||method==='PROPFIND'&&directory)&&!url.pathname.endsWith('/'))url.pathname+='/';
  const resource=resourceLabel(relative),requestConditions=conditionHeaders(extra),requestHeaders=headers(settings,{...extra,...body!=null?{'Content-Type':contentType||(Buffer.isBuffer(body)?'application/octet-stream':'application/json; charset=utf-8')}: {}});
  const effectiveTimeout=Number.isFinite(timeoutMs)&&timeoutMs>0?timeoutMs:timeout,headerController=new AbortController(),started=Date.now();let headerTimedOut=false;
  const operation=typeof operationSignal==='function'?operationSignal():operationSignal,signals=[signal,operation,headerController.signal].filter(Boolean),headerTimer=setTimeout(()=>{headerTimedOut=true;headerController.abort();},effectiveTimeout),combined=signals.length>1?AbortSignal.any(signals):signals[0];
  try{
   const fetchOptions={method,body,headers:requestHeaders,signal:combined,redirect:'error'};
   const response=await (requestOptions.freshConnection?freshFetch:fetcher)(url,fetchOptions);
   clearTimeout(headerTimer);
   const wrapped=bodyDeadline(response,Number.isFinite(bodyTimeoutMs)&&bodyTimeoutMs>0?bodyTimeoutMs:bodyTimeout,method,relative);
   if(response.status>=400||resource==='condition-probe'||resource==='sync-state'||resource==='save-manifest')report({event:'webdav.response',method,resource,status:response.status,statusText:response.statusText,durationMs:Date.now()-started,requestConditions,responseHeaders:diagnosticHeaders(response)});
   return wrapped;
  }catch(error){
   clearTimeout(headerTimer);const code=causeCode(error),reason=combined?.reason;
   report({event:'webdav.request-failed',method,resource,durationMs:Date.now()-started,requestConditions,error});
   if(headerTimedOut)throw causedError(`WebDAV ${method} 请求头超时（${effectiveTimeout} 毫秒）`,error,'YUEDEN_WEBDAV_HEADER_TIMEOUT');
   if(combined?.aborted){if(reason?.name==='TimeoutError')throw causedError(`WebDAV ${method} 请求超时`,error,typeof reason.code==='string'&&reason.code?reason.code:'YUEDEN_WEBDAV_OPERATION_TIMEOUT');throw causedError('WebDAV 请求已取消',error,'YUEDEN_WEBDAV_CANCELLED');}
   throw causedError('WebDAV '+method+' 网络连接失败：'+(code||error.name||'连接中断'),error,code);
  }
 }
 async function collection(settings,relative,root=false,options={}){const response=await request(settings,'PROPFIND',relative,null,'',{Depth:'0'},options.signal,root,true,options.timeoutMs);if(response.status===404){await response.body?.cancel();return false;}if(!response.ok){await response.body?.cancel();throw failure('PROPFIND',response.status);}const tree=xml(await xmlText(response));if(!descendants(tree,'multistatus').length||!successfulProps(tree).some(props=>descendants(props,'collection').length>0))throw Error('服务器未返回有效的 WebDAV 目录；请使用账户提供的 WebDAV 连接地址');return true;}
 async function stat(settings,relative,timeoutMs){const body='<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getetag/><d:getcontentlength/></d:prop></d:propfind>',response=await request(settings,'PROPFIND',relative,body,'application/xml; charset=utf-8',{Depth:'0','Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'},undefined,false,false,timeoutMs);if(response.status===404){await response.body?.cancel();return {exists:false,lastModified:'',etag:'',contentLength:null};}if(!response.ok){await response.body?.cancel();throw failure('PROPFIND',response.status);}const tree=xml(await xmlText(response)),props=successfulProps(tree),rawLength=property(props,'getcontentlength'),length=rawLength.trim()===''?NaN:Number(rawLength);return {exists:true,lastModified:property(props,'getlastmodified'),etag:property(props,'getetag'),contentLength:Number.isFinite(length)&&length>=0?length:null};}
 async function ensurePath(settings,options={}){if(!await collection(settings,'',true,options))throw Error('WebDAV 根目录不存在，请核对连接地址');let relative='';for(const part of segments(settings.webdavRemotePath)){relative+=(relative?'/':'')+part;const scoped={...settings,webdavRemotePath:''};if(await collection(scoped,relative,false,options))continue;const made=await request(scoped,'MKCOL',relative,null,'',{},options.signal,false,false,options.timeoutMs);await made.body?.cancel();if(!made.ok&&made.status!==405)throw failure('MKCOL',made.status);if(!await collection(scoped,relative,false,options))throw Error('WebDAV 目录创建后仍不可访问');}}
 async function ensureDirectories(settings,relative,knownDirectories=new Set()){let current='';for(const part of segments(relative)){current+=(current?'/':'')+part;if(knownDirectories.has(current))continue;if(await collection(settings,current)){knownDirectories.add(current);continue;}const response=await request(settings,'MKCOL',current);await response.body?.cancel();if(!response.ok&&response.status!==405)throw failure('MKCOL',response.status);if(!await collection(settings,current))throw Error('WebDAV 子目录不可访问');knownDirectories.add(current);}}
 async function listFiles(settings,start='saves'){
  const queue=[start],queued=new Set([start]),seen=new Set(),files=new Set(),scope={base:endpoint(settings).href,origins:[address(settings).origin],root:endpoint(settings).pathname};
  if(!scope.base.endsWith('/'))scope.base+='/';if(!scope.root.endsWith('/'))scope.root+='/';
  while(queue.length){
   const batch=[];
   while(queue.length&&batch.length<4){const relative=queue.shift();queued.delete(relative);if(seen.has(relative))continue;seen.add(relative);if(seen.size>500)throw Error('WebDAV 存档目录超过本次枚举上限');batch.push(relative);}
   const responses=await Promise.allSettled(batch.map(async relative=>{
    const response=await request(settings,'PROPFIND',relative,null,'',{Depth:'1'},undefined,false,true);
    if(response.status===404){await response.body?.cancel();return [];}
    if(!response.ok){await response.body?.cancel();throw failure('PROPFIND',response.status);}
    const current=endpoint(settings,relative);if(!current.pathname.endsWith('/'))current.pathname+='/';
    return parseDav(await xmlText(response),current.href,scope).map(row=>({row,key:decodeURIComponent(row.relativePath).replace(/\/$/,'')}));
   }));
   const failed=responses.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   for(const result of responses)for(const {row,key} of result.value){
    if(!key.startsWith(start+'/'))continue;
    if(row.directory){if(!seen.has(key)&&!queued.has(key)){queue.push(key);queued.add(key);}}
    else{files.add(key);if(files.size>10000)throw Error('WebDAV 存档数量超过本次枚举上限');}
   }
  }
  return [...files];
 }
 return {request,ensurePath,ensureDirectories,listFiles,stat};
}
function describe(error){return ['AbortError','TimeoutError'].includes(error?.name)?'WebDAV 请求超时，当前操作已停止':error?.message||'WebDAV 同步失败';}
module.exports={create,address,endpoint,headers,failure,responseDiagnostic,describe,resourceLabel,freshConnectionFetch};
