'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Choice=require('../app/webdav-sync-choice-session');
const LibrarySync=require('../app/webdav-library-sync');

test('local and remote conflict choices survive comparison dialog reopen and replan',()=>{
  const session=Choice.create('endpoint');
  const first=[{key:'resource:A',signature:'a1'},{key:'resource:B',signature:'b1'}];
  Choice.update(session,first);
  assert.equal(Choice.remember(session,'resource:A','a1','local'),true);
  assert.equal(Choice.remember(session,'resource:B','b1','remote'),true);
  Choice.setMode(session,'merge');

  const reopened=[{key:'resource:A',signature:'a1'},{key:'resource:B',signature:'b1'}];
  Choice.update(session,reopened);
  assert.equal(Choice.restore(session,reopened[0]),'local');
  assert.deepEqual(Choice.values(session,reopened),{'resource:A':'local','resource:B':'remote'});
  assert.equal(session.mode,'merge');
});

test('a changed resource clears only its old decision while unchanged resources stay selected',()=>{
  const session=Choice.create();
  const before=[{key:'resource:A',signature:'a1'},{key:'resource:B',signature:'b1'}];
  Choice.update(session,before);
  Choice.remember(session,'resource:A','a1','local');
  Choice.remember(session,'resource:B','b1','remote');
  const after=[{key:'resource:A',signature:'a2'},{key:'resource:B',signature:'b1'}];
  Choice.update(session,after);
  assert.equal(Choice.restore(session,after[0]),'');
  assert.equal(Choice.restore(session,after[1]),'remote');
});

test('choosing the empty option clears a remembered per-resource selection',()=>{
  const session=Choice.create(),unit={key:'resource:A',signature:'a1'};
  Choice.update(session,[unit]);
  Choice.remember(session,unit.key,unit.signature,'local');
  assert.equal(Choice.remember(session,unit.key,unit.signature,''),true);
  assert.equal(Choice.restore(session,unit),'');
});

test('decisions for resources that left the difference set are pruned; cancel clears the session',()=>{
  const session=Choice.create();
  const rows=[{key:'resource:A',signature:'a'},{key:'resource:B',signature:'b'}];
  Choice.update(session,rows);
  Choice.remember(session,'resource:A','a','local');
  Choice.remember(session,'resource:B','b','remote');
  Choice.update(session,[rows[1]]);
  assert.equal(Choice.restore(session,rows[0]),'');
  assert.equal(Choice.restore(session,rows[1]),'remote');
  Choice.clear(session);
  assert.deepEqual(Choice.values(session,[rows[1]]),{});
  assert.equal(Choice.restore(session,rows[1]),'');
});

test('decision signature ignores timestamp-only changes but tracks resource data changes',()=>{
  const local={id:'A',name:'Book',rating:3,updatedAt:'2026-10-01T00:00:00Z'};
  const remote={id:'A',name:'Book',rating:4,updatedAt:'2026-10-01T00:00:01Z'};
  const signature=LibrarySync.decisionSignature(local,remote);
  assert.equal(LibrarySync.decisionSignature({...local,updatedAt:'2026-10-02T00:00:00Z'},remote),signature);
  assert.notEqual(LibrarySync.decisionSignature(local,{...remote,rating:5}),signature);
});

test('renderer loads and uses choice memory for reopened sync comparison dialogs',()=>{
  const renderer=fs.readFileSync(path.join(__dirname,'../app/renderer.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8');
  assert.match(html,/webdav-sync-choice-session\.js"><\/script><script src="renderer\.js/);
  assert.match(renderer,/WebdavSyncChoiceSession\.update\(choiceSession,unknownItems\)/);
  assert.match(renderer,/WebdavSyncChoiceSession\.restore\(choiceSession,item\)/);
  assert.match(renderer,/WebdavSyncChoiceSession\.values\(choiceSession,unknownItems\)/);
  assert.match(renderer,/webdavSyncChoiceSessions\.delete\(choiceKey\)/);
});
