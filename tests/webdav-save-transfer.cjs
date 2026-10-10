'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Client = require('../app/webdav-client');
const SaveTransfer = require('../app/webdav-save-transfer');
const fixture = require('./webdav-fixture.cjs');
const verifyObjectBytes = require('../app/save-snapshots').verifyObjectBytes;

function infoFor(bytes) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { object: `objects/${sha256.slice(0, 2)}/${sha256}.bin`, sha256, size: bytes.length, storedSize: bytes.length, encoding: 'raw' };
}

test('snapshot data objects are transferred before its manifest, and missing objects block the manifest', async () => {
  const files = [{ relative: 'snapshot/manifest.json', immutable: false }, { relative: 'objects/hash.bin', immutable: true }];
  const order = [];
  await SaveTransfer.uploadSnapshotFiles(files, async file => { order.push(file.relative); });
  assert.deepEqual(order, ['objects/hash.bin', 'snapshot/manifest.json']);

  const failed = [];
  await assert.rejects(() => SaveTransfer.uploadSnapshotFiles(files, async file => {
    failed.push(file.relative);
    if (file.immutable) throw Error('remote object missing');
  }), /remote object missing/);
  assert.deepEqual(failed, ['objects/hash.bin']);
});

test('immutable save objects upload with bounded concurrency and the manifest waits for every object', async () => {
  const files=Array.from({length:9},(_,index)=>({relative:'objects/'+index+'.bin',immutable:true,info:{storedSize:128}}));
  files.push({relative:'snapshot/manifest.json',immutable:false,content:Buffer.from('{}')});
  let inFlight=0,maxInFlight=0,completed=0,manifestStarted=false;
  const phases=[];
  await SaveTransfer.uploadSnapshotFiles(files,async file=>{
    if(!file.immutable){manifestStarted=true;assert.equal(completed,9);return;}
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    await new Promise(resolve=>setTimeout(resolve,4));
    inFlight--;completed++;
  },{concurrency:3,onPhase:phase=>phases.push(phase)});
  assert.equal(manifestStarted,true);
  assert.ok(maxInFlight>1&&maxInFlight<=3);
  assert.deepEqual(phases.map(row=>[row.phase,row.state]),[['objects','started'],['objects','completed'],['manifest','started'],['manifest','completed']]);
  assert.equal(phases[0].files,9);
  assert.equal(phases[0].bytes,9*128);
});

test('a catalog reference does not substitute for checking that the remote object exists', async () => {
  const f = await fixture();
  try {
    const client = Client.create();
    await client.ensurePath(f.settings);
    const bytes = Buffer.from('unchanged save object'), info = infoFor(bytes), before = f.requests.length;
    let localReads = 0;
    const result = await SaveTransfer.uploadImmutableObject({
      target: 'saves/' + info.object, info,
      catalogProof: { ...info },
      readLocalBytes: async () => { localReads++; return bytes; },
      verifyObjectBytes, request: (method, target, body, conditions) => client.request(f.settings, method, target, body, '', conditions), ensureDirectory: () => client.ensureDirectories(f.settings, 'saves/objects/' + info.sha256.slice(0, 2))
    });
    assert.equal(result.uploaded, true);
    assert.equal(result.reason, 'put-verified');
    assert.equal(localReads, 1);
    assert.deepEqual(f.requests.slice(before).filter(row => row.path.endsWith(info.sha256 + '.bin')).map(row => row.method), ['GET', 'PUT', 'GET']);
  } finally { await f.close(); }
});

test('a new immutable object is read back and content-verified before manifest upload', async () => {
  const f = await fixture();
  try {
    const client = Client.create();
    await client.ensurePath(f.settings);
    const bytes = Buffer.from('new compressed save object'), info = infoFor(bytes), target = 'saves/' + info.object;
    const result = await SaveTransfer.uploadImmutableObject({
      target, info, readLocalBytes: async () => bytes, verifyObjectBytes,
      request: (method, target, body, conditions) => client.request(f.settings, method, target, body, '', conditions),
      ensureDirectory: () => client.ensureDirectories(f.settings, 'saves/objects/' + info.sha256.slice(0, 2))
    });
    assert.equal(result.uploaded, true);
    assert.equal(result.reason, 'put-verified');
    assert.deepEqual(Buffer.from(f.files.get(Client.endpoint(f.settings, target).pathname).body), bytes);
    assert.deepEqual(f.requests.filter(row => row.path.endsWith(info.sha256 + '.bin')).map(row => row.method), ['GET', 'PUT', 'GET']);
  } finally { await f.close(); }
});

test('save object uploads use the visible default directory when the stored path is empty',async()=>{
  const f=await fixture();
  try{
    const client=Client.create(),settings={...f.settings,webdavRemotePath:''},bytes=Buffer.from('snapshot under configured folder'),info=infoFor(bytes);
    await client.ensurePath(settings);
    const result=await SaveTransfer.uploadImmutableObject({target:'saves/'+info.object,info,readLocalBytes:async()=>bytes,verifyObjectBytes,request:(method,target,body,conditions)=>client.request(settings,method,target,body,'',conditions),ensureDirectory:()=>client.ensureDirectories(settings,'saves/objects/'+info.sha256.slice(0,2))});
    const path=Client.endpoint({...settings,webdavRemotePath:'YueDen'},'saves/'+info.object).pathname;
    assert.equal(result.uploaded,true);
    assert.equal(f.files.has(path),true);
    assert.equal(f.files.has('/dav/saves/'+info.object),false);
  }finally{await f.close();}
});

test('a save-data read-back 404 prevents its manifest from being uploaded', async () => {
  const bytes=Buffer.from('not retained by the remote server'),info=infoFor(bytes),calls=[];let manifestUploaded=false;
  const request=async(method,target,body)=>{calls.push([method,target]);if(method==='GET')return new Response(null,{status:404});if(method==='PUT')return new Response(null,{status:204});throw Error('unexpected '+method);};
  const files=[{relative:info.object,info,immutable:true},{relative:'snapshot-a/manifest.json',immutable:false}];
  await assert.rejects(()=>SaveTransfer.uploadSnapshotFiles(files,async file=>{
    if(file.immutable)return SaveTransfer.uploadImmutableObject({target:'saves/'+file.relative,info:file.info,readLocalBytes:async()=>bytes,verifyObjectBytes,request,ensureDirectory:async()=>{}});
    manifestUploaded=true;
  }),/回读校验失败/);
  assert.equal(manifestUploaded,false);
  assert.deepEqual(calls.map(([method])=>method),['GET','PUT','GET']);
});

test('a lost save-object PUT response is confirmed by one exact remote read', async () => {
  const bytes = Buffer.from('acknowledged after interruption'), info = infoFor(bytes), calls = [];
  let remote = null;
  const request = async (method, target, body) => {
    calls.push(method);
    if (method === 'GET') return remote == null ? new Response(null, { status: 404 }) : new Response(remote, { status: 200, headers: { etag: '"object-1"' } });
    if (method === 'PUT') { remote = Buffer.from(body); throw Error('connection closed after server stored the object'); }
    throw Error('Unexpected ' + method);
  };
  const result = await SaveTransfer.uploadImmutableObject({
    target: 'saves/' + info.object, info, readLocalBytes: async () => bytes, verifyObjectBytes,
    request, ensureDirectory: async () => {}
  });
  assert.equal(result.uploaded, true);
  assert.equal(result.reason, 'confirmed-after-interruption');
  assert.deepEqual(calls, ['GET', 'PUT', 'GET']);
});

test('a transient read error after a committed PUT is retried before reporting failure', async () => {
  const bytes=Buffer.from('stored while the connection closed'),info=infoFor(bytes),calls=[];let remote=null,failedConfirmation=false;
  const request=async(method,target,body)=>{
    calls.push(method);
    if(method==='GET'&&remote==null)return new Response(null,{status:404});
    if(method==='GET'&&!failedConfirmation){failedConfirmation=true;throw Error('temporary read-back network failure');}
    if(method==='GET')return new Response(remote,{status:200,headers:{etag:'"visible-after-retry"'}});
    if(method==='PUT'){remote=Buffer.from(body);throw Error('server stored bytes before the response was lost');}
    throw Error('unexpected '+method);
  };
  const result=await SaveTransfer.uploadImmutableObject({target:'saves/'+info.object,info,readLocalBytes:async()=>bytes,verifyObjectBytes,request,ensureDirectory:async()=>{}});
  assert.equal(result.uploaded,true);
  assert.equal(result.reason,'confirmed-after-interruption');
  assert.deepEqual(calls,['GET','PUT','GET','GET']);
});

test('a concurrent object creation returning 412 succeeds only after exact remote bytes verify', async () => {
  const bytes=Buffer.from('same immutable save object'),info=infoFor(bytes),calls=[];
  const request=async(method,target,body,conditions)=>{
    calls.push({method,conditions});
    if(method==='GET'&&calls.length===1)return new Response(Buffer.from('stale object'),{status:200,headers:{etag:'"old"'}});
    if(method==='PUT')return new Response(null,{status:412});
    if(method==='GET')return new Response(bytes,{status:200,headers:{etag:'"created-by-other-writer"'}});
    throw Error('unexpected '+method);
  };
  const result=await SaveTransfer.uploadImmutableObject({target:'saves/'+info.object,info,readLocalBytes:async()=>bytes,verifyObjectBytes,request,ensureDirectory:async()=>{}});
  assert.equal(result.uploaded,false);
  assert.equal(result.reason,'already-present-after-412');
  assert.deepEqual(calls.map(row=>row.method),['GET','PUT','GET']);
});
