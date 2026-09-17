const assert=require('node:assert/strict'),Session=require('../app/import-session-model'),{enrich}=require('../app/scan-matching');
(async()=>{let calls=0;const row={};const work=()=>new Promise(r=>setTimeout(()=>r(++calls),5));await Promise.all([Session.once(row,work),Session.once(row,work)]);assert.equal(calls,1);
 for(const type of ['game','movie','anime','manga','book']){const r={name:'准确名称',type:type==='manga'?'comic':type==='anime'?'video':type,classification:{type:['movie','anime'].includes(type)?'video':type==='manga'?'comic':type,candidates:[],conflicts:[],confidence:1},naming:{},identifiers:{},metadata:{},scanInfo:{userOverrides:{},automatic:{}},boundary:{confidence:1},warnings:[],evidence:[]};let searched=0,prepared=0;
 await enrich([r],{options:{filter:type,identitySearch:async q=>{assert.equal(q.type,type);searched++;return {integrated:[{name:'准确名称',description:'真实字段占位测试',id:'candidate'}]};},prepareCandidate:async c=>{prepared++;return {...c,coverUrl:'um-cover://test'};}},metrics:{}});
 assert.equal(searched,1);assert.equal(prepared,1);assert.equal(Session.state(r),'ready');assert.equal(r.resolvedMetadata.coverUrl,'um-cover://test');Session.invalidate(r);assert.equal(Session.state(r),'stale');assert.equal(r.resolvedMetadata,undefined);
 }
 assert.equal(Session.state({item:{_previewMatched:true}}),'checked');assert.equal(Session.state({item:{_previewPrepared:true}}),'ready');console.log('PASS shared import lifecycle, five source adapters, invalidation and request coalescing (mock responses)');
})().catch(e=>{console.error(e);process.exitCode=1});
