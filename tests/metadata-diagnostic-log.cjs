const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Log=require('../app/metadata-diagnostic-log');
const BookDiagnostics=require('../app/metadata-book-diagnostics');

const root=path.join(__dirname,'..','test-artifacts',`metadata-diagnostic-${process.pid}-${Date.now()}`);
try{
  const log=Log.create({directory:root,appVersion:'1.0.4b',buildId:'fixture-build',maxBytes:4096,now:()=> '2026-10-05T00:00:00.000Z'});
  const runId='run-fixture';
  assert.equal(BookDiagnostics.safeTitle('Welcome back, Private Person'),'[account page]');
  assert.equal(BookDiagnostics.safeTitle('Search results for QSecretPhrase','QSecretPhrase').includes('QSecretPhrase'),false);
  assert.equal(log.write({runId,sourceId:'onelib',mediaType:'book',operation:'search',phase:'http.start',url:'https://zh.1lib.sk/s/通关游戏?q=通关游戏&token=secret-token#hash-secret',query:'通关游戏',queryLength:4,cookie:'private-cookie',authorization:'Bearer private-auth',errorMessage:'Authorization: Bearer abcdef Cookie: SID=private-cookie user@example.test'}),true);
  const first=JSON.parse(fs.readFileSync(log.filePath(),'utf8').trim());
  assert.equal(first.runId,runId);assert.equal(first.appVersion,'1.0.4b');assert.equal(first.buildId,'fixture-build');assert.equal(first.durationMs,0);
  assert.equal(first.requestHost,'zh.1lib.sk');assert.equal(first.requestPath,'/s/[search term]');assert.deepEqual(first.requestQueryKeys,['q','token']);
  const serialized=fs.readFileSync(log.filePath(),'utf8');
  for(const secret of ['通关游戏','secret-token','hash-secret','private-cookie','private-auth','abcdef','user@example.test','cookie:'])assert.equal(serialized.toLowerCase().includes(secret.toLowerCase()),false,`sensitive value leaked: ${secret}`);
  for(let index=0;index<10;index++)assert.equal(log.write({runId,sourceId:'zlibrary',mediaType:'book',operation:'search',phase:'parse.summary',errorMessage:'x'.repeat(1500)}),true);
  assert.equal(fs.existsSync(log.filePath()+'.1'),true,'rotation should retain one previous log');
  assert.ok(fs.statSync(log.filePath()).size<=4096,'active log should remain under configured limit');
  fs.writeFileSync(path.join(root,'unrelated.log'),'preserve');
  assert.equal(log.clear().ok,true);assert.equal(fs.existsSync(log.filePath()),false);assert.equal(fs.existsSync(log.filePath()+'.1'),false);assert.equal(fs.existsSync(path.join(root,'unrelated.log')),true);
  const broken=Log.create({directory:()=>{throw Error('unavailable');}});assert.equal(broken.write({phase:'source.start'}),false);
  console.log('metadata diagnostic log write/redaction/rotation/clear: passed');
}finally{try{fs.rmSync(root,{recursive:true,force:true});}catch{}}
