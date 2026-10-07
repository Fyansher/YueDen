const {test}=require('node:test');
const assert=require('node:assert/strict');
const Runtime=require('../app/metadata-runtime');
const {createSourceSearch}=require('../app/metadata-sources');

function service(json,text=async()=>'',options={}){
  return createSourceSearch({json,text,pace:0,sourceHome:()=>'',sourceVerified:()=>false,renderHtml:async()=>({html:'',finalUrl:''}),...options});
}

test('a completed fast source is streamed as a usable candidate while an eight-second source is still pending',async()=>{
  let settled=false,resolveFast;
  const fast=new Promise(resolve=>{resolveFast=resolve;});
  const sources=service(async url=>{
    if(url.startsWith('https://api.tvmaze.com/search/shows?')){await Runtime.delay(500);return [{show:{id:31,name:'快速剧集',image:{medium:'https://img.example/fast.jpg'},url:'https://tvmaze.example/shows/31'}}];}
    if(url.startsWith('https://www.wikidata.org/w/api.php?')){await Runtime.delay(8000);return {search:[]};}
    if(url.startsWith('https://www.googleapis.com/books/'))return null;
    return [];
  });
  const owner='slow-source-test',id='fast-before-slow';
  const search=Runtime.run(owner,id,()=>sources.search('movie','快速剧集',{onProgress:bundle=>{
    const group=bundle.sources.find(source=>source.id==='tvmaze');
    if(group?.items.length&&!settled){settled=true;resolveFast(bundle);}
  }})).catch(error=>error);
  let timeout,bundle;
  try{bundle=await Promise.race([fast,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('快源未能及时推送')),2500);})]);}
  finally{clearTimeout(timeout);Runtime.cancel(owner,id);}
  const group=bundle.sources.find(source=>source.id==='tvmaze');
  assert.equal(bundle.loading,true);
  assert.equal(group.state,'loading');
  assert.equal(group.items[0].id,'tvmaze-31');
  assert.equal(group.items[0].name,'快速剧集');
  assert.equal(bundle.sources.find(source=>source.id==='wikidata').state,'loading');
  const canceled=await search;
  assert.equal(canceled.name,'AbortError');
  assert.equal(settled,true);
});

test('Open Library remains usable as a normal book source',async()=>{
  const sources=service(async url=>{
    if(url.startsWith('https://openlibrary.org/search.json?'))return {docs:[{key:'OL123W',title:'普通书目',author_name:['作者甲'],isbn:['9787536692930'],cover_i:12}]};
    return [];
  });
  const bundle=await sources.search('book','普通书目');
  const row=bundle.sources.find(source=>source.id==='openlibrary').items[0];
  assert.equal(row.name,'普通书目');
  assert.equal(row.isbn,'9787536692930');
});

test('TVmaze remains usable as a normal non-book source',async()=>{
  const sources=service(async url=>url.startsWith('https://api.tvmaze.com/search/shows?')?[{show:{id:42,name:'普通剧集',url:'https://tvmaze.example/shows/42',rating:{average:8.2}}}]:[]);
  const bundle=await sources.search('movie','普通剧集');
  const row=bundle.sources.find(source=>source.id==='tvmaze').items[0];
  assert.equal(row.id,'tvmaze-42');
  assert.equal(row.externalRating,'8.2');
});

test('successful 1lib and Z-Library DOM fallbacks clear only their preliminary timeouts',async()=>{
  const searchHtml='<article><a href="/book/123/design"><h2>超时后恢复</h2></a></article>';
  const zlibResults='<section><a href="/book/456/design"><h2>超时后恢复</h2></a></section>';
  const zlibHome='<form action="/search" method="get"><input name="q" type="search"></form>';
  const sources=service(async()=>[],async(url,_timeout,sourceId)=>{
    Runtime.recordFailure({kind:'timeout',status:0,host:new URL(url).hostname,label:'超时',message:'模拟的快速 HTTP 超时'});
    return '';
  },{renderHtml:async(sourceId,url)=>sourceId==='onelib'?{html:searchHtml,finalUrl:url}:sourceId==='zlibrary'?{html:new URL(url).pathname==='/'?zlibHome:zlibResults,finalUrl:url}:{html:'',finalUrl:url}});
  const bundle=await sources.search('book','超时后恢复');
  const oneLib=bundle.sources.find(source=>source.id==='onelib');
  const zlibrary=bundle.sources.find(source=>source.id==='zlibrary');
  assert.equal(oneLib.state,'ok');
  assert.equal(oneLib.items[0].name,'超时后恢复');
  assert.equal(oneLib.statusLabel,undefined);
  assert.equal(zlibrary.state,'ok');
  assert.equal(zlibrary.items[0].name,'超时后恢复');
});
