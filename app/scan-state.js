/* Preserve manual corrections separately from the immutable automatic snapshot. */
function track(item){
 if(!item.scanInfo||typeof item.scanInfo!=='object')return null;
 const info=structuredClone(item.scanInfo),automatic=info.automatic||{},overrides={...info.userOverrides};
 for(const key of ['type','name','localPath'])if(Object.hasOwn(automatic,key)&&Object.hasOwn(item,key)&&item[key]!==automatic[key])overrides[key]=item[key];
 return {...info,userOverrides:overrides};
}
module.exports={track};
