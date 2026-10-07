const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function librarySandbox(){
 const sandbox={
  window:{addEventListener(){}},document:{querySelectorAll:()=>[]},native:{},state:{items:[]},
  CoverClassifier:require('../app/cover-classifier'),
  fallbackCover:name=>'fallback:'+name,
  coverFor:(item,direction='landscape')=>item.coverShared&&item.cover?item.cover:item[direction==='portrait'?'coverPortrait':'coverLandscape']||item.cover||'',
 };
 vm.runInNewContext(read('app/library-covers.js')+'\nglobalThis.__memory=libraryCoverMemory;globalThis.__signature=coverSignature;globalThis.__stable=stableCoverFor;globalThis.__attach=attachStableCover;',sandbox);
 return sandbox;
}

function imageStub(src,{width=0,complete=true}={}){
 const listeners={};return {dataset:{coverDirection:'landscape'},classList:{add(){},remove(){}},isConnected:true,complete,naturalWidth:width,
  _src:src,get src(){return this._src;},set src(value){this._src=value;},getAttribute(name){return name==='src'?this._src:null;},
  addEventListener(name,listener){listeners[name]=listener;},removeEventListener(name){delete listeners[name];},closest(){return null;},
  fire(name){listeners[name]?.();}
 };
}

test('library cover cache is scoped to the resource and direction; empty cover sets are never shared',()=>{
 const s=librarySandbox(),none={id:'resource-A',name:'资源 A'},portraitOnly={id:'resource-B',name:'资源 B',coverPortrait:'portrait-B.jpg',coverOrientation:'portrait'};
 assert.equal(s.__signature(none,'landscape'),'');
 assert.equal(s.__signature(portraitOnly,'landscape'),'');
 const first={id:'resource-A',name:'资源 A',coverLandscape:'same-url.jpg'},second={id:'resource-B',name:'资源 B',coverLandscape:'same-url.jpg'};
 const firstKey=s.__signature(first,'landscape'),secondKey=s.__signature(second,'landscape');
 assert.notEqual(firstKey,secondKey);
 s.__memory.set(secondKey,'resource-B-temporary-reference');
 assert.equal(s.__stable(first,'landscape'),'same-url.jpg');
 assert.equal(s.__stable(second,'landscape'),'resource-B-temporary-reference');
});

test('failed cover fallback keeps its own resource name and is not cached for another resource',async()=>{
 const s=librarySandbox(),item={id:'resource-B',name:'资源 B',coverLandscape:'https://invalid.example/broken.jpg'},key=s.__signature(item,'landscape');
 const image=imageStub('https://invalid.example/broken.jpg',{width:0,complete:true});
 s.__attach(image,item);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(image.dataset.coverFallback,'true');
 assert.equal(image.src,'fallback:资源 B');
 assert.equal(s.__memory.has(key),false);
 assert.equal(s.__stable({id:'resource-A',name:'资源 A'},'landscape'),'');
});

test('metadata search candidate placeholders are identity-scoped and never enter the cover cache',async()=>{
 const sandbox={
  native:{},metadataSession:null,metadataSelectionEpoch:0,CoverClassifier:require('../app/cover-classifier'),
  fallbackCover:name=>'fallback:'+name,
 };
 vm.runInNewContext(read('app/metadata-results.js')+'\nglobalThis.__load=loadCandidateCover;globalThis.__references=candidateCoverReferences;globalThis.__key=candidateCoverKey;',sandbox);
 const image=()=>{let src='';return {dataset:{},classList:{add(){},remove(){}},isConnected:true,naturalWidth:0,
  get src(){return src;},set src(value){src=value;queueMicrotask(()=>{this.naturalWidth=1;this.onload?.();});}
 };};
 const candidateB={id:'b',_sourceId:'steam',mediaType:'game',name:'资源 B'},candidateA={id:'a',_sourceId:'steam',mediaType:'game',name:'资源 A'},previewB=image(),previewA=image();
 const keyB=sandbox.__key(candidateB),keyA=sandbox.__key(candidateA);
 assert.notEqual(keyA,keyB);
 sandbox.__load(previewB,candidateB);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(previewB.src,'fallback:资源 B');
 assert.equal(sandbox.__references.has(keyB),false);
 sandbox.__load(previewA,candidateA);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(previewA.src,'fallback:资源 A');
 assert.equal(sandbox.__references.has(keyA),false);
});
