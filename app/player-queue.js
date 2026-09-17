/* Shared queue identity and display ordering; never mutates library records. */
(function(root){
 const identity=e=>/^[a-z]:[\\/]|^\\\\/i.test(e.path||'')?'file:'+e.path.replaceAll('\\','/').toLowerCase():e.resourceId&&e.memberId?'ref:'+JSON.stringify([e.resourceId,e.memberId]):'path:'+e.path;
 function duplicateIds(queue,currentId){const keep=new Map();for(const e of queue){const k=identity(e);if(!keep.has(k)||e.queueEntryId===currentId)keep.set(k,e.queueEntryId);}return queue.filter(e=>keep.get(identity(e))!==e.queueEntryId).map(e=>e.queueEntryId);}
 function sorted(rows,field='title',order='asc',random=Math.random){if(!['title','artist','album'].includes(field)||!['asc','desc','random'].includes(order))throw Error('排序参数无效');const copy=[...rows];if(order==='random'){for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}return copy.sort((a,b)=>String(a[field]||'').localeCompare(String(b[field]||''),'zh-CN',{numeric:true,sensitivity:'base'})*(order==='desc'?-1:1));}
 const api={identity,duplicateIds,sorted};if(typeof module==='object')module.exports=api;else root.PlayerQueue=api;
})(globalThis);
