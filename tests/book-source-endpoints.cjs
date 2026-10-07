const {test}=require('node:test');
const assert=require('node:assert/strict');
const Endpoints=require('../app/book-source-endpoints');
const Runtime=require('../app/metadata-runtime');
const {createSourceSearch}=require('../app/metadata-sources');

test('mirror directory reads only the first three entries in official and mirror sections',()=>{
  const html=`<div class="card"><div class="card-title">广告 / 快速导航</div><div class="url-list"><a class="item" href="https://ad.invalid/"><span class="item-name">官网入口</span></a></div></div>
  <div class="card"><div class="card-title">官网入口【需科学上网】</div><div class="url-list">
  <a class="item" href="https://official-one.example/"><span class="item-name">①官网入口</span></a>
  <a class="item" href="https://official-two.example/"><span class="item-name">②官网入口</span></a>
  <a class="item" href="https://official-three.example/"><span class="item-name">③官网入口</span></a>
  <a class="item" href="https://official-four.example/"><span class="item-name">④官网入口</span></a></div></div>
  <div class="card"><div class="card-title">镜像入口（国内可用）</div><div class="url-list">
  <a class="item" href="https://mirror-one.example/"><span class="item-name">①镜像网站入口</span></a>
  <a class="item" href="https://mirror-two.example/"><span class="item-name">②镜像网站入口</span></a>
  <a class="item" href="https://mirror-three.example/"><span class="item-name">③镜像网站入口</span></a>
  <a class="item" href="https://mirror-four.example/"><span class="item-name">④镜像网站入口</span></a>
  <a class="item" href="http://unsafe.example/"><span class="item-name">⑤镜像网站入口</span></a></div></div>`;
  assert.deepEqual(Endpoints.parseDirectory(html),{
    official:['https://official-one.example/','https://official-two.example/','https://official-three.example/'],
    mirror:['https://mirror-one.example/','https://mirror-two.example/','https://mirror-three.example/'],
  });
});

test('endpoint order follows official and mirror source roles while retaining active effective URL',()=>{
  const manager=Endpoints.create({file:()=>'/tmp/yueden-endpoint-test.json',fetchText:async()=>''});
  assert.deepEqual(manager.candidates('onelib','https://verified.official.example/s/query'),[
    'https://verified.official.example/s/query','https://zh.1lib.sk/','https://z-library.sk/','https://zh.z-lib.gd/','https://z-lib.fm/','https://zh.zlib.bz/','https://z.wwwnav.com/','https://zz.sodanav.com/','https://z.2rdh.com/',
  ]);
  assert.equal(manager.candidates('zlibrary','https://zh.zlib.bz/')[0],'https://zh.zlib.bz/');
});

test('a failed 1lib host is retried at a discovered entry without leaving the source failed',async()=>{
  const calls=[];let refreshed=0;
  const service=createSourceSearch({
    pace:0,json:async()=>[],sourceHome:id=>id==='onelib'?'https://old-host.example/':'',sourceVerified:()=>false,
    bookSourceEndpoints:{candidates:(id,active)=>id==='onelib'?[active,'https://new-host.example/']:[active],refresh:async()=>{refreshed++;}},
    text:async(url,_timeout,sourceId)=>{
      if(sourceId!=='onelib')return '';
      calls.push(url);
      if(new URL(url).hostname==='old-host.example'){
        Runtime.recordFailure({kind:'network',status:0,host:'old-host.example',label:'连接失败',message:'模拟的旧地址失效'});return '';
      }
      return '<article><a href="/book/9/design"><h2>自动切换书目</h2></a></article>';
    },renderHtml:async(_source,url)=>({html:'',finalUrl:url}),
  });
  const bundle=await service.search('book','自动切换书目');
  const oneLib=bundle.sources.find(source=>source.id==='onelib');
  assert.equal(oneLib.state,'ok');
  assert.equal(oneLib.items[0].name,'自动切换书目');
  assert.equal(new URL(oneLib.items[0].storeUrl).hostname,'new-host.example');
  assert.ok(refreshed>=1);
  assert.ok(calls.some(url=>new URL(url).hostname==='old-host.example'));
  assert.ok(calls.some(url=>new URL(url).hostname==='new-host.example'));
});

test('a failed Z-Library mirror switches to the next mirror and keeps result URLs on that host',async()=>{
  const calls=[];
  const service=createSourceSearch({
    pace:0,json:async()=>[],sourceHome:id=>id==='zlibrary'?'https://old-mirror.example/':'',sourceVerified:()=>false,
    bookSourceEndpoints:{candidates:(id,active)=>id==='zlibrary'?[active,'https://new-mirror.example/']:[active],refresh:async()=>{}},
    text:async(url,_timeout,sourceId)=>{
      if(sourceId!=='zlibrary')return '';
      calls.push(url);
      if(new URL(url).hostname==='old-mirror.example'){
        Runtime.recordFailure({kind:'timeout',status:0,host:'old-mirror.example',label:'超时',message:'模拟的旧镜像超时'});return '';
      }
      return url==='https://new-mirror.example/'?'<form action="/search" method="get"><input type="search" name="q"></form>':'<a href="/book/10">Z-Library 书目</a>';
    },renderHtml:async(_source,url)=>({html:'',finalUrl:url}),
  });
  const bundle=await service.search('book','Z-Library 书目');
  const zlibrary=bundle.sources.find(source=>source.id==='zlibrary');
  assert.equal(zlibrary.state,'ok');
  assert.equal(zlibrary.items[0].name,'Z-Library 书目');
  assert.equal(new URL(zlibrary.items[0].storeUrl).hostname,'new-mirror.example');
  assert.ok(calls.some(url=>new URL(url).hostname==='old-mirror.example'));
  assert.ok(calls.some(url=>new URL(url).hostname==='new-mirror.example'));
});

test('a selected 1lib detail link follows the active fallback host',async()=>{
  const calls=[];const detailPage='<html><head><meta property="og:description" content="备用入口的详情摘要"></head><body><div>作者：作者乙</div></body></html>';
  const service=createSourceSearch({
    pace:0,json:async()=>[],sourceHome:id=>id==='onelib'?'https://old-host.example/':'',sourceVerified:()=>false,
    bookSourceEndpoints:{candidates:(id,active)=>id==='onelib'?[active,'https://new-host.example/']:[active],refresh:async()=>{}},
    text:async(url,_timeout,sourceId)=>{
      if(sourceId!=='onelib')return '';
      calls.push(url);
      if(new URL(url).hostname==='old-host.example'){Runtime.recordFailure({kind:'network',status:0,host:'old-host.example',label:'连接失败',message:'模拟的失效详情入口'});return '';}
      return detailPage;
    },renderHtml:async(_source,url)=>({html:'',finalUrl:url}),
  });
  const detail=await service.resolveCandidate({id:'book-9',name:'测试书目',type:'book',mediaType:'book',_sourceId:'onelib',storeUrl:'https://old-host.example/book/9/design',detailUrl:'https://old-host.example/book/9/design',detailsUnavailable:true});
  assert.equal(detail.description,'备用入口的详情摘要');
  assert.ok(calls.some(url=>new URL(url).hostname==='new-host.example'));
});
