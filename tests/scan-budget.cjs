const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const appModule=require('./app-module.cjs'),{fixture,pe,epub}=require('../../tests/scan-fixtures.cjs');
test('跨目录与文件批次继续发现，不截断后面的独立资源',async()=>{
 const f=await fixture();for(let i=0;i<12;i++)await f.put('Root/'+i+'/App.exe',pe('Independent '+i));
 const r=await appModule('scan-pipeline').scan([path.join(f.root,'Root')],'game',{budget:{maxDirectories:3,maxFiles:4,maxBytes:8192}});
 assert.equal(r.items.length,12);assert.equal(r.warnings.length,0);assert.ok(r.metrics.batches>1);
 assert.ok(r.metrics.bytes>8192);assert.equal(new Set(r.items.map(i=>i.id)).size,12);
});
test('一本书的读取不耗尽整库预算，超过归档批次仍完整提取下一本',async()=>{
 const f=await fixture();for(let i=0;i<6;i++)await epub(f,'Book'+i+'.epub',{title:'作品 '+i,series:'独立 '+i});
 const r=await appModule('scan-pipeline').scan([f.root],'book',{budget:{maxBytes:128*1024,maxArchives:2,maxDirectories:2,maxFiles:3}});
 assert.equal(r.items.length,6);assert.ok(r.items.every(i=>i.metadata.title&&i.classification.type==='book'));assert.equal(r.warnings.length,0);
});
test('坏文件的单文件读取超限不污染其他资源；批次让出后可以取消',async()=>{
 const f=await fixture();await f.put('large.bin',Buffer.alloc(100));await f.put('small.bin','ok');
 const {context}=appModule('scan-context'),ctx=context({budget:{maxBytes:64}});
 await assert.rejects(ctx.cached(path.join(f.root,'large.bin'),'test',()=>ctx.read(path.join(f.root,'large.bin'),100)));
 assert.equal(Buffer.from(await ctx.cached(path.join(f.root,'small.bin'),'test',()=>ctx.read(path.join(f.root,'small.bin'),2))).toString(),'ok');
 const controller=new AbortController();for(let i=0;i<5;i++)await f.put('Cancel/'+i+'/a.exe',pe('Cancel '+i));
 await assert.rejects(appModule('scan-pipeline').scan([path.join(f.root,'Cancel')],'game',{signal:controller.signal,budget:{maxDirectories:1},onProgress:p=>{if(p.phase.includes('分批'))controller.abort();}}),e=>e.name==='AbortError');
});
