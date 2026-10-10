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
  coverFor:(item,direction='landscape')=>{const preferred=direction==='portrait'?'coverPortrait':'coverLandscape',opposite=direction==='portrait'?'coverLandscape':'coverPortrait';return item.coverShared&&item.cover?item.cover:item[preferred]||item.cover||item[opposite]||'';},
 };
 vm.runInNewContext(read('app/library-covers.js')+'\nglobalThis.__memory=libraryCoverMemory;globalThis.__signature=coverSignature;globalThis.__stable=stableCoverFor;globalThis.__attach=attachStableCover;',sandbox);
 return sandbox;
}

function imageStub(src,{width=0,complete=true,direction='landscape'}={}){
 const listeners={};return {dataset:{coverDirection:direction},classList:{add(){},remove(){}},isConnected:true,complete,naturalWidth:width,
  _src:src,get src(){return this._src;},set src(value){this._src=value;},getAttribute(name){return name==='src'?this._src:null;},
  addEventListener(name,listener){listeners[name]=listener;},removeEventListener(name){delete listeners[name];},closest(){return null;},
  fire(name){listeners[name]?.();}
 };
}

test('library cover cache is scoped to the resource and display fallback set',()=>{
 const s=librarySandbox(),none={id:'resource-A',name:'资源 A'},portraitOnly={id:'resource-B',name:'资源 B',coverPortrait:'portrait-B.jpg',coverOrientation:'portrait'};
 assert.equal(s.__signature(none,'landscape'),'');
 assert.notEqual(s.__signature(portraitOnly,'landscape'),'');
 assert.equal(s.__stable(portraitOnly,'landscape'),'portrait-B.jpg');
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

test('a visible valid cover does not trigger a background download or cache migration',()=>{
 let resolves=0;const s=librarySandbox();s.native.resolveLibraryCover=async()=>{resolves++;return 'cached-ref';};
 const item={id:'visible',name:'当前条目',coverLandscape:'https://img.test/visible.jpg'},image=imageStub(item.coverLandscape,{width:120,complete:true});
 s.__attach(image,item);
 assert.equal(resolves,0);
 assert.equal(s.__stable(item,'landscape'),item.coverLandscape);
});

test('a broken portrait tries the same resource landscape cover before a name placeholder',()=>{
 const s=librarySandbox(),item={id:'resource-cover-fallback',name:'竖图失效',coverOrientation:'portrait',coverPortrait:'broken-portrait.jpg',coverLandscape:'usable-landscape.jpg'};
 const image=imageStub(item.coverPortrait,{width:0,complete:false,direction:'portrait'});s.__attach(image,item);image.fire('error');
 assert.equal(image.src,item.coverLandscape);
 assert.notEqual(image.dataset.coverFallback,'true');
});

test('initial card cover can use a saved source URL when only its backup direction remains',()=>{
 const sandbox={CoverClassifier:require('../app/cover-classifier')};
 vm.runInNewContext(read('app/cover-ui.js')+'\nglobalThis.__coverFor=coverFor;',sandbox);
 const item={id:'network-only-backup',name:'备用封面',coverOrientation:'portrait',networkCovers:{coverPortrait:'https://img.test/portrait.jpg'}};
 assert.equal(sandbox.__coverFor(item,'landscape'),'https://img.test/portrait.jpg');
 assert.equal(sandbox.__coverFor({...item,coverLandscape:'local-landscape.jpg'},'landscape'),'local-landscape.jpg');
});

test('late failure from a previous resource cannot replace a reused image with its named fallback',async()=>{
 let finish;const s=librarySandbox();s.native.resolveLibraryCover=()=>new Promise(resolve=>{finish=resolve;});
 const oldItem={id:'resource-B',name:'资源 B',coverLandscape:'https://img.test/broken-b.jpg'};
 const image=imageStub(oldItem.coverLandscape,{width:0,complete:false});s.__attach(image,oldItem);image.fire('error');
 await new Promise(resolve=>setImmediate(resolve));
 image.complete=false;image.dataset.coverFallback='false';image.src='https://img.test/current-a.jpg';
 const currentItem={id:'resource-A',name:'资源 A',coverLandscape:image.src};s.__attach(image,currentItem);
 finish('cached-b-ref');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(image.src,'https://img.test/current-a.jpg');
 assert.equal(image.dataset.coverFallback,'false');
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
