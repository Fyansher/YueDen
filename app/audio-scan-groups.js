const Audio=require('./audio-model'),Identity=require('./resource-identity');
function reconcile(items,existing){let pending=structuredClone(items);const result=[];
 for(const old of existing.filter(i=>i.type==='audio'&&i.audio?.groupingManual)){
  const owned=new Set(old.audio.sources.filter(s=>s.kind==='local').map(s=>Identity.pathKey(s.localPath))),parts=[],remaining=[];
  for(const item of pending){const selected=new Set(item.audio.sources.filter(s=>owned.has(Identity.pathKey(s.localPath))).map(s=>s.id));const tracks=item.audio.tracks.filter(t=>t.sourceRefs.some(r=>selected.has(r)));if(!tracks.length){remaining.push(item);continue;}
   const subset=chosen=>{const refs=new Set(chosen.flatMap(t=>t.sourceRefs)),sources=item.audio.sources.filter(s=>refs.has(s.id)),keys=new Set(sources.map(s=>Identity.pathKey(s.localPath)));return {...item,audio:{...item.audio,tracks:chosen,sources},localFiles:(item.localFiles||[]).filter(f=>keys.has(Identity.pathKey(f.path))),localPath:sources.find(s=>s.kind==='local')?.localPath||''};};
   parts.push(subset(tracks));const rest=item.audio.tracks.filter(t=>!tracks.includes(t));if(rest.length)remaining.push(subset(rest));
  }
  pending=remaining;if(parts.length){const grouped={...parts[0],id:old.id,name:old.name,identityKey:old.identityKey,scanGrouping:old.scanGrouping};for(const p of parts.slice(1)){grouped.audio=Audio.merge(grouped.audio,p.audio);grouped.localFiles.push(...p.localFiles);}grouped.audio.groupingManual=true;grouped.audio.collectionKind=old.audio.collectionKind;result.push(grouped);}
 }return [...result,...pending];
}
module.exports={reconcile};
