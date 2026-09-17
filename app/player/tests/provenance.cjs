// Public upstream material only; TLS uses Node/system trust, never disabled.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'vendor/materials');fs.mkdirSync(out,{recursive:true});
const entries=[
 ['mpv-Copyright.txt','https://raw.githubusercontent.com/mpv-player/mpv/69e63f425a/Copyright'],
 ['mpv-LICENSE.GPL.txt','https://raw.githubusercontent.com/mpv-player/mpv/69e63f425a/LICENSE.GPL'],
 ['mpv-LICENSE.LGPL.txt','https://raw.githubusercontent.com/mpv-player/mpv/69e63f425a/LICENSE.LGPL'],
 ['mpv-source-69e63f425a.zip','https://codeload.github.com/mpv-player/mpv/zip/69e63f425a'],
 ['mpv-build-scripts-cd1edc11.zip','https://codeload.github.com/shinchiro/mpv-winbuild-cmake/zip/cd1edc11dc6887a50f705717619d879f5a93a488'],
 ['mpv-ffmpeg-source-9fc8c785e.zip','https://codeload.github.com/FFmpeg/FFmpeg/zip/9fc8c785e']
];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{const materials=[];for(const [name,url]of entries){const file=path.join(out,name);if(!fs.existsSync(file)){const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(url+' HTTP '+response.status);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()))}materials.push({name,url,sha256:hash(file)})}
 const source=JSON.parse(fs.readFileSync(path.join(root,'vendor/source.json')));if(hash(path.join(root,'vendor',path.basename(source.url)))!==source.sha256)throw Error('mpv archive hash mismatch');
 const binaries=['mpv.exe','mpv.com','d3dcompiler_43.dll'].map(name=>({name,sha256:hash(path.join(root,'vendor',name)),source:source.url}));
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({created:new Date().toISOString(),source,binaries,version:cp.execFileSync(path.join(root,'vendor/mpv.com'),['--version'],{encoding:'utf8',windowsHide:true}),materials,limitations:['Exact full static dependency revisions unavailable: upstream workflow log artifact expired.','libplacebo reports dirty build; uncommitted patch provenance not supplied.','Not a claim of complete corresponding source or public redistribution clearance.','d3dcompiler_43.dll redistribution terms still require upstream documentation.']},null,2));console.log('Saved source, licenses and SHA-256 manifest');})().catch(e=>{console.error(e);process.exitCode=1});
