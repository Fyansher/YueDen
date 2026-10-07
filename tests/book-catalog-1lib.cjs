const {test}=require('node:test');
const assert=require('node:assert/strict');
const Books=require('../app/book-catalog-sources');

test('1lib carries rendered search and detail finalUrl across effective origins',async()=>{
  const query='通关！游戏设计之道',requests=[],rendered=[];let effectiveHome='https://zh.1lib.sk/';
  const searchHtml='<article class="book-result"><a href="/book/123/game-design"><h2>'+query+'</h2><img data-src="/covers/123.jpg"></a></article>';
  const detailHtml='<html><head><meta property="og:title" content="'+query+'"><meta property="og:description" content="书籍详情摘要"><meta property="og:image" content="../covers/123.jpg"></head><body><table><tr><td>作者</td><td>作者甲</td></tr><tr><td>出版社</td><td>示例出版社</td></tr><tr><td>ISBN</td><td>9787536692930</td></tr><tr><td>页数</td><td>302</td></tr></table></body></html>';
  const rows=await Books.search({
    sourceHome:()=>effectiveHome,
    html:async url=>{requests.push(url);return '<div id="app"></div>';},
    renderHtml:async url=>{rendered.push(url);effectiveHome='https://catalog-mirror.example/';return {html:searchHtml,finalUrl:'https://catalog-mirror.example/s/'+encodeURIComponent(query)};},
  },query,'onelib');
  assert.deepEqual(requests,['https://zh.1lib.sk/s/'+encodeURIComponent(query)]);
  assert.deepEqual(rendered,requests);
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,query);
  assert.equal(rows[0].storeUrl,'https://catalog-mirror.example/book/123/game-design');
  assert.equal(rows[0].cover,'https://catalog-mirror.example/covers/123.jpg');
  const detail=await Books.resolveCandidate({
    sourceHome:()=> effectiveHome,
    html:async url=>{requests.push(url);return '<div id="app"></div>';},
    renderHtml:async url=>({html:detailHtml,finalUrl:'https://detail-mirror.example/book/123/page'}),
  },rows[0],'onelib');
  assert.equal(detail.developer,'作者甲');
  assert.equal(detail.publisher,'示例出版社');
  assert.equal(detail.isbn,'9787536692930');
  assert.equal(detail.pages,302);
  assert.equal(detail.description,'书籍详情摘要');
  assert.equal(detail.cover,'https://detail-mirror.example/book/covers/123.jpg');
  assert.equal(requests.at(-1),'https://catalog-mirror.example/book/123/game-design');
});

test('1lib challenge returned by rendered DOM remains a verification issue',async()=>{
  const Runtime=require('../app/metadata-runtime');
  await Runtime.withDiagnostics(async issues=>{
    const rows=await Books.search({sourceHome:()=> 'https://zh.1lib.sk/',html:async()=>'<div id="app"></div>',renderHtml:async()=>({html:'<html><title>Verifying your browser | DiamWall</title></html>',finalUrl:'https://verify.1lib.example/challenge'})},'验证页','onelib');
    assert.deepEqual(rows,[]);
    assert.equal(issues.some(issue=>issue.kind==='verification'),true);
    assert.equal(issues.some(issue=>/结构无法识别/.test(issue.message)),false);
  });
});

test('a previously verified 1lib source reads search and detail through its rendered session first',async()=>{
  const query='通关！游戏设计之道',httpCalls=[],renderCalls=[];
  const searchHtml='<article><a href="/book/123/design"><h2>'+query+'</h2></a></article>';
  const detailHtml='<html><head><meta property="og:title" content="'+query+'"><meta property="og:description" content="会话内详情"></head><body><div>作者：作者甲</div></body></html>';
  const search=await Books.search({sourceVerified:()=>true,sourceHome:()=> 'https://verified-1lib.example/',html:async url=>{httpCalls.push(url);return '';},renderHtml:async url=>{renderCalls.push(url);return {html:searchHtml,finalUrl:'https://verified-1lib.example/s/'+encodeURIComponent(query)};}},query,'onelib');
  assert.equal(search.length,1);
  assert.equal(httpCalls.length,0);
  assert.equal(renderCalls.length,1);
  const detail=await Books.resolveCandidate({sourceVerified:()=>true,sourceHome:()=> 'https://verified-1lib.example/',html:async url=>{httpCalls.push(url);return '';},renderHtml:async url=>({html:detailHtml,finalUrl:'https://verified-1lib.example/book/123/design'})},search[0],'onelib');
  assert.equal(detail.description,'会话内详情');
  assert.equal(detail.detailsUnavailable,false);
  assert.equal(httpCalls.length,0);
});

test('1lib keeps explicit zero results distinct from an unrecognized results page',()=>{
  assert.deepEqual(Books.parseSearch('<p>没有找到相关书籍</p>','onelib','https://zh.1lib.sk/'),[]);
  assert.throws(()=>Books.parseSearch('<main class="unexpected">内容</main>','onelib','https://zh.1lib.sk/'),/结构无法识别/);
});

test('1lib recognizes card titles exposed through accessible labels and cover alt text',()=>{
  const page='<article><a aria-label="通关！游戏设计之道（第2版）" href="/book/123/design.html"><img src="/cover/123.jpg"></a></article><article><a href="/book/124/design.html"><img alt="另一本文名" src="/cover/124.jpg"></a></article><article><a href="/book/125/%E7%AC%AC%E4%B8%89%E6%9C%AC%E4%B9%A6.html"></a></article>';
  const rows=Books.parseSearch(page,'onelib','https://zh.1lib.sk/');
  assert.deepEqual(rows.map(row=>row.name),['通关！游戏设计之道（第2版）','另一本文名','第三本书']);
});

test('verified 1lib can retry through a distinct live GET search route and preserve hidden form fields',async()=>{
  const query='通关！游戏设计之道',direct='https://verified-1lib.example/s/'+encodeURIComponent(query),retry='https://verified-1lib.example/search?token=session-secret&q='+encodeURIComponent(query),calls=[];
  const searchForm='<html><title>Search</title><form action="/search" method="get"><input type="hidden" name="token" value="session-secret"><input type="text" name="q"></form></html>';
  const results='<html><form action="/search" method="get"><input type="hidden" name="token" value="session-secret"><input type="text" name="q"></form><article class="book-result"><a href="/book/123/design"><h2>'+query+'</h2><img src="/cover/123.jpg"></a></article></html>';
  const rows=await Books.search({sourceVerified:()=>true,sourceHome:()=> 'https://verified-1lib.example/',html:async url=>{calls.push(['http',url]);return '';},renderHtml:async url=>{calls.push(['render',url]);return {html:url===direct?searchForm:results,finalUrl:url};}},query,'onelib');
  assert.equal(rows.length,1);
  assert.equal(rows[0].storeUrl,'https://verified-1lib.example/book/123/design');
  assert.deepEqual(calls.filter(call=>call[1]===direct||call[1]===retry),[['render',direct],['http',direct],['render',retry]]);
  assert.equal(calls.filter(call=>call[0]==='render').length,2);
});

test('1lib uses the live path-based /s/<query> route and parses current book-detail URLs',async()=>{
  const query='通关！游戏设计之道',home='https://zh.1lib.sk/',target=home+'s/'+encodeURIComponent(query),calls=[];
  const form='<form action="/s/" method="get"><input type="hidden" name="token" value="session-secret"><input type="search" name="q"></form>';
  const results='<section><a href="/book/123/level-up.html"><h2>'+query+'</h2><img src="/cover/123.jpg"></a></section>';
  const rows=await Books.search({sourceHome:()=>home,html:async url=>{calls.push(url);return url===home?form:results;}},query,'onelib');
  assert.deepEqual(calls,[target]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].detailUrl,home+'book/123/level-up.html');
});
