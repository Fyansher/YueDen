/* Public Nintendo search, not a featured-games page. Region is retained on
   candidates; cataloguing an overseas game does not imply local availability. */
const Text=require('./metadata-text'),Runtime=require('./metadata-runtime');
const arr=v=>Array.isArray(v)?v:[],clean=v=>Text.text(v||'');
function flightRecords(html) {
  const records=[];
  const walk=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>45)return;if(v.title&&v.hardwareCategory&&(v.link||v.pageLink||v.nsuid))records.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x,depth+1);};
  for(const m of String(html).matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)){try{for(const line of JSON.parse(m[1])[1].split('\n')){try{walk(JSON.parse(line.slice(line.indexOf(':')+1)));}catch{}}}catch{}}
  return [...new Map(records.map(v=>[v.nsuid||v.link,v])).values()];
}
const absolute=(url,base='https://www.nintendo.com')=>{try{const v=new URL(url,base);return v.protocol==='https:'?v.href:'';}catch{return '';}};
function hkRow(v) {
  const image=v.imageHeroOrg||v.imageHero?.url||'',link=v.pageLinkCustom||v.link||v.pageLink||'';
  return {id:'ns-'+(v.nsuid||v.softCode||link),name:clean(v.title),cover:image,coverLandscape:image,publisher:clean(v.publisher),developer:clean(v.developer),releaseDate:(v.releaseDate||'').slice(0,10),storeUrl:absolute(link.replace(/\{NSUID\}/g,v.nsuid||'')),storeRegion:'香港',regionalLinks:{HK:absolute(link.replace(/\{NSUID\}/g,v.nsuid||''))},platforms:['ns'],genres:[]};
}
function euRow(v) {
  const image=v.image_url_h2x1_s||v.image_url||'';
  return {id:'ns-eu-'+v.fs_id,name:clean(v.title),aliases:arr(v.title_extras_txt),cover:image,coverLandscape:image,coverPortrait:v.image_url_sq_s||v.image_url||'',publisher:clean(v.publisher),developer:clean(v.developer),releaseDate:(v.date_from||v.dates_released_dts?.[0]||'').slice(0,10),description:clean(v.product_catalog_description_s||v.excerpt),storeUrl:absolute(v.url),storeRegion:'欧洲',regionalLinks:{EU:absolute(v.url)},platforms:['ns'],genres:arr(v.pretty_game_categories_txt).map(g=>({Adventure:'冒险',Action:'动作',RPG:'RPG',Puzzle:'解谜',Simulation:'模拟',Strategy:'策略'})[g]||g)};
}
function jpRow(v) {
  const image=v.iurl?(/^https:/.test(v.iurl)?v.iurl:'https://img-eshop.cdn.nintendo.net/i/'+v.iurl+'.jpg'):'',url=absolute(v.url||'https://store-jp.nintendo.com/item/software/D'+v.nsuid);
  const date=String(v.sdate||'').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  return {id:'ns-jp-'+v.nsuid,name:clean(v.title),aliases:[v.titlek].filter(Boolean),cover:image,coverLandscape:image,publisher:clean(v.maker),releaseDate:date?date[1]+'-'+date[2].padStart(2,'0')+'-'+date[3].padStart(2,'0'):'',description:clean(v.text),storeUrl:url,storeRegion:'日本',regionalLinks:{JP:url},platforms:['ns'],genres:arr(v.genre).map(g=>({'アドベンチャー':'冒险','ロールプレイング':'RPG','アクション':'动作','パズル':'解谜','シミュレーション':'模拟','シューティング':'射击'})[g]||g)};
}
function createNintendoSearch({json,text,parallel,detail,relevance,exclude}) {
  async function nintendo(query,emit,terms=[query]) {
    const records=new Map();let successes=0;
    const publish=batch=>{for(const entry of batch||[])if(entry.storeUrl&&relevance(entry,terms)>0&&!exclude(entry.name))records.set(entry.id,entry);emit([...records.values()]);};
    const enough=()=>{const scores=[...records.values()].map(entry=>relevance(entry,terms));return scores.some(score=>score>=150)||scores.filter(score=>score>=80).length>=3;};
    try{const data=await json('https://www.nintendo.com/hk/api/search?'+new URLSearchParams({k:query,directory:'software',size:'50',p:'1'}),7500);if(Array.isArray(data?.items)){successes++;publish(data.items.filter(v=>/Switch/i.test(v.hardwareCategory)).map(hkRow));}else{const html=await text('https://www.nintendo.com/hk/search?k='+encodeURIComponent(query),7500);if(html){successes++;publish(flightRecords(html).map(hkRow));}}}catch{Runtime.check();}
    if(!enough())try{const data=await json('https://searching.nintendo-europe.com/en/select?'+new URLSearchParams({fq:'type:GAME',q:query,rows:'50',start:'0',wt:'json'}),7500);if(Array.isArray(data?.response?.docs)){successes++;publish(data.response.docs.filter(v=>arr(v.system_names_txt).some(s=>/Nintendo Switch/i.test(s))).map(euRow));}}catch{Runtime.check();}
    if(!enough())try{const data=await json('https://search.nintendo.jp/nintendo_soft/search.json?'+new URLSearchParams({q:query,opt_hard:'1_HAC',opt_sshow:'1',limit:'50',page:'1'}),7500);if(Array.isArray(data?.result?.items)){successes++;publish(data.result.items.filter(v=>v.nsuid&&v.hard==='1_HAC'&&!/DLC|AOC|TRIAL|UPGRADE/i.test(v.sform||'')).map(jpRow));}}catch{Runtime.check();}
    if(!successes)throw Error('Nintendo 公开目录暂不可用');
    const grouped=new Map();for(const entry of records.values()){
      const key=clean(entry.name).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')+'|'+clean(entry.publisher).toLowerCase();
      const old=grouped.get(key);if(!old){grouped.set(key,entry);continue;}
      const [base,extra]=entry.storeRegion==='香港'?[entry,old]:[old,entry];grouped.set(key,{...extra,...base,description:base.description||extra.description,genres:base.genres.length?base.genres:extra.genres,regionalLinks:{...extra.regionalLinks,...base.regionalLinks},storeRegion:[...new Set([base.storeRegion,extra.storeRegion])].join(' / ')});
    }
    const selected=[...grouped.values()].sort((a,b)=>relevance(b,terms)-relevance(a,terms)).slice(0,40);emit(selected);return selected;
  }
  nintendo.resolve=async candidate=>{let url;try{url=new URL(candidate.storeUrl);if(url.protocol!=='https:'||!/(?:^|\.)nintendo\.com$|(?:^|\.)nintendo-europe\.com$/i.test(url.hostname))return candidate;}catch{return candidate;}const page=await text(url.href,6000);return page?detail(candidate,page):candidate;};
  return nintendo;
}
module.exports={createNintendoSearch,flightRecords,hkRow,euRow,jpRow};
