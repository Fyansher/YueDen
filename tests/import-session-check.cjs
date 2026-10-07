const assert=require('node:assert/strict');
const Session=require('../app/import-session-model');
const Queue=require('../app/import-metadata-queue');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 let calls=0;const row={};const work=()=>new Promise(resolve=>setTimeout(()=>resolve(++calls),5));await Promise.all([Session.once(row,work),Session.once(row,work)]);assert.equal(calls,1);
 const rows=[{id:'slow',name:'慢来源',type:'book',selected:true},{id:'fast',name:'快来源',type:'book',selected:true}],events=[];let releaseSlow;
 const slow=new Promise(resolve=>releaseSlow=resolve);
 const queue=Queue.create({rows:()=>rows,eligible:value=>value.selected,query:async(value,onProgress)=>{const partial={integrated:[{id:value.id,name:value.name}],sources:[{id:value.id,state:'loading',items:[{id:value.id,name:value.name}]}],loading:true};onProgress(partial);if(value.id==='slow')await slow;return {...partial,loading:false,sources:[{id:value.id,state:'ok',items:partial.integrated}]};},apply:(value,bundle,{partial}={})=>events.push({id:value.id,partial:!!partial,loading:bundle.loading}),cancel:()=>true});
 void queue.resume();await new Promise((resolve,reject)=>{const end=Date.now()+1000;const poll=()=>events.some(event=>event.id==='fast'&&!event.partial)?resolve():Date.now()>end?reject(Error('fast source waited behind slow source')):setTimeout(poll,5);poll();});
 assert.ok(events.some(event=>event.id==='slow'&&event.partial));assert.ok(events.some(event=>event.id==='fast'&&event.partial));assert.ok(events.some(event=>event.id==='fast'&&!event.partial));assert.equal(events.some(event=>event.id==='slow'&&!event.partial),false);
 releaseSlow();await queue.whenIdle();assert.ok(events.some(event=>event.id==='slow'&&!event.partial));
 const controls=fs.readFileSync(path.join(__dirname,'../app/import-controls.js'),'utf8');assert.doesNotMatch(controls,/联网匹配/);assert.match(controls,/获取元数据/);assert.equal(fs.existsSync(path.join(__dirname,'../app/scan-matching.js')),false);
 assert.equal(Session.state({item:{_previewMatched:true}}),'checked');assert.equal(Session.state({item:{_previewPrepared:true}}),'ready');console.log('PASS shared import lifecycle, fast source progress, and removal of duplicate online matching');
})().catch(error=>{console.error(error);process.exitCode=1;});
