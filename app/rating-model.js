/* Preserve rating provenance and scales; never turn a review tier into a percentage. */
(function(root) {
  function source(value = {}, type = value.type) {
    const text = String(value.externalRating || value.steamRating || '');
    const candidates = [text, value.ratingSource, value.fieldSources?.externalRating, value.storeUrl];
    if (!String(value.metadataSource || '').includes('+')) candidates.push(value.metadataSource);
    for (const candidate of candidates) {
      if (/steam/i.test(candidate || '')) return 'Steam';
      if (/豆瓣|douban/i.test(candidate || '')) return '豆瓣';
      if (/bangumi|bgm\.tv|番组计划/i.test(candidate || '')) return 'Bangumi';
      if (/myanimelist|jikan|mal-/i.test(candidate || '')) return 'MyAnimeList';
      if (/anilist/i.test(candidate || '')) return 'AniList';
      if (/google.*books|谷歌图书/i.test(candidate || '')) return 'Google Books';
      if (/tvmaze/i.test(candidate || '')) return 'TVmaze';
      if (/open.?library/i.test(candidate || '')) return 'Open Library';
      if (/playstation/i.test(candidate || '')) return 'PlayStation';
      if (/dlsite/i.test(candidate || '')) return 'DLsite';
      if (/epic/i.test(candidate || '')) return 'Epic Games';
      if (/kitsu/i.test(candidate || '')) return 'Kitsu';
      if (/igdb/i.test(candidate || '')) return 'IGDB';
    }
    return type === 'game' && (value.steamAppId || /好评|差评|褒贬/.test(text)) ? 'Steam' : '';
  }
  function parse(item = {}, type = item.type) {
    const raw = String(item.externalRating || item.steamRating || '').trim(), origin = source(item,type);
    const percent = raw.match(/(\d+(?:\.\d+)?)\s*%/), fraction = raw.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    const stripped = raw.replace(/^(?:豆瓣|Bangumi|MyAnimeList|AniList|TVmaze|Google Books|Steam)(?:\s*评分)?\s*[:：]?\s*/i,'');
    let value = percent ? Number(percent[1]) : fraction ? Number(fraction[1]) : /^\d+(?:\.\d+)?$/.test(stripped) ? Number(stripped) : item.ratingValue !== null && item.ratingValue !== undefined && item.ratingValue !== '' ? Number(item.ratingValue) : null;
    const max = percent ? 100 : fraction ? Number(fraction[2]) : Number(item.ratingMax) || scale(origin) || null;
    if (value !== null && Number.isFinite(value) && max > 0 && value >= 0 && value <= max) return {source:origin,raw,value,max,ratio:value/max,mode:'numeric',display: origin === 'Steam' ? Number(value.toFixed(1)) + '%' : Number(value.toFixed(1)) + ' / ' + max,detail:origin==='Steam'?'好评率':'平台原始评分'};
    const tiers = ['差评如潮','特别差评','多半差评','差评','褒贬不一','多半好评','好评','特别好评','好评如潮'];
    const tier = [...tiers].sort((a,b)=>b.length-a.length).find(label=>raw.includes(label));
    if (origin === 'Steam' && tier) return {source:origin,raw,value:null,max:null,ratio:tiers.indexOf(tier)/(tiers.length-1),mode:'tier',display:tier,detail:''};
    return {source:origin,raw,value:null,max:null,ratio:null,mode:'empty',display:raw || '暂无评分',detail:raw?'尚无可用数值刻度':'等待平台评分'};
  }
  function scale(source){return ({Steam:100,豆瓣:10,Bangumi:10,MyAnimeList:10,AniList:100,Kitsu:100,TVmaze:10,'Google Books':5,PlayStation:5,'Epic Games':5,DLsite:5,IGDB:100})[source]||null;}
  function tier(raw){return ['好评如潮','特别好评','多半好评','差评如潮','特别差评','多半差评','褒贬不一','好评','差评'].find(value=>String(raw||'').includes(value))||'';}
  function tierFor(ratio){return ratio>=.95?'好评如潮':ratio>=.8?'特别好评':ratio>=.7?'多半好评':ratio>=.4?'褒贬不一':ratio>=.2?'多半差评':'差评如潮';}
  const api={source,parse,scale,tier,tierFor}; if(typeof module!=='undefined')module.exports=api;if(root)root.RatingModel=api;
})(typeof window!=='undefined'?window:null);
