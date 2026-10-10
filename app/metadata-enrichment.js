/* Online-only enrichment. Edition-specific fields never come from search aggregates. */
const Text = require('./metadata-text');
const clean = value => Text.text(value ?? '');
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values.filter(Boolean))];
const norm = value => clean(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').replace(/\d+/g, digits => String(Number(digits)));
const chinese = value => /[\u3400-\u9fff]/.test(value || '');
const names = item => unique([item.name, item.originalName, ...list(item.aliases)].map(norm));
const authors = item => clean(item.developer).replace(/[\[【（(][^\]】）)]*[\]】）)]/g, '').split(/[、,，;/]/).map(norm).filter(Boolean);
function relevance(entry, query) { const term = norm(query); return Math.max(0, ...names(entry).map(name => name === term ? 100 : name.startsWith(term) ? 75 : name.includes(term) ? 50 : 0)); }
const completeness = entry => ['publisher','isbn','pages','translator','description','cast','episodes'].filter(key => Array.isArray(entry[key]) ? entry[key].length : entry[key]).length;
function isbn(value) {
  const values = String(value || '').toUpperCase().match(/[0-9][0-9X\-\s]{8,25}[0-9X]/g) || [];
  const valid = unique(values.map(text => text.replace(/[^\dX]/g, '')).filter(code => {
    if (/^\d{13}$/.test(code)) return [...code].reduce((sum, n, i) => sum + Number(n) * (i % 2 ? 3 : 1), 0) % 10 === 0;
    return /^\d{9}[\dX]$/.test(code) && [...code].reduce((sum, n, i) => sum + (n === 'X' ? 10 : Number(n)) * (10 - i), 0) % 11 === 0;
  }));
  return valid.length === 1 ? valid[0] : '';
}
function count(value) { const match = clean(value).match(/^(\d{1,6})(?:\s*(?:页|話|话|集|ページ|pages?))?$/i); return match && Number(match[1]) > 0 ? Number(match[1]) : null; }
function infoValue(info, keys) {
  for (const key of keys) {
    const row = list(info.infobox).find(row => norm(row.key) === norm(key));
    if (!row) continue;
    const value = Array.isArray(row.value) ? row.value.map(part => typeof part === 'object' ? part.v || '' : part).join('、') : row.value;
    if (clean(value)) return clean(value);
  }
  return '';
}
function sameWork(a, b) {
  if (a.isbn && b.isbn && a.isbn === b.isbn) return true;
  return names(a).some(name => names(b).includes(name)) && authors(a).some(author => authors(b).includes(author));
}
function sameEdition(a, b) {
  if (a.isbn || b.isbn) return Boolean(a.isbn && a.isbn === b.isbn);
  return sameWork(a,b) && a.publisher && norm(a.publisher) === norm(b.publisher) && /^\d{4}[-年]\d/.test(a.releaseDate || '') && a.releaseDate === b.releaseDate;
}
function refreshMatch(item, candidates) {
  const entries = candidates.filter(entry => !String(entry.id || '').startsWith('offline') && !/离线/.test(entry.metadataSource || ''));
  const first=entries[0];if(!first)return null;
  const urls=value=>[value.storeUrl,...Object.values(value.platformLinks||{})].filter(Boolean).map(url=>String(url).replace(/\/$/,''));
  const steamId=value=>{const explicit=String(value.steamAppId||'');if(/^\d+$/.test(explicit))return explicit;for(const url of urls(value)){const match=url.match(/store\.steampowered\.com\/app\/(\d+)(?:\/|$)/i);if(match)return match[1];}const id=String(value.id||''),source=String(value._sourceId||value.sourceId||value.metadataSource||'');return /^\d+$/.test(id)&&/(?:^|\b)steam(?:\b|$)/i.test(source)?id:'';};
  const existingSteamId=steamId(item);if((item.type||'game')==='game'&&existingSteamId)return steamId(first)===existingSteamId?first:null;
  if(item.isbn)return first.isbn===item.isbn?first:null;
  const existingUrls=new Set(urls(item));if(existingUrls.size&&urls(first).some(url=>existingUrls.has(url)))return first;
  const title=norm(item.name);if(!title)return null;
  const exact=entries.filter(entry=>names(entry).includes(title)&&(!item.developer||!entry.developer||sameWork(item,entry))&&(!item.publisher||!entry.publisher||norm(item.publisher)===norm(entry.publisher))&&(!item.releaseDate||!entry.releaseDate||String(item.releaseDate).match(/\d{4}/)?.[0]===String(entry.releaseDate).match(/\d{4}/)?.[0]));
  return exact.length===1&&exact[0]===first?first:null;
}
function fillMissing(base, extra, fields) {
  const output = { ...base, fieldSources: { ...base.fieldSources } }; let filled = false;
  for (const key of fields) {
    const empty = Array.isArray(output[key]) ? !output[key].length : !output[key];
    if (empty && (Array.isArray(extra[key]) ? extra[key].length : extra[key])) { output[key] = extra[key]; output.fieldSources[key] = extra.metadataSource; filled = true; }
  }
  if (filled) output.metadataSource = unique([base.metadataSource, extra.metadataSource]).join(' + ');
  return output;
}
function elementBody(html, id) {
  const start = new RegExp('<div\\b[^>]*\\bid=["\\\']' + id + '["\\\'][^>]*>', 'i').exec(html);
  if (!start) return '';
  const rest = html.slice(start.index + start[0].length), tags = /<\/?div\b[^>]*>/gi; let depth = 1, match;
  while ((match = tags.exec(rest))) { depth += /^<\//.test(match[0]) ? -1 : 1; if (!depth) return rest.slice(0, match.index); }
  return '';
}
function doubanBook(html, seed) {
  const section = elementBody(html, 'info');
  // HTML formatting line breaks are not field boundaries. A <br> ends a field;
  // the value may contain several indented lines, links and nested spans.
  const rows = section.split(/<br\b[^>]*>/gi).map(part => clean(part).replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
  const get = keys => { for (const key of keys) { const match = rows.match(new RegExp('(?:^|\\n)\\s*' + key + '\\s*[:：]\\s*([^\\n]+)')); if (match) return clean(match[1]); } return ''; };
  const description = require('./metadata-html').summary(html,'book');
  const image = html.match(/<a[^>]*class=["'][^"']*nbg[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1];
  const tags = [...elementBody(html, 'db-tags-section').matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(match => clean(match[1])).filter(tag => tag && !/更多|全部/.test(tag));
  const originalName=get(['原作名','原名']);
  return { ...seed, originalName, aliases: originalName?[originalName]:[], developer: get(['作者']) || seed.developer, publisher: get(['出版社']), translator: get(['译者']), isbn: isbn(get(['ISBN'])), pages: count(get(['页数'])), releaseDate: get(['出版年']) || seed.releaseDate, description, detailsUnavailable:!section||!description, cover: image && /^https:/.test(image) ? image : seed.cover, genres: tags, externalRating: html.match(/property=["']v:average["'][^>]*>\s*([\d.]+)/i)?.[1] || '', ratingSource:'豆瓣', ratingMax:10 };
}
function createProviders({ json, text, pace = 0, onEntry = () => {} }) {
  const hostSlots = new Map();
  const get = async (url, options = {}) => { try {
    if (pace) { const host = new URL(url).hostname, now = Date.now(), start = Math.max(now, hostSlots.get(host) || 0); hostSlots.set(host, start + (/jikan|openlibrary/.test(host) ? Math.max(400, pace) : pace)); if (start > now) await require('./metadata-runtime').delay(start-now); }
    return await json(url, 6000, options);
  } catch { require('./metadata-runtime').check(); return null; } };
  const html = async url => { try { return await text(url, 6000); } catch { return ''; } };
  async function map(values, work) {
    const output = new Array(values.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, values.length) }, async () => { while (cursor < values.length) { const i = cursor++; try { output[i] = await work(values[i]); } catch { output[i] = null; } } }));
    return output.filter(Boolean);
  }
  const personNames = new Map();
  function personName(person) {
    if (person.name_cn || !/^\d+$/.test(String(person.id || ''))) return Promise.resolve(clean(person.name_cn || person.name));
    if (!personNames.has(person.id)) personNames.set(person.id, get('https://api.bgm.tv/v0/persons/' + person.id).then(info => infoValue(info || {}, ['简体中文名','中文名','繁体中文名']) || clean(person.name)));
    return personNames.get(person.id);
  }
  async function bangumiDetail(seed, type, query='') {
    const detail = await get('https://api.bgm.tv/v0/subjects/' + seed.id);
    const info = detail || seed;
    const publication = Number(info.type || seed.type) === 1;
    const platform = clean(info.platform);
    const comic = /漫画|マンガ|manga|comic/i.test(platform);
    if (type === 'manga' && platform && !comic) return null;
    if (type === 'book' && comic) return null;
    const name = info.name_cn || seed.name_cn || info.name || seed.name;
    let entry = { id: 'bgm-' + seed.id, providerId: String(seed.id), name, originalName: info.name || seed.name, aliases: infoValue(info, ['别名']).split('、'), cover: info.images?.large || info.images?.common || seed.images?.large || '', genres: unique(list(info.tags).map(tag => clean(tag.name || tag))).slice(0, 10), developer: infoValue(info, publication ? ['作者', '原作', '著者'] : ['导演', '監督']), publisher: infoValue(info, publication ? ['出版社', '出版者'] : ['动画制作', '动画制片', '製作', '制作']), translator: infoValue(info, ['译者', '翻译', '翻訳']), isbn: isbn(infoValue(info, ['ISBN', 'ISBN-13', 'ISBN-10'])), pages: count(infoValue(info, ['页数', 'ページ数'])), episodes: publication ? null : count(infoValue(info, ['话数', '集数'])) || count(String(info.total_episodes || info.eps || '')), releaseDate: info.date || info.air_date || '', externalRating: info.rating?.score ? String(info.rating.score) : '', description: clean(info.summary || seed.summary || ''), cast: [], storeUrl: 'https://bgm.tv/subject/' + seed.id, metadataSource: 'Bangumi 番组计划' };
    if(query&&relevance(entry,query)<=0)return null;
    if (!publication) {
      const [characters, persons] = await Promise.all([get('https://api.bgm.tv/v0/subjects/' + seed.id + '/characters'), get('https://api.bgm.tv/v0/subjects/' + seed.id + '/persons')]);
      const actors = list(characters).flatMap(character => {
        const actors = list(character.actors), local = actors.filter(actor => /[\u3040-\u30ff\u3400-\u9fff]/.test(actor.name_cn || actor.name));
        return local.length ? local : actors;
      });
      const uniqueActors = [...new Map(actors.map(actor => [actor.id || actor.name, actor])).values()];
      entry.cast = unique(await map(uniqueActors, async actor => uniqueActors.indexOf(actor) < 12 ? personName(actor) : clean(actor.name_cn || actor.name)));
      const people = relation => unique(list(persons).filter(person => relation.test(person.relation || '')).map(person => clean(person.name_cn || person.name))).join('、');
      entry.developer ||= people(/^(导演|監督|总导演|総監督)$/); entry.publisher ||= people(/^(动画制作|制作|製作)$/);
      const directors = list(persons).filter(person => /^(导演|監督|总导演|総監督)$/.test(person.relation || ''));
      if (directors.length) entry.developer = (await map(directors.slice(0,3), personName)).join('、') || entry.developer;
    }
    return entry;
  }
  async function bangumiSearch(query, type) {
    const desiredType = type === 'anime' ? 2 : 1;
    const modern = await get('https://api.bgm.tv/v0/search/subjects?limit=12', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: query, sort: 'match', filter: { type: [desiredType] } }) });
    const payload = list(modern?.data).length ? modern.data : (await get('https://api.bgm.tv/search/subject/' + encodeURIComponent(query) + '?type=' + desiredType + '&max_results=16'))?.list;
    const seeds = list(payload).filter(item => Number(item.type) === desiredType).slice(0, 10);
    // Search response fields are enough to identify a result. Subject, cast,
    // staff and person pages are fetched only after the user picks one.
    const entries=seeds.map(seed=>{
      const platform=clean(seed.platform),comic=/漫画|マンガ|manga|comic/i.test(platform);
      if(type==='manga'&&platform&&!comic||type==='book'&&comic)return null;
      const publication=desiredType===1,entry={id:'bgm-'+seed.id,providerId:String(seed.id),name:seed.name_cn||seed.name||query,originalName:seed.name||'',cover:seed.images?.large||seed.images?.common||'',genres:unique(list(seed.tags).map(tag=>clean(tag.name||tag))).slice(0,8),developer:infoValue(seed,['作者','原作','著者','导演','監督']),releaseDate:seed.date||seed.air_date||'',externalRating:seed.rating?.score?String(seed.rating.score):'',episodes:publication?null:count(String(seed.total_episodes||seed.eps||'')),description:clean(seed.summary||''),storeUrl:'https://bgm.tv/subject/'+seed.id,metadataSource:'Bangumi 番组计划',editionKind:type==='manga'?'系列':''};
      return relevance(entry,query)>0?entry:null;
    }).filter(Boolean).sort((a,b)=>relevance(b,query)-relevance(a,query));
    entries.forEach(onEntry);return entries;
  }
  async function editionRecord(edition, work = {}) {
    const authorNames = await map(list(edition.authors).slice(0, 4), async author => { const key = author.key || author.author?.key; if (!/^\/authors\/OL\d+A$/.test(key || '')) return null; const person = await get('https://openlibrary.org' + key + '.json'); return person?.name; });
    const code = isbn(list(edition.isbn_13)[0] || list(edition.isbn_10)[0]);
    return { id: edition.key, name: edition.title || work.title || '', originalName: work.title || '', developer: authorNames.join('、') || list(work.author_name).join('、'), publisher: list(edition.publishers).join('、'), translator: list(edition.contributors).filter(person => /translat|译|翻訳/i.test(person.role)).map(person => person.name).join('、'), isbn: code, pages: count(String(edition.number_of_pages || '')), releaseDate: edition.publish_date || '', description: clean(edition.description?.value || edition.description || work.description?.value || work.description || ''), cover: edition.covers?.[0] > 0 ? 'https://covers.openlibrary.org/b/id/' + edition.covers[0] + '-L.jpg' : code ? 'https://covers.openlibrary.org/b/isbn/' + code + '-L.jpg?default=false' : '', genres: list(work.subjects).slice(0, 8).map(clean), storeUrl: edition.key ? 'https://openlibrary.org' + edition.key : '', metadataSource: 'Open Library（具体版本）' };
  }
  async function byIsbn(code) {
    if (!isbn(code)) return null;
    const edition = await get('https://openlibrary.org/isbn/' + code + '.json');
    const canonical = value => { const valid=isbn(value); if(valid.length!==10)return valid; const prefix='978'+valid.slice(0,9),sum=[...prefix].reduce((total,n,i)=>total+Number(n)*(i%2?3:1),0);return prefix+((10-sum%10)%10); };
    if (!edition || ![...list(edition.isbn_13), ...list(edition.isbn_10)].map(canonical).includes(canonical(code))) return null;
    const entry=await editionRecord(edition);onEntry(entry);return entry;
  }
  async function openLibrarySearch(query) {
    const fields='key,title,author_name,first_publish_year,isbn,cover_i';
    const payload=await get('https://openlibrary.org/search.json?title='+encodeURIComponent(query)+'&lang=zh&limit=8&fields='+fields);
    const entries=list(payload?.docs).slice(0,8).filter(work=>/^OL\d+W$/.test(work.key||'')).map(work=>{
      const codes=list(work.isbn).map(isbn).filter(Boolean),entry={id:'openlibrary-'+work.key,providerId:work.key,name:work.title||query,developer:list(work.author_name).join('、'),cover:Number(work.cover_i)>0?'https://covers.openlibrary.org/b/id/'+work.cover_i+'-M.jpg':'',storeUrl:'https://openlibrary.org/works/'+work.key,editionKind:codes.length===1?'edition':'系列',metadataSource:'Open Library'};
      if(codes.length===1)entry.isbn=codes[0];
      return entry;
    });entries.forEach(onEntry);return entries;
  }
  async function doubanSearch(query) {
    const payload = await get('https://book.douban.com/j/subject_suggest?q=' + encodeURIComponent(query));
    const entries=list(payload).slice(0, 8).map(seed => {
      const id = String(seed.id || seed.url?.match(/subject\/(\d+)/)?.[1] || ''); if (!/^\d+$/.test(id)) return null;
      const url = 'https://book.douban.com/subject/' + id + '/';
      return {id:'douban-book-'+id,providerId:id,name:seed.title||query,developer:clean(Array.isArray(seed.author_name)?seed.author_name.join('、'):seed.author_name),releaseDate:String(seed.year||''),cover:seed.pic||seed.img||'',storeUrl:url,metadataSource:'豆瓣读书',genres:[],detailsUnavailable:true};
    }).filter(Boolean);entries.forEach(onEntry);return entries;
  }
  async function publicationSearch(query, type) {
    const [douban, bangumi] = await Promise.all([doubanSearch(query), bangumiSearch(query, type)]);
    // A generic title can name both a novel and its manga adaptation.
    const matchingDouban = type === 'manga' ? douban.filter(entry => /漫画|マンガ|comic|manga/i.test([entry.name, ...list(entry.genres)].join(' ')) || bangumi.some(other => sameWork(entry, other))) : douban;
    const openLibrary=await openLibrarySearch(query);
    let entries=[...matchingDouban,...bangumi,...openLibrary];
    const seen = new Set();
    return entries.filter(entry => { const key = entry.isbn || entry.id; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a,b) => {
      const rank = relevance(b,query) - relevance(a,query) || Number(chinese(b.name)) - Number(chinese(a.name));
      if (rank) return rank;
      if (a.editionKind === '单行本' && b.editionKind === '单行本') return a.name.localeCompare(b.name, 'zh', {numeric:true});
      return completeness(b) - completeness(a);
    });
  }
  async function jikanSearch(query, type = 'anime') {
    const payload = await get('https://api.jikan.moe/v4/' + (type === 'manga' ? 'manga' : 'anime') + '?q=' + encodeURIComponent(query) + '&limit=5');
    return list(payload?.data).filter(info => type !== 'manga' || !/Novel/i.test(info.type || '')).map(info => ({ id: 'mal-' + info.mal_id, providerId: info.mal_id, name: info.title, originalName: info.title_japanese, aliases: list(info.titles).map(title => title.title), developer: type === 'manga' ? list(info.authors).map(author => author.name).join('、') : '', publisher: type === 'anime' ? list(info.studios).map(studio => studio.name).join('、') : '', episodes: type === 'anime' ? count(String(info.episodes || '')) : null, releaseDate: ((type === 'manga' ? info.published : info.aired)?.from || '').slice(0, 10), genres: list(info.genres).map(genre => genre.name), cast: [], description: clean(info.synopsis), cover: info.images?.jpg?.large_image_url || '', externalRating: info.score != null ? String(info.score) : '', storeUrl: info.url, metadataSource: 'MyAnimeList' }));
  }
  async function jikanCast(entry) {
    const result = await get('https://api.jikan.moe/v4/anime/' + entry.providerId + '/characters');
    return unique(list(result?.data).flatMap(character => list(character.voice_actors).filter(actor => actor.language === 'Japanese').map(actor => clean(actor.person?.name))));
  }
  async function animeSearch(query) {
    const primary=await bangumiSearch(query,'anime');
    return primary.length?primary:jikanSearch(query,'anime');
  }
  async function bangumiPublication(query,type) {
    return bangumiSearch(query,type);
  }
  async function resolveCandidate(seed,type) {
    const source=seed?._sourceId||'',id=String(seed?.providerId||'');
    if(source==='bangumi'&&/^\d+$/.test(id))return bangumiDetail({id,name:seed.name,providerId:id},type,seed.name);
    if(source==='douban'&&/^\d+$/.test(id)&&type==='book')return doubanBook(await html('https://book.douban.com/subject/'+id+'/'),seed);
    if(source==='myanimelist')return {...seed,cast:type==='anime'?await jikanCast(seed):seed.cast||[]};
    if(source==='openlibrary'){
      if(seed.isbn)return await byIsbn(seed.isbn)||seed;
      const workKey=id.startsWith('/works/')?id:'/works/'+id;
      if(!/^\/works\/OL\d+W$/.test(workKey))return seed;
      const payload=await get('https://openlibrary.org'+workKey+'/editions.json?limit=20'),work=await get('https://openlibrary.org'+workKey+'.json');
      const editions=list(payload?.entries).sort((a,b)=>Number(list(b.languages).some(lang=>/\/(chi|zho)$/.test(lang.key)))-Number(list(a.languages).some(lang=>/\/(chi|zho)$/.test(lang.key))));
      if(editions.length===1&&Number(payload?.size)===1){const entry=await editionRecord(editions[0],{...work,title:seed.name,author_name:[seed.developer]});return {...seed,...entry,editionKind:'edition',detailsUnavailable:false};}
      const description=clean(work?.description?.value||work?.description||'');
      return {...seed,description:description||seed.description||'',genres:list(work?.subjects).slice(0,8).map(clean),editionKind:'系列',detailsUnavailable:!description&&!seed.description};
    }
    return seed;
  }
  return { bookSearch: query => publicationSearch(query, 'book'), mangaSearch: query => publicationSearch(query, 'manga'), animeSearch, bangumiSearch, bangumiPublication, bangumiDetail, doubanSearch, openLibrarySearch, byIsbn, jikanSearch, jikanCast, editionRecord, doubanBook, resolveCandidate };
}
module.exports = { createProviders, isbn, count, sameWork, sameEdition, refreshMatch, fillMissing, doubanBook, infoValue, elementBody, norm, names, relevance };
