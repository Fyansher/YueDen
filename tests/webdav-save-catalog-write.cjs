'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Writer=require('../app/webdav-save-catalog-write');
const Catalog=require('../app/webdav-save-catalog');
const Client=require('../app/webdav-client');
const fixture=require('./webdav-fixture.cjs');

const row=id=>({id,manifestHash:'rev-'+id,objects:[]});
const catalog=(...ids)=>Catalog.create(ids.map(row));
const okResponse=(etag='')=>new Response(null,{status:204,headers:etag?{etag}:undefined});

test('a validator-less catalog is rebound to a stable fresh stat around a no-cache reread',async()=>{
  const saved=catalog('remote'),statRow={exists:true,etag:'',lastModified:'Fri, 02 Oct 2026 12:00:00 GMT',contentLength:123};let reads=0,stats=0;
  const fresh=await Writer.refreshCurrent({stat:async()=>{stats++;return statRow;},read:async()=>{reads++;return {catalog:saved,etag:'',lastModified:'',byteLength:123};}});
  assert.equal(reads,1);assert.equal(stats,2);assert.equal(fresh.lastModified,statRow.lastModified);assert.equal(fresh.catalog.revision,saved.revision);
});

test('a validator-less catalog is not paired with a validator that changed during reread',async()=>{
  let stats=0;
  await assert.rejects(()=>Writer.refreshCurrent({
    stat:async()=>({exists:true,etag:'',lastModified:stats++?'Fri, 02 Oct 2026 12:00:01 GMT':'Fri, 02 Oct 2026 12:00:00 GMT'}),
    read:async()=>({catalog:catalog('remote'),etag:'',lastModified:''})
  }),/仍无法确认当前版本/);
});

test('a fresh GET validator is preferred and a disappeared catalog returns create-only state',async()=>{
  let stats=0;
  const fresh=await Writer.refreshCurrent({stat:async()=>{stats++;throw Error('stat unavailable');},read:async()=>({catalog:catalog('remote'),etag:'"fresh"'})});
  assert.equal(fresh.etag,'"fresh"');assert.equal(stats,1);
  assert.equal(await Writer.refreshCurrent({stat:async()=>({exists:false}),read:async()=>null}),null);
});

test('a missing catalog is created only with If-None-Match star and then read back',async()=>{
  const local=catalog('local');let written=null,conditions=null;
  const result=await Writer.publish({
    current:null,localCatalog:local,direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>null,
    put:async(target,headers)=>{written=target;conditions=headers;return okResponse('"catalog-1"');},
    verify:async()=>({catalog:written,etag:'"catalog-1"',byteLength:88})
  });
  assert.deepEqual(conditions,{'If-None-Match':'*'});
  assert.equal(result.catalog.revision,local.revision);
  assert.equal(result.uploaded,1);
});

test('an existing catalog without a validator is freshly reread before a conditional write',async()=>{
  const old=catalog('remote-a'),fresh=catalog('remote-a','remote-b'),local=catalog('local');let refreshes=0,conditions=null,written=null;
  await Writer.publish({
    current:{catalog:old,etag:'',lastModified:''},localCatalog:local,direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>{refreshes++;return {catalog:fresh,etag:'"fresh"'};},
    put:async(target,headers)=>{written=target;conditions=headers;return okResponse();},
    verify:async()=>({catalog:written,etag:'"after"'})
  });
  assert.equal(refreshes,1);
  assert.deepEqual(conditions,{'If-Match':'"fresh"'});
  assert.deepEqual(written.entries.map(entry=>entry.id),['local','remote-a','remote-b']);
});

test('an existing catalog that still has no safe validator is never overwritten',async()=>{
  const current={catalog:catalog('remote'),etag:'',lastModified:''};let writes=0;
  await assert.rejects(()=>Writer.publish({
    current,localCatalog:catalog('local'),direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>current,put:async()=>{writes++;return okResponse();},verify:async()=>null
  }),/缺少安全写入标识/);
  assert.equal(writes,0);
});

test('412 causes a fresh read and remerge before the bounded retry',async()=>{
  const first={catalog:catalog('remote-a'),etag:'"one"'},second={catalog:catalog('remote-a','remote-b'),etag:'"two"'};
  const targets=[],conditions=[];let reads=0;
  const result=await Writer.publish({
    current:first,localCatalog:catalog('local'),direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>{reads++;return second;},
    put:async(target,headers)=>{targets.push(target);conditions.push(headers);return targets.length===1?new Response(null,{status:412}):okResponse('"three"');},
    verify:async()=>({catalog:targets.at(-1),etag:'"three"'})
  });
  assert.equal(reads,1);
  assert.deepEqual(conditions,[{'If-Match':'"one"'},{'If-Match':'"two"'}]);
  assert.deepEqual(targets[1].entries.map(entry=>entry.id),['local','remote-a','remote-b']);
  assert.equal(result.catalog.revision,targets[1].revision);
});

test('catalog upload recovers from a transient socket close while refreshing after 412',async()=>{
  const f=await fixture();
  try{
    let failNextCatalogRead=true;
    const client=Client.create({fetch:async(url,options)=>{
      if(options.method==='GET'&&url.pathname.endsWith('/saves/catalog.json')&&failNextCatalogRead){
        failNextCatalogRead=false;
        const error=new TypeError('fetch failed');error.cause={code:'UND_ERR_SOCKET'};throw error;
      }
      return globalThis.fetch(url,options);
    }});
    await client.ensurePath(f.settings);
    await client.ensureDirectories(f.settings,'saves');
    const initial=catalog('remote');
    await client.request(f.settings,'PUT','saves/catalog.json',JSON.stringify(initial),'application/json');
    const read=async()=>{
      const response=await client.request(f.settings,'GET','saves/catalog.json');
      if(response.status===404){await response.body?.cancel();return null;}
      const text=await response.text();
      return {catalog:Catalog.parse(JSON.parse(text)),etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||'',byteLength:Buffer.byteLength(text)};
    };
    const refreshed=()=>Writer.refreshCurrent({stat:()=>client.stat(f.settings,'saves/catalog.json'),read});
    const published=await Writer.publish({
      current:{catalog:initial,etag:'"stale"'},localCatalog:catalog('local'),direction:'upload',merge:Catalog.merge,
      refreshCurrent:refreshed,
      put:(target,conditions)=>client.request(f.settings,'PUT','saves/catalog.json',JSON.stringify(target),'application/json',conditions),
      verify:read
    });
    assert.equal(failNextCatalogRead,false,'fresh-connection retry completed the catalog reread');
    assert.deepEqual(published.catalog.entries.map(entry=>entry.id),['local','remote']);
    assert.equal(published.etag,'"2"');
    assert.equal(f.requests.filter(row=>row.method==='PUT'&&row.path.endsWith('/saves/catalog.json')&&row.match).length,2);
  }finally{await f.close();}
});

test('a successful PUT with a mismatched read-back is not confirmed',async()=>{
  await assert.rejects(()=>Writer.publish({
    current:null,localCatalog:catalog('local'),direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>null,put:async()=>okResponse(),verify:async()=>({catalog:catalog('other')})
  }),/回读校验不一致/);
});

test('a lost PUT response is accepted only when a fresh read confirms exact catalog revision',async()=>{
  const local=catalog('local');
  const result=await Writer.publish({
    current:null,localCatalog:local,direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>null,put:async()=>{throw Error('socket closed');},
    verify:async()=>({catalog:local,etag:'"confirmed"'})
  });
  assert.equal(result.catalog.revision,local.revision);
  assert.equal(result.uploaded,1);
});

test('a transient catalog read-back failure after a successful PUT is retried',async()=>{
  const local=catalog('local');let writes=0,reads=0;
  const result=await Writer.publish({
    current:null,localCatalog:local,direction:'upload',merge:Catalog.merge,
    refreshCurrent:async()=>null,put:async()=>{writes++;return okResponse('"stored"');},
    verify:async()=>{reads++;if(reads===1)throw Error('temporary read-back interruption');return {catalog:local,etag:'"stored"'};}
  });
  assert.equal(writes,1);
  assert.equal(reads,2);
  assert.equal(result.catalog.revision,local.revision);
});
