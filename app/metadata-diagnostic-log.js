const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const FILE_NAME='metadata-diagnostics.jsonl';
const MAX_BYTES=2*1024*1024;
const SECRET_KEY=/(?:cookie|authorization|password|passwd|csrf|access.?token|refresh.?token|session|credential|user.?name|headers?|html|response.?body|request.?body|local.?storage|session.?storage)/i;

function address(value,query=''){
  try{
    const url=new URL(String(value));
    if(!/^https?:$/.test(url.protocol)||url.username||url.password)return null;
    const segments=(url.pathname||'/').split('/');for(let i=1;i<segments.length;i++)if(/^(?:token|session|auth|login|callback|reset|password-reset|verification)$/i.test(segments[i-1]))segments[i]='[redacted]';
    let pathname;try{pathname=decodeURIComponent(segments.join('/'));}catch{pathname=segments.join('/');}pathname=redactText(pathname,query);
    return {host:url.hostname.toLowerCase().slice(0,253),path:pathname.slice(0,1000),queryKeys:[...new Set([...url.searchParams.keys()].slice(0,40).map(key=>key.slice(0,80)))]};
  }catch{return null;}
}
function redactText(value,query=''){
  let text=String(value??'');
  if(query&&query.length>1)text=text.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),'[search term]');
  text=text.replace(/https?:\/\/[^\s"'<>]+/gi,raw=>{const parsed=address(raw);return parsed?parsed.host+parsed.path:'[url]';});
  text=text.replace(/\b(set-cookie|cookie)\b\s*[:=]\s*[^\r\n]*/gi,'$1=[redacted]');
  text=text.replace(/\b(authorization)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+(?:\s+[^\s,;]+)?/gi,'$1=[redacted]');
  text=text.replace(/\b(password|passwd|csrf(?:token)?|access[_-]?token|refresh[_-]?token|session(?:id)?|username)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
  text=text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]');
  return text.slice(0,1600);
}
function safeValue(value,key,query,depth=0){
  if(SECRET_KEY.test(key))return undefined;
  if(/^(?:query|keyword|searchText|searchQuery)$/i.test(key))return undefined;
  if(/url$/i.test(key)||/^(?:url|address)$/i.test(key)){
    const parsed=address(value,query);if(!parsed)return undefined;
    const prefix=key==='requestUrl'?'request':key==='finalUrl'?'final':key==='redirectFromUrl'?'redirectFrom':key==='redirectToUrl'?'redirectTo':key==='url'||key==='address'?'request':key.replace(/Url$/i,'').toLowerCase();
    return {[prefix+'Host']:parsed.host,[prefix+'Path']:parsed.path,...(parsed.queryKeys.length?{[prefix+'QueryKeys']:parsed.queryKeys}:{})};
  }
  if(value==null||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:undefined;
  if(typeof value==='string'){
    if(/(?:^|\/)(?:query|keyword|search)(?:\/|$)/i.test(value)&&/^https?:/i.test(value))return undefined;
    if(/path$/i.test(key))return redactText(value.split(/[?#]/,1)[0],query).slice(0,1000)||'/';
    return redactText(value,query);
  }
  if(depth>4)return undefined;
  if(Array.isArray(value))return value.slice(0,30).map(item=>safeValue(item,'',query,depth+1)).filter(item=>item!==undefined);
  if(typeof value==='object'){
    const out={};for(const [childKey,child] of Object.entries(value)){const safe=safeValue(child,childKey,query,depth+1);if(safe===undefined)continue;if(safe&&typeof safe==='object'&&!Array.isArray(safe)&&(/url$/i.test(childKey)||/^(?:url|address)$/i.test(childKey)))Object.assign(out,safe);else out[childKey]=safe;}
    return out;
  }
  return undefined;
}

function create({directory,appVersion='unknown',buildId='',maxBytes=MAX_BYTES,now=()=>new Date().toISOString()}={}){
  const resolveDirectory=()=>typeof directory==='function'?directory():directory;
  const filePath=()=>path.join(resolveDirectory(),FILE_NAME);
  function write(event={}){
    try{
      const query=String(event.query||'');
      const clean=safeValue({...event,query:undefined},'',query)||{};
      const row={time:now(),appVersion:String(appVersion||'unknown').slice(0,80),...(buildId?{buildId:String(buildId).slice(0,80)}:{}),runId:String(event.runId||randomUUID()).slice(0,100),durationMs:0,...clean};
      if(!row.phase&&row.event)row.phase=String(row.event).slice(0,100);
      const line=JSON.stringify(row)+'\n',target=filePath(),dir=path.dirname(target);
      fs.mkdirSync(dir,{recursive:true});
      let size=0;try{size=fs.statSync(target).size;}catch{}
      if(size+Buffer.byteLength(line,'utf8')>Math.max(1024,Number(maxBytes)||MAX_BYTES)){
        const previous=target+'.1';try{fs.rmSync(previous,{force:true});}catch{}
        try{if(fs.existsSync(target))fs.renameSync(target,previous);}catch{}
      }
      fs.appendFileSync(target,line,{encoding:'utf8',flag:'a'});
      return true;
    }catch{return false;}
  }
  function clear(){
    const errors=[];
    for(const target of [filePath(),filePath()+'.1'])try{fs.rmSync(target,{force:true});}catch(error){errors.push(String(error?.message||error));}
    return {ok:errors.length===0,errors};
  }
  return {write,clear,filePath,directory:resolveDirectory};
}

module.exports={create,address,redactText,MAX_BYTES,FILE_NAME};
