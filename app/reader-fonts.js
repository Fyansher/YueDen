const {execFile}=require('node:child_process');
let pending;
module.exports=()=>pending||(pending=new Promise((resolve,reject)=>{
 if(process.platform!=='win32'){reject(Error('当前平台不支持枚举系统字体'));return;}
 execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; $fonts=New-Object System.Drawing.Text.InstalledFontCollection; @($fonts.Families | ForEach-Object { $_.Name }) | ConvertTo-Json -Compress'],{windowsHide:true,timeout:15000,maxBuffer:1024*1024},(error,out)=>{if(error){pending=null;reject(Error('无法读取系统字体，请稍后重试'));return;}try{const names=JSON.parse(out.replace(/^\uFEFF/,''));resolve([...new Set(Array.isArray(names)?names:[names])].filter(v=>typeof v==='string').sort((a,b)=>a.localeCompare(b,'zh-CN')));}catch(e){pending=null;reject(e);}});
}));
