/* Back up before transforming any existing library. Future schemas fail closed. */
const fs=require('node:fs'),Audio=require('./audio-model');
const VERSION=4;
function validate(v){if(!v||!Array.isArray(v.items)||!Array.isArray(v.categories)||v.items.some(i=>!i||typeof i!=='object'))throw Error('资源库格式损坏，已阻止覆盖');if(v.schemaVersion!=null&&(!Number.isInteger(v.schemaVersion)||v.schemaVersion<1||v.schemaVersion>VERSION))throw Error('资源库版本不支持，已阻止覆盖');return v;}
function migrate(file){
 const raw=fs.readFileSync(file,'utf8');let value;try{value=validate(JSON.parse(raw));}catch(error){throw Error('资源库迁移已停止，原文件未修改：'+error.message);}
 if(value.schemaVersion===VERSION)return value;
 const next={...value,...require("./library-relations").fields(value),schemaVersion:VERSION,items:value.items.map(item=>item.type==='audio'?{...item,audio:Audio.normalize(item.audio)}:item)};
 const backup=file+'.before-schema-'+VERSION+'-'+Date.now()+'.bak';fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
 const temp=file+'.migration.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2),{flag:'wx'});fs.renameSync(temp,file);return next;
}
module.exports={VERSION,validate,migrate};
