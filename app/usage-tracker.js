/* One timeline per real window/session. Time goes to the previous resource only. */
function create({record,opened=()=>{},now=()=>performance.now()}){
 let previous=null,at=now();const pending=new Map();
 function sample(next){const time=now(),elapsed=(time-at)/1000;at=time;
  if(previous?.id&&elapsed>0&&elapsed<=10){
   const same=next?.id===previous.id&&next?.generation===previous.generation;
   const playing=previous.playing&&(same?Number(next.position)>Number(previous.position):false);
   const windowSeconds=previous.active?elapsed:0,playbackSeconds=playing?elapsed:0,seconds=previous.active||playing?elapsed:0;
   if(seconds){const row=pending.get(previous.id)||{seconds:0,windowSeconds:0,playbackSeconds:0};for(const [k,v]of Object.entries({seconds,windowSeconds,playbackSeconds}))row[k]+=v;row.lastUsedAt=new Date().toISOString();pending.set(previous.id,row);}
  }
  if(next?.id&&next.id!==previous?.id)opened(next.id);
  previous=next?.id?{...next}:null;
 }
 async function flush(){const rows=[...pending];pending.clear();for(let i=0;i<rows.length;i++){const [id,value]=rows[i];try{await record(id,value);}catch(error){for(const [key,row]of rows.slice(i)){const old=pending.get(key)||{seconds:0,windowSeconds:0,playbackSeconds:0};for(const field of ['seconds','windowSeconds','playbackSeconds'])old[field]+=row[field];old.lastUsedAt=[old.lastUsedAt,row.lastUsedAt].filter(Boolean).sort().at(-1);pending.set(key,old);}throw error;}}}
 return {sample,flush,stop(){sample(null);return flush();}};
}
module.exports={create};
