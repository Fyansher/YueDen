(()=>{window.installQueueReorder=(host,commit,onError)=>{
 let drag=null;const events=new AbortController(),nodes=()=>[...host.children].filter(n=>n.dataset.id),ids=()=>nodes().map(n=>n.dataset.id);
 const direct=target=>{let node=target instanceof Element?target:null;while(node&&node.parentElement!==host)node=node.parentElement;return node?.dataset.id?node:null;};
 const listen=(target,name,fn)=>target.addEventListener(name,fn,{signal:events.signal});
 function clear(){for(const n of nodes())n.classList.remove('queue-dragging');drag=null;}
 function cancel(){if(!drag)return;const before=drag.before.filter(n=>n.parentElement===host);if(before.length===nodes().length)ReorderMotion.move(host,before);clear();}
 async function save(order,before){try{await commit(order);}catch(error){if(before.every(n=>n.parentElement===host))ReorderMotion.move(host,before);onError(error);}}
 listen(host,'dragstart',e=>{const row=direct(e.target);if(!row||!row.draggable||!e.dataTransfer)return;e.stopPropagation();drag={row,before:nodes()};row.classList.add('queue-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-yueden-queue',row.dataset.id);});
 listen(host,'dragover',e=>{if(!drag||e.dataTransfer?.files.length)return;const target=direct(e.target);if(!target||target===drag.row)return;e.preventDefault();e.stopPropagation();const rect=target.getBoundingClientRect(),ordered=nodes().filter(n=>n!==drag.row),at=ordered.indexOf(target)+(e.clientY>rect.y+rect.height/2?1:0);ordered.splice(at,0,drag.row);ReorderMotion.move(host,ordered,{exclude:[drag.row]});});
 listen(host,'drop',e=>{if(!drag||e.dataTransfer?.files.length)return;e.preventDefault();e.stopPropagation();const before=drag.before,order=ids(),changed=order.some((id,i)=>id!==before[i].dataset.id);clear();if(changed)void save(order,before);});
 listen(host,'dragend',cancel);listen(host,'keydown',e=>{if(e.key==='Escape'){cancel();return;}if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;const row=direct(e.target),before=nodes(),index=before.indexOf(row),next=index+(e.key==='ArrowUp'?-1:1);if(index<0)return;e.preventDefault();e.stopPropagation();if(next<0||next>=before.length)return;const ordered=[...before];[ordered[index],ordered[next]]=[ordered[next],ordered[index]];ReorderMotion.move(host,ordered);row.focus({preventScroll:true});void save(ids(),before);});
 listen(window,'blur',cancel);return {cancel,isDragging:()=>!!drag,destroy(){cancel();events.abort();}};
};})();
