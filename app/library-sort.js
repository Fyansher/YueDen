(function(root){
 const fields={custom:'自定义排序',name:'名称',createdAt:'添加时间',updatedAt:'更新时间',rating:'个人评分',releaseDate:'发行日期',lastOpenedAt:'最近打开'};
 const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
 function normalize(v){return {field:Object.hasOwn(fields,v?.field)?v.field:'custom',direction:v?.direction==='desc'?'desc':'asc',manual:v?.manual===true};}
 function value(item,field){if(field==='name')return item.name?.trim()||null;if(field==='custom')return Number.isFinite(item.sortOrder)?item.sortOrder:null;const v=item[field];if(v==null||v==='')return null;if(field==='rating')return Number.isFinite(Number(v))?Number(v):null;const n=Date.parse(v);return Number.isFinite(n)?n:null;}
 function compare(a,b,pref){const p=normalize(pref);if(p.manual){p.field='custom';p.direction='asc';}const av=value(a,p.field),bv=value(b,p.field);if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;const primary=av==null?0:typeof av==='string'?collator.compare(av,bv):av-bv;return primary*(p.direction==='desc'?-1:1)||(p.field==='custom'?0:collator.compare(String(a.id||''),String(b.id||'')));}
 const api={fields,normalize,compare,sort:(items,pref)=>[...items].sort((a,b)=>compare(a,b,pref))};if(typeof module!=='undefined')module.exports=api;else root.LibrarySort=api;
})(typeof window==='undefined'?globalThis:window);
