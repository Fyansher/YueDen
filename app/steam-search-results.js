/* Preserve the order supplied by each Steam search endpoint. Steam localizes
   titles, so a second textual relevance pass can discard its best result. */
function preserveCandidateOrder(entries,limit=40){
 const unique=new Map();
 for(const entry of Array.isArray(entries)?entries:[]){
  const id=String(entry?.id||entry?.appid||entry?.steamAppId||'');
  if(!/^\d+$/.test(id)||!entry?.name)continue;
  const previous=unique.get(id);
  if(!previous)unique.set(id,{...entry,id});
  else unique.set(id,{...entry,...previous,id,tiny_image:previous.tiny_image||entry.tiny_image||''});
 }
 return [...unique.values()].slice(0,limit);
}
module.exports={preserveCandidateOrder};
