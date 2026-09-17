// Progress is owned by the media member, not by a mutable library grouping.
function reconcile(data,id,files){
 const allowed=new Set(files.map(f=>f.key||f.path||f.url)), own=data[id]||{};
 const rows=Object.values(data).filter(v=>v&&typeof v==='object').sort((a,b)=>String(a.lastOpenedAt||'').localeCompare(String(b.lastOpenedAt||'')));
 const positions={},marks=new Map();let latest={};
 for(const row of rows){let relevant=false;for(const [key,value]of Object.entries(row.positions||{}))if(allowed.has(key)){positions[key]=value;relevant=true;}for(const mark of row.bookmarks||[])if(allowed.has(mark.member)){const key=mark.kind==='annotation'?'annotation:'+mark.id:JSON.stringify(mark),previous=marks.get(key);if(!previous||String(mark.updatedAt||mark.createdAt||'')>=String(previous.updatedAt||previous.createdAt||''))marks.set(key,mark);}if(relevant)latest=row;}
 return {...latest,...own,member:allowed.has(own.member)?own.member:allowed.has(latest.member)?latest.member:undefined,positions,bookmarks:[...marks.values()]};
}
module.exports={reconcile};
