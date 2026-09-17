(function(root){
 const copy=v=>JSON.parse(JSON.stringify(v)),kind=v=>['music','asmr','radio','other'].includes(v)?v:'music';
 const snapshot=s=>({queue:copy(s.queue||[]),index:s.index||0,position:s.position||0,repeat:s.repeat||'none',shuffle:!!s.shuffle,shuffleOrder:[...(s.shuffleOrder||[])],source:s.source||null});
 function normalize(s={},legacyKind='music'){const result={...copy(s),version:2,activeContext:kind(s.activeContext||legacyKind),contexts:s.contexts&&typeof s.contexts==='object'?copy(s.contexts):{}};result.contexts[result.activeContext]=snapshot(result);return result;}
 function switchTo(s,target){const next=normalize(s);target=kind(target);if(next.activeContext===target)return next;next.contexts[next.activeContext]=snapshot(next);Object.assign(next,next.contexts[target]||snapshot({}));next.activeContext=target;if(target==='asmr'){next.shuffle=false;next.repeat='none';}return next;}
 function order(tracks){const manual=tracks.some(t=>t.manualOrder!=null);return [...tracks].sort((a,b)=>(manual?(a.manualOrder??1e9)-(b.manualOrder??1e9):0)||(a.discNumber||1)-(b.discNumber||1)||(a.trackNumber||1e9)-(b.trackNumber||1e9)||String(a.title||'').localeCompare(String(b.title||''),'zh-CN',{numeric:true}));}
 function shuffled(s,rng=Math.random){const ids=s.queue.map(e=>e.queueEntryId),current=ids[s.index],rest=ids.filter(id=>id!==current);for(let i=rest.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}return [current,...rest].filter(Boolean);}
 function sequence(s){if(!s.shuffle)return s.queue.map(e=>e.queueEntryId);const ids=new Set(s.queue.map(e=>e.queueEntryId));return [...(s.shuffleOrder||[]).filter(id=>ids.has(id)),...s.queue.map(e=>e.queueEntryId).filter(id=>!(s.shuffleOrder||[]).includes(id))];}
 function nextIndex(s,delta){const ids=sequence(s),at=ids.indexOf(s.queue[s.index]?.queueEntryId),next=ids[(at+delta+ids.length)%ids.length];return Math.max(0,s.queue.findIndex(e=>e.queueEntryId===next));}
 const api={kind,normalize,switchTo,order,shuffled,sequence,nextIndex};if(typeof module!=='undefined')module.exports=api;else root.AudioContext=api;
})(typeof window==='undefined'?globalThis:window);
