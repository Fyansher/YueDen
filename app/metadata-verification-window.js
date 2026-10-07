const {isIP}=require('node:net');

function hostName(value){
 const host=String(value||'').trim().toLowerCase();
 if(host.length>253||host.endsWith('.')||isIP(host)||!host.includes('.'))return '';
 const labels=host.split('.');
 if(labels.some(label=>label.length<1||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return '';
 return host;
}
function verificationUrl(host){const safe=hostName(host);return safe?'https://'+safe+'/':'';}
function safeNavigation(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!hostName(url.hostname))return '';return url.href;}catch{return '';}
}
const renderedDomScript=`(()=>{const doc=document,parts=[];let shadowRootCount=0,anchorCount=0,bookLinkCount=0;const serialize=root=>{const isDocument=root?.nodeType===9,source=isDocument?root.documentElement:root;if(!source)return '';let clone;if(source.nodeType===1)clone=source.cloneNode(true);else{clone=doc.createElement('div');for(const child of Array.from(source.childNodes||[]))clone.appendChild(child.cloneNode(true));}const originals=source.nodeType===1?[source,...(source.querySelectorAll?.('*')||[])]:[...(source.querySelectorAll?.('*')||[])],copies=clone.nodeType===1?[clone,...(clone.querySelectorAll?.('*')||[])]:[...(clone.querySelectorAll?.('*')||[])];for(let i=0;i<Math.min(originals.length,copies.length);i++){const original=originals[i],copy=copies[i];for(const key of ['href','src','poster','data-src']){const raw=original.getAttribute?.(key);if(!raw||raw.startsWith('#'))continue;try{const target=new URL(raw,original.ownerDocument?.baseURI||doc.baseURI);if(/^https?:$/.test(target.protocol))copy.setAttribute(key,target.href);}catch{}}if(original.matches?.('a[href]')){const owner=original.ownerDocument||doc,refs=(original.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean),labelled=refs.map(id=>owner.getElementById(id)?.textContent||'').join(' '),alts=[...(original.querySelectorAll('img[alt],img[title]')||[])].map(img=>img.getAttribute('alt')||img.getAttribute('title')||'').join(' '),visible=original.innerText||original.textContent||'',label=[labelled,original.getAttribute('aria-label')||'',original.getAttribute('title')||'',alts,visible].filter(value=>String(value||'').trim()).join(' ').replace(/\\s+/g,' ').trim();if(label)copy.setAttribute('data-yueden-accessible-label',label.slice(0,1200));}}return clone.outerHTML||clone.innerHTML||'';};const seen=new Set();const visit=root=>{if(!root?.querySelectorAll||seen.has(root))return;seen.add(root);for(const anchor of root.querySelectorAll('a[href]')){anchorCount++;if(/\\/book\\//i.test(anchor.getAttribute('href')||''))bookLinkCount++;}for(const host of root.querySelectorAll('*')){let shadow;try{shadow=host.shadowRoot;}catch{}if(shadow&&!seen.has(shadow)){shadowRootCount++;const html=serialize(shadow);if(html)parts.push(html);visit(shadow);}}};const main=serialize(doc);if(main)parts.push(main);visit(doc);return {title:doc.title||'',html:parts.join('\\n'),anchorCount,bookLinkCount,shadowRootCount};})()`;
async function captureDomSnapshot(webContents,pageUrl){
 const current=safeNavigation(pageUrl||(()=>{try{return webContents.getURL();}catch{return '';}})()),mainOrigin=current?new URL(current).origin:'';let mainFrame=null,frames=[];
 try{mainFrame=webContents.mainFrame||null;const subtree=mainFrame?.framesInSubtree;if(Array.isArray(subtree))frames=subtree.slice();}catch{}
 if(!frames.length&&mainFrame?.executeJavaScript)frames=[mainFrame];
 if(!frames.length){try{return await webContents.executeJavaScript("({title:document.title||'',html:document.documentElement?.outerHTML||'',anchorCount:document.querySelectorAll('a[href]').length,bookLinkCount:document.querySelectorAll('a[href*=\\\"/book/\\\" i]').length,shadowRootCount:0})",true);}catch{return {title:'',html:'',anchorCount:0,bookLinkCount:0,shadowRootCount:0};}}
 const eligible=frames.filter(frame=>{let frameUrl=String(frame?.url||'');if(frameUrl==='about:blank'||frameUrl==='about:srcdoc')frameUrl=current;const safe=safeNavigation(frameUrl);try{return Boolean(safe&&mainOrigin&&new URL(safe).origin===mainOrigin);}catch{return false;}});
 const captures=await Promise.all(eligible.map(async frame=>{try{const result=await frame.executeJavaScript(renderedDomScript,true);return result&&typeof result==='object'?result:null;}catch{return null;}}));
 const valid=captures.filter(value=>value&&typeof value.html==='string'),primaryIndex=Math.max(0,eligible.findIndex(frame=>frame===mainFrame)),primary=valid[primaryIndex]||valid[0]||{};
 return {title:String(primary.title||''),html:valid.map(value=>value.html).filter(Boolean).join('\\n'),frameDocumentCount:valid.length,anchorCount:valid.reduce((sum,value)=>sum+(Number(value.anchorCount)||0),0),bookLinkCount:valid.reduce((sum,value)=>sum+(Number(value.bookLinkCount)||0),0),shadowRootCount:valid.reduce((sum,value)=>sum+(Number(value.shadowRootCount)||0),0)};
}
function create({BrowserWindow,partition,userAgent}){
 const renderedSnapshots=new Map(),maxSnapshotBytes=8*1024*1024,snapshotTtlMs=2*60*1000;
 function cacheRenderedDom(requestUrl,result){
  const requested=safeNavigation(requestUrl),finalUrl=safeNavigation(result?.finalUrl||requestUrl),html=String(result?.html||'');
  if(result?.verified!==true||!requested||!finalUrl||!html.trim()||Buffer.byteLength(html,'utf8')>maxSnapshotBytes)return false;
  const snapshot={html,finalUrl,pageTitle:String(result?.title||'').slice(0,240),storedAt:Date.now()};
  renderedSnapshots.set(requested,snapshot);renderedSnapshots.set(finalUrl,snapshot);
  while(renderedSnapshots.size>8)renderedSnapshots.delete(renderedSnapshots.keys().next().value);
  return true;
 }
 function takeRenderedDom(value){
  const key=safeNavigation(value);if(!key)return null;
  const snapshot=renderedSnapshots.get(key);if(!snapshot)return null;
  for(const [url,item] of renderedSnapshots)if(item===snapshot)renderedSnapshots.delete(url);
  if(Date.now()-snapshot.storedAt>snapshotTtlMs)return null;
  return {...snapshot,readMode:'interactive-session-cache'};
 }
 function openSafeWindow(url,parent,{keepOpenOnVerification=false}={}){
  const window=new BrowserWindow({parent:parent&&!parent.isDestroyed()?parent:undefined,width:1040,height:760,minWidth:640,minHeight:460,show:true,title:'来源网页处理 · YueDen',backgroundColor:'#0c121b',webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
  if(userAgent)window.webContents.setUserAgent(userAgent);
  window.webContents.setWindowOpenHandler(({url:target})=>{const safe=safeNavigation(target);if(safe)openSafeWindow(safe,window);return {action:'deny'};});
  const guard=(event,target)=>{if(!safeNavigation(target))event.preventDefault();};
  window.webContents.on('will-navigate',guard);
  window.webContents.on('will-redirect',guard);
  let finalUrl=url,title='',loadCompleted=false,closeResult=null,inspectingClose=false,closeAttemptCount=0,holdAfterClose=false,parentClosing=false;
  const remember=target=>{const safe=safeNavigation(target);if(safe)finalUrl=safe;};
  window.webContents.on('did-navigate',(_event,target)=>remember(target));
  window.webContents.on('did-redirect-navigation',(_event,target,_inPlace,isMainFrame)=>{if(isMainFrame!==false)remember(target);});
  window.webContents.on('did-navigate-in-page',(_event,target,isMainFrame)=>{if(isMainFrame!==false)remember(target);});
  window.webContents.on('did-finish-load',()=>{loadCompleted=true;});
  window.webContents.on('page-title-updated',(_event,value)=>{title=String(value||'').slice(0,240);});
  const onClose=event=>{
   if(inspectingClose)return;
   event.preventDefault();inspectingClose=true;closeAttemptCount++;
   let timer;
   const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000);});
   const snapshot=Promise.resolve().then(()=>captureDomSnapshot(window.webContents,window.webContents.getURL())).catch(()=>null);
   Promise.race([snapshot,timeout]).then(value=>{
    clearTimeout(timer);
    if(value&&typeof value==='object'){title=String(value.title||title).slice(0,240);}
    try{remember(window.webContents.getURL());}catch{}
    const html=String(value?.html||''),Network=require('./metadata-network'),diagnostics=require('./metadata-book-diagnostics');
    const verificationHit=Network.isVerificationPage(html)||Network.isVerificationPage('<title>'+title+'</title>');
    const verificationReason=verificationHit?diagnostics.verificationReason(html,title):'';
    const result={finalUrl,title,html:html.length<=maxSnapshotBytes?html:'',loadCompleted,verificationHit,verificationReason,verified:loadCompleted&&!verificationHit,frameDocumentCount:Number(value?.frameDocumentCount)||0,anchorCount:Number(value?.anchorCount)||0,bookLinkCount:Number(value?.bookLinkCount)||0,shadowRootCount:Number(value?.shadowRootCount)||0};
    if(keepOpenOnVerification&&!parentClosing&&closeAttemptCount===1&&verificationHit){
     holdAfterClose=true;
     try{window.setTitle('网站验证仍在进行');}catch{}
     try{window.webContents.executeJavaScript(`(()=>{const id='yueden-verification-hint';let node=document.getElementById(id);if(!node){node=document.createElement('div');node.id=id;node.style.cssText='position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);max-width:90vw;padding:12px 18px;border-radius:10px;background:#17202b;color:#fff;font:14px/1.5 sans-serif;box-shadow:0 4px 24px #0008;pointer-events:none';document.documentElement.appendChild(node)}node.textContent='网站验证仍在进行。请完成页面操作并等页面跳转或显示搜索结果；再次点击关闭可退出。'})()`).catch(()=>{});}catch{}
     return;
    }
    closeResult=result;
   }).finally(()=>{if(holdAfterClose){holdAfterClose=false;inspectingClose=false;return;}window.removeListener('close',onClose);if(!window.isDestroyed())window.close();});
  };
  window.on('close',onClose);
  const closed=new Promise(resolve=>window.once('closed',()=>{try{remember(window.webContents.getURL());}catch{}resolve(closeResult||{finalUrl,title,loadCompleted:false,verificationHit:false,verificationReason:'',verified:false});}));
  window.loadURL(url).catch(()=>{});
  if(parent&&!parent.isDestroyed())parent.once('closed',()=>{parentClosing=true;if(!window.isDestroyed())window.close();});
  return {window,closed};
 }
 async function open(host,parent,startUrl,options={}){
  const url=startUrl?safeNavigation(startUrl):verificationUrl(host);if(!url||new URL(url).hostname.toLowerCase()!==hostName(host))throw Error('验证来源域名无效');
  if(parent?.isDestroyed())throw Error('主窗口已关闭');
  const opened=openSafeWindow(url,parent,options);
  return await opened.closed;
 }
 async function readRenderedDom(value,{timeoutMs=8000,signal,diagnosticContext}={}){
  const url=safeNavigation(value),started=Date.now(),context=diagnosticContext,log=(phase,fields={})=>{try{context?.log?.({phase,operation:context.operation||'search',requestUrl:value,...fields});}catch{}};
  if(!url){log('render.failed',{errorName:'UnsafeUrlError',errorMessage:'渲染目标地址无效'});return {html:'',finalUrl:''};}
  const cached=takeRenderedDom(url);if(cached){log('render.snapshot-cache-hit',{durationMs:Date.now()-started,htmlLength:cached.html.length,finalUrl:cached.finalUrl,readMode:cached.readMode});return cached;}
  const effectiveTimeout=Math.max(500,Math.min(20000,Number(timeoutMs)||8000));log('render.start',{requestUrl:url,timeoutMs:effectiveTimeout});
  const window=new BrowserWindow({width:900,height:700,show:false,title:'',webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false}});
  if(userAgent)window.webContents.setUserAgent(userAgent);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const guard=(event,target)=>{if(!safeNavigation(target))event.preventDefault();};
  window.webContents.on('will-navigate',guard);window.webContents.on('will-redirect',guard);
  const close=()=>{try{if(!window.isDestroyed())window.destroy();}catch{}};
  let timer,abort,navigationVersion=0,navigationCount=0,redirectCount=0,inPageNavigationCount=0,stopLoadingCount=0,stage='browser-load',loadCompleted=false;const navigationWaiters=new Set();
  const markNavigation=(count=true)=>{navigationVersion++;if(count)navigationCount++;stage='browser-navigation';for(const wake of navigationWaiters)wake();navigationWaiters.clear();};
  window.webContents.on('did-navigate',markNavigation);
  window.webContents.on('did-redirect-navigation',(_event,_target,_inPlace,isMainFrame)=>{if(isMainFrame!==false){redirectCount++;markNavigation();}});
  window.webContents.on('did-navigate-in-page',(_event,_target,isMainFrame)=>{if(isMainFrame!==false){inPageNavigationCount++;markNavigation();}});
  window.webContents.on('did-stop-loading',()=>{stopLoadingCount++;markNavigation(false);});
  window.webContents.on('did-finish-load',()=>{loadCompleted=true;});
  const safeCurrentUrl=()=>{try{return safeNavigation(window.webContents.getURL())||url;}catch{return url;}};
  const navigationSummary=()=>log('render.navigation-summary',{durationMs:Date.now()-started,navigationCount,redirectCount,inPageNavigationCount,stopLoadingCount,finalUrl:safeCurrentUrl()});
  try{
   const activeSignal=signal||undefined;
   const stopped=new Promise((_,reject)=>{
    timer=setTimeout(()=>{const layer=stage==='browser-load'?'browser-load':window.webContents.isLoading?.()?'browser-navigation':'browser-dom';const error=Object.assign(new Error('渲染页面读取超时'),{name:'TimeoutError',timeoutLayer:layer});reject(error);},effectiveTimeout);
    if(activeSignal){abort=()=>reject(Object.assign(new Error(activeSignal.reason?.message||'已取消'),{name:activeSignal.reason?.name||'AbortError',timeoutLayer:'abort'}));if(activeSignal.aborted)abort();else activeSignal.addEventListener('abort',abort,{once:true});}
   });
   await Promise.race([window.loadURL(url),stopped]);stage='browser-dom';log('render.load-complete',{durationMs:Date.now()-started,loadCompleted,finalUrl:safeCurrentUrl()});
   // Bound DOM settling separately from navigation: dynamic pages may keep changing
   // clocks, counters, or ad nodes forever, but the latest DOM is still parseable.
   const domWaitBudgetMs=Math.max(500,Math.min(6000,effectiveTimeout-(Date.now()-started)-1200));
   log('render.dom-wait-start',{domWaitBudgetMs,minimumWaitMs:4000,quietWaitMs:900});
   const script=`new Promise(resolve=>{const root=document.documentElement;if(!root){resolve({html:'',returnReason:'missing-document'});return}let done=false,interval,mutationTimer;const started=Date.now(),minimumWait=4000,quietWait=900,maximumWait=${domWaitBudgetMs};const signature=()=>{const body=document.body;let text='';try{text=String(body?.innerText||body?.textContent||'').replace(/\\s+/g,' ').slice(0,6000)}catch{}let links='',forms='';try{links=Array.from(document.querySelectorAll('a[href]')).slice(0,500).map(a=>[a.getAttribute('href'),String(a.className||'').slice(0,80),String(a.innerText||a.textContent||'').replace(/\\s+/g,' ').slice(0,100)].join('|')).join('\\n')}catch{}try{forms=Array.from(document.forms||[]).map(f=>[f.method||'',f.getAttribute('action')||'',Array.from(f.querySelectorAll('input[name]')).map(i=>[i.name,i.type||'',i.checked?'1':'0'].join(':')).join(',')].join('|')).join('\\n')}catch{}return [document.title||'',document.readyState||'',text,links,forms].join('\\u0000')};let previous=signature(),stableSince=Date.now();const finish=reason=>{if(done)return;done=true;observer.disconnect();clearInterval(interval);clearTimeout(mutationTimer);resolve({html:root.outerHTML||'',returnReason:reason})};const check=()=>{if(done)return;const next=signature();if(next!==previous){previous=next;stableSince=Date.now()}const now=Date.now();if(now-started>=maximumWait){finish('maximum-wait');return}if(now-started>=minimumWait&&now-stableSince>=quietWait)finish('stable')};const observer=new MutationObserver(()=>{clearTimeout(mutationTimer);mutationTimer=setTimeout(check,120)});observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});interval=setInterval(check,250);check()})`;
   while(true){
    const version=navigationVersion;
    let wake;const navigationChanged=new Promise(resolve=>{wake=resolve;navigationWaiters.add(wake);});
    let outcome;
    stage='browser-dom';try{outcome=await Promise.race([window.webContents.executeJavaScript(script,true).then(result=>({result})),stopped,navigationChanged.then(()=>({navigation:true}))]);}
    catch(error){navigationWaiters.delete(wake);if(navigationVersion!==version)continue;throw error;}
    navigationWaiters.delete(wake);
    if(outcome?.navigation||navigationVersion!==version){stage='browser-navigation';continue;}
    const returned=outcome?.result,returnReason=typeof returned==='string'?'load-complete':returned?.returnReason||'load-complete';
    let finalUrl=url;try{finalUrl=safeNavigation(window.webContents.getURL())||url;}catch{}
    if(navigationVersion!==version)continue;
    const frameApi=window.webContents.mainFrame;
    const captured=frameApi&&(Array.isArray(frameApi.framesInSubtree)||typeof frameApi.executeJavaScript==='function')?await Promise.race([captureDomSnapshot(window.webContents,finalUrl),stopped]):null;
    if(navigationVersion!==version)continue;
    const html=captured?.html|| (typeof returned==='string'?returned:returned?.html);
    const body=String(html||'').slice(0,8*1024*1024),pageTitle=require('./metadata-book-diagnostics').safeTitle(window.webContents.getTitle?.()||'',context?.query),verification=require('./metadata-network').isVerificationPage(body),verificationReason=verification?require('./metadata-book-diagnostics').verificationReason(body,pageTitle):'';
    navigationSummary();log('render.dom-return',{returnReason,durationMs:Date.now()-started,htmlLength:body.length,finalUrl,pageTitle,verificationHit:verification,verificationReason,frameDocumentCount:Number(captured?.frameDocumentCount)||0,anchorCount:Number(captured?.anchorCount)||0,bookLinkCount:Number(captured?.bookLinkCount)||0,shadowRootCount:Number(captured?.shadowRootCount)||0});
    return {html:body,finalUrl,pageTitle,returnReason,verificationHit:verification,verificationReason,frameDocumentCount:Number(captured?.frameDocumentCount)||0,anchorCount:Number(captured?.anchorCount)||0,bookLinkCount:Number(captured?.bookLinkCount)||0,shadowRootCount:Number(captured?.shadowRootCount)||0};
   }
  }catch(error){
   const timeoutLayer=error?.timeoutLayer||(error?.name==='TimeoutError'?stage:error?.name==='AbortError'?'abort':'');
   if(timeoutLayer==='browser-dom'&&loadCompleted&&!window.isDestroyed()){
    const partial=await Promise.race([captureDomSnapshot(window.webContents,safeCurrentUrl()).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]);
    if(partial?.html){
     const finalUrl=safeCurrentUrl(),body=String(partial.html).slice(0,8*1024*1024),pageTitle=require('./metadata-book-diagnostics').safeTitle(window.webContents.getTitle?.()||'',context?.query),verification=require('./metadata-network').isVerificationPage(body),verificationReason=verification?require('./metadata-book-diagnostics').verificationReason(body,pageTitle):'';
     navigationSummary();log('render.partial-snapshot',{timeoutLayer,returnReason:'dom-timeout-snapshot',durationMs:Date.now()-started,htmlLength:body.length,finalUrl,pageTitle,verificationHit:verification,verificationReason,frameDocumentCount:Number(partial.frameDocumentCount)||0,anchorCount:Number(partial.anchorCount)||0,bookLinkCount:Number(partial.bookLinkCount)||0,shadowRootCount:Number(partial.shadowRootCount)||0});
     return {html:body,finalUrl,pageTitle,returnReason:'dom-timeout-snapshot',timeoutLayer,partialSnapshot:true,verificationHit:verification,verificationReason,frameDocumentCount:Number(partial.frameDocumentCount)||0,anchorCount:Number(partial.anchorCount)||0,bookLinkCount:Number(partial.bookLinkCount)||0,shadowRootCount:Number(partial.shadowRootCount)||0};
    }
   }
   navigationSummary();
   if(timeoutLayer)log('render.timeout',{timeoutLayer,durationMs:Date.now()-started,timeoutMs:effectiveTimeout,errorName:error?.name||'TimeoutError',errorMessage:error?.message||''});
   else log('render.failed',{timeoutLayer:'',durationMs:Date.now()-started,errorName:error?.name||'Error',errorMessage:error?.message||''});
   throw error;
  }finally{
   clearTimeout(timer);if(signal&&abort)signal.removeEventListener('abort',abort);close();
  }
 }
 return {open,readRenderedDom,cacheRenderedDom};
}
module.exports={create,hostName,verificationUrl,safeNavigation,captureDomSnapshot};
