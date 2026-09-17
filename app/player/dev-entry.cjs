// Development-only bootstrap. Never use the executable's shared/production user-data.
const {app}=require('electron'),path=require('node:path'),fs=require('node:fs');
const directory=path.join(__dirname,'dev-user-data');fs.mkdirSync(directory,{recursive:true});
const setPath=app.setPath.bind(app);app.setPath=(name,value)=>setPath(name,name==='userData'?directory:value);setPath('userData',directory);
require('../main.js');
