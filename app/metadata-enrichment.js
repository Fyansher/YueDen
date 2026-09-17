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
  if (item.type === 'game' && item.steamAppId) return entries.find(entry => String(entry.steamAppId || entry.id) === String(item.steamAppId));
  if (item.isbn) return entries.find(entry => entry.isbn === item.isbn);
  const linked = entries.find(entry => item.storeUrl && entry.storeUrl?.replace(/\/$/,'') === item.storeUrl.replace(/\/$/,''));
  if (linked) return linked;
  const exact = entries.filter(entry => names(entry).includes(norm(item.name)) && (!item.developer || sameWork(item, entry)) && (!item.publisher || norm(item.publisher) === norm(entry.publisher)) && (!item.releaseDate || String(item.releaseDate).slice(0,4) === String(entry.releaseDate).slice(0,4)));
  return exact.length === 1 ? exact[0] : null;
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
    const entries = await map(seeds, async seed => {const entry=await bangumiDetail(seed,type,query);if(entry&&relevance(entry,query)>0)onEntry(entry);return entry;});
    return entries.filter(entry => relevance(entry, query) > 0).sort((a,b) => relevance(b,query) - relevance(a,query));
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
    const payload = await get('https://openlibrary.org/search.json?title=' + encodeURIComponent(query) + '&lang=zh&limit=4&fields=key,title,author_name');
    const batches = await map(list(payload?.docs).slice(0, 4), async work => {
      if (/^OL\d+W$/.test(work.key || '')) work.key = '/works/' + work.key;
      if (!/^\/works\/OL\d+W$/.test(work.key || '')) return [];
      const [editionPage, fullWork] = await Promise.all([get('https://openlibrary.org' + work.key + '/editions.json?limit=30'), get('https://openlibrary.org' + work.key + '.json')]);
      const entries = list(editionPage?.entries).sort((a,b) => Number(list(b.languages).some(lang => /\/(chi|zho)$/.test(lang.key))) - Number(list(a.languages).some(lang => /\/(chi|zho)$/.test(lang.key))));
      return map(entries.slice(0, 2), async edition => {const entry=await editionRecord(edition, { ...work, ...fullWork, author_name: work.author_name });onEntry(entry);return entry;});
    });
    return batches.flat();
  }
  async function doubanSearch(query) {
    const payload = await get('https://book.douban.com/j/subject_suggest?q=' + encodeURIComponent(query));
    return map(list(payload).slice(0, 8), async seed => {
      const id = String(seed.id || seed.url?.match(/subject\/(\d+)/)?.[1] || ''); if (!/^\d+$/.test(id)) return null;
      const url = 'https://book.douban.com/subject/' + id + '/';
      const entry=doubanBook(await html(url), { id: 'douban-book-' + id, name: seed.title || query, developer: clean(Array.isArray(seed.author_name) ? seed.author_name.join('、') : seed.author_name), releaseDate: String(seed.year || ''), cover: seed.pic || seed.img || '', storeUrl: url, metadataSource: '豆瓣读书', genres: [] });onEntry(entry);return entry;
    });
  }
  async function publicationSearch(query, type) {
    const [douban, bangumi] = await Promise.all([doubanSearch(query), bangumiSearch(query, type)]);
    // A generic title can name both a novel and its manga adaptation.
    const matchingDouban = type === 'manga' ? douban.filter(entry => /漫画|マンガ|comic|manga/i.test([entry.name, ...list(entry.genres)].join(' ')) || bangumi.some(other => sameWork(entry, other))) : douban;
    let entries = [...matchingDouban, ...bangumi];
    if (type === 'manga') {
      const volumes = await map(bangumi.filter(entry => !entry.isbn && !entry.pages).slice(0, 2), async series => {
        const related = list(await get('https://api.bgm.tv/v0/subjects/' + series.providerId + '/subjects')).filter(item => item.type === 1 && item.relation === '单行本');
        if (related.length) series.editionKind = '系列';
        return map(related.slice(0, 24), async seed => {
          const volume = await bangumiDetail(seed, type); if (!volume) return null;
          const number = (seed.name || '').match(/[（(]\s*(\d+)\s*[)）]\s*$/)?.[1];
          if (number && chinese(series.name) && !chinese(volume.name)) volume.name = series.name + ' (' + String(Number(number)).padStart(2,'0') + ')';
          volume.editionKind = '单行本'; volume.metadataSource += ' · 单行本'; return volume;
        });
      });
      entries.push(...volumes.flat());
    }
    if (entries.some(entry => !entry.pages || !entry.isbn) || !entries.length) {
      const known = unique(entries.map(entry => entry.isbn));
      const supplements = await map(known, byIsbn);
      // Without an ISBN, show precise-edition alternatives instead of copying random page counts.
      if (!known.length && type === 'book') supplements.push(...await openLibrarySearch(query));
      entries = entries.map(entry => {
        for (const extra of [...bangumi, ...supplements]) {
          if (entry.id === extra.id) continue;
          if (sameEdition(entry, extra)) entry = fillMissing(entry, extra, ['developer','publisher','translator','isbn','pages','releaseDate','description','cover','genres']);
          else if (sameWork(entry, extra)) entry = fillMissing(entry, extra, ['description','genres']);
        }
        return entry;
      });
      for (const extra of supplements) if (!entries.some(entry => sameEdition(entry, extra))) entries.push(extra);
    }
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
    const primary = await bangumiSearch(query, 'anime');
    if (!primary.length) return map(await jikanSearch(query), async entry => ({ ...entry, cast: await jikanCast(entry) }));
    return map(primary, async entry => {
      if (entry.cast.length && entry.episodes) return entry;
      const alternatives = await jikanSearch(entry.originalName || entry.name);
      const other = alternatives.find(other => names(entry).some(name => names(other).includes(name)) && entry.releaseDate?.slice(0,4) === other.releaseDate?.slice(0,4));
      if (!other) return entry;
      if (!entry.cast.length) other.cast = await jikanCast(other);
      return fillMissing(entry, other, ['cast', 'episodes']);
    });
  }
  async function bangumiPublication(query,type) {
    const entries=await bangumiSearch(query,type);
    if(type!=='manga')return entries;
    const batches=await map(entries.filter(entry=>!entry.isbn&&!entry.pages).slice(0,2),async series=>{
      const related=list(await get('https://api.bgm.tv/v0/subjects/'+series.providerId+'/subjects')).filter(item=>item.type===1&&item.relation==='单行本');
      if(related.length)series.editionKind='系列';
      return map(related.slice(0,24),async seed=>{const volume=await bangumiDetail(seed,type);if(!volume)return null;const number=(seed.name||'').match(/[（(]\s*(\d+)\s*[)）]\s*$/)?.[1];if(number&&chinese(series.name)&&!chinese(volume.name))volume.name=series.name+' ('+String(Number(number)).padStart(2,'0')+')';volume.editionKind='单行本';onEntry(volume);return volume;});
    });
    return [...entries,...batches.flat()];
  }
  return { bookSearch: query => publicationSearch(query, 'book'), mangaSearch: query => publicationSearch(query, 'manga'), animeSearch, bangumiSearch, bangumiPublication, doubanSearch, openLibrarySearch, byIsbn, jikanSearch, jikanCast };
}
module.exports = { createProviders, isbn, count, sameWork, sameEdition, refreshMatch, fillMissing, doubanBook, infoValue, elementBody, norm, names, relevance };
