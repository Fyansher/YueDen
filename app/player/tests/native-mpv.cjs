const {app,BrowserWindow}=require('electron'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),readline=require('node:readline');
const {MpvBackend}=require('../dist/mpv-backend');
const root=path.resolve(__dirname,'../test-artifacts');fs.mkdirSync(root,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(root,'mpv-user-data-')));
app.on('window-all-closed',()=>{});
let helper,win,backend,finished=false;const checks=[];
async function finish(error){if(finished)return;finished=true;try{await backend?.close()}catch(e){error ||= e}helper?.stdin.end();helper?.kill();if(win&&!win.isDestroyed())win.destroy();fs.writeFileSync(path.join(root,'native-mpv.json'),JSON.stringify({time:new Date().toISOString(),checks,error:error?.stack||null,audioCaptured:false,manualVisualVerified:false},null,2));app.exit(error?1:0)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function position(generation){for(let n=0;n<40;n++){const s=await backend.sample(generation);if(s?.position>0)return s;await delay(100)}throw Error('实际后端进度未前进')}
app.whenReady().then(async()=>{try{
  win=new BrowserWindow({show:true,width:1024,height:640,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>Unified Manager 播放器隔离验证</title><body style="margin:0;background:#111;color:white"><div style="height:450px"></div><button id="control">测试控制栏</button></body>'));
  const hwnd=win.getNativeWindowHandle().readBigUInt64LE().toString();helper=spawn(path.resolve(__dirname,'../native/VideoHost.exe'),[hwnd],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});helper.on('error',finish);
  const lines=(async function*(){for await(const line of readline.createInterface({input:helper.stdout}))if(!/^(pointer|frame) /.test(line))yield line})();const hello=JSON.parse((await lines.next()).value);assert.equal(hello.parent,hwnd);
  helper.stdin.write('0 0 800 440\n');assert.equal((await lines.next()).value,'sized');
  backend=new MpvBackend(path.resolve(__dirname,'../vendor/mpv.exe'),hello.hwnd);
  await backend.load(path.join(root,'generated video.mkv'),1,0);let sample=await position(1);assert.equal(sample.hasVideo,true);checks.push({name:'真实生成视频由嵌入子窗口的 mpv 解码，进度前进',sample});
  await backend.pause(true);assert.equal((await backend.sample(1)).paused,true);await backend.seek(2);await backend.pause(false);checks.push({name:'暂停/定位/继续命令和后端状态通过'});
  await backend.equalizer({enabled:true,gains:[0,0,0,0,0,6,0,0,0,0]});sample=await position(1);assert.ok(sample.position>=2);checks.push({name:'运行时滤镜命令成功，无重新加载媒体；实际输出效果尚未采集',sample});
  await backend.equalizer({enabled:false,gains:Array(10).fill(0)});
  win.setSize(800,520);helper.stdin.write('0 0 650 360\n');assert.equal((await lines.next()).value,'sized');win.setFullScreen(true);await delay(150);win.setFullScreen(false);
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("control").textContent'),'测试控制栏');checks.push({name:'缩放/全屏切换后控制栏 DOM 仍在；原生遮挡和真实点击未人工验收'});
  await backend.load(path.join(root,'generated audio.wav'),2,0);sample=await position(2);assert.equal(sample.hasVideo,false);helper.stdin.write('hide\n');assert.equal((await lines.next()).value,'hidden');checks.push({name:'真实纯音频进度前进，无视频参数，子区域隐藏',sample});
  await backend.stop();await finish();
}catch(error){await finish(error)}});
setTimeout(()=>finish(Error('真实 mpv 核查超时')),40000);
