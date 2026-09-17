(function(root){
 function range(order,anchor,end){const a=order.indexOf(anchor),b=order.indexOf(end);return a<0||b<0?[]:order.slice(Math.min(a,b),Math.max(a,b)+1);}
 function apply(order,anchor,end,base=[],selected=true){const next=new Set(base);for(const id of range(order,anchor,end))selected?next.add(id):next.delete(id);return next;}
 const api={range,apply};if(typeof module!=='undefined')module.exports=api;else root.SelectionRange=api;
})(typeof window!=='undefined'?window:globalThis);
