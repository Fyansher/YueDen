const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../app/network-cache'),metadata=require('../app/metadata-runtime');
test('only HTTP and response caches are cleared, with before/after sizes',async()=>{
 const calls=[];let bytes=100,mem=40,steam=20;const protectedState={cookies:'login',localStorage:'data',indexedDB:'data',library:'data',playback:'data',reading:'data'};
 const api=create({session:()=>({getCacheSize:async()=>{calls.push('size');return bytes},clearCache:async()=>{calls.push('http');bytes=0},clearStorageData:()=>assert.fail('must not clear storage')}),metadata:{cacheSize:()=>mem+2,clearCache:()=>{calls.push('metadata');mem=0}},steam:{size:()=>steam+2,clear:()=>{calls.push('steam');steam=0}}});
 const before=structuredClone(protectedState),result=await api.clear();assert.deepEqual(result,{before:{httpBytes:100,memoryBytes:60},after:{httpBytes:0,memoryBytes:0},errors:[]});assert.deepEqual(calls,['size','http','metadata','steam','size']);assert.deepEqual(protectedState,before);
});
test('concurrent clears share one operation and allow retry after failure',async()=>{
 let resolve,calls=0;const api=create({session:()=>({getCacheSize:async()=>0,clearCache:()=>{calls++;return new Promise(r=>resolve=r)}}),metadata:{cacheSize:()=>2,clearCache(){}},steam:{size:()=>2,clear(){}}});
 const a=api.clear(),b=api.clear();assert.equal(a,b);await new Promise(setImmediate);resolve();await a;assert.equal(calls,1);const c=api.clear();await new Promise(setImmediate);resolve();await c;assert.equal(calls,2);
});
test('partial failure is reported and independent caches still clear',async()=>{
 let cleared=0;const api=create({session:()=>({getCacheSize:async()=>{throw Error('size unavailable')},clearCache:async()=>{throw Error('HTTP denied')}}),metadata:{cacheSize:()=>2,clearCache:()=>cleared++},steam:{size:()=>2,clear:()=>cleared++}});
 const result=await api.clear();assert.equal(cleared,2);assert.equal(result.errors.length,3);assert.match(result.errors.join(','),/HTTP denied/);assert.equal(result.after,null);
});
test('clearing does not interrupt a result but prevents old requests repopulating metadata',async()=>{
 metadata.clearCache();let resolve;const first=metadata.cached('pending',()=>new Promise(r=>resolve=r));await new Promise(setImmediate);metadata.clearCache();resolve({name:'old'});assert.deepEqual(await first,{name:'old'});assert.equal(metadata.cacheSize(),2);let calls=0;assert.deepEqual(await metadata.cached('pending',async()=>{calls++;return {name:'new'}}),{name:'new'});assert.equal(calls,1);assert.ok(metadata.cacheSize()>2);metadata.clearCache();
});
test('requests after clearing do not reuse an older in-flight response',async()=>{
 await metadata.run('cache-test','query',async()=>{let resolve;const old=metadata.cached('same',()=>new Promise(r=>resolve=r));await new Promise(setImmediate);metadata.clearCache();assert.equal(await metadata.cached('same',async()=>'new'),'new');resolve('old');await old;assert.equal(await metadata.cached('same',async()=>'wrong'),'new');});metadata.clearCache();
});
test('cache IPC is restricted to main application frame',()=>{
 const {authorize}=require('../app/ipc-guard'),path=require('node:path'),{pathToFileURL}=require('node:url'),root=path.resolve('app');function event(file){const frame={url:pathToFileURL(path.join(root,file)).href};return {sender:{isDestroyed:()=>false,mainFrame:frame},senderFrame:frame};}
 for(const channel of ['cache:size','cache:clear']){assert.equal(authorize(event('index.html'),channel,root),true);assert.equal(authorize(event('reader.html'),channel,root),false);assert.equal(authorize(event('player/queue.html'),channel,root),false);}
});
