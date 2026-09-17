// Real H.264 and independent GetCursorInfo samples; never infer visibility from CSS.
const electron=require('electron'),{app,BrowserWindow,ipcMain}=electron,fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'yueden-cursor-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});
const evidence={},checks=[],baseline=process.argv.includes('--baseline'),crash=process.argv.find(a=>a.startsWith('--crash='))?.split('=')[1];
let service,handle,hostProcess,original,peer;
const js=(w,s)=>w.webContents.executeJavaScript(s),check=(name,ok)=>{assert.ok(ok,name);checks.push(name)};
async function until(f,label){for(let n=0;n<80;n++){if(await f())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout '+label)}
const S=require('../app/player/dist/surface').NativeSurface,open=S.prototype.open;
S.prototype.open=async function(exe,parent){const result=await open.call(this,baseline?path.resolve('test-artifacts/final-three/baseline-VideoHost.exe'):exe,parent);hostProcess=this.child;return result};
const probe=(...args)=>require('./cursor-probe.cjs').create(handle)(...args);
async function visible(name){let value;await until(async()=>{value=await probe('read');return value.flags===1},name);evidence[name]=value;check(name,true)}
async function idle(name){let value;await until(async()=>{value=await probe('read');return value.flags===0},name);evidence[name]=value;check(name,true)}
app.whenReady().then(async()=>{try{
 const file=JSON.parse(fs.readFileSync('app/player/test-artifacts/formats/manifest.json')).find(x=>x.name==='h264').file;
 service=require('../app/player/dist/service').createPlayerService({electron,ipcMain,loadLibrary:()=>({items:[{id:'video',type:'movie',name:'H264',localPath:file,localFiles:[{path:file,name:'H264'}]}]}),dataRoot:()=>root,disguised:()=>false});
 await service.openResource('video');const p=BrowserWindow.getAllWindows().find(w=>w.umPlayerKind==='main');handle=p.getNativeWindowHandle().readBigUInt64LE().toString();original=await probe('read');
 await until(()=>js(p,'player.snapshot().then(s=>s.hasVideo&&s.position>0)'),'H264 decode');check('real H264 decode',true);await js(p,'player.command({type:"pause",paused:true})');const before=p.getBounds();
 p.show();p.focus();await until(()=>p.isFocused(),'focus before fullscreen key');evidence.focus=await probe('focus');evidence.target=handle;evidence.prekey=await probe('read');await probe('key','f');await until(()=>p.isFullScreen(),'F fullscreen');await until(()=>js(p,'!document.body.classList.contains("controls-visible")'),'controls hidden');
 const frame=await probe(),center=[frame.x+Math.floor(frame.width/2),frame.y+Math.floor(frame.height/2)],bottom=[center[0],frame.y+frame.height-30];
 await probe('move',...center);await visible('start visible');await idle('native video idle hidden');
 if(crash==='app'){fs.mkdirSync('test-artifacts/final-three',{recursive:true});fs.writeFileSync('test-artifacts/final-three/app-crash-ready.json',JSON.stringify({pid:process.pid,handle,hostPid:hostProcess.pid,mpvPid:require('../app/player/dist/mpv-backend').MpvBackend.owner.process.pid}));await new Promise(()=>{});}
 if(crash){if(crash==='host')hostProcess.kill();else p.webContents.forcefullyCrashRenderer();await visible(crash+' crash restores cursor');await until(()=>p.isDestroyed(),crash+' closes player safely');check(crash+' disposes player',true);}
 else {
 await probe('move',center[0]+20,center[1]);await visible('movement restores');await idle('second idle hides');
 await probe('move',...bottom);await until(()=>js(p,'document.body.classList.contains("controls-visible")'),'bottom controls');await visible('bottom controls restore cursor');
 await until(()=>js(p,'!document.body.classList.contains("controls-visible")'),'controls disappear');await idle('controls disappear hides again');
 await probe('key','escape');await until(()=>!p.isFullScreen(),'Escape');await visible('Escape restores cursor');await until(()=>p.getBounds().width===before.width&&p.getBounds().height===before.height,'bounds restored');check('fullscreen restores bounds',true);
 // Outside the player, even while it remains on the desktop, must use the normal cursor.
 await probe('move',frame.x+10,frame.y+10);await visible('outside player visible');
 peer=new BrowserWindow({x:200,y:200,width:640,height:400,title:'YueDen cursor test peer',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await peer.loadURL('data:text/html,<title>Cursor test peer</title>Independent test window');peer.show();peer.focus();
 p.show();p.focus();await until(()=>p.isFocused(),'focus player');await probe('key','f');await until(()=>p.isFullScreen(),'fullscreen again');await probe('move',...center);await idle('idle before Alt-Tab');
 await probe('key','altTab');await until(async()=>(await probe('read')).foreground!==Number(handle),'actual Alt-Tab');await visible('Alt-Tab restores system cursor');
 p.show();p.focus();await until(()=>p.isFocused(),'return player');await probe('move',...center);await visible('return visible');await idle('idle before minimize');
 p.minimize();await until(()=>p.isMinimized(),'minimize');await visible('minimize restores cursor');p.restore();p.focus();await until(()=>!p.isMinimized(),'restore');await visible('restore visible');
 await until(()=>p.isFullScreen(),'restore fullscreen');await probe('move',...center);await idle('idle before close');await service.close();await visible('close restores desktop cursor');check('player windows disposed',!BrowserWindow.getAllWindows().some(w=>w.umPlayerKind));
 }
}catch(e){evidence.error=e.stack}finally{
 await service?.close();if(peer&&!peer.isDestroyed())peer.destroy();if(original)await probe('move',original.x,original.y);
 fs.mkdirSync('test-artifacts/final-three',{recursive:true});fs.writeFileSync('test-artifacts/final-three/cursor-acceptance'+(baseline?'-baseline':crash?'-'+crash:'')+'.json',JSON.stringify({checks,evidence},null,2));app.exit(evidence.error?1:0);
}});setTimeout(()=>app.exit(2),60000);
