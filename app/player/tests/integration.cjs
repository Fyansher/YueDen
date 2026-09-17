const electron=require('electron'),{app,BrowserWindow}=electron,fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.UM_PLAYER_TEST_ARTIFACTS||path.resolve(__dirname,'../test-artifacts'),root=fs.mkdtempSync(path.join(base,'integration-user-data-')),appDir=process.env.UM_PLAYER_TEST_APP||path.resolve(__dirname,'../..');
const {MpvBackend}=require(path.join(appDir,'player/dist/mpv-backend'));
const setter=app.setPath.bind(app);app.setPath=(key,value)=>setter(key,key==='userData'?root:value);setter('userData',root);
const video=path.join(base,'generated video.mkv'),audio=path.join(base,'generated audio.wav');
fs.writeFileSync(path.join(root,'library.json'),JSON.stringify({schemaVersion:4,items:[{id:'movie-test',type:'movie',name:'影视测试',localPath:video,localFiles:[{path:video,name:'影视第一集'}]},{id:'anime-test',type:'anime',name:'番剧测试',localPath:video,localFiles:[{path:video,name:'番剧第一集'}]},{id:'audio-test',type:'audio',name:'声音测试',audio:{kind:'music',collectionKind:'album',tracks:[{id:'track-test',title:'声音第一轨',sourceRefs:['source-test']}],sources:[{id:'source-test',kind:'local',localPath:audio}]}}],categories:[]}));
process.env.UM_PLAYER_SNAP_TRACE='1';const checks=[],errors=[];let main,done=false;
app.on('web-contents-created',(_,contents)=>contents.on('console-message',(_,level,message)=>{if(level===3)errors.push(message)}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let n=0;n<100;n++){if(await fn())return;await delay(100)}throw Error('集成等待超时')}
const js=(win,source)=>win.webContents.executeJavaScript(source);
async function finish(error){if(done)return;done=true;try{await MpvBackend.owner?.close()}catch{}fs.writeFileSync(path.join(base,'integration.json'),JSON.stringify({time:new Date().toISOString(),checks,errors,error:error?.stack||null,isolatedData:root},null,2));for(const win of BrowserWindow.getAllWindows())win.destroy();app.exit(error?1:0)}
app.whenReady().then(async()=>{try{
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));return main});
  await until(()=>js(main,'Boolean(window.audioPlayer&&window.unifiedAPI)'));
  assert.equal(await js(main,'document.querySelectorAll("audio,video").length'),0);checks.push('资源管理器未创建独立 HTML 音视频引擎');
  await js(main,'unifiedAPI.launchReader("movie-test")');await until(async()=>{const s=await js(main,'unifiedAPI.playerSnapshot()');return s.status==='playing'&&s.position>0});
  const primary=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='main');assert.ok(primary);const processId=MpvBackend.owner.process.pid;checks.push('影视原入口真实播放并创建唯一主播放器');
  await js(main,'unifiedAPI.launchReader("anime-test")');assert.equal(BrowserWindow.getAllWindows().filter(w=>w.umPlayerKind==='main').length,1);assert.equal(MpvBackend.owner.process.pid,processId);checks.push('番剧原入口复用同一窗口与 mpv 进程');
  await js(main,'audioPlayer.command("play",[{itemId:"audio-test",trackId:"track-test"}])');await until(async()=>{const s=await js(main,'unifiedAPI.playerSnapshot()');return s.status==='playing'&&!s.hasVideo&&s.position>0});assert.equal(MpvBackend.owner.process.pid,processId);checks.push('声音原入口复用同一进程，音轨关联正确并清除视频状态');
  await js(main,'unifiedAPI.playerCommand({type:"pause",paused:true})');
  for(const kind of ['lyrics','queue','eq']){
    for(let n=0;n<20;n++){await js(main,`unifiedAPI.playerAction('aux',${JSON.stringify(kind)})`);const win=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind===kind);assert.ok(win);win.close();}
    assert.equal(BrowserWindow.getAllWindows().filter(w=>w.umPlayerKind===kind).length,1);
  }
  assert.equal(MpvBackend.owner.process.pid,processId);checks.push('三个辅助窗口各关闭/重开20次，无重复实例，mpv进程保持');
  const formats=JSON.parse(fs.readFileSync(path.join(base,'formats/manifest.json'),'utf8')),results=[];
  for(const format of formats){try{assert.equal(format.status,'generated-not-played');await js(main,`unifiedAPI.playerAction('drop',[${JSON.stringify(format.file)}])`);let s=await js(main,'unifiedAPI.playerSnapshot()');const id=s.queue.at(-1).queueEntryId;await js(main,`unifiedAPI.playerCommand({type:'play',id:${JSON.stringify(id)}})`);await until(async()=>{s=await js(main,'unifiedAPI.playerSnapshot()');return s.status==='playing'&&s.position>0});assert.equal(s.hasVideo,format.video);assert.equal(MpvBackend.owner.process.pid,processId);results.push({...format,status:'backend-decoding-and-progress-passed',position:s.position,audioOutputVerified:false,visualVerified:false})}catch(error){results.push({...format,status:'playback-failed',error:error.message})}}
  fs.writeFileSync(path.join(base,'formats/played.json'),JSON.stringify(results,null,2));assert.ok(results.every(r=>r.status==='backend-decoding-and-progress-passed'));checks.push('12组基础容器/编码由完整应用实际播放，进度前进；声音采集和画面人工验收未执行');
  await js(main,"unifiedAPI.playerAction('eq',{enabled:true,gains:[0,0,0,0,0,6,0,0,0,0]})");const eqState=await js(main,'unifiedAPI.playerSnapshot()');assert.equal(eqState.eq.gains[5],6);await js(main,"unifiedAPI.playerAction('eq',{enabled:false,gains:[0,0,0,0,0,6,0,0,0,0]})");assert.equal((await js(main,'unifiedAPI.playerSnapshot()')).eq.gains[5],6);checks.push('完整应用EQ启用/旁路保留增益，命令成功；实际音频输出未采集');
  await js(main,"unifiedAPI.playerAction('aux','lyrics')");const lyricWindow=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='lyrics');primary.minimize();await delay(150);assert.equal(lyricWindow.isVisible(),false);primary.restore();await delay(150);assert.equal(lyricWindow.isVisible(),true);primary.setFullScreen(true);await delay(150);assert.equal(lyricWindow.isVisible(),false);primary.setFullScreen(false);await delay(150);assert.equal(lyricWindow.isVisible(),true);checks.push('主播放器最小化/全屏暂隐藏辅助窗，退出恢复用户显隐');
  await js(main,"unifiedAPI.playerAction('aux','queue')");const queueWindow=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='queue');primary.hide();
  for(const [direction,sourcePos,targetPos]of [['left',[100,120],[550,120]],['right',[1000,120],[550,120]],['top',[550,100],[550,650]],['bottom',[550,750],[550,200]]]){
    lyricWindow.setBounds({x:sourcePos[0],y:sourcePos[1],width:300,height:300});queueWindow.setBounds({x:targetPos[0],y:targetPos[1],width:320,height:300});await delay(250);const before=lyricWindow.getSize();
    const nativeDrag=await new Promise((resolve,reject)=>require('node:child_process').execFile(path.join(appDir,'player/native/DragProbe.exe'),[lyricWindow.getNativeWindowHandle().readBigUInt64LE().toString(),queueWindow.getNativeWindowHandle().readBigUInt64LE().toString(),direction],{windowsHide:true,timeout:10000},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))));
    checks.push({direction,nativeTitlebarDrag:nativeDrag,trace:direction==='top'?lyricWindow.umSnapTrace:undefined});assert.ok(Math.abs(nativeDrag.snapGapPixels)<=1,'原生标题栏接近目标应贴合');assert.ok(nativeDrag.detachGapPixels>20,'原生拖动应能解除');assert.ok(Math.abs(nativeDrag.altGapPixels)>1,'拖动途中Alt应禁用吸附');assert.deepEqual(lyricWindow.getSize(),before,'吸附不改窗口尺寸');
  }primary.show();
  await js(main,'unifiedAPI.playerCommand({type:"stop"})');let s=await js(main,'unifiedAPI.playerSnapshot()');assert.equal(s.position,0);assert.ok(s.currentId);checks.push('停止归零且保留当前媒体');
  primary.close();await until(()=>!MpvBackend.owner);assert.ok(!main.isDestroyed());checks.push('关闭主播放器后后端清理，资源管理器仍运行');
  await finish();
}catch(error){await finish(error)}});
setTimeout(()=>finish(Error('集成总超时')),60000);require(path.join(appDir,'main.js'));
