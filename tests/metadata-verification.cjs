const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Network=require('../app/metadata-network');
const Verification=require('../app/metadata-verification-window');
const RenderService=require('../app/metadata-render-service');

test('verification pages are actionable while ordinary denial, quota and timeout remain distinct',()=>{
  const issue=Network.classify(403,'<html><title>Checking your browser</title></html>','catalog.example');
  assert.equal(issue.kind,'verification');
  const summary=Network.summary([issue]);
  assert.equal(summary.verificationRequired,true);
  assert.equal(summary.verificationHost,'catalog.example');
  assert.equal(Network.classify(403,'Forbidden','catalog.example').kind,'denied');
  assert.equal(Network.classify(403,'<title>Access Denied</title>','catalog.example').kind,'verification');
  assert.equal(Network.classify(403,'<html><title>请稍候…</title></html>','steamui.com').kind,'verification');
  assert.equal(Network.classify(403,'<html><title>Please wait</title></html>','steamui.com').kind,'verification');
  assert.equal(Network.classify(429,'rate limited','catalog.example').kind,'quota');
  assert.equal(Network.classify(0,'','catalog.example').kind,'network');
  assert.equal(Network.classify(513,'<html><title>Verifying your browser | DiamWall</title></html>','zh.1lib.sk').kind,'verification');
});

test('rendered session snapshots include same-origin child frames while excluding unrelated embedded origins',async()=>{
  const main={url:'https://catalog.example/search?q=book',executeJavaScript:async()=>({title:'Search',html:'<html><body>shell</body></html>',anchorCount:2,bookLinkCount:0,shadowRootCount:0})};
  const resultFrame={url:'https://catalog.example/results',executeJavaScript:async()=>({title:'',html:'<a href="https://catalog.example/book/123/title">A book</a>',anchorCount:1,bookLinkCount:1,shadowRootCount:0})};
  const unrelatedFrame={url:'https://unrelated.example/content',executeJavaScript:async()=>{throw Error('cross-origin frames must not be read');}};
  main.framesInSubtree=[main,resultFrame,unrelatedFrame];
  const snapshot=await Verification.captureDomSnapshot({mainFrame:main,getURL:()=>main.url},main.url);
  assert.equal(snapshot.frameDocumentCount,2);
  assert.equal(snapshot.anchorCount,3);
  assert.equal(snapshot.bookLinkCount,1);
  assert.match(snapshot.html,/catalog\.example\/book\/123\/title/);
  assert.doesNotMatch(snapshot.html,/unrelated\.example/);
});

test('verification browser shares its persistent partition and blocks unsafe navigations',async()=>{
  assert.equal(Verification.verificationUrl('catalog.example'),'https://catalog.example/');
  assert.equal(Verification.verificationUrl('127.0.0.1'),'');
  assert.equal(Verification.safeNavigation('https://accounts.example/login'),'https://accounts.example/login');
  assert.equal(Verification.safeNavigation('http://accounts.example/login'),'');
  assert.equal(Verification.safeNavigation('https://user:pass@accounts.example/'),'');
  assert.equal(Verification.safeNavigation('https://accounts.example:8443/'),'');
  const instances=[];
  class MockWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setUserAgent=agent=>{this.agent=agent;};this.webContents.setWindowOpenHandler=handler=>{this.popup=handler;};this.webContents.getURL=()=>this.url||'';this.webContents.executeJavaScript=async script=>String(script).includes('document.documentElement?.outerHTML')?{title:this.snapshotTitle||'Verified',html:this.snapshotHtml||'<html><body>渲染后的结果</body></html>'}:'<html><body>渲染后的结果</body></html>';this.setTitle=value=>{this.nativeTitle=value;};instances.push(this);}
    isDestroyed(){return Boolean(this.destroyed);}
    loadURL(url){this.url=url;this.webContents.emit('did-finish-load');return Promise.resolve();}
    destroy(){this.destroyed=true;}
    close(){const event={prevented:false,preventDefault(){this.prevented=true;}};this.emit('close',event);if(event.prevented)return;this.destroyed=true;this.emit('closed');}
  }
  const parent=new MockWindow({});
  const open=Verification.create({BrowserWindow:MockWindow,partition:'persist:yueden-metadata',userAgent:'YueDen test'}).open('catalog.example',parent);
  const browser=instances[1];
  assert.equal(browser.url,'https://catalog.example/');
  assert.equal(browser.options.webPreferences.partition,'persist:yueden-metadata');
  assert.deepEqual({...browser.options.webPreferences},{partition:'persist:yueden-metadata',contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false});
  assert.equal(browser.agent,'YueDen test');
  browser.url='https://catalog.example/search?q=verified';browser.webContents.emit('did-navigate',{},browser.url);browser.webContents.emit('page-title-updated',{},'Verified');
  browser.close();
  assert.deepEqual(await open,{finalUrl:'https://catalog.example/search?q=verified',title:'Verified',html:'<html><body>渲染后的结果</body></html>',loadCompleted:true,verificationHit:false,verificationReason:'',verified:true,frameDocumentCount:0,anchorCount:0,bookLinkCount:0,shadowRootCount:0});
  const challenged=Verification.create({BrowserWindow:MockWindow,partition:'persist:yueden-metadata'}).open('catalog.example',parent),challengeWindow=instances.at(-1);challengeWindow.snapshotTitle='Checking your browser';challengeWindow.snapshotHtml='<html><title>Checking your browser</title></html>';challengeWindow.close();const challengeResult=await challenged;assert.equal(challengeResult.verificationHit,true);assert.equal(challengeResult.verified,false);
  const waiting=Verification.create({BrowserWindow:MockWindow,partition:'persist:yueden-metadata'}).open('catalog.example',parent,undefined,{keepOpenOnVerification:true}),waitingWindow=instances.at(-1);waitingWindow.snapshotTitle='请稍候…';waitingWindow.snapshotHtml='<html><title>请稍候…</title><body>请稍候…</body></html>';waitingWindow.close();await new Promise(resolve=>setImmediate(resolve));assert.equal(waitingWindow.isDestroyed(),false);assert.match(waitingWindow.nativeTitle,/验证仍在进行/);waitingWindow.snapshotTitle='Catalog Search';waitingWindow.snapshotHtml='<html><title>Catalog Search</title><body>搜索结果</body></html>';waitingWindow.close();const waitingResult=await waiting;assert.equal(waitingResult.verificationHit,false);assert.equal(waitingResult.verified,true);
  const dom=await Verification.create({BrowserWindow:MockWindow,partition:'persist:yueden-metadata',userAgent:'YueDen test'}).readRenderedDom('https://catalog.example/search?q=verified');
  assert.equal(dom.html,'<html><body>渲染后的结果</body></html>');
  assert.equal(dom.finalUrl,'https://catalog.example/search?q=verified');
  assert.equal(instances.at(-1).options.webPreferences.partition,'persist:yueden-metadata');
  assert.equal(instances.at(-1).options.show,false);
  const cacheReader=Verification.create({BrowserWindow:MockWindow,partition:'persist:yueden-metadata'}),interactivePage={html:'<html><body><a href="/book/1/design">渲染后的搜索结果</a></body></html>',finalUrl:'https://catalog.example/s/book',verified:true};
  assert.equal(cacheReader.cacheRenderedDom('https://catalog.example/s/book',interactivePage),true);
  const windowsBeforeCacheRead=instances.length,cached=await cacheReader.readRenderedDom('https://catalog.example/s/book');
  assert.equal(cached.html,interactivePage.html);assert.equal(cached.finalUrl,interactivePage.finalUrl);assert.equal(cached.readMode,'interactive-session-cache');assert.equal(instances.length,windowsBeforeCacheRead);
  assert.equal(cacheReader.cacheRenderedDom('https://catalog.example/s/private',{...interactivePage,verified:false}),false);
});

test('shared render service falls back through the source session and revokes stale verification on a real challenge',async()=>{
  const records=[],failures=[],events=[];
  const locations={record:(...args)=>{records.push(args);return true;}};
  const runtime={signal:()=>null,check(){},recordFailure:issue=>failures.push(issue)};
  const context={operation:'search',log:event=>events.push(event)};
  const fallback=RenderService.create({readRenderedDom:async()=>{throw Object.assign(new Error('DOM timeout'),{name:'TimeoutError',timeoutLayer:'browser-dom'});},sourceLocations:locations,network:Network,runtime,fetchText:async(url,timeout,sourceId,diagnosticContext)=>{assert.equal(sourceId,'onelib');assert.ok(timeout>0);diagnosticContext.log({phase:'http.end',status:200});return '<html><title>search</title><body>book results</body></html>';}});
  const page=await fallback('onelib','https://catalog.example/search?q=book',8500,context);
  assert.equal(page.readMode,'same-session-http-fallback');assert.match(page.html,/book results/);assert.ok(events.some(event=>event.phase==='render.http-fallback-start'));assert.equal(failures.length,0);
  const challenge=RenderService.create({readRenderedDom:async()=>({html:'<html><title>Checking your browser</title></html>',finalUrl:'https://catalog.example/search'}),sourceLocations:locations,network:Network,runtime,fetchText:async()=>{throw Error('challenge pages must not be retried');}});
  const blocked=await challenge('onelib','https://catalog.example/search',8500,context);
  assert.equal(blocked.verificationHit,true);assert.equal(failures.at(-1).kind,'verification');assert.equal(records.at(-1)[3].verified,false);
});

test('book-source renderer uses the extended DOM budget while other providers keep their existing budget',async()=>{
  const received=[],runtime={signal:()=>null,check(){},recordFailure(){}},service=RenderService.create({readRenderedDom:async(url,options)=>{received.push(options.timeoutMs);return {html:'<html><body>results</body></html>',finalUrl:url};},sourceLocations:{record(){}},network:Network,runtime,fetchText:async()=>''});
  await service('onelib','https://catalog.example/s/book',8500);
  await service('zlibrary','https://catalog.example/s/book',8500);
  await service('douban','https://catalog.example/search?q=book',8500);
  assert.deepEqual(received,[7500,7500,5000]);
});

test('rendered DOM waits for hydration and structural stability instead of returning an early partial snapshot',async()=>{
  const instances=[];
  class MutatingWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setUserAgent=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>this.url||'';this.root={outerHTML:'<html><body>page shell</body></html>'};this.document={documentElement:this.root,body:{innerText:'page shell',textContent:'page shell'},title:'',readyState:'complete',forms:[],querySelectorAll:()=>[]};this.webContents.executeJavaScript=script=>{setTimeout(()=>{this.root.outerHTML='<html><body>hydrated search result</body></html>';this.document.body.innerText='hydrated search result';this.document.body.textContent='hydrated search result';},2800);return vm.runInNewContext(script,{document:this.document,MutationObserver:class{constructor(callback){this.callback=callback;}observe(){this.timer=setInterval(()=>this.callback(),40);}disconnect(){clearInterval(this.timer);}},setTimeout,clearTimeout,setInterval,clearInterval,Date});};instances.push(this);}
    isDestroyed(){return Boolean(this.destroyed);}
    loadURL(url){this.url=url;return Promise.resolve();}
    destroy(){this.destroyed=true;}
  }
  const reader=Verification.create({BrowserWindow:MutatingWindow,partition:'persist:yueden-metadata'});
  const start=Date.now(),dom=await reader.readRenderedDom('https://catalog.example/search?q=ok',{timeoutMs:7000});
  const elapsed=Date.now()-start;
  assert.match(dom.html,/hydrated search result/);
  assert.equal(dom.returnReason,'stable');
  assert.ok(elapsed>=3800&&elapsed<5500,'the renderer should wait for late page content and then for a quiet DOM');
  assert.equal(dom.finalUrl,'https://catalog.example/search?q=ok');
  instances.at(-1).destroy();
});

test('rendered DOM returns a bounded snapshot when a page keeps mutating',async()=>{
  let ticks=0,mutationTimer;
  class DynamicWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setUserAgent=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>this.url||'';this.root={outerHTML:'<html><body>live result</body></html>'};this.document={documentElement:this.root,body:{innerText:'live result',textContent:'live result'},title:'Live results',readyState:'complete',forms:[],querySelectorAll:()=>[]};this.webContents.executeJavaScript=script=>{mutationTimer=setInterval(()=>{ticks++;this.document.body.innerText=`live result ${ticks}`;this.document.body.textContent=this.document.body.innerText;this.root.outerHTML=`<html><body>${this.document.body.innerText}</body></html>`;},100);return vm.runInNewContext(script,{document:this.document,MutationObserver:class{constructor(callback){this.callback=callback;}observe(){this.timer=setInterval(()=>this.callback(),40);}disconnect(){clearInterval(this.timer);}},setTimeout,clearTimeout,setInterval,clearInterval,Date});};}
    isDestroyed(){return Boolean(this.destroyed);}
    loadURL(url){this.url=url;return Promise.resolve();}
    destroy(){this.destroyed=true;clearInterval(mutationTimer);}
  }
  const reader=Verification.create({BrowserWindow:DynamicWindow,partition:'persist:yueden-metadata'});
  const start=Date.now(),dom=await reader.readRenderedDom('https://catalog.example/live',{timeoutMs:3000});
  const elapsed=Date.now()-start;
  assert.match(dom.html,/live result/);
  assert.equal(dom.returnReason,'maximum-wait');
  assert.ok(ticks>0,'the page should still be mutating when its snapshot is returned');
  assert.ok(elapsed<2500,'continuous page mutations must not consume the entire render timeout');
});

test('rendered DOM preserves a readable snapshot when the DOM-settle wait expires',async()=>{
  class BusyWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setUserAgent=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>this.url||'';this.webContents.executeJavaScript=script=>script.includes('const root=document.documentElement')?new Promise(()=>{}):Promise.resolve({title:'Search',html:'<html><body><a href="https://catalog.example/book/1/test">rendered result</a></body></html>',anchorCount:1,bookLinkCount:1,shadowRootCount:0});}
    isDestroyed(){return Boolean(this.destroyed);}
    loadURL(url){this.url=url;this.webContents.emit('did-finish-load');return Promise.resolve();}
    destroy(){this.destroyed=true;}
  }
  const reader=Verification.create({BrowserWindow:BusyWindow,partition:'persist:yueden-metadata'});
  const dom=await reader.readRenderedDom('https://catalog.example/search?q=book',{timeoutMs:900});
  assert.match(dom.html,/rendered result/);
  assert.equal(dom.returnReason,'dom-timeout-snapshot');
  assert.equal(dom.partialSnapshot,true);
  assert.equal(dom.timeoutLayer,'browser-dom');
});

test('source adapters share the session fetch, generic verification stays available, and SteamUI is detached',()=>{
  const main=fs.readFileSync(require.resolve('../app/main.js'),'utf8');
  const renderer=fs.readFileSync(require.resolve('../app/metadata-results.js'),'utf8');
  assert.match(main,/const METADATA_SESSION_PARTITION = 'persist:yueden-metadata'/);
  assert.match(main,/create\(\{BrowserWindow,partition:METADATA_SESSION_PARTITION/);
  assert.match(main,/createGameSources\(\{json:\(\.\.\.args\)=>fetchMetadataJson\(\.\.\.args\),text:\(\.\.\.args\)=>fetchMetadataText\(\.\.\.args\),steam:/);
  assert.match(main,/createSourceSearch\(\{[\s\S]*sourceHome:[\s\S]*renderHtml:renderMetadataHtml/);
  assert.match(main,/renderHtml:renderMetadataHtml/);
  assert.match(main,/metadata-render-service'\)\.create\(\{readRenderedDom:\(\.\.\.args\)=>metadataVerificationWindow\.readRenderedDom\(\.\.\.args\)/);
  assert.match(require('node:fs').readFileSync(require.resolve('../app/metadata-render-service'),'utf8'),/fetchText\(url,remaining,sourceId,diagnosticContext\)/);
  assert.match(main,/native-json'\)\.nativeJson\(\(input,init=\{\}\)=>getMetadataHttpSession\(\)\.fetch\(input,\{\.\.\.init,credentials:'include'\}\)/);
  assert.match(main,/if\(sourceId==='onelib'\)[\s\S]{0,350}getMetadataHttpSession\(\)\.fetch\(url,\{credentials:'include'/);
  assert.match(main,/credentials:'include'/);
  assert.match(main,/current\.origin!==allowedOrigin/);
  assert.match(main,/metadataSourceLocations\.rewrite\(sourceId,url\)/);
  assert.doesNotMatch(main,/steamUiBrowserSearch|steamUiResults|steamui\.com|SteamUI/);
  assert.match(main,/async function steamSearch\(query,emit=\(\)=>\{\}\)/);
  for(const endpoint of ['steamSuggestSearch(query)','store.steampowered.com/api/storesearch/','steamcommunity.com/actions/SearchApps/','steamPagedSearch(query)'])assert.ok(main.includes(endpoint),endpoint);
  assert.doesNotMatch(renderer,/系统浏览器验证窗口/);
  assert.match(main,/metadataSourceLocations\.record\(safeSourceId,safeHost,result\.finalUrl,\{verified\}\)/);
  assert.match(main,/text: \(url,timeout,sourceId,diagnosticContext\) => fetchMetadataText\(url,timeout,sourceId,diagnosticContext\)/);
  assert.match(renderer,/native\.openMetadataVerification\(group\.verificationHost,payload\.type\|\|metadataPrimaryType\(\),payload\.query,sourceId\)/);
  assert.match(renderer,/group\.verificationRequired===true/);
});

test('redirected verification keeps the original challenged source host for the browser retry',async()=>{
  const Runtime=require('../app/metadata-runtime');
  const Network=require('../app/metadata-network');
  const issues=await Runtime.withDiagnostics(async captured=>{
    await Network.readResponse({status:403,ok:false,url:'https://challenge.example/check',headers:{get:()=> 'text/html'},text:async()=>'<html><title>Checking your browser</title></html>'},'https://steamui.com/api/loadGames.php?search=ff7');
    return captured;
  });
  assert.equal(issues[0]?.kind,'verification');
  assert.equal(issues[0]?.host,'steamui.com');
});

test('verified effective origins persist without query strings and rewrite any source request using the same challenged host',t=>{
  const root=path.join(__dirname,'..','test-artifacts'),dir=fs.mkdtempSync(path.join(root,'metadata-locations-')),file=path.join(dir,'locations.json');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const Locations=require('../app/metadata-source-locations'),locations=Locations.create({file});
  assert.equal(locations.isVerified('onelib'),false);
  assert.equal(locations.record('onelib','zh.1lib.sk','https://accounts.auth-provider.example/login?code=private'),true);
  assert.equal(locations.homeFor('onelib','https://zh.1lib.sk/'),'https://zh.1lib.sk/');
  assert.equal(locations.record('onelib','zh.1lib.sk','https://catalog-mirror.example/s/book?token=private#top'),true);
  assert.equal(locations.isVerified('onelib'),false);
  assert.equal(locations.record('onelib','zh.1lib.sk','https://catalog-mirror.example/s/book',{verified:true}),true);
  assert.equal(locations.isVerified('onelib'),true);
  assert.equal(locations.homeFor('onelib','https://zh.1lib.sk/'),'https://catalog-mirror.example/s/book');
  assert.equal(locations.rewrite('other-provider','https://zh.1lib.sk/s/query'),'https://catalog-mirror.example/s/query');
  assert.equal(fs.readFileSync(file,'utf8').includes('private'),false);
  const reloaded=Locations.create({file});
  assert.equal(reloaded.isVerified('onelib'),true);
  assert.equal(reloaded.originFor('onelib','https://zh.1lib.sk/'),'https://catalog-mirror.example');
  assert.equal(reloaded.rewrite('onelib','https://zh.1lib.sk/book/123'),'https://catalog-mirror.example/book/123');
  assert.equal(reloaded.record('onelib','zh.1lib.sk','https://catalog-mirror.example/verify',{verified:false}),true);
  assert.equal(reloaded.isVerified('onelib'),false);
  assert.equal(Locations.create({file}).isVerified('onelib'),false);
});
