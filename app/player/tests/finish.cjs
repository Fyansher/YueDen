// Focused final checks; never opens production user-data or repeats the codec matrix.
const electron=require('electron'),{app,BrowserWindow,screen}=electron,fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const mode=process.env.UM_FINISH_MODE||'release',appDir=process.env.UM_PLAYER_TEST_APP||path.resolve(__dirname,'../..'),base=path.resolve(__dirname,'../test-artifacts/finish');fs.mkdirSync(base,{recursive:true});
const data=fs.mkdtempSync(path.join(base,mode+'-')),setPath=app.setPath.bind(app);app.setPath=(k,v)=>setPath(k,k==='userData'?data:v);setPath('userData',data);
const fixture=path.resolve(__dirname,'../test-artifacts'),video=path.join(fixture,'generated video.mkv'),audio=path.join(fixture,'generated audio.wav');
const pcm=path.join(data,'output.s16le');
if(mode==='eq'){const spawn=cp.spawn;cp.spawn=function(file,args,options){if(path.basename(file).toLowerCase()==='mpv.exe')args=[...args,'--ao=pcm','--ao-pcm-waveheader=no','--ao-pcm-append=yes','--ao-pcm-file='+pcm,'--audio-format=s16','--audio-samplerate=48000','--audio-channels=stereo'];return spawn(file,args,options)}}
fs.writeFileSync(path.join(data,'library.json'),JSON.stringify({schemaVersion:4,items:[{id:'movie-test',type:'movie',name:'影视测试',localPath:video,localFiles:[{path:video,name:'影视'}]},{id:'anime-test',type:'anime',name:'番剧测试',localPath:video,localFiles:[{path:video,name:'番剧'}]},{id:'audio-test',type:'audio',name:'声音测试',audio:{kind:'music',collectionKind:'album',tracks:[{id:'track-test',title:'声音',sourceRefs:['source-test']}],sources:[{id:'source-test',kind:'local',localPath:audio}]}}],categories:[]}));
const {MpvBackend}=require(path.join(appDir,'player/dist/mpv-backend'));let main,finished=false,processId;const checks=[],errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms)),js=(w,s)=>w.webContents.executeJavaScript(s);
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await delay(100)}throw Error('等待超时')}
const snapshot=()=>js(main,'unifiedAPI.playerSnapshot()'),action=(n,v)=>js(main,`unifiedAPI.playerAction(${JSON.stringify(n)},${JSON.stringify(v)})`),command=v=>js(main,`unifiedAPI.playerCommand(${JSON.stringify(v)})`);
async function finish(error){if(finished)return;finished=true;try{await MpvBackend.owner?.close()}catch(e){error||=e}let residual=false;if(processId)try{process.kill(processId,0);residual=true}catch{}if(residual)error||=Error('mpv仍存活');fs.writeFileSync(path.join(base,mode+'-result.json'),JSON.stringify({time:new Date().toISOString(),appDir,data,checks,errors,error:error?.stack||null,mpvResidual:residual,manualListening:false},null,2));for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(error?1:0)}
app.on('web-contents-created',(_,w)=>w.on('render-process-gone',(_,detail)=>errors.push(detail)));
app.whenReady().then(async()=>{try{
 await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));return main});await until(()=>js(main,'Boolean(window.unifiedAPI&&window.audioPlayer)'));
 await js(main,'unifiedAPI.launchReader("movie-test")');await until(async()=>{const s=await snapshot();return s.status==='playing'&&s.position>0});processId=MpvBackend.owner.process.pid;const primary=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='main');
 if(mode==='snap'){
  await command({type:'pause',paused:true});await action('aux','lyrics');await action('aux','queue');main.hide();primary.hide();
  const source=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='lyrics'),target=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='queue'),area=screen.getPrimaryDisplay().workArea;
  const direction=process.env.UM_SNAP_DIRECTION||'left',positions={left:[340,450],right:[1074,450],top:[700,100],bottom:[700,774]},position=positions[direction];source.setBounds({x:area.x+position[0],y:area.y+position[1],width:300,height:300});target.setBounds({x:area.x+700,y:area.y+450,width:320,height:300});source.setTitle('歌词 · '+direction);source.show();target.showInactive();
  const tick=setInterval(()=>fs.writeFileSync(path.join(base,'snap-'+direction+'-live.json'),JSON.stringify({source:source.getBounds(),target:target.getBounds(),displays:screen.getAllDisplays(),trace:source.umSnapTrace},null,2)),200);
  setTimeout(()=>{clearInterval(tick);checks.push('桌面交互观察，不能代替人工完整验收');void finish()},120000);return;
 }
 if(mode==='eq'){
  // Fixed 250Hz + 1kHz, low amplitude, stereo; no private audio or microphone input.
  const wav=path.join(data,'fixed.wav'),seconds=3,rate=48000,b=Buffer.alloc(44+rate*seconds*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);for(let i=0;i<rate*seconds;i++){const v=Math.round(1800*(Math.sin(2*Math.PI*250*i/rate)+Math.sin(2*Math.PI*1000*i/rate)));b.writeInt16LE(v,44+i*4);b.writeInt16LE(v,46+i*4)}fs.writeFileSync(wav,b);
  const mkv=path.join(data,'fixed.mkv');cp.execFileSync(path.join(appDir,'codec/bin/ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:r=10:d=3','-i',wav,'-c:v','ffv1','-c:a','pcm_s16le','-shortest',mkv],{windowsHide:true});
  function amplitude(bytes,hz){let re=0,im=0,n=Math.floor(bytes.length/4);for(let i=0;i<n;i++){const v=bytes.readInt16LE(i*4);re+=v*Math.cos(2*Math.PI*hz*i/rate);im+=v*Math.sin(2*Math.PI*hz*i/rate)}return 2*Math.hypot(re,im)/n}
  for(const file of [wav,mkv]){
   await action('drop',[file]);let s=await snapshot();await command({type:'play',id:s.queue.at(-1).queueEntryId});await command({type:'volume',value:100,muted:false});const rows=[];
   for(const [label,enabled,band,gain]of [['bypass',false,5,0],['1k+6',true,5,6],['1k-6',true,5,-6],['250+6',true,3,6],['disabled',false,3,6]]){
    const gains=Array(10).fill(0);gains[band]=gain;await action('eq',{enabled,gains});const start=fs.statSync(pcm).size;await command({type:'play',id:s.queue.at(-1).queueEntryId});await until(()=>fs.statSync(pcm).size-start>rate*4*2.5);await delay(150);const end=fs.statSync(pcm).size;assert.ok(end-start>rate*4*2.5,'PCM output advances');const bytes=fs.readFileSync(pcm).subarray(end-rate*4/2,end),a=amplitude(bytes,250),b=amplitude(bytes,1000);rows.push({label,a250:a,a1000:b,ratioDb:20*Math.log10(b/a)});
   }
   assert.ok(rows[1].ratioDb-rows[0].ratioDb>4);assert.ok(rows[2].ratioDb-rows[0].ratioDb< -4);assert.ok(rows[3].ratioDb-rows[0].ratioDb< -4);assert.ok(Math.abs(rows[4].ratioDb-rows[0].ratioDb)<.6);checks.push({file:path.basename(file),rows,verified:'actual app mpv PCM output; NOT Windows endpoint loopback or human listening'});
  }await finish();return;
 }
 checks.push('包内影视实际mpv解码、进度前进');await js(main,'unifiedAPI.launchReader("anime-test")');assert.equal(MpvBackend.owner.process.pid,processId);
 await js(main,'audioPlayer.command("play",[{itemId:"audio-test",trackId:"track-test"}])');await until(async()=>{const s=await snapshot();return s.status==='playing'&&!s.hasVideo&&s.position>0});assert.equal(MpvBackend.owner.process.pid,processId);checks.push('三类原入口同窗口同mpv；视频转纯音频');
 await command({type:'pause',paused:true});assert.equal((await snapshot()).status,'paused');await command({type:'seek',seconds:2});await command({type:'pause',paused:false});checks.push('暂停/定位/继续');
 for(const kind of ['lyrics','queue','eq']){await action('aux',kind);let w=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind===kind);w.close();assert.equal(w.isDestroyed(),false);assert.equal(w.isVisible(),false);await action('aux',kind);assert.equal(BrowserWindow.getAllWindows().filter(w=>w.umPlayerKind===kind).length,1)}checks.push('三辅助窗关闭隐藏并复用');
 await command({type:'stop'});assert.equal((await snapshot()).position,0);assert.ok((await snapshot()).currentId);primary.close();await until(()=>!MpvBackend.owner);assert.equal(main.isDestroyed(),false);checks.push('停止保留条目；关闭播放器停止mpv、关闭辅助窗、保留资源主窗');
 await js(main,'unifiedAPI.launchReader("movie-test")');await until(()=>Boolean(MpvBackend.owner?.process));processId=MpvBackend.owner.process.pid;checks.push('重新打开播放器正常');
 // Exercise real main-window close, report before app termination using before-quit.
 app.on('will-quit',()=>{fs.writeFileSync(path.join(base,mode+'-result.json'),JSON.stringify({time:new Date().toISOString(),appDir,data,checks,errors,error:null,mpvPid:processId,mainExitRequested:true,manualListening:false},null,2))});main.close();
}catch(e){await finish(e)}});
process.env.UM_PLAYER_SNAP_TRACE='1';setTimeout(()=>finish(Error('收尾测试超时')),mode==='snap'?125000:65000);require(path.join(appDir,'main.js'));
