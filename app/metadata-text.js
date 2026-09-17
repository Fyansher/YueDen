(function (root) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', eacute: 'é', aacute: 'á', ouml: 'ö', uuml: 'ü', shy: '', zwj: '\u200d', zwnj: '\u200c' };
  function decode(value) {
    let result = String(value ?? '');
    for (let i = 0; i < 4; i++) {
      const next = result.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (token, key) => {
        if (key[0] === '#') { const n = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1)); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�'; }
        if (typeof document !== 'undefined') { const node = document.createElement('textarea'); node.innerHTML = token; return node.value; }
        return named[key] ?? named[key.toLowerCase()] ?? token;
      });
      if (next === result) break; result = next;
    }
    return result;
  }
  function text(value) { return decode(value).replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\u00a0/g, ' ').trim(); }
  function candidate(item) {
    const copy = { ...item };
    for (const key of ['name', 'description', 'developer', 'publisher', 'translator', 'releaseDate', 'externalRating', 'steamRating', 'metadataSource']) if (typeof copy[key] === 'string') copy[key] = text(copy[key]);
    for (const key of ['genres', 'cast']) if (Array.isArray(copy[key])) copy[key] = copy[key].map(text);
    return copy;
  }
  const api = { decode, text, candidate };
  if (typeof module !== 'undefined') module.exports = api; else root.MetadataText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
