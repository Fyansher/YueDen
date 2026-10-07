async function resolveOrKeep(candidate,resolve){
 try{
  const value=await resolve(candidate);
  return {value:value||candidate,detailed:Boolean(value),error:null};
 }catch(error){
  if(error?.name==='AbortError')throw error;
  return {value:candidate,detailed:false,error};
 }
}
module.exports={resolveOrKeep};
