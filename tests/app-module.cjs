const path=require('node:path');
const directory=process.env.UNIFIED_TEST_APP_DIR||path.resolve(__dirname,'../app');
function appModule(name){return require(path.join(directory,name));}
appModule.resolve=name=>require.resolve(path.join(directory,name));
module.exports=appModule;
