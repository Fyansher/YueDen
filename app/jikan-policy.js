/* Brief circuit breaker for a known upstream outage, no mirror fallback. */
function create({now=Date.now,cooldown=30000}={}){let until=0,lastStatus=503;const applies=url=>new URL(url).hostname==='api.jikan.moe';return {blocked(url){return applies(url)&&now()<until?lastStatus:0},observe(url,status){if(!applies(url))return;if(status>=500){until=now()+cooldown;lastStatus=status;}else if(status>=200&&status<300)until=0;}};}
module.exports={create,...create()};
