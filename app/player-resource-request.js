// Resolve stable library references and validate playlist membership in the main process.
const Relations=require('./library-relations'),Audio=require('./audio-context');
function resolve(library,refs,source){
 if(!Array.isArray(refs)||!refs.length||refs.length>10000||refs.some(r=>!r||typeof r.itemId!=='string'))throw Error('资源列表无效');
 const resolved=refs.map(ref=>typeof ref.trackId==='string'?Relations.resolve(library,ref):{...ref});
 const contexts=resolved.map(ref=>{const item=library.items.find(i=>i.id===ref.itemId);if(!item)throw Error('资源已不存在');return item.type==='audio'?Audio.kind(item.audio?.kind):'video';});
 if(source?.kind==='playlist'){
  const playlist=library.playlists?.find(p=>p.id===source.id);if(!playlist)throw Error('歌单已不存在');
  const key=r=>JSON.stringify([r.itemId,r.trackId]),members=new Set(playlist.entries.map(r=>key(Relations.resolve(library,r))));
  if(resolved.some((r,i)=>contexts[i]==='video'||!members.has(key(r))))throw Error('音轨不属于所选歌单');
  return {refs:resolved,context:'music'};
 }
 if(contexts.some(c=>c!==contexts[0]))throw Error('请选择同一分区的音轨，或从歌单播放');
 return {refs:resolved,context:contexts[0]};
}
module.exports={resolve};
