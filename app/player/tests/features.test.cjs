const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {snap,restoreBounds}=require('../dist/snap'),{filter}=require('../dist/equalizer'),{loadLyrics}=require('../dist/lyrics'),{importLegacy}=require('../dist/legacy');
test('四方向12 DIP吸附、20 DIP滞回、21 DIP解除、Alt和远距离目标',()=>{
 const target={id:'b',x:100,y:100,width:100,height:100};
 for(const [raw,axis,expected]of [[{x:-12,y:100},'x',0],[{x:212,y:100},'x',200],[{x:100,y:-12},'y',0],[{x:100,y:212},'y',200]]){const rect={...raw,width:100,height:100};const s=snap(rect,[target]);assert.equal(s.bounds[axis],expected);const held=snap({...rect,[axis]:expected+20},[target],s.state);assert.equal(held.bounds[axis],expected);const released=snap({...rect,[axis]:expected+21},[target],s.state);assert.equal(released.bounds[axis],expected+21)}
 const raw={x:212,y:100,width:100,height:100};assert.deepEqual(snap(raw,[target],{},true).bounds,raw);assert.equal(snap({...raw,y:500},[target]).bounds.x,212);
});
test('吸附只改移动者位置、大小不变、角对齐和确定性候选',()=>{
 const a={id:'a',x:100,y:100,width:100,height:100},b={id:'b',x:100,y:100,width:100,height:100},raw={x:205,y:105,width:80,height:90};
 const result=snap(raw,[b,a]);assert.equal(result.state.x.target,'a');assert.equal(result.bounds.x,200);assert.equal(result.bounds.y,100);assert.equal(result.bounds.width,80);assert.equal(result.bounds.height,90);assert.equal(a.x,100);
});
test('布局保持负坐标显示器；移除显示器、超大尺寸和损坏数值安全回退',()=>{
 const areas=[{x:0,y:0,width:1920,height:1040},{x:-1280,y:0,width:1280,height:984}],defaults={x:40,y:40,width:1024,height:640},min={width:640,height:400};
 assert.equal(restoreBounds({x:-1000,y:10,width:800,height:600},areas,defaults,min).x,-1000);
 const moved=restoreBounds({x:-1000,y:10,width:3000,height:2000},[areas[0]],defaults,min);assert.equal(moved.x,0);assert.equal(moved.width,1920);assert.equal(moved.height,1040);
 assert.equal(restoreBounds({x:NaN,width:-5},areas,defaults,min).width,640);
});
test('EQ严格十段半分贝范围，禁用不改数值，实际峰值限幅保护',()=>{
 const gains=[0,0,0,0,0,6,0,0,0,0];assert.equal(filter({enabled:false,gains}), '');const af=filter({enabled:true,gains});assert.match(af,/volume=0dB/);assert.match(af,/alimiter=limit=0.95:level=false/);assert.match(af,/f=1000:t=o:w=1:g=6/);assert.equal(gains[5],6);assert.throws(()=>filter({enabled:true,gains:Array(10).fill(.3)}));assert.throws(()=>filter({enabled:true,gains:[0]}));
});
test('LRC复用现有解析器：多标签、小数、offset、无歌词/空/损坏区分',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'um-player-lyrics-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const media=path.join(dir,'中文.wav'),file=path.join(dir,'中文.lrc');
 assert.equal((await loadLyrics(media)).status,'none');fs.writeFileSync(file,'');assert.equal((await loadLyrics(media)).status,'empty');
 fs.writeFileSync(file,'[ar:作者]\n[offset:100]\n[00:01.2][00:03.45]第一行\n[00:99]异常\n[00:04.123]第二行');const result=await loadLyrics(media);assert.equal(result.status,'synced');assert.deepEqual(result.lines.map(l=>l.time),[1.3,3.55,4.223]);
 fs.writeFileSync(file,Buffer.from([0xff,0x80]));assert.equal((await loadLyrics(media)).status,'error');
});
test('迁移先验证再备份、原文件不改、稳定引用保留、重复迁移一致',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'um-player-migrate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const library={items:[{id:'a',type:'audio',audio:{kind:'music',tracks:[{id:'t',title:'音轨',sourceRefs:['s']}],sources:[{id:'s',kind:'local',localPath:path.join(dir,'a.wav')}]}}]};
 const original=JSON.stringify({version:2,activeContext:'music',queue:[{queueEntryId:'stable',itemId:'a',trackId:'t'}],progress:[{trackId:'t',position:12}]});fs.writeFileSync(path.join(dir,'audio-session.json'),original);
 const first=importLegacy(dir,library),second=importLegacy(dir,library);assert.deepEqual(first,second);assert.equal(first.contexts.music.queue[0].queueEntryId,'stable');assert.equal(first.positions[JSON.stringify(['a','t'])],12);assert.equal(fs.readFileSync(path.join(dir,'audio-session.json'),'utf8'),original);assert.equal(fs.readFileSync(path.join(dir,'audio-session.json.before-player-v1.bak'),'utf8'),original);
 fs.writeFileSync(path.join(dir,'reader-progress.json'),'broken');assert.throws(()=>importLegacy(dir,library));assert.equal(fs.existsSync(path.join(dir,'reader-progress.json.before-player-v1.bak')),false);
});
