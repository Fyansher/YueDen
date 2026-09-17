/* Additional public catalogues. Only typed works and explicit title aliases
   are accepted. A short Wikidata entity description is NOT a film synopsis. */
const Text=require('./metadata-text'),{score}=require('./game-sources');
const arr=v=>Array.isArray(v)?v:[],unique=v=>[...new Set(v.filter(Boolean))];
const languages=['zh-hans','zh-cn','zh','zh-hant','en','ja'];
const label=e=>languages.map(lang=>e?.labels?.[lang]?.value).find(Boolean)||'';
const claims=(e,p)=>arr(e?.claims?.[p]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value).filter(v=>v!=null);
const ids=(e,p)=>claims(e,p).map(v=>v.id).filter(Boolean);
async function wikidata({get,emit},query){
 const api='https://www.wikidata.org/w/api.php?',request=values=>get(api+new URLSearchParams({format:'json',maxlag:'5',...values}));
 let found=await request({action:'wbsearchentities',search:query,language:/[\u3400-\u9fff]/.test(query)?'zh':'en',uselang:'zh',limit:'8'});
 const keys=arr(found?.search).map(x=>x.id).filter(x=>/^Q\d+$/.test(x));if(!keys.length)return [];
 const entities=async keys=>keys.length?(await request({action:'wbgetentities',ids:unique(keys).slice(0,50).join('|'),props:'labels|aliases|claims',languages:languages.join('|')}))?.entities||{}:{};
 const works=Object.values(await entities(keys)),types=await entities(works.flatMap(e=>ids(e,'P31')));
 const accepted=works.filter(e=>ids(e,'P31').some(id=>id==='Q11424'||/^(television series|anime television series|animated television series|television film|feature film|animated feature film)$/i.test(types[id]?.labels?.en?.value||'')));
 const people=await entities(accepted.flatMap(e=>['P57','P161','P272','P136'].flatMap(p=>ids(e,p))).slice(0,50));
 const result=[];
 for(const e of accepted){
  const names=unique([...Object.values(e.labels||{}).map(l=>l.value),...Object.values(e.aliases||{}).flatMap(a=>arr(a).map(l=>l.value)),...claims(e,'P1476').map(v=>v.text)]);
  const dates=claims(e,'P577').filter(v=>v.time&&v.precision>=9).map(v=>v.time.replace(/^\+/,'').slice(0,v.precision>=11?10:v.precision===10?7:4)).sort();
  const entry={id:'wikidata-'+e.id,name:label(e),originalName:claims(e,'P1476').find(v=>v.language==='en')?.text||e.labels?.en?.value||'',aliases:names,developer:ids(e,'P57').map(id=>label(people[id])).filter(Boolean).join('、'),publisher:ids(e,'P272').map(id=>label(people[id])).filter(Boolean).join('、'),cast:ids(e,'P161').map(id=>label(people[id])).filter(Boolean),genres:ids(e,'P136').map(id=>label(people[id])).filter(Boolean),releaseDate:dates[0]||'',description:'',storeUrl:'https://www.wikidata.org/wiki/'+e.id,scope:ids(e,'P31').includes('Q11424')?'film':'series',identifiers:{wikidata:e.id,imdb:claims(e,'P345')[0]}};
  if(score(entry,[query])>0){result.push(entry);emit(entry);}
 }return result;
}
async function kitsu({get,emit},query,type='anime'){
 const kind=type==='manga'?'manga':'anime',url=new URL('https://kitsu.io/api/edge/'+kind);url.search=new URLSearchParams({'filter[text]':query,'page[limit]':'12'});
 const payload=await get(url.href,{headers:{Accept:'application/vnd.api+json'}}),result=[];
 for(const row of arr(payload?.data)){
  const v=row.attributes||{},titles=v.titles||{};if(/novel|music/i.test(v.subtype||''))continue;
  const entry={id:'kitsu-'+kind+'-'+row.id,name:titles.zh_cn||titles.zh_tw||titles.ja_jp||v.canonicalTitle||'',originalName:titles.ja_jp||v.canonicalTitle||'',aliases:unique([...Object.values(titles),...arr(v.abbreviatedTitles),v.canonicalTitle]),cover:v.posterImage?.original||v.posterImage?.large||'',coverLandscape:v.coverImage?.original||v.coverImage?.large||'',description:Text.text(v.synopsis||v.description||''),releaseDate:v.startDate||'',episodes:type==='anime'?v.episodeCount:null,externalRating:v.averageRating||'',ratingSource:'Kitsu',ratingMax:100,storeUrl:'https://kitsu.app/'+kind+'/'+encodeURIComponent(v.slug||row.id),editionKind:type==='manga'?'系列':''};
  if(score(entry,[query])>0){result.push(entry);emit(entry);}
 }return result;
}
module.exports={wikidata,kitsu};
