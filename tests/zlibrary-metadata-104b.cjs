const {test}=require('node:test');
const assert=require('node:assert/strict');
const Z=require('../app/zlibrary-metadata');

test('Z-Library uses the verified effective origin, parses its search results, then reads one selected detail',async()=>{
  const home='<form action="/search" method="get"><input type="hidden" name="token" value="session-secret"><input type="search" name="q"></form>';
  const results='<section class="results"><a href="/book/456/design"><h2>通关！游戏设计之道</h2></a></section>';
  const detail='<html><head><meta property="og:title" content="通关！游戏设计之道"><meta property="og:description" content="Z-Library 详情摘要"></head><body><table><tr><td>Author</td><td>作者乙</td></tr><tr><td>Publisher</td><td>测试出版社</td></tr><tr><td>ISBN</td><td>9787536692930</td></tr></table></body></html>';
  const calls=[];
  const adapter={sourceHome:()=> 'https://verified-zlib.example/',html:async url=>{calls.push(url);if(url==='https://verified-zlib.example/')return home;if(url.startsWith('https://verified-zlib.example/search?'))return results;if(url==='https://verified-zlib.example/book/456/design')return '<div id="app"></div>';return '';},renderHtml:async url=>({html:url.endsWith('/book/456/design')?detail:'',finalUrl:url})};
  const rows=await Z.search(adapter,'通关！游戏设计之道');
  assert.equal(calls[0],'https://verified-zlib.example/');
  assert.ok(calls.some(url=>url==='https://verified-zlib.example/search?token=session-secret&q=%E9%80%9A%E5%85%B3%EF%BC%81%E6%B8%B8%E6%88%8F%E8%AE%BE%E8%AE%A1%E4%B9%8B%E9%81%93'));
  assert.equal(rows.length,1);
  assert.equal(rows[0].storeUrl,'https://verified-zlib.example/book/456/design');
  const found=await Z.resolve(adapter,rows[0]);
  assert.equal(found.developer,'作者乙');
  assert.equal(found.publisher,'测试出版社');
  assert.equal(found.isbn,'9787536692930');
  assert.equal(found.description,'Z-Library 详情摘要');
  assert.equal(found.detailsUnavailable,false);
});

test('current Z-Library /s/ search form resolves to /s/<query> and parses the live book URL shape',async()=>{
  const query='通关！游戏设计之道',home='https://zh.zlib.bz/',target=home+'s/'+encodeURIComponent(query),detailUrl=home+'book/456/level-up.html',calls=[];
  const form='<form action="/s/" method="get"><input type="hidden" name="token" value="session-secret"><input type="search" name="q"></form>';
  const results='<div class="book-item"><a href="/book/456/level-up.html"><h3>'+query+'（第2版）</h3><img data-src="/covers/456.jpg"></a></div>';
  const detail='<html><head><meta property="og:title" content="'+query+'（第2版）"><meta property="og:description" content="Z-Library 详情摘要"></head><body><table><tr><td>Author</td><td>作者乙</td></tr><tr><td>Publisher</td><td>测试出版社</td></tr></table></body></html>';
  const adapter={sourceHome:()=>home,html:async url=>{calls.push(url);if(url===home)return form;if(url===target)return results;if(url===detailUrl)return detail;return '';}};
  const rows=await Z.search(adapter,query);
  assert.deepEqual(calls.slice(0,2),[home,target]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].storeUrl,detailUrl);
  const found=await Z.resolve(adapter,rows[0]);
  assert.equal(found.developer,'作者乙');
  assert.equal(found.publisher,'测试出版社');
  assert.equal(found.description,'Z-Library 详情摘要');
  assert.equal(found.detailsUnavailable,false);
});

test('verified Z-Library follows the live results-page GET filter form without aborting result parsing',async()=>{
  const query='通关！游戏设计之道',target='https://verified-zlib.example/s/'+encodeURIComponent(query),rendered=[];
  const shell='<form action="/s/" method="get"><input type="hidden" name="content_type" value="book"><input type="search" name="q" value="'+query+'"></form>';
  const filtered='https://verified-zlib.example/s/'+encodeURIComponent(query)+'?content_type=book';
  const results='<section><a href="/book/456/design.html"><h2>'+query+'（第2版）</h2></a></section>';
  const adapter={sourceVerified:()=>true,sourceHome:()=>target,html:async()=>'',renderHtml:async url=>{rendered.push(url);return {html:url===target?shell:results,finalUrl:url};}};
  const rows=await Z.search(adapter,query);
  assert.equal(rendered[0],target);assert.equal(rendered[1],filtered);
  assert.equal(rows.length,1);assert.equal(rows[0].name,query+'（第2版）');assert.equal(rows[0].storeUrl,'https://verified-zlib.example/book/456/design.html');
});

test('Z-Library distinguishes an explicit zero-result page from an unknown page and rejects off-origin detail links',()=>{
  assert.deepEqual(Z.parseSearch('<p>No results</p>','https://verified-zlib.example/'),[]);
  assert.throws(()=>Z.parseSearch('<main>Layout changed</main>','https://verified-zlib.example/'),/结构无法识别/);
  assert.equal(Z.safeUrl('https://elsewhere.example/book/1','https://verified-zlib.example/'),'');
  assert.equal(Z.safeUrl('http://verified-zlib.example/book/1','https://verified-zlib.example/'),'');
});

test('Z-Library recognizes rendered result cards when the title is exposed by accessibility metadata',()=>{
  const page='<section><a href="/book/456/design.html" aria-label="通关！游戏设计之道（第2版）"><img src="/cover/456.jpg"></a></section><section><a href="/book/457/design.html"><img alt="另一本书" src="/cover/457.jpg"></a></section><section><a href="/book/458/%E7%AC%AC%E4%B8%89%E6%9C%AC%E4%B9%A6.html"></a></section>';
  const rows=Z.parseSearch(page,'https://verified-zlib.example/');
  assert.deepEqual(rows.map(row=>row.name),['通关！游戏设计之道（第2版）','另一本书','第三本书']);
});

test('Z-Library carries rendered home, search and detail finalUrl through relative links',async()=>{
  const query='通关！游戏设计之道',calls=[],renderCalls=[];let effectiveHome='https://zh.zlib.bz/';
  const home='<form action="search" method="get"><input type="search" name="q"></form>';
  const results='<section><a href="../book/456/design"><h2>'+query+'</h2><img src="../../covers/456.jpg"></a></section>';
  const detail='<html><head><meta property="og:title" content="'+query+'"><meta property="og:description" content="详情摘要"><meta property="og:image" content="../covers/456.jpg"></head><body><table><tr><td>Author</td><td>作者乙</td></tr></table></body></html>';
  const adapter={
    sourceHome:()=>effectiveHome,
    html:async url=>{calls.push(url);return '<div id="app"></div>';},
    renderHtml:async url=>{
      renderCalls.push(url);
      if(url==='https://zh.zlib.bz/'){effectiveHome='https://home-mirror.example/catalog';return {html:home,finalUrl:effectiveHome};}
      if(url.includes('home-mirror.example/search?')){effectiveHome='https://results-mirror.example/';return {html:results,finalUrl:'https://results-mirror.example/s/'+encodeURIComponent(query)};}
      effectiveHome='https://detail-mirror.example/';return {html:detail,finalUrl:'https://detail-mirror.example/book/456/design'};
    }
  };
  const rows=await Z.search(adapter,query);
  assert.equal(rows.length,1);
  assert.equal(calls[0],'https://zh.zlib.bz/');
  assert.ok(renderCalls.includes('https://home-mirror.example/search?q='+encodeURIComponent(query)));
  assert.equal(rows[0].storeUrl,'https://results-mirror.example/book/456/design');
  assert.equal(rows[0].cover,'https://results-mirror.example/covers/456.jpg');
  const detailResult=await Z.resolve(adapter,rows[0]);
  assert.equal(detailResult.developer,'作者乙');
  assert.equal(detailResult.description,'详情摘要');
  assert.equal(detailResult.cover,'https://detail-mirror.example/book/covers/456.jpg');
  assert.ok(calls.includes('https://results-mirror.example/book/456/design'));
});

test('Z-Library challenge returned by rendered DOM remains a verification issue',async()=>{
  const Runtime=require('../app/metadata-runtime');
  await Runtime.withDiagnostics(async issues=>{
    const result=await Z.search({sourceHome:()=> 'https://zh.zlib.bz/',html:async()=>'<form action="/search" method="get"><input name="q" type="search"></form>',renderHtml:async()=>({html:'<html><title>Checking your browser</title><body>Access Denied</body></html>',finalUrl:'https://verify.zlib.example/challenge'})},'验证页');
    assert.deepEqual(result,[]);
    assert.equal(issues.some(issue=>issue.kind==='verification'),true);
    assert.equal(issues.some(issue=>/结构无法识别/.test(issue.message)),false);
  });
});

test('a previously verified Z-Library source uses rendered home, search and detail without serial HTTP waits',async()=>{
  const query='通关！游戏设计之道',httpCalls=[],renderCalls=[];
  const home='<form action="/search" method="get"><input name="q" type="search"></form>';
  const results='<section><a href="/book/456/design"><h2>'+query+'</h2></a></section>';
  const detail='<html><head><meta property="og:title" content="'+query+'"><meta property="og:description" content="验证会话详情"></head><body><table><tr><td>Author</td><td>作者乙</td></tr></table></body></html>';
  const adapter={sourceVerified:()=>true,sourceHome:()=> 'https://verified-zlib.example/',html:async url=>{httpCalls.push(url);return '';},renderHtml:async url=>{renderCalls.push(url);if(url==='https://verified-zlib.example/')return {html:home,finalUrl:url};if(url.includes('/search?'))return {html:results,finalUrl:url};return {html:detail,finalUrl:'https://verified-zlib.example/book/456/design'};}};
  const rows=await Z.search(adapter,query);
  assert.equal(rows.length,1);
  assert.equal(rows[0].storeUrl,'https://verified-zlib.example/book/456/design');
  assert.deepEqual(httpCalls,[]);
  assert.equal(renderCalls.length,2);
  const found=await Z.resolve(adapter,rows[0]);
  assert.equal(found.description,'验证会话详情');
  assert.equal(found.developer,'作者乙');
  assert.equal(httpCalls.length,0);
});
