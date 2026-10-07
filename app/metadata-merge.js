/* Conservative, field-level complementing; raw source records stay unchanged. */
const {isbn,norm,names} = require('./metadata-enrichment');
const Rating = require('./rating-model');
const Platform = require('./platform-model');
const fields=['name','description','developer','publisher','translator','releaseDate','isbn','pages','cast','episodes','genres','aliases','cover','coverPortrait','coverLandscape','externalRating','storeUrl','platforms','platformLinks','steamAppId'];
const present=value=>Array.isArray(value)?value.length>0:value!==null&&value!==undefined&&value!=='';
const chinese=value=>/[\u3400-\u9fff]/.test(Array.isArray(value)?value.join(' '):value||'');
function isbnKey(code) {
  const valid=isbn(code);if(valid.length!==10)return valid;
  const prefix='978'+valid.slice(0,9),sum=[...prefix].reduce((s,n,i)=>s+Number(n)*(i%2?3:1),0);return prefix+((10-sum%10)%10);
}
function month(value) { const match=String(value||'').match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);return match?match[1]+'-'+match[2].padStart(2,'0'):''; }
function sameAuthors(a,b) {
  const split=value=>String(value||'').replace(/[\[【（(][^\]】）)]*[\]】）)]/g,'').split(/[、,，;；/]/).map(norm).filter(Boolean);
  return split(a.developer).some(name=>split(b.developer).includes(name));
}
function sharedId(a,b) { if(a.steamAppId&&b.steamAppId&&String(a.steamAppId)===String(b.steamAppId))return true;return Object.entries(a.identifiers||{}).some(([key,value])=>present(value)&&String(b.identifiers?.[key]||'')===String(value)); }
function sameTitle(a,b) { return names(a).some(name=>names(b).includes(name)); }
function sameWork(a,b,type) {
  if(a.mediaType&&b.mediaType&&a.mediaType!==b.mediaType)return false;
  if(['book','manga'].includes(type))return Boolean(isbnKey(a.isbn)&&isbnKey(a.isbn)===isbnKey(b.isbn)) || (sameTitle(a,b)&&sameAuthors(a,b));
  if(a.scope&&b.scope&&a.scope!==b.scope)return false;
  if(sharedId(a,b))return true;
  const year=String(a.releaseDate||'').match(/\d{4}/)?.[0],otherYear=String(b.releaseDate||'').match(/\d{4}/)?.[0];
  if(type==='game')return sameTitle(a,b)&&!(year&&otherYear&&year!==otherYear)&&!(a.developer&&b.developer&&!sameAuthors(a,b));
  return sameTitle(a,b)&&Boolean(year&&year===otherYear)&&!(a.developer&&b.developer&&!sameAuthors(a,b));
}
function sameEdition(a,b) {
  const x=isbnKey(a.isbn),y=isbnKey(b.isbn);
  if(x&&y)return x===y;
  if(a.editionKind==='系列'||b.editionKind==='系列')return false;
  return sameTitle(a,b)&&sameAuthors(a,b)&&Boolean(a.publisher&&norm(a.publisher)===norm(b.publisher)&&month(a.releaseDate)&&month(a.releaseDate)===month(b.releaseDate));
}
function stamp(entry,label,type,sourceId='') {
  const copy={...entry,mediaType:type,metadataSource:label,fieldSources:{},...(sourceId?{_sourceId:sourceId}:{})};
  for(const key of fields)if(present(copy[key]))copy.fieldSources[key]=label;
  const rating=Rating.parse({...copy,ratingSource:copy.ratingSource||label},type);
  copy.ratingSource=rating.source;copy.ratingValue=rating.value;copy.ratingMax=rating.max;
  return copy;
}
function mergeMetadata(sourceGroups,type,primarySource='') {
  const entries=sourceGroups.flatMap((group,index)=>(group.items||[]).map((entry,itemIndex)=>({...entry,_rank:index,_sourceOrder:itemIndex,_sourceId:group.id||entry._sourceId||''}))).sort((a,b)=>{
    const preferred=Number(b._sourceId===primarySource)-Number(a._sourceId===primarySource);
    return preferred||((type==='game'?Number(/Steam/i.test(b.metadataSource))-Number(/Steam/i.test(a.metadataSource)):Number(chinese(b.name))-Number(chinese(a.name)))||a._rank-b._rank||a._sourceOrder-b._sourceOrder);
  });
  const result=[],consumed=new Set();
  for(let index=0;index<entries.length;index++) {
    if(consumed.has(index))continue;
    const base=structuredClone(entries[index]);delete base._rank;delete base._sourceOrder;
    const baseSourceId=base._sourceId;delete base._sourceId;
    base.fieldSources={...(base.fieldSources||{})};
    for(const key of fields)if(present(base[key]))base.fieldSources[key]||=base.metadataSource||'';
    if(type==='game')base.platformLinks={...(base.platformLinks||{})};
    const matchedCandidates=[];
    const contributions=new Set(String(base.metadataSource||'').split(/\s+\+\s+/).filter(Boolean));
    for(let j=0;j<entries.length;j++) {
      if(j===index)continue;const extra=entries[j],publication=['book','manga'].includes(type);
      const unknown=!isbnKey(base.isbn)?base:!isbnKey(extra.isbn)?extra:null;
      const ambiguous=publication&&unknown&&new Set(entries.filter(entry=>sameWork(unknown,entry,type)).map(entry=>isbnKey(entry.isbn)).filter(Boolean)).size>1;
      const edition=publication&&!ambiguous&&sameEdition(base,extra),work=publication?(edition||sameWork(base,extra,type)):sameWork(base,extra,type);
      if(!work)continue;
      const matched=structuredClone(extra);delete matched._rank;delete matched._sourceOrder;delete matched._sourceId;
      if(extra._sourceId&&extra._sourceId!==baseSourceId&&!matchedCandidates.some(row=>row.sourceId===extra._sourceId&&String(row.candidate.id)===String(extra.id)))matchedCandidates.push({sourceId:extra._sourceId,candidate:matched,edition:!publication||edition,ambiguous});
      if(type==='game'){
        const aliases=[...new Set([...(base.aliases||[]),extra.name,extra.originalName,...(extra.aliases||[])].filter(Boolean))];if(aliases.length!==(base.aliases||[]).length){base.aliases=aliases;base.fieldSources.aliases||=extra.fieldSources?.aliases||extra.metadataSource||'';contributions.add(extra.metadataSource);}
        base.identifiers={...extra.identifiers,...base.identifiers};
        base.platforms=[...new Set([...(base.platforms||[]),...(extra.platforms||[])])];
        base.platformLinks={...extra.platformLinks,...base.platformLinks};
        for(const entry of [extra,base]){const platform=Platform.normalize(entry.storeUrl);if(platform)base.platformLinks[platform]=entry.storeUrl;}
      }else if(publication){
        const aliases=[...new Set([...(base.aliases||[]),...(extra.aliases||[])].filter(Boolean))];
        if(aliases.length!==(base.aliases||[]).length){base.aliases=aliases;base.fieldSources.aliases||=extra.fieldSources?.aliases||extra.metadataSource||'';contributions.add(extra.metadataSource);}
      }
      // Duplicate precise editions collapse. Other editions remain selectable.
      if(edition||!publication||(base.editionKind==='系列'&&extra.editionKind==='系列'))consumed.add(j);
      const allowed=publication&&!edition?['description','genres']:fields;
      for(const key of allowed) {
        if(!present(extra[key]))continue;
        // The primary source is the user's chosen baseline. Other sources only
        // fill blanks, including when they have more localized text.
        if(present(base[key]))continue;
        // Do not overwrite a platform's numeric score with another site's score.
        base[key]=structuredClone(extra[key]);base.fieldSources[key]=extra.fieldSources?.[key]||extra.metadataSource;contributions.add(extra.metadataSource);
        if(key==='externalRating'){base.ratingSource=extra.ratingSource;base.ratingValue=extra.ratingValue;base.ratingMax=extra.ratingMax;}
      }
    }
    base.metadataSource=[...contributions].filter(Boolean).join(' + ');base.integrated=true;
    if(baseSourceId)base._sourceId=baseSourceId;
    if(matchedCandidates.length)base._matchedCandidates=matchedCandidates;
    result.push(base);
  }
  return result;
}
module.exports={mergeMetadata,stamp,sameWork,sameEdition,isbnKey,present};
