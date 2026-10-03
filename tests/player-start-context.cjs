const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Audio=require('../app/audio-context');

const service=fs.readFileSync(path.join(__dirname,'..','app','player','src','service.ts'),'utf8').replace(/\r\n/g,'\n');
const serviceRuntime=fs.readFileSync(path.join(__dirname,'..','app','player','dist','service.js'),'utf8').replace(/\r\n/g,'\n');
const windowSource=fs.readFileSync(path.join(__dirname,'..','app','player','window.js'),'utf8').replace(/\r\n/g,'\n');

test('first playback initializes a shuffled order with the chosen track first',()=>{
  const start=service.indexOf("if(mode==='play'){");
  const end=service.indexOf("else if(mode==='next')",start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const block=service.slice(start,end);
  assert.ok(block.indexOf('await playEntry(entry.queueEntryId')<block.indexOf('if(settings.shuffle)'));
  assert.match(block,/settings\.shuffleOrder=require\('\.\.\/\.\.\/audio-context'\)\.shuffled\(\{queue:active\.queue,index:active\.queue\.findIndex\(e=>e\.queueEntryId===active\.currentId\)\}\)/);
  assert.match(serviceRuntime,/settings\.shuffleOrder = require\('\.\.\/\.\.\/audio-context'\)\.shuffled\(\{ queue: active\.queue, index: active\.queue\.findIndex\(e => e\.queueEntryId === active\.currentId\) \}\)/);
  const queue=['a','b','c','d','e'].map(queueEntryId=>({queueEntryId}));
  assert.deepEqual(Audio.shuffled({queue,index:2},()=>0),['c','b','d','e','a']);
});

test('songs page passes its view to playback and service preserves it as the list target',()=>{
  assert.match(windowSource,/if\(libraryView==='songs'\)\{for\(const track of ordered\(filtered\.flatMap\(g=>g\.tracks\),null\)\)addTrack\(libraryHost,track,track\.orderId,\{view:'songs'\}\)/);
  const start=service.indexOf('function destination(');
  const end=service.indexOf('\n  }',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  assert.match(service.slice(start,end),/if\(source\?\.view==='songs'\)return \{view:'songs',groupId:null\}/);
  assert.match(serviceRuntime,/if \(source\?\.view === 'songs'\)\s+return \{ view: 'songs', groupId: null \}/);
});
