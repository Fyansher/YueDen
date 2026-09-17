/* Recognize an installation before visiting its assets. No executables are run. */
const fs=require('node:fs/promises'),path=require('node:path');
const helper=/unins|setup|crash|update|vcredist|dxsetup|reporter|cefsubprocess|notification|installer|EOSBootstrapper|UnityPlayer|UE4Prereq|service|benchmark/i;
const binaryDir=/^(?:bin(?:aries)?(?:_pc)?|exe(?:32|64)?|win(?:32|64)|x64|x86|game|engine)$/i;
async function identify(dir,rows,{signal}={}){
 const check=()=>{if(signal?.aborted)throw Error('已停止扫描');};check();
 const direct=rows.filter(r=>r.isFile()&&/\.exe$/i.test(r.name)&&!helper.test(r.name));
 const marked=rows.some(r=>r.isDirectory()&&/^(?:\.egstore|.+_Data|MonoBleedingEdge|Engine)$/i.test(r.name));
 const launcher=rows.find(r=>r.isFile()&&/\.(cmd|bat)$/i.test(r.name)&&!helper.test(r.name));
 if(!direct.length&&!marked&&!launcher&&!rows.some(r=>r.isDirectory()&&binaryDir.test(r.name)))return null;
 const candidates=direct.map(r=>path.join(dir,r.name));let inspected=rows.filter(r=>r.isFile()).length;
 async function binaries(folder,depth){check();let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch{return;}for(const r of entries){check();if(r.isSymbolicLink())continue;if(r.isFile()){inspected++;if(/\.exe$/i.test(r.name)&&!helper.test(r.name))candidates.push(path.join(folder,r.name));}else if(depth<3&&binaryDir.test(r.name))await binaries(path.join(folder,r.name),depth+1);}}
 for(const r of rows)if(r.isDirectory()&&binaryDir.test(r.name))await binaries(path.join(dir,r.name),1);
 if(!candidates.length)return null;
 // Unmarked collections of separate EXEs are not assumed to be one installation.
 if(!marked&&!launcher&&direct.length>1)return null;
 let target='';if(launcher){try{const source=(await fs.readFile(path.join(dir,launcher.name),'utf8')).slice(0,16384);target=source.match(/["']([\w .-]+\.exe)["']/i)?.[1]||'';}catch{}}
 const rank=file=>{const name=path.basename(file),stem=path.basename(file,'.exe');return (name.toLowerCase()===target.toLowerCase()?100:0)+(path.dirname(file)===dir?20:0)+(path.basename(dir).toLowerCase().startsWith(stem.toLowerCase())?15:0)-(/(?:_gl|_dx\d*|safe|config|launcher|editor)/i.test(name)?30:0)-(/Engine/i.test(path.relative(dir,file))?60:0);};
 candidates.sort((a,b)=>rank(b)-rank(a)||a.localeCompare(b));
 let name=path.basename(candidates[0],'.exe').replace(/[-_]?(?:Win64|Win32)[-_]?Shipping$/i,'');
 if(launcher&&name.length<5)name=path.basename(launcher.name,path.extname(launcher.name));
 if(name.length<4||/^(?:game|start|nw|launch)$/i.test(name))name=path.basename(dir);
 name=name.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ');
 return {name,paths:candidates,inspected,root:dir};
}
module.exports={identify,helper};
