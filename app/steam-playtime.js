/* One authenticated Steam request per account; never send credentials to mirrors. */
function createSteamPlaytime({json,settings,now=Date.now}){
 let cache=null,pending=null;
 async function sync(force=false){
  const config=settings(),id=String(config.steamId||'').trim(),key=String(config.steamApiKey||'').trim();
  if(!/^\d{17}$/.test(id))throw Error('请填写 17 位 SteamID64。');
  if(!key)throw Error('同步时长需要 Steam Web API Key；只填写 SteamID64 无法调用 Steam 时长接口。基本游戏搜索不需要 Key。');
  const account=id+'|'+key;
  if(!force&&cache?.account===account&&now()-cache.at<300000)return cache.result;
  if(pending?.account===account)return pending.promise;
  const promise=(async()=>{
   const url=new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
   url.search=new URLSearchParams({key,steamid:id,include_appinfo:'false',include_played_free_games:'true',format:'json'});
   const payload=await json(url.href,12000);
   if(!payload)throw Error('Steam 时长请求失败，请检查网络和 API Key 是否有效。');
   const response=payload.response;
   if(!response||!Array.isArray(response.games)&&response.game_count!==0)throw Error('Steam 未返回可见的游戏时长。请检查 SteamID64，并在 Steam 隐私设置中公开“游戏详情”，取消隐藏总游戏时间。');
   const hours={};for(const game of response.games||[])if(/^\d+$/.test(String(game.appid))&&Number.isFinite(Number(game.playtime_forever))&&Number(game.playtime_forever)>=0)hours[String(game.appid)]=Math.round(Number(game.playtime_forever)/6)/10;
   const result={hours,syncedAt:new Date(now()).toISOString()};cache={account,at:now(),result};return result;
  })();pending={account,promise};try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
 }
 return {sync,async hours(appid){try{return (await sync()).hours[String(appid)]??null;}catch{return null;}}};
}
module.exports={createSteamPlaytime};
