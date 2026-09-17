const fs=require('node:fs');
function validate(value){if(!value||!Array.isArray(value.items)||!Array.isArray(value.categories)||value.items.some(i=>!i||typeof i!=='object'))throw Error('资源库格式损坏，已阻止覆盖；请从备份恢复');if(value.schemaVersion!=null&&(!Number.isInteger(value.schemaVersion)||value.schemaVersion>4||value.schemaVersion<1))throw Error('资源库版本不支持，已阻止覆盖');return value;}
function read(file){let data;try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('资源库无法读取或 JSON 损坏，原文件未覆盖；请从备份恢复');}return validate(data);}
function guard(file){if(fs.existsSync(file))read(file);}
module.exports={validate,read,guard};
