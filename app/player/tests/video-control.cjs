// Operates ONLY the isolated diagnostic instance recorded by video-visible.cjs.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const active=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-artifacts/video/active.json')));
if(!active.out.includes('test-artifacts'))throw Error('Isolated instance required');
const action=process.argv[2]||'inspect';
const socket=new WebSocket(action==='close'?active.resourcePage:active.videoPage);
let serial=0;const pending=new Map();
socket.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(expression){const id=++serial;const result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
socket.addEventListener('open',async()=>{try{
 if(action==='close'){await evaluate('unifiedAPI.close()');return}
 if(action==='audio'||action==='video'){
  const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-artifacts/formats/manifest.json')));
  const file=action==='audio'?path.resolve(__dirname,'../test-artifacts/generated audio.wav'):manifest.find(f=>f.video&&f.streams.some(s=>s.codec==='h264')).file;
  await evaluate(`(async()=>{await player.action('drop',${JSON.stringify([file])});const s=await player.snapshot();await player.command({type:'play',id:s.queue.at(-1).queueEntryId})})()`);
  await pause(600);await evaluate("player.command({type:'pause',paused:true})");await pause(400);
 }
 const state=await evaluate('player.snapshot()');const native=JSON.parse(cp.execFileSync(path.join(__dirname,'VideoInspect.exe'),[active.hwnd],{encoding:'utf8',windowsHide:true}));
 const video=native.video;
 if(state.hasVideo){if(!video.visible||video.client.right<=1||native.zOrder.find(r=>r.depth===1).hwnd!==active.hwnd)throw Error('Video child hidden/empty/behind Chromium');}
 else if(action==='audio'&&video.visible)throw Error('Audio did not hide video child');
 const result={action,state,native};fs.writeFileSync(path.join(active.out,action+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({action,hasVideo:state.hasVideo,status:state.status,firstChild:native.zOrder.find(r=>r.depth===1),video}));
 }catch(e){console.error(e);process.exitCode=1}finally{socket.close()}});
setTimeout(()=>{socket.close();if(pending.size)process.exitCode=1},15000).unref();
