const path=require('node:path');
function install({ipcMain,dataRoot,loadLibrary,now=()=>performance.now()}){
 const store=require('./reader-progress-store').createProgressStore(()=>path.join(dataRoot(),'usage-records.json'));let tail=Promise.resolve();const beats=new Map(),timelines=new Set();
 const serial=fn=>{const work=tail.then(fn);tail=work.catch(()=>{});return work;};
 const exists=id=>typeof id==='string'&&loadLibrary().items.some(i=>i.id===id);
 const add=(id,delta)=>serial(async()=>{if(!exists(id))return;const old=store.read()[id]||{},next={...old};for(const key of ['seconds','windowSeconds','playbackSeconds'])next[key]=(Number(old[key])||0)+Math.max(0,Number(delta[key])||0);if(delta.lastUsedAt)next.lastUsedAt=[old.lastUsedAt,delta.lastUsedAt].filter(Boolean).sort().at(-1);return store.save(id,next);});
 const open=id=>serial(()=>{if(!exists(id))throw Error('资源不存在');return store.save(id,{...(store.read()[id]||{}),openedAt:new Date().toISOString()});});
 const update=(event,id,seconds)=>{if(!exists(id))return Promise.reject(Error('资源不存在'));const key=event.sender.id+':'+id,time=now(),prior=beats.get(key)??time;beats.set(key,time);if(beats.size>1000)beats.delete(beats.keys().next().value);return seconds==null?open(id):add(id,{seconds:Math.max(0,Math.min(10,Number(seconds)||0,(time-prior)/1000))});};
 function timeline(read){const tracker=require('./usage-tracker').create({now,record:add,opened:id=>{void open(id).catch(error=>console.error('最近使用记录未保存：',error));}});const api={sample:()=>tracker.sample(read()),flush:()=>{api.sample();return tracker.flush();},reset:()=>tracker.stop(),close:()=>{timelines.delete(api);return tracker.stop();}};timelines.add(api);return api;}
 async function flush(){await Promise.all([...timelines].map(t=>t.flush()));await tail;}
 const decorate=library=>{const records=store.read();return {...library,items:library.items.map(item=>require('./usage-model').fill(item,records))};};
 ipcMain.handle('usage:snapshot',async()=>{await flush();return store.read();});ipcMain.handle('usage:opened',(e,id)=>update(e,id));ipcMain.handle('usage:tick',(e,id,seconds)=>update(e,id,seconds));
 return {timeline,flush,decorate,async stop(){await Promise.all([...timelines].map(t=>t.close()));await tail;await store.flush();}};
}
module.exports={install};
