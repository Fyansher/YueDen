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
