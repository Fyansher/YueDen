'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Association=require('../app/save-snapshot-association');

test('classic renderer modules load together without global lexical collisions',()=>{
  const browser={};browser.window=browser;browser.globalThis=browser;
  for(const file of ['save-snapshot-selection.js','webdav-sync-choice-session.js','save-snapshot-association.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app',file),'utf8'),browser,{filename:file});
  assert.equal(typeof browser.SaveSnapshotSelection.toggleAll,'function');
  assert.equal(typeof browser.WebdavSyncChoiceSession.create,'function');
  assert.equal(typeof browser.SaveSnapshotAssociation.candidate,'function');
});

test('orphan suggestions use stable game IDs, identical local save paths, or exact normalized titles',()=>{
  const saved={gameName:'No Man\'s Sky',resourceIdentity:{steamAppId:'275850'},paths:['D:/Saves/NMS']};
  assert.equal(Association.candidate(saved,{id:'a',type:'game',name:'Completely renamed',steamAppId:'275850'}),true);
  assert.equal(Association.candidate({...saved,resourceIdentity:{}},{id:'b',type:'game',name:'Other title',savePaths:['d:/saves/nms']}),true);
  assert.equal(Association.candidate({...saved,resourceIdentity:{},paths:[]},{id:'c',type:'game',name:'NO-MAN’S SKY'}),true);
  assert.equal(Association.candidate({...saved,resourceIdentity:{},paths:[]},{id:'d',type:'game',name:'No Man\'s Sky 2'}),false);
  assert.equal(Association.candidate(saved,{id:'e',type:'book',name:'No Man\'s Sky',steamAppId:'275850'}),false);
});

test('stable identities keep Steam AppIDs and recognized external identifier keys',()=>{
  assert.deepEqual(Association.stableIdentity({steamAppId:'123',identifiers:{bangumi:'456',invalid:{id:1}}}),{steamAppId:'123',identifiers:{bangumi:'456'}});
  assert.equal(Association.sameIdentity({identifiers:{bangumi:'456'}},{identifiers:{bangumi:'456',steam:'123'}}),true);
});
