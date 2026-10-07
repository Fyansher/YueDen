const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Log=require('../app/metadata-diagnostic-log');
const {createSourceSearch}=require('../app/metadata-sources');
const {createGameSources}=require('../app/game-sources');

const root=path.join(__dirname,'..','test-artifacts',`metadata-flow-${process.pid}-${Date.now()}`);
const resultPage='<html><head><title>Fixture results</title></head><body><a class="result-card" href="/download">Download</a><form action="/search"><input name="csrf" type="hidden" value="private-value"></form></body></html>';
const zlibraryHome='<html><body><form method="get" action="/search"><input name="q" type="search" value=""></form></body></html>';
(async()=>{
  try{
    const log=Log.create({directory:root,appVersion:'1.0.4b',buildId:'fixture-build'});
    const sources=createSourceSearch({
      pace:0,settings:()=>({}),sourceHome:id=>id==='onelib'?'https://zh.1lib.sk/':id==='zlibrary'?'https://zh.zlib.bz/':'',sourceVerified:()=>false,
      diagnostics:row=>log.write(row),
      json:async url=>url.includes('googleapis.com/books/')?{items:[{id:'fixture-book',volumeInfo:{title:'Fixture Book',authors:['Fixture Author'],canonicalVolumeLink:'https://books.google.com/books?id=fixture'}}]}:null,
      text:async(url,timeout,sourceId,context)=>{
        const html=sourceId==='zlibrary'&&new URL(url).pathname==='/'?zlibraryHome:resultPage;
        if(['onelib','zlibrary'].includes(sourceId)){
          context.log({phase:'http.start',requestUrl:url,timeoutMs:timeout,verified:false,requestMode:'fixture-session-fetch'});
          context.log({phase:'http.end',requestUrl:url,finalUrl:url,status:200,durationMs:2,contentType:'text/html',bodyLength:html.length,verificationHit:false});
        }
        return html;
      },
      renderHtml:async(sourceId,url,timeout,context)=>{
        context.log({phase:'render.start',requestUrl:url,timeoutMs:timeout});
        context.log({phase:'render.load-complete',requestUrl:url,durationMs:3,finalUrl:url});
        context.log({phase:'render.navigation-summary',requestUrl:url,navigationCount:1,redirectCount:0,inPageNavigationCount:0,stopLoadingCount:1,finalUrl:url});
        context.log({phase:'render.dom-return',requestUrl:url,returnReason:'stable',durationMs:4,htmlLength:resultPage.length,finalUrl:url,pageTitle:'Fixture results',verificationHit:false,verificationReason:''});
        return {html:resultPage,finalUrl:url,pageTitle:'Fixture results',returnReason:'stable'};
      }
    });
    const result=await sources.search('book','QSecretPhrase');
    const events=fs.readFileSync(log.filePath(),'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
    for(const id of ['onelib','zlibrary']){
      const rows=events.filter(row=>row.sourceId===id&&row.operation==='search');
      assert.ok(rows.some(row=>row.phase==='http.start'),id+' HTTP start');assert.ok(rows.some(row=>row.phase==='http.end'),id+' HTTP end');
      assert.ok(rows.some(row=>row.phase==='render.start'),id+' render start');assert.ok(rows.some(row=>row.phase==='render.dom-return'),id+' DOM return');
      assert.ok(rows.some(row=>row.phase==='parse.summary'),id+' structural summary');assert.ok(rows.some(row=>row.phase==='source.failed'),id+' source end');
      assert.equal(new Set(rows.map(row=>row.runId)).size,1,id+' events should share a runId');
      const summary=rows.find(row=>row.phase==='parse.summary');assert.equal(summary.parserFilters.detailPathRejected,1);assert.equal(summary.parserFilters.finalCandidateCount,0);assert.equal(summary.requestPath?.includes('QSecretPhrase'),false);
    }
    const google=result.sources.find(row=>row.id==='googlebooks');assert.equal(google.state,'ok');assert.equal(google.items[0].name,'Fixture Book');
    const googleEvents=events.filter(row=>row.sourceId==='googlebooks'&&row.operation==='search');assert.ok(googleEvents.some(row=>row.phase==='source.start'));assert.ok(googleEvents.some(row=>row.phase==='source.success'));assert.equal(new Set(googleEvents.map(row=>row.runId)).size,1);
    const gameLog=Log.create({directory:path.join(root,'game'),appVersion:'1.0.4b'}),games=createGameSources({json:async()=>null,text:async()=>'',steam:async()=>[],aliases:()=>[],settings:()=>({}),diagnostics:row=>gameLog.write(row)});
    const gameResult=await games.search('NoFixtureGame'),gameEvents=fs.readFileSync(gameLog.filePath(),'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert.equal(gameResult.sources.length,6);for(const id of ['steam','bangumi','nintendo','playstation','epic','dlsite']){const rows=gameEvents.filter(row=>row.sourceId===id&&row.operation==='search');assert.ok(rows.some(row=>row.phase==='source.start'),id+' source start');assert.ok(rows.some(row=>['source.success','source.empty','source.failed'].includes(row.phase)),id+' source end');assert.equal(new Set(rows.map(row=>row.runId)).size,1,id+' runId');}
    console.log('metadata diagnostics: onelib/zlibrary stage correlation; normal Google Books and game/Steam source flows remain usable');
  }finally{try{fs.rmSync(root,{recursive:true,force:true});}catch{}}
})().catch(error=>{console.error(error);process.exitCode=1;});
