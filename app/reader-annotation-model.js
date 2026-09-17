/* Stable annotation records. Appearance and content are independent facets. */
(function(root){
 const colours=['#d8b957','#74b69a','#79a9d0','#ba98cc','#d894a4','#d5a075'];
 const clean=text=>String(text||'').replace(/\u00ad/g,'').replace(/([A-Za-z])-\r?\n(?=[a-z])/g,'$1').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/([^\n])\n(?=[^\n])/g,'$1 ').replace(/\n{3,}/g,'\n\n').trim();
 const hash=value=>{let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(36);};
 const key=segment=>JSON.stringify([segment.member,segment.position,segment.quote]);
 function migrate(marks,source){return (marks||[]).map((mark,index)=>{if(mark.kind==='annotation'||!mark.annotation&&!mark.note&&!mark.quote)return mark;return {...mark,kind:'annotation',version:1,id:mark.id||'legacy-'+hash(JSON.stringify([mark.member,mark.position,mark.quote,mark.note])),source:mark.source||source,createdAt:mark.createdAt||source.createdAt||null,updatedAt:mark.updatedAt||null,excerpt:!!mark.quote,segments:mark.segments||[{member:mark.member,position:mark.position||{},quote:mark.quote||'',chapter:mark.label||'原笔记位置'}],quote:mark.quote||'',note:mark.note||'',highlight:mark.annotation==='highlight'?{color:colours[0]}:null,underline:mark.annotation==='underline'?{color:colours[0],style:'solid'}:null,tags:mark.tags||[],legacy:true};});}
 function create(segments,source,id){const copy=structuredClone(segments),now=new Date().toISOString();return {kind:'annotation',version:1,id,source,createdAt:now,updatedAt:now,member:copy[0]?.member,position:copy[0]?.position||{},segments:copy,quote:copy.map(s=>clean(s.quote)).join('\n\n'),excerpt:false,note:'',translation:null,tags:[],highlight:null,underline:null};}
 function append(current,next){const result=[...current],seen=new Set(result.map(key));for(const s of next)if(!seen.has(key(s))){result.push(s);seen.add(key(s));}return result;}
 const api={colours,clean,key,migrate,create,append};if(typeof module!=='undefined')module.exports=api;root.ReaderAnnotationModel=api;
})(typeof window==='undefined'?globalThis:window);
