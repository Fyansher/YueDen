// Real Windows System.Speech through the same backend; no Electron UI and no audible output.
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const handlers=new Map(),ipc=new EventEmitter();ipc.handle=(name,fn)=>handlers.set(name,fn);const win=new EventEmitter();win.isDestroyed=()=>false;
require('../app/reader-speech').installReaderSpeech(ipc,()=>win);
const report={runtime:process.versions,platform:process.platform,audible:false,electronWindow:false,at:new Date().toISOString()};
(async()=>{try{const call=request=>handlers.get('reader:speech')({sender:{id:1}},request);report.voices=await call({action:'voices'});if(!report.voices.length)throw Error('未找到本机语音');report.playback=await call({action:'start',text:'Hello reader.',volume:0});report.ok=report.playback.completed===true;}catch(e){report.ok=false;report.error=e.message;}fs.writeFileSync(path.resolve(__dirname,'../docs/test-results/reader-speech-runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.ok?0:1;})();
