const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const oldRoot='D:/Software/YueDen/YueDen 1.0.1/程序/resources/app/player';
const sourceRoot=path.join(__dirname,'..','app','player');
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const oldWindow=read(path.join(oldRoot,'window.js'));
const sourceWindow=read(path.join(sourceRoot,'window.js'));
const oldService=read(path.join(oldRoot,'src','service.ts'));
const sourceService=read(path.join(sourceRoot,'src','service.ts'));

function through(text,start,end){
  const at=text.indexOf(start),finish=text.indexOf(end,at);
  assert.notEqual(at,-1,`missing baseline start: ${start}`);
  assert.notEqual(finish,-1,`missing baseline end: ${end}`);
  return text.slice(at,finish);
}

test('playback mode control and service action match 1.0.1',()=>{
  const uiStart="modeButton=button('播放模式',";
  const uiEnd=';modeButton.dataset.modeControl';
  assert.equal(through(sourceWindow,uiStart,uiEnd),through(oldWindow,uiStart,uiEnd));
  const actionStart="else if(name==='mode')";
  const actionEnd="\n    else if(name==='eq')";
  assert.equal(through(sourceService,actionStart,actionEnd),through(oldService,actionStart,actionEnd));
});

test('track selector and loading behavior match 1.0.1',()=>{
  const renderStart='const tk=JSON.stringify(s.tracks);';
  const renderEnd='const bk=JSON.stringify(s.bookmarks);';
  const oldTrackBlock=through(oldWindow,renderStart,renderEnd);
  const sourceTrackBlock=through(sourceWindow,renderStart,'const markKey=JSON.stringify');
  assert.ok(sourceTrackBlock.startsWith(oldTrackBlock));
  assert.equal(sourceService.includes("state.status==='playing'&&priorStatus==='loading'"),true);
  assert.equal(oldService.includes("state.status==='playing'&&priorStatus==='loading'"),true);
  assert.equal(sourceWindow.includes('trackSelect.disabled='),false);
  assert.equal(sourceWindow.includes("action('tracks')"),false);
});

test('bookmark selector preserves the current choice like 1.0.1',()=>{
  const start='const bk=JSON.stringify(s.bookmarks);';
  const end='bookmarks.value=prior}';
  const oldBlock=through(oldWindow,start,end)+end;
  const sourceBlock=through(sourceWindow,start,end)+'bookmarks.value=prior}';
  assert.equal(sourceBlock,oldBlock);
  assert.equal(sourceBlock.includes('s.bookmarks.at(-1)'),false);
});
