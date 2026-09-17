const fs=require('node:fs'),path=require('node:path');
const KEYS=['webdavPassword','steamApiKey','googleBooksApiKey'],STORED='__UM_STORED_SECRET__';
function publicSettings(value,masked=false){const next=structuredClone(value||{});for(const k of KEYS)next[k]=masked&&next[k]?STORED:'';delete next.credentialRefs;return next;}
function create({directory,safeStorage}){
 const file=()=>path.join(directory(),'credentials.enc.json');
 const atomic=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2));fs.renameSync(p+'.tmp',p);};
 const available=()=>safeStorage?.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text';
 function vault(){if(!fs.existsSync(file()))return {schemaVersion:1,values:{}};const v=JSON.parse(fs.readFileSync(file(),'utf8'));if(v.schemaVersion!==1||!v.values)throw Error('凭据库损坏或版本不支持，未覆盖原文件');return v;}
 function hydrate(config){const next={...config},v=vault();for(const k of KEYS){if(next[k]&&next[k]!==STORED)continue;const ref=config.credentialRefs?.[k];next[k]='';if(ref&&v.values[ref]){try{if(!available())throw Error();next[k]=safeStorage.decryptString(Buffer.from(v.values[ref],'base64'));}catch{next.credentialsUnavailable=true;}}}return next;}
 function prepare(config){const next={...config,credentialRefs:{...config.credentialRefs}},v=vault();let changed=false;
  for(const k of KEYS){const value=config[k];if(value===STORED){delete next[k];continue;}if(typeof value==='string'&&value){if(!available())throw Error('系统安全存储不可用；凭据未保存，请稍后重试');const ref=next.credentialRefs[k]||'settings:'+k;v.values[ref]=safeStorage.encryptString(value).toString('base64');next.credentialRefs[k]=ref;changed=true;}else if(Object.hasOwn(config,k)&&!config.credentialsUnavailable){delete next.credentialRefs[k];}delete next[k];}
  delete next.credentialsUnavailable;if(changed)atomic(file(),v);return next;
 }
 function migrate(config,settingsPath){if(!KEYS.some(k=>config[k]&&config[k]!==STORED))return hydrate(config);if(!available())throw Error('系统安全存储不可用，尚未迁移旧凭据；原设置保持不变');const backup=settingsPath+'.before-secrets.enc';if(!fs.existsSync(backup))fs.writeFileSync(backup,safeStorage.encryptString(JSON.stringify(config)),{flag:'wx'});const clean=prepare(config);atomic(settingsPath,clean);return hydrate(clean);}
 function resolve(input,stored){if(input.webdavPassword===STORED&&((input.webdavUrl!=null&&input.webdavUrl!==stored.webdavUrl)||(input.webdavUsername!=null&&input.webdavUsername!==stored.webdavUsername)))throw Error('连接地址或用户名已改变，请重新输入此连接密码');const next={...stored,...input};for(const k of KEYS)if(next[k]===STORED)next[k]=stored[k]||'';return next;}
 return {prepare,hydrate,migrate,resolve,publicSettings};
}
module.exports={create,publicSettings,KEYS,STORED};
