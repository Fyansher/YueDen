/* Remembers the effective HTTPS origin learned after source verification.
   Only source IDs, hostnames and origins are persisted; page queries/cookies
   remain in the existing Electron session and are never written here. */
const fs=require('node:fs');
const {isIP}=require('node:net');

function safeHost(value){
  const host=String(value||'').trim().toLowerCase();
  if(host.length>253||host.endsWith('.')||isIP(host)||!host.includes('.'))return '';
  const labels=host.split('.');
  return labels.every(label=>label.length>0&&label.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))?host:'';
}
function safeUrl(value){
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!safeHost(url.hostname))return null;return url;}catch{return null;}
}
function create({file}){
  const sources=new Map();let loaded=false;
  const filePath=()=>typeof file==='function'?file():file;
  function load(){
    if(loaded)return;loaded=true;
    try{
      const data=JSON.parse(fs.readFileSync(filePath(),'utf8'));
      if(data?.version!==1||!data.sources||typeof data.sources!=='object')return;
      for(const [id,value] of Object.entries(data.sources)){
        if(!/^[a-z][a-z0-9_-]{0,39}$/.test(id))continue;
        const origin=safeUrl(value?.origin),requestedHost=safeHost(value?.requestedHost);
        if(origin&&requestedHost)sources.set(id,{requestedHost,origin:origin.origin,finalUrl:origin.origin+'/',verified:value?.verified===true});
      }
    }catch{}
  }
  function save(){
    try{
      const target=filePath();fs.mkdirSync(require('node:path').dirname(target),{recursive:true});
      const data={version:1,sources:Object.fromEntries([...sources].map(([id,value])=>[id,{requestedHost:value.requestedHost,origin:value.origin,...(value.verified?{verified:true}:{})}]))};
      fs.writeFileSync(target,JSON.stringify(data,null,2),'utf8');
    }catch{}
  }
  function record(sourceId,requestedHost,finalUrl,options={}){
    load();if(!/^[a-z][a-z0-9_-]{0,39}$/.test(String(sourceId||'')))return false;
    const supplied=safeHost(requestedHost),previous=sources.get(sourceId),requested=previous?.requestedHost===supplied?previous.requestedHost:supplied,final=safeUrl(finalUrl);if(!requested||!final)return false;
    const authHost=/^(?:accounts?|auth|login|passport|oauth|sso|id|identity)(?:[.-]|$)/i.test(final.hostname);
    const authPath=/(?:^|\/)(?:accounts?|auth|login|sign-?in|oauth|sso|passport|callback)(?:\/|$)/i.test(final.pathname);
    const authPage=authHost||authPath;
    const origin=authPage&&final.hostname.toLowerCase()!==requested?'https://'+requested:final.origin;
    const path=authPage?'/':final.pathname;
    const finalPage=new URL(path,origin);
    const verified=Object.prototype.hasOwnProperty.call(options,'verified')?options.verified===true:Boolean(previous?.verified&&previous?.requestedHost===supplied);
    sources.set(sourceId,{requestedHost:requested,origin,finalUrl:finalPage.href,verified});save();return true;
  }
  function activate(sourceId,value,{verified=false}={}){
    load();if(!/^[a-z][a-z0-9_-]{0,39}$/.test(String(sourceId||'')))return false;
    const url=safeUrl(value);if(!url)return false;
    sources.set(sourceId,{requestedHost:url.hostname.toLowerCase(),origin:url.origin,finalUrl:url.origin+'/',verified:verified===true});save();return true;
  }
  function originFor(sourceId,fallback){
    load();const remembered=sources.get(String(sourceId||''));if(remembered)return remembered.origin;
    const url=safeUrl(fallback);return url?.origin||'';
  }
  function isVerified(sourceId){load();return sources.get(String(sourceId||''))?.verified===true;}
  function homeFor(sourceId,fallback){
    load();const remembered=sources.get(String(sourceId||''));
    if(remembered?.finalUrl){
      const page=new URL(remembered.finalUrl);
      return remembered.finalUrl;
    }
    const url=safeUrl(fallback);return url?.href||'';
  }
  function rewrite(sourceId,value){
    load();let url;try{url=new URL(value);}catch{return String(value||'');}
    const remembered=sources.get(String(sourceId||''))||[...sources.values()].find(item=>url.hostname.toLowerCase()===item.requestedHost);
    if(remembered&&url.hostname.toLowerCase()===remembered.requestedHost&&url.origin!==remembered.origin){
      url=new URL(url.pathname+url.search,remembered.origin);
    }
    url.hash='';return url.href;
  }
  return {record,activate,originFor,homeFor,rewrite,isVerified};
}
module.exports={create,safeHost,safeUrl};
