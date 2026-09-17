const path=require('node:path'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
if(process.platform!=='win32')throw Error('Requires Windows x64 .NET Framework compiler');
const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
if(!fs.existsSync(compiler))throw Error('Missing .NET Framework x64 compiler');
execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll','/out:'+path.join(__dirname,'VideoHost.exe'),path.join(__dirname,'VideoHost.cs'),path.join(__dirname,'AudioBrand.cs')],{windowsHide:true,stdio:'inherit'});
if(process.argv.includes('--tests'))execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+path.join(__dirname,'DragProbe.exe'),path.join(__dirname,'DragProbe.cs')],{windowsHide:true,stdio:'inherit'});

if(process.argv.includes('--tests'))execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+path.resolve(__dirname,'../../../tests/WindowProbe.exe'),path.resolve(__dirname,'../../../tests/WindowProbe.cs')],{windowsHide:true,stdio:'inherit'});
