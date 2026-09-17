const fs=require('node:fs'),path=require('node:path');
function create(root){
 const file=()=>path.join(root(),'dialog-locations.json');
 const read=()=>{try{const v=JSON.parse(fs.readFileSync(file(),'utf8'));if(v?.schema!==1||!v.locations||typeof v.locations!=='object')throw Error('Invalid dialog history');return v;}catch(e){if(e.code==='ENOENT')return {schema:1,locations:{}};throw e;}};
 return {get(key){try{const value=read().locations[key];return typeof value==='string'&&path.isAbsolute(value)&&fs.existsSync(value)?value:undefined;}catch{return undefined;}},set(key,selected){
  if(typeof selected!=='string'||!path.isAbsolute(selected)||!fs.existsSync(selected))return;
  try{const v=read();v.locations[key]=fs.statSync(selected).isDirectory()?selected:path.dirname(selected);fs.mkdirSync(root(),{recursive:true});fs.writeFileSync(file()+'.tmp',JSON.stringify(v));fs.renameSync(file()+'.tmp',file());}catch{/* A damaged history is never overwritten; selection itself remains usable. */}
 }};
}
function wrap(dialog,root){const memory=create(root);return new Proxy(dialog||{},{get(target,key){if(key!=='showOpenDialog')return target[key];return async(...args)=>{const index=args.length-1,options=args[index],scope=options.title||'resource';args[index]={...options,defaultPath:options.defaultPath||memory.get(scope)||options.fallbackPath};const result=await target.showOpenDialog(...args);if(!result.canceled&&result.filePaths?.length)memory.set(scope,result.filePaths[0]);return result;};}});}
module.exports={create,wrap};
