/* Durable URL -> validated content-addressed image mapping; no library field writes. */
const fs=require('node:fs'),path=require('node:path');
function createCoverUrlCache(store){
 let entries=null;const file=()=>path.join(store.root(),'url-index.json');
 const exists=ref=>{const p=store.fileFor(ref);return Boolean(p&&fs.existsSync(p));};
 function load(){if(entries)return;try{const data=JSON.parse(fs.readFileSync(file(),'utf8'));entries=new Map(Object.entries(data).filter(([url,ref])=>/^https:\/\//i.test(url)&&exists(ref)).slice(-2000));}catch{entries=new Map();}}
 function lookup(url){load();const value=entries.get(url);if(value&&exists(value))return value;entries.delete(url);return '';}
 function remember(url,ref){if(!/^https:\/\//i.test(url)||!exists(ref))return;load();entries.delete(url);entries.set(url,ref);while(entries.size>2000)entries.delete(entries.keys().next().value);
  try{fs.mkdirSync(store.root(),{recursive:true});const temporary=file()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(Object.fromEntries(entries)));fs.renameSync(temporary,file());}catch{/* An unavailable cache must not discard a usable image. */}
 }
 function forget(url){load();entries.delete(url);try{fs.writeFileSync(file()+'.tmp',JSON.stringify(Object.fromEntries(entries)));fs.renameSync(file()+'.tmp',file());}catch{}}
 return {lookup,remember,exists,forget};
}
module.exports={createCoverUrlCache};
