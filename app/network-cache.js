// Only network response caches. Never clear session storage or filesystem directories.
function create({session,metadata,steam}){
 let pending=null;
 async function size(){return {httpBytes:await session().getCacheSize(),memoryBytes:Math.max(0,metadata.cacheSize()-2)+Math.max(0,steam.size()-2)};}
 async function perform(){
  const errors=[];let before=null,after=null;
  try{before=await size();}catch(error){errors.push('清除前大小查询失败：'+error.message);}
  for(const [name,clear] of [['HTTP 缓存',()=>session().clearCache()],['元数据缓存',()=>metadata.clearCache()],['Steam 查询缓存',()=>steam.clear()]]){
   try{await clear();}catch(error){errors.push(name+'清除失败：'+error.message);}
  }
  try{after=await size();}catch(error){errors.push('清除后大小查询失败：'+error.message);}
  return {before,after,errors};
 }
 function clear(){if(!pending)pending=perform().finally(()=>{pending=null;});return pending;}
 return {size,clear};
}
module.exports={create};
