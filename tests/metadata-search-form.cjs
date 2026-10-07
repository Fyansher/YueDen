const {test}=require('node:test');
const assert=require('node:assert/strict');
const Form=require('../app/metadata-search-form');

test('same-origin GET search forms preserve hidden and checked fields without logging their values',()=>{
  const page='<form method="get" action="/s/"><input type="hidden" name="token" value="opaque-token"><input type="search" name="q"><input type="checkbox" name="e" value="1" checked><input type="checkbox" name="fulltext" value="1"></form>';
  const stats={},target=Form.buildGetSearchUrl(page,'A search phrase','https://catalog.example/',stats),url=new URL(target);
  assert.equal(url.origin,'https://catalog.example');
  assert.equal(url.pathname,'/s/');
  assert.equal(url.searchParams.get('token'),'opaque-token');
  assert.equal(url.searchParams.get('q'),'A search phrase');
  assert.equal(url.searchParams.get('e'),'1');
  assert.equal(url.searchParams.has('fulltext'),false);
  assert.equal(stats.searchFormCandidateCount,1);
});

test('GET search forms cannot send queries or hidden tokens to another origin',()=>{
  const page='<form method="get" action="https://other.example/search"><input type="hidden" name="token" value="opaque-token"><input type="search" name="q"></form>';
  assert.equal(Form.buildGetSearchUrl(page,'query','https://catalog.example/'), '');
});
