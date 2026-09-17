// Actual Electron/Win32 child relationship; no mpv or decoder claims.
const {app,BrowserWindow}=require('electron'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),readline=require('node:readline');
const root=path.resolve(__dirname,'../test-artifacts');fs.mkdirSync(root,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(root,'native-user-data-')));
let helper,win;const checks=[];let finished=false;
app.on('window-all-closed',()=>{}); // Keep the probe alive until helper-exit assertions and report finish.
function finish(error){if(finished)return;finished=true;helper?.kill();if(win&&!win.isDestroyed())win.destroy();fs.writeFileSync(path.join(root,'native-host.json'),JSON.stringify({time:new Date().toISOString(),versions:process.versions,checks,error:error?.stack||null,mpvPlayed:false},null,2));app.exit(error?1:0)}
app.whenReady().then(async()=>{
  try{
    win=new BrowserWindow({show:false,width:1024,height:640,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    if(!process.env.UM_NATIVE_HOST_ONLY) await win.loadURL('data:text/html,<title>Native video host test</title><p>Test controls</p>');
    const hwnd=win.getNativeWindowHandle().readBigUInt64LE().toString();
    helper=spawn(path.resolve(__dirname,'../native/VideoHost.exe'),[hwnd],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    helper.on('error',finish);
    const lines=(async function*(){for await(const line of readline.createInterface({input:helper.stdout}))if(!/^(pointer|frame) /.test(line))yield line})();
    const hello=JSON.parse((await lines.next()).value);assert.equal(hello.parent,hwnd);assert.notEqual(hello.hwnd,hwnd);checks.push('真实 HWND 为独立子窗口，父窗口是本次隔离 Electron 窗口');
    helper.stdin.write('0 0 800 420\n');assert.equal((await lines.next()).value,'sized');checks.push('原生视频区域尺寸命令成功');
    helper.stdin.write('hide\n');assert.equal((await lines.next()).value,'hidden');checks.push('子窗口可隐藏');
    helper.stdin.write('-1 0 800 420\n');assert.equal((await lines.next()).value,'invalid');checks.push('拒绝越界几何参数');
    const exit=new Promise(resolve=>helper.once('exit',resolve));win.destroy();await exit;assert.equal(helper.exitCode,0);checks.push('父窗口销毁后桥接退出');finish();
  }catch(error){finish(error)}
});
setTimeout(()=>finish(Error('原生子窗口核查超时')),20000);
