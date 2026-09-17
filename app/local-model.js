/* Shared identity/grouping rules. Never group numbered games into one card. */
(function(root){
 const types=['audio','game','software','movie','anime','manga','book','document','unknown_application','unknown_collection','other'],video=/\.(mp4|webm|mkv|m4v|mov|avi|wmv|flv|mpg|mpeg|vob|m2ts|mts|ts|m3u8|mpd)$/i,images=/\.(jpe?g|png|webp|gif|bmp|avif)$/i,books=/\.(epub|pdf|txt|md|markdown|mobi|azw3|azw|prc)$/i;
 const pathKey=p=>String(p||'').replace(/^file:\/\//i,'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 const base=p=>String(p).replace(/\\/g,'/').split('/').pop()||'',stem=p=>base(p).replace(/\.[^.]+$/,'');
 const natural=(a,b)=>String(a).localeCompare(String(b),'zh',{numeric:true,sensitivity:'base'});
 function roman(s){const nums={I:1,V:5,X:10,L:50,C:100};let n=0;for(let i=0;i<s.length;i++)n+=(nums[s[i]]||0)<(nums[s[i+1]]||0)?-nums[s[i]]:nums[s[i]];return n;}
 function canonical(name){let s=String(name||'').normalize('NFKC').toLowerCase().replace(/\bfinal\s*fantasy\s*([ivxlc]+)\b/gi,(_,n)=>'最终幻想'+roman(n.toUpperCase())).replace(/\bfinal\s*fantasy\s*/gi,'最终幻想').replace(/^ff\s*(\d+)/i,'最终幻想$1').replace(/最终幻想\s*/g,'最终幻想').replace(/怪猎世界|怪獵世界|monster hunter world/gi,'怪物猎人世界').replace(/factorio/gi,'异星工厂');
  return s.replace(/windows edition|world machine edition|完整版|中文版|简体中文|繁体中文/gi,'').replace(/[^\p{L}\p{N}]/gu,'');
 }
 function cleanTitle(value){
  let name=String(value||'').normalize('NFKC');
  // A leading bracket may contain the actual title, not a release-group name.
  const enclosed=name.match(/^[\[【]([^\]】]+)[\]】]\s*(.*)$/);
  if(enclosed&&/^(?:(?:卷|册|冊|第|vol|chapter|ch|part|ep|s\d)[\s\S]*|\d*|)$/i.test(enclosed[2]))name=enclosed[1]+' '+enclosed[2];
  else name=name.replace(/\[[^\]]*\]|【[^】]*】/g,' ');
  name=name.replace(/[（(](?:全彩版|全彩|彩色版|黑白版|扫描版|掃描版|高清版|电子版|電子版|Z[ -]?Library|zlib|Anna.?s? Archive|安娜的档案|分析师[^)）]*|作者[：: ][^)）]*|译者[：: ][^)）]*)[）)]/gi,' ');
  return name.replace(/[._]+/g,' ').replace(/\b(?:2160p|1080p|720p|480p|BluRay|WEB.?DL|x26[45]|HEVC|H264|H265|CHS|CHT|GB|BIG5)\b/gi,' ').replace(/\s+/g,' ').trim();
 }
 function titleInfo(file,type,parent=''){
  let name=cleanTitle(stem(file));
  let season=null,episode=null,volume=null;
  if(type!=='game'){
   const se=name.match(/\bS(\d{1,2})\s*E(\d{1,4})\b/i);if(se){season=Number(se[1]);episode=Number(se[2]);name=name.replace(se[0],' ');}
   name=name.replace(/第\s*([\d一二三四五六七八九十]+)\s*季/g,(_,v)=>{season=/^\d+$/.test(v)?Number(v):v;return ' ';});
   const ep=name.match(/(?:第\s*(\d+)\s*[集话話回卷册冊部]|\b(?:EP?|episode|vol(?:ume)?|part)\s*[-.]?\s*(\d+)\b|[卷册冊]\s*(\d+))/i);
   if(ep){(type==='book'||type==='manga')?volume=Number(ep[1]||ep[2]||ep[3]):episode=Number(ep[1]||ep[2]||ep[3]);name=name.replace(ep[0],' ');}
   const tail=name.match(/(?:\s+-?\s*|[（(])(\d{1,3})[）)]?\s*$/)||(['book','manga'].includes(type)?name.match(/(?<=[\p{Script=Han}])(\d{1,2})$/u):null);if(tail&&!episode&&!volume){(type==='book'||type==='manga')?volume=Number(tail[1]):episode=Number(tail[1]);name=name.slice(0,tail.index);}
   if(/^\d{1,4}$/.test(name)&&!episode&&!volume){(type==='book'||type==='manga')?volume=Number(name):episode=Number(name);}if(/^\d{1,4}$/.test(name)||!name)name=base(parent).replace(/(?:第[\d一二三四五六七八九十]+季|season\s*\d+|S\d+)$/i,'').trim()||stem(file);
  }
  return {name:name.replace(/\s*[-–—]+\s*$/,'').trim()||stem(file),season,episode,volume};
 }
 function detectedType(file,hint){if(/\.(exe|appref-ms)$/i.test(file))return 'game';if(video.test(file))return hint==='anime'?'anime':'movie';if(images.test(file)||/\.(cbz|zip)$/i.test(file))return 'manga';if(books.test(file))return 'book';return null;}
 const members=item=>(Array.isArray(item.localFiles)&&item.localFiles.length?item.localFiles:item.localPath?[{path:item.localPath,name:base(item.localPath)}]:[]);
 function same(a,b){return (typeof module!=='undefined'?require('./resource-identity'):root.ResourceIdentity).compare(a,b).status==='match';}
 function mergeFiles(a,b){const out=new Map();for(const f of [...a,...b])if(f?.path&&!out.has(pathKey(f.path)))out.set(pathKey(f.path),f);return [...out.values()].sort((x,y)=>(Number(x.season)||0)-(Number(y.season)||0)||natural(x.name||x.path,y.name||y.path));}
 function fillMissing(current,candidate){const next={...current};for(const key of ['playtime','steamPlaytime','playtimeSource','name','originalName','aliases','identifiers','cover','coverPortrait','coverLandscape','description','developer','publisher','genres','releaseDate','steamAppId','externalRating','ratingSource','ratingValue','ratingMax','cast','episodes','isbn','pages','translator','storeUrl','metadataSource','fieldSources','networkCovers','platforms','platformLinks']){
   if(key==='platforms'&&current.platformsManual)continue;
   if(['playtime','steamPlaytime','playtimeSource'].includes(key)&&current.type!=='game')continue;
   if(key==='playtimeSource'&&current.playtime!=null&&current.playtime!==''&&current.playtime!==candidate.playtime)continue;
   if(['ratingSource','ratingValue','ratingMax'].includes(key)&&current.externalRating&&current.externalRating!==candidate.externalRating)continue;
   const empty=v=>v==null||v===''||Array.isArray(v)&&!v.length||typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length;
   if(empty(next[key])&&!empty(candidate[key]))next[key]=candidate[key];
  }return next;
 }
 function searchName(name){return cleanTitle(String(name||'').replace(/\.(exe|appref-ms)$/i,'')).replace(/\.(exe|appref-ms)$/i,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[._]+/g,' ').replace(/\s*\[([^\]]*(?:x64|x86|build|repack|rip|中文|汉化|1080p|720p)[^\]]*)\]\s*/gi,' ').replace(/\s*\(?\b(?:v(?:er(?:sion)?)?\s*\d+(?:[ .]\d+)+|build\s*\d+|x64|x86|win64|win32)\b\)?\s*$/gi,'').replace(/\s+/g,' ').trim();}
 function oneEdit(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length===b.length){if(a[i]===b[j+1]&&a[i+1]===b[j]){i+=2;j+=2;}else{i++;j++;}}else if(a.length>b.length)i++;else j++;}return edits+(i<a.length||j<b.length?1:0)<=1;}
 function matchConfidence(name,candidate){
  const values=[candidate.name,candidate.originalName,...candidate.aliases||[]].filter(Boolean);
  // A source often writes its translated title followed by the official original in parentheses.
  const originals=values.flatMap(value=>[...String(value).matchAll(/[（(]([^()（）]+)[）)]/g)].map(m=>m[1]).filter(value=>/[a-z]{3}/i.test(value)&&!/^(?:demo|dlc|windows|pc|x64|repack|中文版)$/i.test(value)));
  const a=canonical(searchName(name)),names=[...values,...originals].map(n=>({raw:searchName(n),key:canonical(searchName(n))}));
  if(!a||a.length<2)return 0;if(names.some(n=>n.key===a))return 1;
  const digits=s=>(s.match(/\d+/g)||[]).join(',');let score=0;
  for(const n of names){if(digits(a)!==digits(n.key))continue;
   if(a.length>=6&&/^[a-z\d]+$/.test(a)&&/^[a-z\d]+$/.test(n.key)&&oneEdit(a,n.key))score=Math.max(score,.94);
   const subtitle=n.raw.split(/[:：–—]/)[0];if(a.length>=5&&canonical(subtitle)===a)score=Math.max(score,.97);
   if(a.length>=5&&n.key.startsWith(a)&&n.key.length-a.length<5)score=Math.max(score,.82);
  }return score;
 }
 function preferredCandidates(type,bundle){if(Array.isArray(bundle))return bundle;const steam=bundle.sources?.find(s=>s.id==='steam')?.items||[];return type==='game'&&steam.length?steam:bundle.integrated||[];}
 function automaticCandidate(name,type,bundle){
  const items=preferredCandidates(type,bundle),ranked=items.map(candidate=>({candidate,score:matchConfidence(name,candidate)})).sort((a,b)=>b.score-a.score),best=ranked[0];if(!best||best.score<.94)return null;
  const identity=c=>c.steamAppId?'steam:'+c.steamAppId:c.isbn?'isbn:'+c.isbn:c.id?String(c.id):canonical(c.name)+'|'+(c.releaseDate||'')+'|'+(c.developer||'');
  if(ranked.slice(1).some(other=>other.score>=best.score-.03&&identity(other.candidate)!==identity(best.candidate)))return null;
  return best.candidate;
 }

 const api={types,video,images,books,pathKey,base,stem,natural,canonical,cleanTitle,titleInfo,detectedType,members,same,mergeFiles,fillMissing,searchName,matchConfidence,preferredCandidates,automaticCandidate};if(typeof module!=='undefined')module.exports=api;else root.LocalModel=api;
})(typeof window!=='undefined'?window:globalThis);
