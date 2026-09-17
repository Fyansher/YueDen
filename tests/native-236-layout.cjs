const electron=require('electron'),{app,BrowserWindow,ipcMain}=electron,fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'yueden-layout-')),out=path.resolve('test-artifacts/release-2.25.36');fs.mkdirSync(out,{recursive:true});app.setPath('userData',root);app.on('window-all-closed',()=>{});
const checks=[],rounds=[],win=k=>BrowserWindow.getAllWindows().find(w=>w.umPlayerKind===k),js=(w,s)=>w.webContents.executeJavaScript(s);let service,done=false;
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('window state timeout');}
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
async function finish(error){if(done)return;done=true;clearTimeout(deadline);await service?.close();fs.writeFileSync(path.join(out,'window-layout.json'),JSON.stringify({checks,rounds,root,displays:electron.screen.getAllDisplays().map(d=>({bounds:d.bounds,scale:d.scaleFactor})),error:error?.stack},null,2));app.exit(error?1:0);}
const deadline=setTimeout(()=>finish(Error('deadline')),60000);
app.whenReady().then(async()=>{try{
service=require('../app/player/dist/service').createPlayerService({electron,ipcMain,loadLibrary:()=>({items:[]}),dataRoot:()=>root,disguised:()=>false});await service.show();
for(const kind of ['queue','lyrics','eq'])await js(win('main'),'player.action("aux",'+JSON.stringify(kind)+')');
const expected={};for(const [kind,b]of Object.entries({main:{x:211,y:143,width:823,height:543},queue:{x:1070,y:141,width:357,height:503},lyrics:{x:680,y:140,width:333,height:487},eq:{x:320,y:701,width:633,height:277}})){win(kind).setBounds(b);expected[kind]=win(kind).getNormalBounds();}
await service.close();check('close captures all four layouts even without moved/resized end events',Object.keys(JSON.parse(fs.readFileSync(path.join(root,'player-state.json'))).player.layouts).length===4);
for(let i=0;i<6;i++){await service.show();const actual={};for(const kind of Object.keys(expected)){actual[kind]=win(kind).getNormalBounds();assert.deepEqual(actual[kind],expected[kind],kind+' round '+i);check(kind+' exact position and size round '+i,win(kind).isVisible());}rounds.push(actual);await service.close();}
await service.show();win('main').maximize();await until(()=>win('main').isMaximized());await service.close();await service.show();check('maximized state reopens maximized',win('main').isMaximized());assert.deepEqual(win('main').getNormalBounds(),expected.main);check('maximized restore preserves normal rectangle',true);
win('main').unmaximize();await until(()=>!win('main').isMaximized());win('main').setFullScreen(true);await until(()=>win('main').isFullScreen());await service.close();await service.show();await until(()=>win('main').isFullScreen());check('fullscreen state reopens fullscreen',true);await service.close();check('all owned BrowserWindows disposed',BrowserWindow.getAllWindows().length===0);await finish();
}catch(error){await finish(error)}});
