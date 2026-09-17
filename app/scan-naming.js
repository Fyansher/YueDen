const path=require('node:path');
const splitCamel=value=>String(value||'').replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2').replace(/([a-z\d])([A-Z])/g,'$1 $2');
function parse(raw){
 let display=String(raw||'').normalize('NFKC').trim();const codeHints=[],versionTags=[];
 display=display.replace(/^\[([A-Za-z]{1,12}\d{1,6})\]\s*/,(_,v)=>{codeHints.push(v);return '';});
 display=display.replace(/[（(]((?:汉化|漢化|中文|全彩|黑白|扫描|掃描|电子|電子|高清)版|[vV]\d+(?:\.\d+)+|x64|x86|Z[ -]?Library|分析师[^)）]*|作者[：: ][^)）]*)[）)]/g,(_,v)=>{versionTags.push(v);return '';});
 let volume=null;const enclosed=display.match(/^[\[【]([^\]】]+)[\]】]\s*((?:卷|册|冊|vol)\s*\d+)$/i);if(enclosed)display=enclosed[1]+' '+enclosed[2];
 display=display.replace(/(?:第\s*(\d+)\s*[卷册冊]|(?:卷|册|冊|\bvol(?:ume)?\s*)\s*(\d+))$/i,(_,a,b)=>{volume=Number(a||b);return '';});
 return {displayTitle:splitCamel(display).replace(/\s+/g,' ').trim()||String(raw),codeHints,versionTags,volume};
}
function naming(file,{packageRoot,metadata={},rule}={}){
 const rawPathName=path.basename(file),rawDirectoryName=path.basename(packageRoot||path.dirname(file)),stem=path.basename(file,path.extname(file)),application=/\.exe$/i.test(file);
 const raw=metadata.originalCollectionName|| (application?rawDirectoryName:stem),parts=parse(raw),product=String(metadata.productName||'').trim();
 let displayTitle=metadata.title||(application&&require('./application-identity').product(product)?product:parts.displayTitle),confidence=metadata.title?.length? .96:application&&displayTitle===product?.trim()? .9:application?.45:.68,source=metadata.title?'embedded-title':application&&displayTitle===product?'pe-product':'original-path';
 const placeholder=v=>String(v||'').match(/^(?:steam[ _:-]*)?appid[ _:-]*(\d+)$/i),hint=[metadata.title,product,rawDirectoryName,stem].map(placeholder).find(Boolean),platformHints=hint?{steam:hint[1]}:{};
 if(placeholder(displayTitle)){displayTitle=[parts.displayTitle,stem].find(v=>!placeholder(v)&&require('./application-identity').product(v))||'未命名资源'+(hint?'（Steam ID：'+hint[1]+'）':'');confidence=.45;source='readable-path-fallback';}
 if(rule?.title){displayTitle=rule.title;confidence=1;source=rule.id;}
 return {...parts,seriesTitle:parts.volume!=null?parts.displayTitle:'',rawPathName,rawDirectoryName,originalPath:file,displayTitle,platformHints,confidence,source,candidates:[...new Set([displayTitle,product,stem,rawDirectoryName].filter(Boolean))]};
}
function scopedRules(rules,root,file,metadata){return (rules||[]).filter(rule=>{
 if(!rule.verified||!rule.scope||!rule.source)return false;const rel=path.relative(path.resolve(rule.scope),root);if(rel.startsWith('..')||path.isAbsolute(rel))return false;
 if(rule.entry&&path.basename(file).toLowerCase()!==String(rule.entry).toLowerCase())return false;
 if(rule.productName&&metadata.productName!==rule.productName)return false;
 if(rule.productId&&metadata.identifiers?.[rule.productId.source]!==rule.productId.value)return false;
 return Boolean(rule.entry||rule.productName||rule.productId);
 });}
module.exports={parse,naming,scopedRules,splitCamel};
