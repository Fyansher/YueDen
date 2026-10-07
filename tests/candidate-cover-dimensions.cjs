const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCandidateCovers}=require('../app/candidate-covers');

test('cover preview reports the source image and its actual dimensions',async()=>{
  const url='um-cover://image/'+('a'.repeat(64))+'.jpg';
  const cache=createCandidateCovers({request:async()=>null,compact:value=>value,dimensions:reference=>reference===url?{width:600,height:900}:null,exists:()=>true});
  const result=await cache.resolveDetailed([url],{owner:'test',id:'portrait'});
  assert.deepEqual(result,{reference:url,sourceUrl:url,dimensions:{width:600,height:900}});
});
