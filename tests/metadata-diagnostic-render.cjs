const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const Verification=require('../app/metadata-verification-window');

test('render diagnostics distinguish load, navigation, DOM and external abort timeouts',async()=>{
  let mode='load';
  class MockWindow extends EventEmitter{
    constructor(){super();this.destroyed=false;this.webContents=new EventEmitter();this.webContents.setUserAgent=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>this.url||'';this.webContents.getTitle=()=>'';this.webContents.isLoading=()=>mode==='navigation';this.webContents.executeJavaScript=()=>new Promise(()=>{});}
    isDestroyed(){return this.destroyed;}
    loadURL(url){this.url=url;return mode==='load'?new Promise(()=>{}):Promise.resolve();}
    destroy(){this.destroyed=true;}
  }
  const reader=Verification.create({BrowserWindow:MockWindow,partition:'persist:yueden-metadata'}),events=[];
  const context={runId:'render-run',sourceId:'zlibrary',mediaType:'book',operation:'search',log:event=>events.push(event)};
  for(const [current,expected]of [['load','browser-load'],['navigation','browser-navigation'],['dom','browser-dom']]){
    mode=current;await assert.rejects(reader.readRenderedDom('https://zlib.example/search?q=private',{timeoutMs:500,diagnosticContext:context}),/超时/);
    assert.equal(events.filter(event=>event.phase==='render.timeout').at(-1).timeoutLayer,expected);
  }
  mode='dom';const controller=new AbortController(),pending=reader.readRenderedDom('https://zlib.example/search?q=private',{timeoutMs:3000,signal:controller.signal,diagnosticContext:context});setTimeout(()=>controller.abort(new Error('任务取消')),30);
  await assert.rejects(pending,/任务取消/);assert.equal(events.filter(event=>event.phase==='render.timeout').at(-1).timeoutLayer,'abort');
  assert.ok(events.every(event=>!event.runId||event.runId==='render-run'));
  console.log('render timeout layers: browser-load, browser-navigation, browser-dom, abort');
});
