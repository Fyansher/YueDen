/* Shared by the main process and overview. Manual values, including zero, win. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.UsageModel=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 const types=['game','movie','anime','manga','book','audio'];
 const number=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
 const present=v=>v!==null&&v!==undefined&&v!=='';
 function fill(item,records){if(!['book','manga'].includes(item.type)||item.playtimeSource==='手动'||present(item.playtime)&&item.playtimeSource!=='本机记录')return item;const seconds=number(records?.[item.id]?.seconds);return seconds>0?{...item,playtime:Math.round(seconds/360)/10,playtimeSource:'本机记录'}:item;}
 function hours(item,records){const local=number(records?.[item.id]?.seconds)/3600;return item.playtimeSource==='本机记录'&&records?.[item.id]?local:Math.max(number(item.playtime),local);}
 function recent(item,records){const record=records?.[item.id]||{};return Math.max(Date.parse(record.openedAt||record.lastOpenedAt||'')||0,Date.parse(record.lastUsedAt||'')||0);}
 function groups(items,records){return types.map(type=>({type,hours:items.filter(i=>i.type===type).reduce((n,i)=>n+hours(i,records),0)}));}
 function rankings(items,records,type){const rows=items.filter(i=>i.type===type).map(item=>({item,hours:hours(item,records),recent:recent(item,records)}));return {recent:rows.filter(r=>r.recent>0).sort((a,b)=>b.recent-a.recent||a.item.id.localeCompare(b.item.id)).slice(0,5),longest:rows.filter(r=>r.hours>0).sort((a,b)=>b.hours-a.hours||b.recent-a.recent||a.item.id.localeCompare(b.item.id)).slice(0,5)};}
 return {types,fill,hours,groups,rankings};
});
