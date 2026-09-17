const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installReaderLookup}=require('../app/reader-lookup');
function harness(fetcher){const handlers=new Map(),win=new EventEmitter();installReaderLookup({handle:(name,fn)=>handlers.set(name,fn)},()=>win,{fetcher});return (name,arg)=>handlers.get(name)({sender:{id:1}},arg);}
test('词典只接受短英文词，固定来源，不允许任意代理地址',async()=>{
 let seen;const call=harness(async(url,options)=>{seen={url,options};return new Response(JSON.stringify([{meanings:[{partOfSpeech:'noun',definitions:[{definition:'test meaning'}]}]}]));});
 const out=await call('reader:lookup',{kind:'dictionary',text:'reader'});assert.equal(out.source,'Free Dictionary API');assert.match(out.text,/test meaning/);assert.equal(seen.url,'https://api.dictionaryapi.dev/api/v2/entries/en/reader');assert.equal(seen.options.redirect,'error');
 await assert.rejects(call('reader:lookup',{kind:'dictionary',text:'https://127.0.0.1'}));
});
test('翻译采用500字节限制而非500中文字符，语言白名单',async()=>{
 let called=0;const call=harness(async()=>{called++;return new Response('{}');});
 await assert.rejects(call('reader:lookup',{kind:'translate',text:'字'.repeat(200),from:'en',to:'zh-CN'}),/500/);
 await assert.rejects(call('reader:lookup',{kind:'translate',text:'word',from:'bad',to:'zh-CN'}));assert.equal(called,0);
});
test('翻译缓存避免重复请求，服务拒绝不伪造译文',async()=>{
 let count=0;const call=harness(async()=>{count++;return new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:'阅读'}}));});
 const query={kind:'translate',text:'read',from:'en',to:'zh-CN'};assert.equal((await call('reader:lookup',query)).text,'阅读');await call('reader:lookup',query);assert.equal(count,1);
 const fail=harness(async()=>new Response('{}',{status:429}));await assert.rejects(fail('reader:lookup',query),/额度/);
});
test('关闭查询发出取消信号，不执行后台重试',async()=>{
 let signal;const call=harness(async(_,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('canceled'))));});
 const query=call('reader:lookup',{kind:'dictionary',text:'reader'});await call('reader:lookupCancel');await assert.rejects(query,/canceled/);assert.equal(signal.aborted,true);
});
