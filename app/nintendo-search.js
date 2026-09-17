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
  return async function nintendo(query,emit,terms=[query]) {
    const records=new Map();let successes=0,failures=0;
    const publish=batch=>{for(const entry of batch)if(entry.storeUrl&&relevance(entry,terms)>0&&!exclude(entry.name))records.set(entry.id,entry);emit([...records.values()]);};
    await Promise.all([
      (async()=>{try{
        for(let page=1;page<=10;page++){
          const data=await json('https://www.nintendo.com/hk/api/search?'+new URLSearchParams({k:query,directory:'software',size:'100',p:String(page)}),7500);
          if(!Array.isArray(data?.items)){const html=await text('https://www.nintendo.com/hk/search?k='+encodeURIComponent(query),7500);const entries=flightRecords(html);if(!entries.length&&!html)throw Error('Nintendo 香港搜索不可用');publish(entries.map(hkRow));successes++;break;}
          successes++;publish(data.items.filter(v=>/Switch/i.test(v.hardwareCategory)).map(hkRow));if(!data.more||!data.items.length)break;
          if(page===10)failures++;
        }
      }catch{Runtime.check();failures++;}})(),
      (async()=>{try{
        for(let start=0;start<500;start+=100){
          const data=await json('https://searching.nintendo-europe.com/en/select?'+new URLSearchParams({fq:'type:GAME',q:query,rows:'100',start:String(start),wt:'json'}),7500);
          if(!Array.isArray(data?.response?.docs))throw Error('Nintendo 欧洲目录不可用');successes++;
          publish(data.response.docs.filter(v=>arr(v.system_names_txt).some(s=>/Nintendo Switch/i.test(s))).map(euRow));
          if(start+100>=data.response.numFound)break;if(start===400)failures++;
        }
      }catch{Runtime.check();failures++;}})(),
      (async()=>{try{
        for(let page=1;page<=5;page++){
          const data=await json('https://search.nintendo.jp/nintendo_soft/search.json?'+new URLSearchParams({q:query,opt_hard:'1_HAC',opt_sshow:'1',limit:'100',page:String(page)}),7500);
          if(!Array.isArray(data?.result?.items))throw Error('Nintendo 日本目录不可用');successes++;
          publish(data.result.items.filter(v=>v.nsuid&&v.hard==='1_HAC'&&!/DLC|AOC|TRIAL|UPGRADE/i.test(v.sform||'')).map(jpRow));
          if(page*100>=data.result.total||!data.result.items.length)break;if(page===5)failures++;
        }
      }catch{Runtime.check();failures++;}})()
    ]);
    if(!successes)throw Error('Nintendo 公开目录暂不可用');
    // Preserve regional links while avoiding duplicate rows for the same title
    // and publisher. Editions/remakes have distinct titles and are not collapsed.
    const grouped=new Map();for(const entry of records.values()){
      const key=clean(entry.name).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')+'|'+clean(entry.publisher).toLowerCase();
      const old=grouped.get(key);if(!old){grouped.set(key,entry);continue;}
      const [base,extra]=entry.storeRegion==='香港'?[entry,old]:[old,entry];grouped.set(key,{...extra,...base,description:base.description||extra.description,genres:base.genres.length?base.genres:extra.genres,regionalLinks:{...extra.regionalLinks,...base.regionalLinks},storeRegion:[...new Set([base.storeRegion,extra.storeRegion])].join(' / ')});
    }
    const selected=[...grouped.values()].sort((a,b)=>relevance(b,terms)-relevance(a,terms));emit(selected);
    const completed=new Map(selected.map(v=>[v.id,v]));
    await parallel(selected,async entry=>{const page=await text(entry.storeUrl,6000);const result={...await detail(entry,page),detailsUnavailable:!page&&!entry.description||failures>0};completed.set(result.id,result);emit([...completed.values()]);return result;});
    return [...completed.values()];
  };
}
module.exports={createNintendoSearch,flightRecords,hkRow,euRow,jpRow};
