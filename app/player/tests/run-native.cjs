const {spawn}=require('node:child_process'),path=require('node:path');
const runtime=process.argv[2];if(!runtime||!path.isAbsolute(runtime))throw Error('Pass an absolute Electron executable path');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const script=({mpv:'native-mpv.cjs',integration:'integration.cjs'})[process.argv[3]]||'native-host.cjs';
const child=spawn(runtime,[path.join(__dirname,script)],{windowsHide:true,shell:false,stdio:'inherit',env});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;console.error('Native probe process timeout');},65000);
child.once('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1});
child.once('exit',code=>{clearTimeout(timer);process.exitCode=code===0?0:1;console.log('Native probe exit:',code)});
