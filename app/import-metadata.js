const Model=require('./local-model');
function createImportSearch({steam,search}){
 return async(type,name)=>{
  const query=String(name||'').trim();
  if(type==='game'){
   let items;try{items=await steam(query);}catch(error){if(error.name==='AbortError')throw error;items=[];}
   const bundle={type,integrated:items,sources:[{id:'steam',label:'Steam',state:items.length?'ok':'empty',items}],loading:false};
   // A confident Steam identity need not wait for every other console storefront.
   if(/^appid:\d+$/i.test(query)&&items.length||Model.automaticCandidate(query,type,bundle))return bundle;
  }
  return search(type,query);
 };
}
module.exports={createImportSearch};
