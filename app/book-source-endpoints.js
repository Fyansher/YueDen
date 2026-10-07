const fs=require('node:fs');
const path=require('node:path');
const H=require('./metadata-html');
const Locations=require('./metadata-source-locations');

const DIRECTORY='https://znew.pages.dev/';
const SEEDS={
  official:['https://zh.1lib.sk/','https://z-library.sk/','https://zh.z-lib.gd/','https://z-lib.fm/'],
  mirror:['https://zh.zlib.bz/','https://z.wwwnav.com/','https://zz.sodanav.com/','https://z.2rdh.com/'],
};
const safeOrigin=value=>{const url=Locations.safeUrl(value);return url?url.origin+'/':'';};
function sectionLinks(card,kind){
  const title=H.text(H.blocks(card,'div',attrs=>/(?:^|\s)card-title(?:\s|$)/.test(attrs.class||''))[0]?.body||'');
  if(kind==='official'?!/官网入口/i.test(title):!/镜像入口/i.test(title))return [];
  const area=H.blocks(card,'div',attrs=>/(?:^|\s)url-list(?:\s|$)/.test(attrs.class||''))[0]?.body||card;
  const links=H.blocks(area,'a',attrs=>/(?:^|\s)item(?:\s|$)/.test(attrs.class||''));
  const result=[];
  for(const link of links){
    const label=H.text(H.blocks(link.body,'span',attrs=>/(?:^|\s)item-name(?:\s|$)/.test(attrs.class||''))[0]?.body||link.body);
    if(kind==='official'?!/官网入口/i.test(label):!/镜像(?:网站)?入口/i.test(label))continue;
    const origin=safeOrigin(link.attrs.href);if(origin&&!result.includes(origin))result.push(origin);
    if(result.length===3)break;
  }
  return result;
}
function parseDirectory(html){
  const groups={official:[],mirror:[]};
  for(const card of H.blocks(String(html||''),'div',attrs=>/(?:^|\s)card(?:\s|$)/.test(attrs.class||''))){
    for(const kind of Object.keys(groups))groups[kind].push(...sectionLinks(card.body,kind));
  }
  for(const kind of Object.keys(groups))groups[kind]=[...new Set(groups[kind])].slice(0,3);
  return groups;
}
function create({file,fetchText,now=()=>Date.now(),refreshIntervalMs=12*60*60*1000}){
  let saved=null,pending=null;
  const filePath=()=>typeof file==='function'?file():file;
  function load(){
    if(saved)return saved;
    try{const value=JSON.parse(fs.readFileSync(filePath(),'utf8'));if(value?.version===1&&value.groups)saved={updatedAt:Number(value.updatedAt)||0,groups:{official:value.groups.official.map(safeOrigin).filter(Boolean),mirror:value.groups.mirror.map(safeOrigin).filter(Boolean)}};}catch{}
    return saved;
  }
  function persist(value){try{const target=filePath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify({version:1,...value},null,2),'utf8');}catch{}}
  async function refresh(force=false){
    const current=load();if(!force&&current&&now()-current.updatedAt<refreshIntervalMs)return current.groups;
    if(pending)return pending;
    pending=(async()=>{try{
      const html=await fetchText(DIRECTORY,6500);if(!html||String(html).length>700000)return current?.groups||null;
      const groups=parseDirectory(html);if(!groups.official.length&&!groups.mirror.length)return current?.groups||null;
      saved={updatedAt:now(),groups:{official:[...new Set([...groups.official,...SEEDS.official])].slice(0,6),mirror:[...new Set([...groups.mirror,...SEEDS.mirror])].slice(0,6)}};persist(saved);return saved.groups;
    }catch{return current?.groups||null;}finally{pending=null;}})();
    return pending;
  }
  function candidates(sourceId,active=''){
    const groups=load()?.groups||{};const own=sourceId==='onelib'?'official':'mirror',other=own==='official'?'mirror':'official';
    const current=Locations.safeUrl(active)?.href||'',origins=new Set(current?[new URL(current).origin]:[]),result=current?[current]:[];
    for(const value of [...(groups[own]||[]),...SEEDS[own],...(groups[other]||[]),...SEEDS[other]]){const origin=safeOrigin(value);if(origin&&!origins.has(new URL(origin).origin)){origins.add(new URL(origin).origin);result.push(origin);}}
    return result;
  }
  return {refresh,candidates,parseDirectory,seedGroups:()=>structuredClone(SEEDS)};
}
module.exports={DIRECTORY,SEEDS,parseDirectory,create};
