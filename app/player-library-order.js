/* Presentation order only. Stable references stay in the original library. */
(function(root){
 const views=['songs','playlists','asmr','radio','other','movie','anime'];
 const scope=(view,groupId=null)=>JSON.stringify([view,groupId]);
 function tracks(rows){const counts=new Map();return rows.map(row=>{const key=JSON.stringify([row.ref.itemId,row.ref.trackId??row.ref.file]),n=counts.get(key)||0;counts.set(key,n+1);return {...row,orderId:JSON.stringify([row.ref.itemId,row.ref.trackId??row.ref.file,n])};});}
 function apply(rows,ids,key){if(!Array.isArray(ids))return rows;const ranks=new Map(ids.map((id,i)=>[id,i]));return [...rows].sort((a,b)=>(ranks.get(key(a))??Infinity)-(ranks.get(key(b))??Infinity));}
 function ids(groups,view,groupId=null){if(!views.includes(view))throw Error('该分类不支持拖动排序');if(view==='songs'){if(groupId!==null)throw Error('排序范围无效');return tracks(groups.flatMap(g=>g.tracks)).map(t=>t.orderId);}if(groupId!==null){const group=groups.find(g=>g.id===groupId);if(!group)throw Error('合集已变化');return tracks(group.tracks).map(t=>t.orderId);}if(view==='playlists')throw Error('请先选择歌单');return groups.map(g=>g.id);}
 function validate(groups,view,groupId,order){const expected=ids(groups,view,groupId),allowed=new Set(expected);if(!Array.isArray(order)||order.length!==expected.length||new Set(order).size!==order.length||order.some(id=>!allowed.has(id)))throw Error('列表已变化，请重新排序');return [...order];}
 const api={scope,tracks,apply,ids,validate};if(typeof module==='object')module.exports=api;else root.PlayerLibraryOrder=api;
})(globalThis);
