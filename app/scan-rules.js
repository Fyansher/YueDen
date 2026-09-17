/* Optional, local, scoped and explicitly verified rules; never global name guesses. */
const fs=require('node:fs'),path=require('node:path');
const types=new Set(['game','software','book','comic','video','document','unknown_application','unknown_collection']);
function read(dataRoot){
 const file=path.join(dataRoot,'scan-rules.json');try{if(fs.statSync(file).size>256*1024)return [];const value=JSON.parse(fs.readFileSync(file,'utf8'));return (Array.isArray(value)?value:value.rules||[]).slice(0,200).filter(r=>r&&r.verified===true&&typeof r.scope==='string'&&path.isAbsolute(r.scope)&&typeof r.source==='string'&&r.source.trim()&&(!r.type||types.has(r.type))&&(r.entry||r.productName||r.productId));}catch{return [];}
}
module.exports={read};
