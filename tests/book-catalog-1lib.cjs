const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSourceSearch}=require('../app/metadata-sources');

test('1lib uses its international host and exposes the external-browser verification fallback',async()=>{
  const requests=[];
  const search=createSourceSearch({
    pace:0,
    json:async()=>null,
    text:async url=>{requests.push(url);return '';},
  });
  const result=await search.search('book','Sample title');
  const oneLib=result.sources.find(source=>source.id==='onelib');
  assert.equal(requests.some(url=>url.startsWith('https://zh.1lib.sk/')),false);
  assert.ok(requests.includes('https://1lib.sk/s/Sample%20title'));
  assert.equal(oneLib.state,'unavailable');
  assert.equal(oneLib.searchUrl,'https://1lib.sk/s/Sample%20title');
});
