// Opt-in, one public metadata request per provider, no user library or credentials.
const fs=require('fs'),os=require('os'),path=require('path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'yueden-provider-smoke-'));
const music=require('../app/audio-metadata').create({dataRoot:()=>root,coverStore:{}});
const providers=require('../app/audio-providers').create({dataRoot:()=>root,coverStore:{},music});
(async()=>{const out={at:new Date().toISOString()};const rows=await providers.search({name:'Imagine',audio:{kind:'music',collectionKind:'single',artists:['John Lennon']}},AbortSignal.timeout(20000),true);out.metadata=rows.providers;
try{const lyric=await music.lyrics({name:'Imagine',audio:{collectionKind:'single',artists:['John Lennon']}},{title:'Imagine',artists:['John Lennon'],durationSeconds:183},AbortSignal.timeout(16000));out.lrclib={kind:lyric.kind,hasText:!!lyric.text,mismatch:lyric.mismatch};}catch(e){out.lrclib={state:require('../app/provider-status').classify(e),message:e.message};}
fs.mkdirSync('test-artifacts/partial-cleanup',{recursive:true});fs.writeFileSync('test-artifacts/partial-cleanup/providers-live.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
