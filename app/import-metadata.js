function createImportSearch({search}){
 return async(type,name,options={})=>search(type,String(name||'').trim(),options);
}
module.exports={createImportSearch};
