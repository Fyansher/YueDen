'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Catalog=require('../app/webdav-save-catalog');

test('cloud catalog keeps display metadata without changing snapshot object references',()=>{
 const id='items/Game--0123456789/2026-10-08_12-00-00',hash='a'.repeat(64);
 const catalog=Catalog.create([{id,manifestHash:'manifest-rev',metadata:{itemId:'game-1',gameName:'Example Game',createdAt:'2026-10-08T12:00:00.000Z',note:'Chapter 3',files:2,size:99},objects:[{object:`objects/aa/${hash}.bin`,sha256:hash,size:50,storedSize:99,encoding:'raw'}]}]);
 const loaded=Catalog.parse(JSON.parse(JSON.stringify(catalog)));
 assert.deepEqual(loaded.entries[0].metadata,catalog.entries[0].metadata);
 assert.equal(loaded.entries[0].objects.length,1);
});

test('cloud deletion publishes a tombstone before removing snapshot files',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=main.indexOf('async function deleteBackups('),end=main.indexOf('\nasync function deleteBackup(',start),flow=main.slice(start,end);
 const publish=flow.indexOf('await publishDeletedSaveSnapshots(settings,selected,remoteState)'),cleanup=flow.indexOf('await remove.deleteSnapshots(settings,selected.map(entry=>entry.id))');
 assert.ok(publish>=0&&cleanup>publish,'cloud catalogue must stop listing snapshots before physical cleanup');
 assert.match(main,/function recordDeletedSaveSnapshots\(entries,library=loadLibrary\(\)\)/);
 assert.match(main,/async function publishDeletedSaveSnapshots\(settings,entries,remoteState\)/);
 const object='objects/aa/'+'a'.repeat(64)+'.bin',ref={object,sha256:'a'.repeat(64),size:10,storedSize:10,encoding:'raw'};
 const a={id:'items/Game--one/2026-10-01_10-00-00',manifestHash:'rev-a',objects:[ref]},b={id:'items/Game--one/2026-10-02_10-00-00',manifestHash:'rev-b',objects:[ref]};
 const remote=Catalog.create([a,b]),local=Catalog.create([b],[{id:a.id}]),merged=Catalog.merge(remote,local,'upload');
 assert.deepEqual(merged.entries.map(row=>row.id),[b.id]);
 assert.deepEqual(merged.tombstones,[a.id]);
});

test('normal WebDAV sync does not download cloud snapshot objects; explicit restore does',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8'),start=main.indexOf('async function syncWebdav('),end=main.indexOf('\nfunction currentDisguiseState',start),flow=main.slice(start,end);
 const defer=flow.indexOf("event:'webdav.save-snapshots.deferred'");assert.ok(defer>=0);
 const saveDownload=flow.indexOf("webdavSyncPhase='download-save-snapshots'");const saveFinalize=flow.indexOf("webdavSyncPhase='save-catalog-finalize'");
 assert.ok(saveDownload>=0&&saveFinalize>saveDownload);
 const downloadPhase=flow.slice(saveDownload,saveFinalize);
 assert.doesNotMatch(downloadPhase,/download\('saves\/'\+object\)/);
 assert.doesNotMatch(downloadPhase,/syncObjectPath\(object\)/);
 assert.match(flow,/const finalLocalCatalog=plannedSaveCatalog/);
 const restore=main.slice(main.indexOf('async function restoreRemoteBackup('),main.indexOf('async function deleteRemoteBackup('));
 assert.match(restore,/readRemoteSnapshotManifest/);assert.match(restore,/verifyObjectFile/);assert.match(restore,/saveSnapshots\.restore/);
 const listing=main.slice(main.indexOf('async function listRemoteSaveSnapshots('),main.indexOf('async function refreshRemoteSaveCatalogForWrite('));
 assert.match(listing,/remoteOnly:!localAvailable/);assert.match(listing,/metadata/);
});
