// Independent Windows x64 distribution. Never reads installed user-data.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const testVersion=process.argv.find(a=>a.startsWith('--test-version='))?.split('=')[1];if(testVersion&&!/^2\.25\.29-test\.[1-9]\d*$/.test(testVersion))throw Error('Invalid test version');
const version=testVersion||require('../package.json').version;
const player=__dirname,app=path.dirname(player),redesign=path.dirname(app),work=path.dirname(redesign),name='YueDen '+version,out=path.join(redesign,'release',name),runtime=path.join(work,'runtime-44/extracted');
const zip=path.join(redesign,'release','YueDen-'+version+'-Windows-x64.zip');if(process.argv.includes('--zip')&&fs.existsSync(zip))throw Error('ZIP already exists; preserve it');
const finishOnly=process.argv.includes('--finish-only');if(fs.existsSync(out)&&!finishOnly)throw Error('Output already exists; preserve it, use a new version for another build');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.cpSync(a,b,{recursive:true})};
if(!finishOnly){for(const n of fs.readdirSync(runtime)){if(n==='resources')continue;copy(path.join(runtime,n),path.join(out,'程序',n==='electron.exe'?'YueDen.exe':n==='LICENSE'?'LICENSE.electron.txt':n))}
const dest=path.join(out,'程序/resources/app');fs.mkdirSync(dest,{recursive:true});
for(const entry of fs.readdirSync(app,{withFileTypes:true})){if(entry.name==='player')continue;if(entry.isFile()||['assets','codec','docs','native','vendor'].includes(entry.name))copy(path.join(app,entry.name),path.join(dest,entry.name))}
for(const n of ['dist','src','window.html','window.js','queue-reorder.js','window.css','audio-adapter.js','preload.cjs','README.md','package.json','pnpm-lock.yaml','tsconfig.json'])copy(path.join(player,n),path.join(dest,'player',n));
for(const [,src] of fs.readFileSync(path.join(dest,'player/window.html'),'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)){if(!fs.existsSync(path.resolve(dest,'player',src)))throw Error('Missing packaged player resource: '+src);}
for(const n of ['VideoHost.exe','VideoHost.cs','AudioBrand.cs','build.cjs'])copy(path.join(player,'native',n),path.join(dest,'player/native',n));
for(const n of ['mpv.exe','mpv.com','d3dcompiler_43.dll','source.json','materials'])copy(path.join(player,'vendor',n),path.join(dest,'player/vendor',n));
for(const n of ['FFmpeg-7ba069f4f1.zip','BtbN-build-scripts.zip'])copy(path.join(work,'third-party-source',n),path.join(out,'第三方源码',n));
copy(path.join(work,'packaging/第三方组件.md'),path.join(out,'第三方组件-既有.md'));
copy(path.join(app,'docs/player-release.md'),path.join(out,'README.md'));
if(testVersion){
 const packageFile=path.join(dest,'package.json'),meta=JSON.parse(fs.readFileSync(packageFile));meta.version=version;fs.writeFileSync(packageFile,JSON.stringify(meta,null,2)+'\n');
 const index=path.join(dest,'index.html');fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace(/<small>2\.25\.\d+<\/small>/,'<small>'+version+'</small>'));
 const history=fs.readFileSync(path.join(out,'README.md'),'utf8');fs.writeFileSync(path.join(out,'README.md'),'# 悦森盒 YueDen 测试版\n\n版本：'+version+' · Windows x64 · portable\n\n完整解压后运行根目录 YueDen.exe。请解压到新的独立目录，不覆盖正式安装，不复制或迁移个人 user-data。测试数据只写入本包根目录 user-data，运行组件随包分发。\n\n包含本轮已验证的窗口吸附和局部原生光标修复。Task 4 已由用户取消；既有 MusicBrainz 联系信息合规缺口未被改写为已修复。此包不是正式发布，其余功能由用户人工验收。\n\n当前流程只提供解压即用版本，无安装器；不自动安装。\n\n## 沿用组件记录与历史限制\n\n'+history.slice(history.indexOf('## 播放器与第三方来源')));
 copy(path.join(redesign,'docs/remaining-tasks-final-report.md'),path.join(out,'验证记录/remaining-tasks-final-report.md'));
}
copy(path.join(player,'tests'),path.join(out,'开发测试/player-tests'));copy(__filename,path.join(out,'开发测试/build-release.cjs'));
const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
cp.execFileSync(compiler,['/nologo','/target:winexe','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll','/win32icon:'+path.join(app,'assets/icon.ico'),'/out:'+path.join(out,'YueDen.exe'),path.join(redesign,'packaging/Launcher.cs')],{windowsHide:true});
}
if(!fs.existsSync(path.join(out,'程序/YueDen.exe'))||fs.existsSync(path.join(out,'user-data')))throw Error('Only clean staging packages may be finalized');
(async()=>{const {rcedit}=await import(require('node:url').pathToFileURL(path.join(work,'branding-tools/node_modules/rcedit/lib/index.js')).href);for(const file of [path.join(out,'YueDen.exe'),path.join(out,'程序/YueDen.exe')])await rcedit(file,{icon:path.join(app,'assets/icon.ico'),'version-string':{FileDescription:'悦森盒 YueDen',ProductName:'悦森盒 YueDen',InternalName:'YueDen',OriginalFilename:'YueDen.exe'},'file-version':testVersion?'2.25.29.1':version+'.0','product-version':testVersion?'2.25.29.1':version+'.0'});
 const rows=[];function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()){if(['user-data','node_modules','test-artifacts','baseline','dev-user-data'].includes(e.name))throw Error('Forbidden release directory: '+f);visit(f)}else if(e.name!=='SHA256SUMS.json')rows.push({path:path.relative(out,f).replaceAll('\\','/'),bytes:fs.statSync(f).size,sha256:hash(f)})}}visit(out);fs.writeFileSync(path.join(out,'SHA256SUMS.json'),JSON.stringify({created:new Date().toISOString(),version:name,files:rows},null,2));console.log(out);
 if(process.argv.includes('--zip')){cp.execFileSync(path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-Command',"$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:YUEDEN_STAGE,$env:YUEDEN_ZIP,[IO.Compression.CompressionLevel]::Optimal,$true)"],{windowsHide:true,env:{...process.env,YUEDEN_STAGE:out,YUEDEN_ZIP:zip},stdio:'inherit'});console.log(JSON.stringify({zip,bytes:fs.statSync(zip).size,sha256:hash(zip)}));}
})().catch(e=>{console.error(e);process.exitCode=1});
