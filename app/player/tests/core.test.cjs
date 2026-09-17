const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {PlayerSession}=require('../dist/session');
const {validateCommand}=require('../dist/contracts');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
class FakeBackend {
  calls=[]; generation=0;
  async load(file,generation,start){this.calls.push(['load',file,generation,start]);this.generation=generation}
  async volume(value,muted){this.calls.push(['volume',value,muted])}
  async pause(value){this.calls.push(['pause',value])}
  async seek(value){this.calls.push(['seek',value])}
  async stop(){this.calls.push(['stop'])}
  async close(){this.calls.push(['close'])}
  async sample(generation){return {generation,position:12,duration:90,paused:false,ended:false,hasVideo:true}}
}
function setup(progress){const backend=new FakeBackend(),session=new PlayerSession(backend,progress),entries=session.append(['甲','乙','丙'].map(title=>({path:path.resolve(title+' 测试.mp4'),title,resourceId:title,memberId:title+'-1'})));return {backend,session,entries}}
test('稳定队列：追加和排序不断播，下一项根据新顺序，拒绝重复或缺失 ID',async()=>{
  const {session,backend,entries:e}=setup();await session.play(e[0].queueEntryId);await session.poll();
  session.reorder([e[1].queueEntryId,e[0].queueEntryId,e[2].queueEntryId]);
  session.append([{path:path.resolve('追加.wav'),title:'追加'}]);
  assert.equal(backend.calls.filter(x=>x[0]==='load').length,1);assert.equal(session.snapshot().currentId,e[0].queueEntryId);
  assert.throws(()=>session.reorder([e[0].queueEntryId,e[0].queueEntryId]));await session.next();assert.equal(session.snapshot().currentId,e[2].queueEntryId);
});
test('停止保留媒体/队列并先保存对应成员进度，再播放从零开始',async()=>{
  const saved=[];const {session,backend,entries:e}=setup(async(entry,time)=>saved.push([entry.resourceId,entry.memberId,time]));
  await session.play(e[0].queueEntryId,35);await session.poll();await session.stop();
  assert.deepEqual(saved,[['甲','甲-1',12]]);assert.equal(session.snapshot().position,0);assert.equal(session.snapshot().currentId,e[0].queueEntryId);
  await session.play(e[0].queueEntryId);assert.equal(backend.calls.filter(x=>x[0]==='load').at(-1)[3],0);
});
test('删除其他项不影响当前；删除当前立即清除关联，异步停止不清除新选择',async()=>{
  const {session,backend,entries:e}=setup();await session.play(e[0].queueEntryId);await session.remove(e[2].queueEntryId);
  assert.equal(backend.calls.filter(x=>x[0]==='stop').length,0);
  const blocked=defer();backend.stop=()=>blocked.promise;
  const removed=session.remove(e[0].queueEntryId);assert.equal(session.snapshot().currentId,null);
  const playing=session.play(e[1].queueEntryId);blocked.resolve();await Promise.all([removed,playing]);
  assert.equal(session.snapshot().currentId,e[1].queueEntryId);assert.equal(session.snapshot().queue.length,1);
});
test('过期播放采样不可污染快速切歌后的状态和资源关联',async()=>{
  const {session,backend,entries:e}=setup();await session.play(e[0].queueEntryId);const old=session.snapshot().generation;
  const response=defer();backend.sample=()=>response.promise;const poll=session.poll();
  await session.play(e[1].queueEntryId);response.resolve({generation:old,position:80,duration:100,paused:false,ended:true,hasVideo:true});await poll;
  assert.equal(session.snapshot().position,0);assert.equal(session.snapshot().currentId,e[1].queueEntryId);assert.equal(session.snapshot().status,'loading');
});
test('同一同步轮快速选择只打开最后一项；旧打开失败不能污染新选择',async()=>{
  const {session,backend,entries:e}=setup();await Promise.all(e.map(row=>session.play(row.queueEntryId)));assert.equal(backend.calls.filter(x=>x[0]==='load').length,1);
  const pending=defer();backend.load=()=>pending.promise;const first=session.play(e[0].queueEntryId);await new Promise(setImmediate);
  backend.load=FakeBackend.prototype.load.bind(backend);const second=session.play(e[1].queueEntryId);pending.reject(Error('旧文件损坏'));await Promise.all([first,second]);
  assert.equal(session.snapshot().error,null);assert.equal(session.snapshot().currentId,e[1].queueEntryId);
});
test('错误后可再次打开有效文件；列表末项结束后停止',async()=>{
  const {session,backend,entries:e}=setup();backend.load=async()=>{throw Error('文件损坏')};await session.play(e[0].queueEntryId);assert.equal(session.snapshot().status,'error');
  backend.load=FakeBackend.prototype.load.bind(backend);await session.play(e[2].queueEntryId);
  backend.sample=async generation=>({generation,position:90,duration:90,paused:true,ended:true,hasVideo:false});await session.poll();
  assert.equal(session.snapshot().status,'stopped');assert.equal(session.snapshot().currentId,e[2].queueEntryId);assert.equal(session.snapshot().position,0);
});
test('快照不可修改权威状态；订阅先快照后单调版本更新；取消订阅有效',()=>{
  const {session,entries:e}=setup();const seen=[];const unsubscribe=session.subscribe(s=>{seen.push(s.revision);s.queue.length=0});
  session.reorder(e.map(x=>x.queueEntryId).reverse());assert.equal(session.snapshot().queue.length,3);assert.ok(seen[1]>seen[0]);
  unsubscribe();session.reorder(e.map(x=>x.queueEntryId));assert.equal(seen.length,2);
});
test('保存失败也执行停止；关闭幂等，关闭后拒绝修改',async()=>{
  const {session,backend,entries:e}=setup(async()=>{throw Error('进度损坏，停止写入')});await session.play(e[0].queueEntryId);await session.poll();await session.stop();
  assert.equal(backend.calls.filter(x=>x[0]==='stop').length,1);assert.match(session.snapshot().error,/停止写入/);
  await session.close();await session.close();assert.equal(backend.calls.filter(x=>x[0]==='close').length,1);assert.throws(()=>session.append([]));await assert.rejects(session.play(e[0].queueEntryId));
});
test('IPC 契约拒绝命令执行、非有限数、字符串冒充布尔值等异常参数',()=>{
  for(const value of [null,[],{type:'exec',command:'calc'},{type:'seek',seconds:NaN},{type:'volume',value:101,muted:false},{type:'pause',paused:'false'},{type:'reorder',ids:[4]}])assert.throws(()=>validateCommand(value));
  assert.deepEqual(validateCommand({type:'stop',shell:'ignored'}),{type:'stop'});
});
