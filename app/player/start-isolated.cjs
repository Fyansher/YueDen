const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const runtime=process.argv[2]||path.resolve(__dirname,'../../../runtime-44/extracted/electron.exe');
if(!path.isAbsolute(runtime)||!fs.existsSync(runtime))throw Error('请指定已有 Electron 可执行文件的绝对路径');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(runtime,[path.join(__dirname,'dev-entry.cjs')],{shell:false,windowsHide:true,stdio:'inherit',env});
child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.exitCode=code||0});
