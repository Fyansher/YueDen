const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../app/steam-request-policy');

test('Steam联想搜索优先于排队中的后台封面资产请求',async()=>{
  let time=0,release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),order=[];
  const queue=policy.create({now:()=>time,spacing:100,runtime:{check(){},delay:async ms=>{time+=ms;},recordFailure(){}}});
  const active=queue.run('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?id=1',async()=>{order.push('active-art');entered();await gate;return {};});
  await started;
  const artwork=Array.from({length:155},(_,i)=>queue.run('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?id='+(i+2),async()=>{order.push('art'+i);return {};}));
  const search=queue.run('https://store.steampowered.com/search/suggest?term=Servant%20of%20the%20Lake',async()=>{order.push('search');return {};});
  release();await Promise.all([active,...artwork,search]);
  assert.deepEqual(order.slice(0,2),['active-art','search']);
  assert.equal(new Set(order).size,157);
});
