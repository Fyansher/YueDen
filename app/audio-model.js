/* Versioned work → track → source model. Never infer identity from a title. */
const {randomUUID}=require('node:crypto');
const text=(v,max=2000)=>typeof v==='string'?v.slice(0,max):'';
const list=v=>Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,100).map(x=>text(x)):[];
const num=(v,max=1e10)=>Number.isFinite(Number(v))?Math.max(0,Math.min(max,Number(v))):0;
function id(v){return typeof v==='string'&&/^[\w:.-]{1,150}$/.test(v)?v:randomUUID();}
function source(value){
 const v=value||{},kind=['local','http','webdav'].includes(v.kind)?v.kind:'local';
 const out={id:id(v.id),kind,mimeType:text(v.mimeType,100)};
 if(kind==='local'){out.localPath=text(v.localPath,32768);}
 else if(kind==='webdav'){out.connectionId=text(v.connectionId,150);out.relativePath=text(v.relativePath,8192);out.remoteObjectId=text(v.remoteObjectId,2000);}
 else if(v.connectionId){out.connectionId=text(v.connectionId,150);}else {const url=new URL(v.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('音频地址只接受不含账号密码的 HTTP(S) 链接');if([...url.searchParams.keys()].some(k=>/token|signature|credential|password|api.?key|x-amz|x-goog/i.test(k)))throw Error('临时签名地址不能存入资源库，请使用受控连接');out.url=url.href;}
 return out;
}
function normalize(value={}){
 const sources=(Array.isArray(value.sources)?value.sources:[]).slice(0,30000).map(source),seen=new Set();
 for(const s of sources){if(seen.has(s.id))throw Error('音频来源 ID 重复');seen.add(s.id);}
 const ids=new Set(),tracks=(Array.isArray(value.tracks)?value.tracks:[]).slice(0,30000).map(t=>{
  const track={manualOrder:t.manualOrder!=null&&Number.isFinite(Number(t.manualOrder))?num(t.manualOrder,99999):null,cover:text(t.cover,8192),metadataSource:text(t.metadataSource,200),metadataConfirmed:Boolean(t.metadataConfirmed),lockedFields:list(t.lockedFields),identifiers:{musicbrainz:text(t.identifiers?.musicbrainz,100)},id:id(t.id),title:text(t.title),albumTitle:text(t.albumTitle),artists:list(t.artists),discNumber:num(t.discNumber,999),trackNumber:num(t.trackNumber,99999),durationSeconds:num(t.durationSeconds),codec:text(t.codec,100),sampleRate:num(t.sampleRate,1000000),channels:num(t.channels,64),sourceRefs:list(t.sourceRefs).filter(ref=>seen.has(ref)),preferredSourceId:text(t.preferredSourceId,150),lyricsOffsetMs:Math.max(-3600000,Math.min(3600000,Number(t.lyricsOffsetMs)||0))};
  if(ids.has(track.id))throw Error('音轨 ID 重复');ids.add(track.id);if(!track.sourceRefs.includes(track.preferredSourceId))track.preferredSourceId=track.sourceRefs[0]||'';return track;
 });
 return {groupingManual:Boolean(value.groupingManual),identifiers:{musicbrainzRelease:text(value.identifiers?.musicbrainzRelease,100)},kind:['music','asmr','radio','other'].includes(value.kind)?value.kind:'music',collectionKind:['album','single','work'].includes(value.collectionKind)?value.collectionKind:'album',artists:list(value.artists),albumArtists:list(value.albumArtists),circle:text(value.circle),creators:list(value.creators),performers:list(value.performers),language:text(value.language,100),edition:text(value.edition),resumePolicy:['start','resume'].includes(value.resumePolicy)?value.resumePolicy:value.kind==='music'||!value.kind?'start':'resume',sources,tracks};
}
function localKey(p){return text(p,32768).replace(/\\/g,'/').toLowerCase();}
function same(a,b){return require('./resource-identity').compare(a,b).status==='match';}
function merge(existing,candidate){
 const a=normalize(existing),b=normalize(candidate),keys=new Map(a.sources.map(s=>[s.kind==='local'?'local:'+localKey(s.localPath):s.kind==='http'?'http:'+(s.connectionId||s.url):'dav:'+s.connectionId+':'+s.relativePath,s.id])),mapping=new Map();
 for(const s of b.sources){const k=s.kind==='local'?'local:'+localKey(s.localPath):s.kind==='http'?'http:'+(s.connectionId||s.url):'dav:'+s.connectionId+':'+s.relativePath;if(keys.has(k)){mapping.set(s.id,keys.get(k));continue;}a.sources.push(s);keys.set(k,s.id);mapping.set(s.id,s.id);}
 for(const t of b.tracks){const refs=t.sourceRefs.map(r=>mapping.get(r)).filter(Boolean);const matches=a.tracks.filter(old=>old.id===t.id||old.sourceRefs.some(r=>refs.includes(r))||a.identifiers.musicbrainzRelease&&a.identifiers.musicbrainzRelease===b.identifiers.musicbrainzRelease&&old.identifiers.musicbrainz&&old.identifiers.musicbrainz===t.identifiers.musicbrainz&&Math.abs(old.durationSeconds-t.durationSeconds)<=2);if(matches.length===1){matches[0].sourceRefs=[...new Set([...matches[0].sourceRefs,...refs])];continue;}a.tracks.push({...t,sourceRefs:refs,preferredSourceId:mapping.get(t.preferredSourceId)||refs[0]||''});}
 return a;
}
module.exports={normalize,same,merge,localKey};
