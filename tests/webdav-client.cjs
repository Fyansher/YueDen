const test = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../app/webdav-client');
const Sync = require('../app/webdav-library-sync');
const SyncState = require('../app/webdav-state');
const Catalog = require('../app/webdav-save-catalog');
const ConditionProbe = require('../app/webdav-condition-probe');
const fixture = require('./webdav-fixture.cjs');

function syncState(items = []) {
  const value={syncFormat:'yueden-sync-state',syncVersion:4,syncSchemaVersion:4,schemaVersion:4,items,deletedItems:[],deletedSaveSnapshots:[],categories:[],playlists:[],referenceRedirects:[],organizationHistory:[],settings:{},settingsUpdatedAt:'',audioConnections:[],audioConnectionsUpdatedAt:''};
  value.contentRevision=SyncState.contentRevision(value);value.syncRevision=SyncState.syncRevision(value);return value;
}
function syncJson(value){return JSON.stringify(SyncState.toRemoteState(value));}

test('InfiniCLOUD origin maps to official DAV endpoint without rewriting explicit paths', () => {
  assert.equal(Client.endpoint({ webdavUrl: 'https://ogi.teracloud.jp/', webdavRemotePath: '悦森盒' }, 'library.json').href, 'https://ogi.teracloud.jp/dav/%E6%82%A6%E6%A3%AE%E7%9B%92/library.json');
  assert.equal(Client.address({ webdavUrl: 'https://sample.infini-cloud.net/dav/custom/' }).pathname, '/dav/custom/');
  assert.throws(() => Client.address({ webdavUrl: 'https://host/dav/?token=x' }));
  assert.throws(() => Client.endpoint({ webdavUrl: 'https://host/dav/', webdavRemotePath: '../x' }));
});

test('first sync creates each missing collection before GET and preserves conditional write', async () => {
  const f = await fixture();
  try {
    const c = Client.create();
    await c.ensurePath(f.settings);
    assert.equal(f.requests.filter(row => row.method === 'MKCOL').length, 2);
    const local = syncState([{ id: 'a' }]), backups = [];
    const plan = await Sync.plan({ local, direction: 'bidirectional', get: () => c.request(f.settings, 'GET', 'sync-state.json'), backup: async value => backups.push(value) });
    assert.equal(backups.length, 1);
    assert.deepEqual(plan.headers, { 'If-None-Match': '*' });
    assert.ok((await c.request(f.settings, 'PUT', 'sync-state.json', JSON.stringify(plan.state), '', plan.headers)).ok);
    const again = await Sync.plan({ local, direction: 'bidirectional', get: () => c.request(f.settings, 'GET', 'sync-state.json'), backup: async () => {} });
    assert.equal(again.headers['If-Match'], '"1"');
    await c.ensurePath(f.settings);
    assert.equal(f.requests.filter(row => row.method === 'MKCOL').length, 2);
  } finally { await f.close(); }
});

test('connection test rejects HTTP errors and HTML instead of reporting success', async () => {
  const f = await fixture();
  try {
    const c = Client.create();
    for (const code of [400, 401, 403, 429, 500]) {
      f.setMode('status' + code);
      await assert.rejects(c.ensurePath(f.settings), new RegExp(String(code)));
    }
    f.setMode('html');
    await assert.rejects(c.ensurePath(f.settings), /WebDAV 目录/);
    assert.ok(f.requests.every(row => row.method !== 'PUT'));
  } finally { await f.close(); }
});

test('connection probe performs a temporary write, exact read-back, and cleanup without probing conditional PUT support', async () => {
  const f = await fixture();
  try {
    const c = Client.create(); await c.ensurePath(f.settings);
    const result = await ConditionProbe.probe({ settings: f.settings, request: (...args) => c.request(...args), token: 'simple-case' });
    assert.equal(result.ok, true);
    const relative = f.requests.findLast(row => row.method === 'DELETE')?.path;
    assert.ok(relative?.includes('.yueden-write-check-simple-case.tmp'));
    assert.equal(f.files.has(relative), false);
    const probeRows=f.requests.filter(row=>row.path===relative);
    assert.deepEqual(probeRows.map(row=>row.method),['PUT','GET','DELETE']);
    assert.equal(probeRows[0].match,undefined);
    assert.equal(probeRows[0].none,undefined);
  } finally { await f.close(); }
});

test('connection probe confirms a lost PUT response by reading the exact temporary content and cleans up', async () => {
  const calls = [];
  let stored = '';
  const request = async (_settings, method, relative, content = null) => {
    calls.push({ method, relative });
    if (method === 'PUT') { stored = String(content); throw Error('socket closed after server write'); }
    if (method === 'GET') return new Response(stored, { status: 200 });
    if (method === 'DELETE') { stored = ''; return new Response(null, { status: 204 }); }
    throw Error('Unexpected request');
  };
  const diagnostics=[];
  const result = await ConditionProbe.probe({ settings: {}, request, token: 'lost-response', diagnostic: row=>diagnostics.push(row) });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(row=>row.method),['PUT','GET','DELETE']);
  assert.equal(calls[0].relative,calls[1].relative);
  assert.equal(calls[1].relative,calls[2].relative);
  assert.equal(stored,'');
  assert.equal(diagnostics[0].event,'connection-test.put-confirmed-after-interruption');
});

test('a response interruption fails after the single normal GET and never issues Range requests', async () => {
  let gets = 0;
  const interrupted = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }), { status: 200 });
  await assert.rejects(Sync.plan({ local: syncState([]), direction: 'download', get: async headers => { gets++;assert.deepEqual(headers,{});return interrupted; }, backup: async () => {} }), /terminated/);
  assert.equal(gets,1);
});

test('oversized sync state is rejected before a second request or Range download', async () => {
  const state=syncState([]);state.settings.padding='x'.repeat(Sync.MAX_SYNC_STATE_BYTES);
  const body=Buffer.from(syncJson(state)),calls=[];
  await assert.rejects(Sync.plan({local:syncState([]),direction:'download',get:async headers=>{calls.push(headers||{});return new Response(body,{status:200,headers:{'content-length':String(body.length)}});},backup:async()=>{}}),/超过读取上限/);
  assert.deepEqual(calls,[{}]);
});

test('idle body deadline resets after each received response chunk', async () => {
  const client=Client.create({bodyTimeout:25,fetch:async()=>new Response(new ReadableStream({async start(controller){controller.enqueue(Buffer.from('a'));await new Promise(resolve=>setTimeout(resolve,12));controller.enqueue(Buffer.from('b'));await new Promise(resolve=>setTimeout(resolve,12));controller.enqueue(Buffer.from('c'));controller.close();}}))});
  const response=await client.request({webdavUrl:'https://dav.example/dav/'},'GET','covers/asset.jpg');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(),'abc');
});

test('unchanged library and save fast path performs only two metadata requests and no state, manifest, or object GET', async () => {
  const f=await fixture();
  try{
    const client=Client.create(),local=SyncState.toRemoteState(syncState([{id:'same',name:'Same'}])),catalog=require('../app/webdav-save-catalog').create();
    await client.ensurePath(f.settings);await client.ensureDirectories(f.settings,'saves');
    const statePut=await client.request(f.settings,'PUT','sync-state.json',JSON.stringify(local));await statePut.body?.cancel();
    const catalogPut=await client.request(f.settings,'PUT','saves/catalog.json',JSON.stringify(catalog));await catalogPut.body?.cancel();
    const before=f.requests.length,started=Date.now(),localState=await client.stat(f.settings,'sync-state.json'),saveState=await client.stat(f.settings,'saves/catalog.json');
    let getCalls=0;
    const planned=await Sync.plan({local,direction:'bidirectional',cachedRemote:{state:local,etag:localState.etag,lastModified:localState.lastModified,byteLength:localState.contentLength},get:async()=>{getCalls++;throw Error('fast path must not GET sync-state');},backup:async()=>{}});
    const saved=Catalog.canSkip({localRevision:catalog.revision,cached:{localRevision:catalog.revision,remoteRevision:catalog.revision,etag:saveState.etag,remoteLength:saveState.contentLength},remote:saveState});
    const requests=f.requests.slice(before);
    assert.equal(planned.comparison.equal,true);assert.equal(saved,true);assert.equal(getCalls,0);
    assert.ok(Date.now()-started<500,'metadata-only unchanged check should complete quickly on the local HTTP fixture');
    assert.deepEqual(requests.map(row=>row.method),['PROPFIND','PROPFIND']);
    assert.ok(requests.every(row=>row.depth==='0'));
    assert.ok(!requests.some(row=>row.method==='GET'||row.depth==='1'));
  }finally{await f.close();}
});

test('sync plan can reuse an unchanged remote state from a verified strong ETag cache', async () => {
  const remote = syncState([{ id: 'remote' }]), diagnostics = [];
  const plan = await Sync.plan({
    local: remote, direction: 'upload', cachedRemote: { state: remote, etag: '"same-version"', lastModified: 'Thu, 01 Oct 2026 05:00:00 GMT', byteLength: Buffer.byteLength(syncJson(remote)) },
    get: async () => { throw Error('full download must be skipped'); }, backup: async () => {}, diagnostic: row => diagnostics.push(row)
  });
  assert.equal(plan.comparison.equal, true);
  assert.deepEqual(plan.headers, { 'If-Match': '"same-version"' });
  assert.equal(diagnostics.some(row => row.event === 'webdav.sync.FAST_PATH'), false, 'low-level plan results do not emit partial fast-path summaries');
});

test('forced write recovery bypasses the cached common version and rereads WebDAV', async () => {
  const remote = syncState([{ id: 'game', status: '未开始' }]);
  const local = syncState([{ id: 'game', status: '已通关' }]);
  let reads = 0;
  const result = await Sync.plan({
    local, direction: 'download', resolution: 'remote', forceFreshRemote: true,
    cachedRemote: { state: local, etag: '"stale-cache"', lastModified: 'Thu, 01 Oct 2026 05:00:00 GMT' },
    get: async () => { reads += 1; return new Response(syncJson(remote), { status: 200, headers: { etag: '"fresh-cloud"', 'last-modified': 'Thu, 01 Oct 2026 05:02:00 GMT' } }); },
    backup: async () => {}
  });
  assert.equal(reads, 1);
  assert.equal(result.comparison.equal, false);
  assert.equal(result.comparison.changed, 1);
});

test('a fresh conflict replan also refreshes metadata before selecting the next conditional validator', async () => {
  const remote=syncState([{id:'game',status:'cloud'}]),local=syncState([{id:'game',status:'local'}]);let stats=0;
  const result=await Sync.plan({local,direction:'upload',resolution:'local',forceFreshRemote:true,get:async()=>new Response(syncJson(remote),{status:200}),stat:async options=>{stats++;assert.equal(options.forceFresh,true);return {etag:'"fresh-after-412"',lastModified:'Thu, 01 Oct 2026 05:05:00 GMT'};},backup:async()=>{}});
  assert.equal(stats,1);
  assert.deepEqual(result.headers,{'If-Match':'"fresh-after-412"'});
});

test('WebDAV stat requests bypass intermediary caches when checking validators', async () => {
  const f = await fixture();
  try {
    let captured;
    const client = Client.create({ fetch: async (url, options) => { captured = options.headers; return fetch(url, options); } });
    await client.stat(f.settings, 'sync-state.json');
    assert.equal(captured['Cache-Control'], 'no-cache, no-store, max-age=0');
    assert.equal(captured.Pragma, 'no-cache');
  } finally { await f.close(); }
});

test('WebDAV preserves read failures without retrying the request implicitly', async () => {
  const f = await fixture();
  try {
    let calls = 0; const diagnostics = [];
    const client = Client.create({
      fetch: async () => {
        calls += 1;
        if (calls === 1) { const error = new TypeError('fetch failed'); error.cause = { code: 'UND_ERR_SOCKET' }; throw error; }
        return new Response(null, { status: 207 });
      },
      onDiagnostic: row => diagnostics.push(row)
    });
    await assert.rejects(client.request(f.settings, 'PROPFIND', 'saves', null, '', { Depth: '0' }, undefined, false, true),/UND_ERR_SOCKET/);
    assert.equal(calls, 1);
    assert.equal(diagnostics.filter(row => row.event === 'webdav.request-failed').length, 1);
  } finally { await f.close(); }
});

test('missing ETag falls back to Last-Modified and missing validators never allow unconditional upload', async () => {
  const f = await fixture();
  try {
    const c = Client.create();
    await c.ensurePath(f.settings);
    const local = syncState([]), args = { local, direction: 'upload', get: () => c.request(f.settings, 'GET', 'sync-state.json'), backup: async () => {} };
    f.setMode('read400');
    await assert.rejects(Sync.plan(args), /400/);
    f.setMode('');
    await c.request(f.settings, 'PUT', 'sync-state.json', JSON.stringify(syncState([])));
    f.setMode('noetag');
    const fallback = await Sync.plan(args);
    assert.deepEqual(fallback.headers, { 'If-Unmodified-Since': f.files.get(Client.endpoint(f.settings, 'sync-state.json').pathname).lastModified });
    f.setMode('nometadata');
    await assert.rejects(Sync.plan(args), /ETag 或修改时间/);
    f.setMode('');
    const plan = await Sync.plan(args);
    f.setMode('race');
    assert.equal((await c.request(f.settings, 'PUT', 'sync-state.json', '{}', '', plan.headers)).status, 412);
  } finally { await f.close(); }
});

test('timeouts and cancellation terminate actual in-flight HTTP requests', async () => {
  const f = await fixture();
  try {
    f.setMode('hang');
    const closed = require('node:events').once(f.server, 'request-aborted');
    await assert.rejects(Client.create({ timeout: 15000 }).ensurePath(f.settings, { timeoutMs: 40 }), /超时/);
    await closed;
    assert.ok(f.aborted > 0);
    const controller = new AbortController(), request = Client.create().request(f.settings, 'GET', 'sync-state.json', null, '', {}, controller.signal);
    controller.abort();
    await assert.rejects(request, /取消/);
  } finally { await f.close(); }
});

test('whole WebDAV operation deadline aborts after headers without conflating the header timeout', async () => {
  const client=Client.create({timeout:500,operationSignal:()=>AbortSignal.timeout(25),fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  await assert.rejects(client.request({webdavUrl:'https://dav.example/dav/'},'GET','sync-state.json'),error=>error.code==='YUEDEN_WEBDAV_OPERATION_TIMEOUT'&&/请求超时/.test(error.message));
});

test('save listing uses finite depth and preserves nested paths', async () => {
  const f = await fixture();
  try {
    const c = Client.create();
    await c.ensurePath(f.settings);
    await c.ensureDirectories(f.settings, 'saves/game');
    await c.request(f.settings, 'PUT', 'saves/game/存档.dat', 'data');
    assert.deepEqual(await c.listFiles(f.settings), ['saves/game/存档.dat']);
    assert.ok(!f.requests.some(row => row.depth === 'infinity'));
  } finally { await f.close(); }
});

test('save listing uses bounded parallel directory requests', async () => {
  const f = await fixture();
  try {
    const c = Client.create();
    await c.ensurePath(f.settings);
    await c.ensureDirectories(f.settings, 'saves');
    const root = Client.endpoint(f.settings, 'saves').pathname.replace(/\/$/, '');
    for (let index = 0; index < 100; index += 1) {
      const folder = root + '/snapshot-' + index + '/';
      f.directories.add(folder);
      f.files.set(folder + 'manifest.json', { body: '{}', etag: '"' + index + '"', lastModified: new Date().toUTCString() });
    }
    let active = 0, maxActive = 0;
    f.server.on('request', (request, response) => {
      if (request.method !== 'PROPFIND') return;
      active += 1;
      maxActive = Math.max(maxActive, active);
      response.on('finish', () => { active -= 1; });
    });
    f.setDelay(5);
    const listed = await c.listFiles(f.settings);
    assert.equal(listed.length, 100);
    assert.ok(maxActive > 1, 'independent directories should be listed in parallel');
    assert.ok(maxActive <= 4, 'directory listing must keep its concurrency bounded');
  } finally { await f.close(); }
});

test('semantic equality canonicalizes local cover references and remote image data', () => {
  const crypto=require('node:crypto'),image=Buffer.from('same optimized jpeg bytes'),hash=crypto.createHash('sha256').update(image).digest('hex');
  const local=syncState([{id:'same',name:'Title',cover:`um-cover://image/${hash}.jpg`,genres:[],updatedAt:'2026-09-29T10:00:00.000Z'}]);
  local.settingsUpdatedAt='2026-09-29T10:00:00.000Z';local.settings={appearance:{theme:'ocean',accent:'#65d8b0'},remotePath:'YueDen'};
  const remote=syncState([{cover:'data:image/jpeg;base64,'+image.toString('base64'),id:'same',name:'Title',updatedAt:'2026-09-30T10:00:00.000Z'}]);
  remote.settingsUpdatedAt='2026-09-30T10:00:00.000Z';remote.settings={remotePath:'YueDen',appearance:{accent:'#65d8b0',theme:'ocean'}};
  const comparison=Sync.compare(local,remote,{localLastModified:'2026-09-29T12:00:00.000Z',remoteLastModified:'Thu, 29 Sep 2026 14:00:00 GMT'});
  assert.equal(comparison.equal,true);
  assert.equal(comparison.latestSide,'same');
  assert.equal(comparison.localHash,comparison.remoteHash);
  assert.equal(comparison.localLastModified,'2026-09-29T12:00:00.000Z');
});

test('identical content does not create an unnecessary recovery snapshot', async () => {
  const f = await fixture();
  try {
    const c = Client.create(); await c.ensurePath(f.settings);
    const same = SyncState.toRemoteState(syncState([{ id: 'same', name: 'Same' }]));
    const key = Client.endpoint(f.settings, 'sync-state.json').pathname;
    f.files.set(key, { body: JSON.stringify(same), etag: '"same"', lastModified: new Date().toUTCString() });
    let backups = 0;
    const result = await Sync.plan({ local: same, direction: 'bidirectional', get: () => c.request(f.settings, 'GET', 'sync-state.json'), backup: async () => { backups += 1; } });
    assert.equal(result.comparison.equal, true);
    assert.equal(backups, 0);
  } finally { await f.close(); }
});

test('a common sync base identifies the changed branch without using item timestamps', async () => {
  const f=await fixture();
  try {
    const c=Client.create();await c.ensurePath(f.settings);
    const remote=syncState([{id:'same',name:'Cloud title',updatedAt:'2026-09-29T10:00:00.000Z'}]);
    remote.settingsUpdatedAt='2026-09-29T10:00:00.000Z';
    const key=Client.endpoint(f.settings,'sync-state.json').pathname,lastModified='Tue, 29 Sep 2026 14:00:00 GMT';
    f.files.set(key,{body:syncJson(remote),etag:'"7"',lastModified});
    const endpointKey='d'.repeat(64),lineage={schemaVersion:2,endpointKey,baseRevision:Sync.contentHash(remote),baseState:remote};
    const localNewer={...remote,settingsUpdatedAt:'2026-09-29T08:00:00.000Z',items:[{...remote.items[0],name:'Local title',updatedAt:'2026-09-29T08:00:00.000Z'}],lineage};
    const localWins=await Sync.plan({local:localNewer,direction:'bidirectional',endpointKey,resolution:'merge',localLastModified:'2026-09-29T08:00:00.000Z',get:()=>c.request(f.settings,'GET','sync-state.json'),stat:()=>c.stat(f.settings,'sync-state.json'),backup:async()=>{}});
    assert.equal(localWins.comparison.remoteLastModified,lastModified);
    assert.equal(localWins.comparison.remoteTimestampSource,'共同版本与内容差异');
    assert.equal(localWins.comparison.latestSide,'local');
    assert.equal(localWins.state.items[0].name,'Local title');

    const localOlder={...remote,lineage};
    const cloudChanged={...remote,items:[{...remote.items[0],name:'Cloud title v2',updatedAt:'2026-09-30T09:00:00.000Z'}]};
    f.files.set(key,{body:syncJson(cloudChanged),etag:'"8"',lastModified});
    const cloudWins=await Sync.plan({local:localOlder,direction:'bidirectional',endpointKey,resolution:'merge',localLastModified:'2026-09-29T16:00:00.000Z',get:()=>c.request(f.settings,'GET','sync-state.json'),stat:()=>c.stat(f.settings,'sync-state.json'),backup:async()=>{}});
    assert.equal(cloudWins.comparison.latestSide,'remote');
    assert.equal(cloudWins.state.items[0].name,'Cloud title v2');
  } finally { await f.close(); }
});

test('three-way merge combines independent fields and reports same-field conflicts', () => {
  const base=syncState([{id:'r',name:'Old',rating:2,review:'base'}]);
  const local={...base,items:[{...base.items[0],name:'Local'}],lineage:{schemaVersion:2,endpointKey:'d'.repeat(64),baseRevision:Sync.contentHash(base),baseState:base}};
  const remote={...base,items:[{...base.items[0],rating:4}]};
  const merged=Sync.merge(local,remote);
  assert.equal(merged.items[0].name,'Local');
  assert.equal(merged.items[0].rating,4);
  assert.throws(()=>Sync.merge({...local,items:[{...base.items[0],name:'Local'}]},{...remote,items:[{...base.items[0],name:'Cloud',rating:4}]}),/items\[r\]\.name/);
});

test('without common lineage timestamps do not infer a winner', () => {
  const local=syncState([{id:'r',name:'Local',updatedAt:'2030-01-01T00:00:00Z'}]);
  const remote=syncState([{id:'r',name:'Cloud',updatedAt:'2020-01-01T00:00:00Z'}]);
  const comparison=Sync.compare(local,remote);
  assert.equal(comparison.latestSide,'unknown');
  assert.equal(comparison.mergeable,false);
});
