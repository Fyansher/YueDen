const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('shared playback mode control updates its icon for every mode',()=>{
  const button={dataset:{},classList:{add(){},toggle(){}},setAttribute(name,value){this[name]=value;}};
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/playback-controls.js'),'utf8'),context);
  const controls=context.window.PlaybackControls,root={querySelector:()=>button};
  for(const [state,icon] of [
    [{shuffle:false,repeat:'none'},'order'],
    [{shuffle:false,repeat:'all'},'repeat'],
    [{shuffle:false,repeat:'one'},'single'],
    [{shuffle:true,repeat:'none'},'shuffle'],
  ]){
    controls.mode(root,state);
    assert.equal(button.dataset.playbackIcon,icon);
    assert.match(button.innerHTML,/<svg class="playback-icon"/);
  }
  assert.deepEqual(['none','all','one','shuffle'].map((mode,index)=>{
    const state=mode==='shuffle'?{shuffle:true,repeat:'none'}:{shuffle:false,repeat:mode};
    return controls.nextMode(state);
  }),['all','one','shuffle','none']);
});
