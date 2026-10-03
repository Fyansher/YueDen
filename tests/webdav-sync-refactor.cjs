'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const State = require('../app/webdav-state');
const Sync = require('../app/webdav-library-sync');
const Endpoint = require('../app/webdav-endpoint-key');
const Catalog = require('../app/webdav-save-catalog');
const CoverStore = require('../app/cover-store');
const CoverSync = require('../app/webdav-cover-sync');
const WriteRecovery = require('../app/webdav-write-recovery');
const WebdavClient = require('../app/webdav-client');
const DiagnosticLog = require('../app/webdav-diagnostic-log');

function library(items = []) {
  return { schemaVersion: 4, items, categories: [], deletedItems: [], deletedSaveSnapshots: [], playlists: [], referenceRedirects: [], organizationHistory: [], settings: {}, audioConnections: [] };
}

function fakeImages(bytes) {
  return { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 200, height: 100 }), resize() { return this; }, toJPEG: () => bytes }) };
}

test('terminated sync-state GET retries through the separately configured fresh fetcher', async () => {
  const local=library([{id:'game',name:'Game'}]),remote=State.toRemoteState(local),bytes=Buffer.from(JSON.stringify(remote));
  let pooledFetches=0,freshFetches=0;
  const client=WebdavClient.create({
    fetch:async()=>{
      pooledFetches++;
      const body=new ReadableStream({start(controller){controller.enqueue(Buffer.from('{"partial":'));const cause=Object.assign(Error('other side closed'),{code:'UND_ERR_SOCKET'});controller.error(cause);}});
      return new Response(body,{status:200,headers:{etag:'"stable"','content-length':String(bytes.length)}});
    },
    freshFetch:async(_url,init)=>{
      freshFetches++;
      assert.equal(init.method,'GET');
      return new Response(bytes,{status:200,headers:{etag:'"stable"','content-length':String(bytes.length)}});
    }
  });
  const settings={webdavUrl:'https://dav.example/dav/',webdavRemotePath:'YueDen'};
  const diagnostics=[];
  const get=(headers,signal,requestOptions={})=>client.request(settings,'GET','sync-state.json',null,'',headers,signal,false,false,5000,5000,requestOptions);
  const result=await Sync.plan({local,direction:'bidirectional',get,backup:async()=>{},diagnostic:row=>diagnostics.push(row)});
  assert.equal(pooledFetches,1,'only the initial read uses the ordinary fetcher');
  assert.equal(freshFetches,1,'the retry must use the fresh-connection fetcher');
  assert.equal(result.comparison.syncEqual,true,'the successfully reread state continues through comparison');
  assert.ok(diagnostics.some(row=>row.event==='webdav.sync.REMOTE_BODY_READ_RETRY'&&row.freshConnection===true));
});

test('sync diagnostics preserve failure phase, error cause chain, and explicit fast-path meanings', () => {
  const root=fs.mkdtempSync(path.join(__dirname,'webdav-diagnostic-'));
  try{
    const cause=Object.assign(Error('other side closed'),{code:'UND_ERR_SOCKET'}),error=Error('read failed',{cause});
    DiagnosticLog.create(()=>root).write({event:'webdav.sync.failed',operation:'sync',phase:'read-sync-state',error});
    const row=JSON.parse(fs.readFileSync(path.join(root,'logs','webdav-diagnostics.jsonl'),'utf8').trim());
    assert.equal(row.phase,'read-sync-state');
    assert.equal(row.errorName,'Error');
    assert.equal(row.errorMessage,'read failed');
    assert.equal(row.errorCause,'UND_ERR_SOCKET');
    assert.equal(row.errorCauseChain.length,2);
  const fastPath=DiagnosticLog.fastPathRecord({libraryUnchanged:true,savesUnchanged:false,archivesUnchanged:false});
    assert.equal(fastPath.libraryUnchanged,true);
    assert.equal(fastPath.savesUnchanged,false);
    assert.equal(fastPath.archivesUnchanged,false);
    assert.equal(fastPath.overallUnchanged,false);
    assert.equal(Object.hasOwn(fastPath,'unchanged'),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('shared content revision covers every resource field while excluding local paths and merge timestamps', () => {
  const base = library([{ id: 'resource', name: 'Title', rating: 2, status: 'playing', customPluginValue: { a: 1 } }]);
  const local = structuredClone(base);
  local.items[0].localPath = 'D:/Games/one';
  local.items[0].deviceLocations = { deviceA: { localPath: 'D:/Games/one' } };
  local.items[0].updatedAt = '2026-10-01T00:00:00Z';
  assert.equal(State.contentRevision(base), State.contentRevision(local));
  for (const [field, value] of [['rating', 5], ['status', 'complete'], ['customPluginValue', { a: 2 }]]) {
    const edited = structuredClone(base); edited.items[0][field] = value;
    assert.notEqual(State.contentRevision(base), State.contentRevision(edited), field);
  }
  const settings = structuredClone(base); settings.settings = { appearance: { theme: 'night' } };
  assert.equal(State.contentRevision(base), State.contentRevision(settings));
  assert.notEqual(State.syncRevision(base), State.syncRevision(settings));
});

test('lineage is endpoint-scoped and never reused for another WebDAV identity', () => {
  const endpointA = Endpoint.key({ webdavUrl: 'https://dav.example/dav/', webdavRemotePath: 'YueDen/Library', webdavUsername: 'one', webdavPassword: 'secret-a' });
  const endpointASame = Endpoint.key({ webdavUrl: 'https://DAV.example/dav', webdavRemotePath: '/YueDen/Library/', webdavUsername: 'one', webdavPassword: 'rotated' });
  const endpointB = Endpoint.key({ webdavUrl: 'https://dav.example/dav/', webdavRemotePath: 'YueDen/Other', webdavUsername: 'one', webdavPassword: 'secret-a' });
  assert.equal(endpointA, endpointASame);
  assert.notEqual(endpointA, endpointB);
  const baseState = State.toBaseState(library([{ id: 'game', name: 'Game' }]));
  const record = { schemaVersion: 2, endpointKey: endpointA, baseRevision: State.syncRevision(baseState), baseState };
  const local = { ...library([{ id: 'game', name: 'Local edit' }]), lineage: record };
  const remote = { ...library([{ id: 'game', name: 'Game' }]), lineage: record };
  assert.ok(Sync.commonBase(local, remote, endpointA));
  assert.equal(Sync.commonBase(local, remote, endpointB), null);
});

test('save catalog has deterministic content, detects edits and only skips against its cached remote validator', () => {
  const a = Catalog.create([{ id: 'two', manifestHash: 'b' }, { id: 'one', manifestHash: 'a' }], []);
  const b = Catalog.create([{ id: 'one', manifestHash: 'a' }, { id: 'two', manifestHash: 'b' }], []);
  assert.equal(a.revision, b.revision);
  assert.equal(Catalog.parse(JSON.parse(JSON.stringify(a))).revision, a.revision);
  const edited = Catalog.create([{ id: 'one', manifestHash: 'new' }, { id: 'two', manifestHash: 'b' }], []);
  assert.notEqual(edited.revision, a.revision);
  assert.equal(Catalog.canSkip({ localRevision: a.revision, cached: { localRevision: a.revision, remoteRevision: a.revision, etag: '"r1"', remoteLength: 42 }, remote: { exists: true, etag: '"r1"', contentLength: 42 } }), true);
  assert.equal(Catalog.canSkip({ localRevision: edited.revision, cached: { localRevision: edited.revision, remoteRevision: a.revision, etag: '"r1"', remoteLength: 42 }, remote: { exists: true, etag: '"r1"', contentLength: 42 } }), false, 'a changed local catalog must not reuse an old remote validator');
  assert.equal(Catalog.canSkipByContent(a.revision, a), true);
  assert.equal(Catalog.canSkipByContent(edited.revision, a), false);
  assert.equal(Catalog.canSkip({ localRevision: edited.revision, cached: { localRevision: a.revision, etag: '"r1"', remoteLength: 42 }, remote: { exists: true, etag: '"r1"', contentLength: 42 } }), false);
  assert.equal(Catalog.canSkip({ localRevision: a.revision, cached: { localRevision: a.revision, etag: '"r1"', remoteLength: 42 }, remote: { exists: true, etag: '"r2"', contentLength: 42 } }), false);
  assert.equal(Catalog.canSkip({ localRevision: a.revision, cached: { localRevision: a.revision, etag: '"r1"', remoteLength: 42 }, remote: { exists: true, etag: '"r1"', contentLength: null } }), false);
  const digest='a'.repeat(64),withObjects=Catalog.create([{id:'items/Game--1234567890/2026-10-01_10-00-00',manifestHash:'manifest',objects:[{object:`objects/aa/${digest}.bin`,sha256:digest,size:10,storedSize:10,encoding:'raw'}]}]);
  assert.equal(Catalog.parse(JSON.parse(JSON.stringify(withObjects))).entries[0].objects.length,1);
  assert.throws(()=>Catalog.parse({...a,schemaVersion:1}),/云端存档索引格式无效/);
});

test('new sync state stores cover references while lineage contains only content hashes', () => {
  const bytes = Buffer.from('test jpeg bytes'), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const base = library([{ id: 'game', coverLandscape: `data:image/jpeg;base64,${bytes.toString('base64')}` }]);
  const root = path.join(__dirname, '..', 'test-artifacts', `cover-state-${crypto.randomBytes(5).toString('hex')}`), store = new CoverStore(() => root, fakeImages(bytes));
  const compact=store.compactForSync(base),baseState=State.toBaseState(compact),revision=State.syncRevision(baseState),endpointKey='c'.repeat(64);
  const remote = State.toRemoteState({ ...compact, lineage: { schemaVersion: 2, endpointKey, baseRevision: revision, baseState } });
  assert.equal(remote.syncVersion, 4);
  assert.equal(remote.lineage.baseState.items[0].coverLandscape, `sha256:${hash}`);
  assert.equal(JSON.stringify(remote).includes(bytes.toString('base64')), false);
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(State.syncRevision(remote.lineage.baseState), remote.lineage.baseRevision);
});

test('cover objects upload with content-addressed create conditions and download only after SHA-256 verification', async () => {
  const bytes = Buffer.from('test jpeg bytes'), hash = crypto.createHash('sha256').update(bytes).digest('hex'), reference = `um-cover://image/${hash}.jpg`;
  const root = path.join(__dirname, '..', 'test-artifacts', `cover-sync-${crypto.randomBytes(5).toString('hex')}`);
  const localStore = new CoverStore(() => path.join(root, 'local'), fakeImages(bytes));
  const remoteStore = new CoverStore(() => path.join(root, 'remote'), fakeImages(bytes));
  const remote = new Map();
  try {
    localStore.storeObject(reference, bytes);
    const request = async (_settings, method, relative, body, _type, conditions = {}) => {
      if (method === 'GET') return remote.has(relative) ? new Response(remote.get(relative), { status: 200 }) : new Response(null, { status: 404 });
      if (method === 'PUT') { assert.deepEqual(conditions, { 'If-None-Match': '*' }); remote.set(relative, Buffer.from(body)); return new Response(null, { status: 201 }); }
      throw Error(`Unexpected ${method}`);
    };
    const state = library([{ id: 'movie', coverLandscape: reference }]);
    const uploaded = await CoverSync.ensureRemoteObjects({ settings: {}, state, store: localStore, request, ensureDirectories: async () => {} });
    assert.equal(uploaded.uploaded, 1);
    assert.deepEqual(remote.get(`covers/${hash}.jpg`), bytes);
    const downloaded = await CoverSync.ensureLocalObjects({ settings: {}, state, store: remoteStore, request });
    assert.equal(downloaded.downloaded, 1);
    assert.deepEqual(remoteStore.readObject(reference), bytes);
    remote.set(`covers/${hash}.jpg`, Buffer.from('wrong bytes'));
    await assert.rejects(CoverSync.ensureLocalObjects({ settings: {}, state, store: new CoverStore(() => path.join(root, 'bad'), fakeImages(bytes)), request }), /封面对象校验失败/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an existing content-addressed cover is verified and skipped after conditional create reports it exists', async () => {
  const bytes=Buffer.from('verified cover data'),hash=crypto.createHash('sha256').update(bytes).digest('hex'),reference=`um-cover://image/${hash}.jpg`,root=path.join(__dirname,'..','test-artifacts',`cover-repair-${crypto.randomBytes(5).toString('hex')}`),store=new CoverStore(()=>root,fakeImages(bytes)),remote=new Map([[`covers/${hash}.jpg`,bytes]]);
  try{
    store.storeObject(reference,bytes);
    let gets=0,puts=0;
    const request=async(_settings,method,relative,body,_type,conditions={})=>{
      if(method==='GET'){gets++;return remote.has(relative)?new Response(remote.get(relative),{status:200,headers:{etag:'"repair-me"'}}):new Response(null,{status:404});}
      if(method==='PUT'){puts++;assert.deepEqual(conditions,{'If-None-Match':'*'});return new Response(null,{status:412});}
      throw Error(`Unexpected ${method}`);
    };
    const result=await CoverSync.ensureRemoteObjects({settings:{},state:library([{id:'movie',coverLandscape:reference}]),store,request,ensureDirectories:async()=>{}});
    assert.equal(result.uploaded,0);
    assert.equal(result.skipped,1);
    assert.equal(puts,1);
    assert.equal(gets,1,'a 412 gets one content verification; unchanged covers do not reach this branch');
    assert.deepEqual(remote.get(`covers/${hash}.jpg`),bytes,'an existing object is never overwritten');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a mismatched object at a content-addressed cover path is rejected instead of silently accepted', async () => {
  const bytes=Buffer.from('expected cover'),hash=crypto.createHash('sha256').update(bytes).digest('hex'),reference=`um-cover://image/${hash}.jpg`,wrong=Buffer.from('corrupt object'),root=path.join(__dirname,'..','test-artifacts',`cover-mismatch-${crypto.randomBytes(5).toString('hex')}`),store=new CoverStore(()=>root,fakeImages(bytes)),remote=new Map([[`covers/${hash}.jpg`,wrong]]);
  try{
    store.storeObject(reference,bytes);
    const request=async(_settings,method,relative,_body,_type,conditions={})=>{
      if(method==='PUT'){assert.deepEqual(conditions,{'If-None-Match':'*'});return new Response(null,{status:412});}
      if(method==='GET')return new Response(remote.get(relative),{status:200});
      throw Error(`Unexpected ${method}`);
    };
    await assert.rejects(CoverSync.ensureRemoteObjects({settings:{},state:library([{id:'movie',coverLandscape:reference}]),store,request,ensureDirectories:async()=>{}}),/云端对象与内容地址不符/);
    assert.deepEqual(remote.get(`covers/${hash}.jpg`),wrong,'an unverified remote object is preserved for manual recovery');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unchanged cover hashes make zero requests and one changed resource uploads only its new cover', async () => {
  const bytesByReference=new Map(),makeCover=index=>{
    const bytes=Buffer.from(`cover-${index}`),hash=crypto.createHash('sha256').update(bytes).digest('hex'),reference=`um-cover://image/${hash}.jpg`;
    bytesByReference.set(reference,bytes);return reference;
  };
  const previous=library(Array.from({length:80},(_,index)=>({id:`item-${index}`,coverLandscape:makeCover(index)})));
  const store={
    references:state=>new Map((state.items||[]).flatMap(item=>['cover','coverPortrait','coverLandscape'].map(key=>item[key]).filter(value=>typeof value==='string').map(reference=>[reference.slice('um-cover://image/'.length,-4),reference]))),
    readObject:reference=>bytesByReference.get(reference),
    storeObject:()=>{}
  };
  let requests=0,directoryCalls=0;
  const request=async(_settings,method,relative,body,_type,conditions={})=>{
    requests++;
    assert.equal(method,'PUT');
    assert.deepEqual(conditions,{'If-None-Match':'*'});
    return new Response(null,{status:201});
  };
  const metadataOnly=structuredClone(previous);metadataOnly.items[12].rating=5;
  const unchanged=await CoverSync.ensureRemoteObjects({settings:{},state:metadataOnly,previousState:previous,store,request,ensureDirectories:async()=>{directoryCalls++;}});
  assert.equal(requests,0,'unchanged covers are not PROPFINDed, fetched, or uploaded');
  assert.equal(directoryCalls,0);
  assert.equal(unchanged.skipped,80);

  const changed=structuredClone(metadataOnly),newReference=makeCover('replacement');changed.items[12].coverLandscape=newReference;
  const updated=await CoverSync.ensureRemoteObjects({settings:{},state:changed,previousState:previous,store,request,ensureDirectories:async()=>{directoryCalls++;}});
  assert.equal(requests,1,'only the newly referenced content hash is sent');
  assert.equal(directoryCalls,1);
  assert.equal(updated.uploaded,1);
  assert.equal(updated.skipped,79);
});

test('bidirectional sync asks for a local, cloud, or merge choice before applying different states', async () => {
  const local=library([{id:'game',name:'Local title'}]),remote=State.toRemoteState(library([{id:'game',name:'Cloud title'}]));
  const get=async()=>new Response(JSON.stringify(remote),{status:200,headers:{etag:'"remote-v1"'}});
  const initial=await Sync.plan({local,direction:'bidirectional',get,backup:async()=>{}});
  assert.equal(initial.needsDecision,true);
  assert.equal(initial.preview.comparison.syncEqual,false);
  const localChoice=await Sync.plan({local,direction:'bidirectional',get,backup:async()=>{},resolution:'local',expectedVersion:initial.preview.version});
  assert.equal(localChoice.needsDecision,undefined);
  assert.equal(localChoice.actualDirection,'upload');
  assert.equal(localChoice.state.items[0].name,'Local title');
  const mergeChoice=await Sync.plan({local,direction:'bidirectional',get,backup:async()=>{},resolution:'merge',expectedVersion:initial.preview.version});
  assert.equal(mergeChoice.needsDecision,true,'unresolvable merge conflicts are offered for per-item choices after merge is selected');
  assert.ok(mergeChoice.preview.comparison.unknownItems.length>0);
});

test('412 causes a fresh remote plan before retrying a conditional state write', async () => {
  const before = library([{ id: 'game', name: 'Base' }]);
  const changedRemote = library([{ id: 'game', name: 'Base', rating: 4 }]);
  const desired = library([{ id: 'game', name: 'Local title', rating: 4 }]);
  const initial = { state: State.toRemoteState(desired), headers: { 'If-Match': '"old"' }, remoteSnapshot: { state: before, etag: '"old"' }, actualDirection: 'bidirectional' };
  let puts = 0, replans = 0;
  const result = await WriteRecovery.writeSyncState({
    initial, plan: async options => {
      replans++;
      assert.equal(options.forceFreshRemote, true);
      assert.equal(options.cachedRemote, null);
      assert.equal(Object.hasOwn(options, 'expectedVersion'), false);
      return { ...initial, state: State.toRemoteState(desired), headers: { 'If-Match': '"fresh"' }, remoteSnapshot: { state: changedRemote, etag: '"fresh"' } };
    },
    planOptions: { local: desired, direction: 'bidirectional', expectedVersion: 'stale', resolution: 'local' },
    refreshLocal: async () => desired,
    same: Sync.sameState,
    put: async (_state, conditions) => { puts++; if (puts === 1) { const error = Error('precondition failed'); error.status = 412; throw error; } assert.deepEqual(conditions, { 'If-Match': '"fresh"' }); }
  });
  assert.equal(puts, 2);
  assert.equal(replans, 1);
  assert.equal(result.wrote, true);
  assert.equal(result.prepared.remoteSnapshot.etag, '"fresh"');
});

test('an ambiguous PUT is confirmed by a forced fresh read instead of being blindly resent', async () => {
  const desired=State.toRemoteState(library([{id:'game',name:'Game'}])),before=library([]),initial={state:desired,headers:{'If-None-Match':'*'},remoteSnapshot:{state:null},actualDirection:'upload'};
  let puts=0,reads=0;const order=[];
  const result=await WriteRecovery.writeSyncState({initial,plan:async options=>{reads++;order.push('get');assert.equal(options.forceFreshRemote,true);assert.equal(options.forceDecision,true);return {needsDecision:true,remoteSnapshot:{state:desired,etag:'"written"'}};},planOptions:{local:desired,direction:'upload',stat:async()=>{order.push('stat');return {exists:true,etag:'"written"'};}},refreshLocal:async()=>desired,same:Sync.sameState,put:async()=>{puts++;throw Error('socket closed after write');}});
  assert.equal(puts,1);
  assert.equal(reads,1);
  assert.deepEqual(order,['stat','get']);
  assert.equal(result.confirmedAfterInterruption,true);
  assert.equal(result.wrote,true);
  assert.equal(result.prepared.remoteSnapshot.etag,'"written"');
});

test('schema 4 rejects tampering, inline covers, and old sync-state without migration', async () => {
  const current = State.toRemoteState(library([{ id: 'game', name: 'Game' }]));
  current.items[0].name = 'tampered';
  await assert.rejects(Sync.snapshot(new Response(JSON.stringify(current), { status: 200 })), /版本校验失败/);
  const legacy = library([{ id: 'game', name: 'Game', coverLandscape: 'data:image/jpeg;base64,Y292ZXI=' }]);
  Object.assign(legacy, { syncFormat: 'yueden-sync-state', syncVersion: 3, syncSchemaVersion: 3 });
  await assert.rejects(Sync.snapshot(new Response(JSON.stringify(legacy), { status: 200 })), /同步文件版本不匹配/);
  const currentInline={...legacy,syncVersion:4,syncSchemaVersion:4};currentInline.contentRevision=State.contentRevision(currentInline);currentInline.syncRevision=State.syncRevision(currentInline);
  await assert.rejects(Sync.snapshot(new Response(JSON.stringify(currentInline), { status: 200 })), /内嵌封面/);
});

test('diagnostics redact inline image payloads and long base64 tokens', () => {
  const { cleanText } = require('../app/webdav-diagnostic-log');
  const payload = 'A'.repeat(256), safe = cleanText(`failed data:image/jpeg;base64,${payload}`);
  assert.equal(safe.includes(payload), false);
  assert.match(safe, /REDACTED/);
});
