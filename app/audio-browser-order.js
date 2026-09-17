/* Stable presentation identities; album track order and playback queues are untouched. */
(function(root){
 const trackId=row=>JSON.stringify([row.item.id,row.track.id]);
 function entryIds(entries){const counts=new Map();return entries.map(e=>{const key=JSON.stringify([e.itemId,e.trackId]),n=counts.get(key)||0;counts.set(key,n+1);return e.id||JSON.stringify([e.itemId,e.trackId,n]);});}
 function merge(all,visible){const allowed=new Set(all),selected=new Set(visible);if(selected.size!==visible.length||visible.some(id=>!allowed.has(id)))throw Error('列表已变化，请重新排序');let at=0;return all.map(id=>selected.has(id)?visible[at++]:id);}
 function apply(rows,order,key){const rank=new Map((Array.isArray(order)?order:[]).map((id,i)=>[id,i]));return [...rows].sort((a,b)=>(rank.get(key(a))??Infinity)-(rank.get(key(b))??Infinity));}
 const api={trackId,entryIds,merge,apply};if(typeof module==='object')module.exports=api;else root.AudioBrowserOrder=api;
})(globalThis);
