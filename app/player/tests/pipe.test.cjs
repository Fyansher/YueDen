const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {MpvClient}=require('../dist/mpv-client');
async function fixture(t,handler,timeout=200){
  const pipe='\\\\.\\pipe\\um-player-test-'+randomUUID();
  const sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});let buf='';socket.on('data',chunk=>{buf+=chunk;let i;while((i=buf.indexOf('\n'))>=0){const req=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);handler(socket,req)}})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve)});
  const socket=await new Promise((resolve,reject)=>{const s=net.createConnection(pipe,()=>resolve(s));s.once('error',reject)});
  const client=new MpvClient(socket,timeout);t.after(async()=>{client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve))});return client;
}
test('真实 Windows 管道 / 模拟 mpv：乱序回应按请求 ID 关联，中文路径作为结构化参数',async t=>{
  const received=[];const client=await fixture(t,(s,req)=>{received.push(req);if(received.length===2){for(const r of [...received].reverse()){const line=JSON.stringify({request_id:r.request_id,error:'success',data:r.command[1]})+'\n';s.write(line.slice(0,12));s.write(line.slice(12))}}});
  const values=await Promise.all([client.request(['loadfile','D:\\中文 空格\\甲.mkv']),client.request(['get_property','pause'])]);
  assert.deepEqual(values,['D:\\中文 空格\\甲.mkv','pause']);assert.equal(received.length,2);
});
test('真实 Windows 管道 / 模拟 mpv：后端拒绝、超时、断线均返回可处理错误',async t=>{
  const client=await fixture(t,(s,r)=>{if(r.command[0]==='reject')s.write(JSON.stringify({request_id:r.request_id,error:'property unavailable'})+'\n');if(r.command[0]==='disconnect')s.destroy()},35);
  await assert.rejects(client.request(['reject']),/property unavailable/);await assert.rejects(client.request(['hang']),/超时/);await assert.rejects(client.request(['disconnect']),/关闭/);await assert.rejects(client.request(['later']),/未连接/);
});
test('真实 Windows 管道 / 模拟 mpv：损坏 JSON 终止连接并拒绝所有未完成请求',async t=>{
  const client=await fixture(t,s=>s.write('broken\n'));const results=await Promise.allSettled([client.request(['a']),client.request(['b'])]);assert.ok(results.every(r=>r.status==='rejected'));
});
