const http = require('node:http');

module.exports = async () => {
  const directories = new Set(['/dav/']);
  const files = new Map();
  const requests = [];
  let mode = '';
  let aborted = 0;
  let delayMs = 0;
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const row = (href, { directory = false, lastModified = '', etag = '', body = null } = {}) =>
    '<d:response><d:href>' + escape(href) + '</d:href><d:propstat><d:prop><d:resourcetype>' +
    (directory ? '<d:collection/>' : '') + '</d:resourcetype>' +
    (lastModified ? '<d:getlastmodified>' + escape(lastModified) + '</d:getlastmodified>' : '') +
    (body == null ? '' : '<d:getcontentlength>' + Buffer.byteLength(String(body)) + '</d:getcontentlength>') +
    (etag ? '<d:getetag>' + escape(etag) + '</d:getetag>' : '') +
    '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const key = url.pathname;
      requests.push({ method: req.method, path: key, depth: req.headers.depth, match: req.headers['if-match'], none: req.headers['if-none-match'], unmodifiedSince: req.headers['if-unmodified-since'] });
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (mode === 'hang') {
        req.on('close', () => { aborted += 1; server.emit('request-aborted'); });
        return;
      }
      if (/^status/.test(mode)) { res.writeHead(Number(mode.slice(6))); res.end(); return; }
      if (mode === 'html') { res.end('<html>Login</html>'); return; }
      if (req.method === 'PROPFIND') {
        const file = files.get(key);
        if (file) {
          res.writeHead(207, { 'Content-Type': 'application/xml' });
          res.end('<d:multistatus xmlns:d="DAV:">' + row(key, file) + '</d:multistatus>');
          return;
        }
        if (!directories.has(key)) { res.writeHead(404); res.end(); return; }
        let rows = row(key, { directory: true });
        if (req.headers.depth === '1') {
          for (const directory of directories) {
            if (directory !== key && directory.startsWith(key) && !directory.slice(key.length).replace(/\/$/, '').includes('/')) rows += row(directory, { directory: true });
          }
          for (const [filePath, entry] of files) {
            if (filePath.startsWith(key) && !filePath.slice(key.length).includes('/')) rows += row(filePath, entry);
          }
        }
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        res.end('<d:multistatus xmlns:d="DAV:">' + rows + '</d:multistatus>');
        return;
      }
      if (req.method === 'MKCOL') {
        if (directories.has(key)) res.writeHead(405);
        else if (!directories.has(key.replace(/[^/]+\/$/, ''))) res.writeHead(409);
        else { directories.add(key); res.writeHead(201); }
        res.end();
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (mode === 'read400') { res.writeHead(400); res.end(); return; }
        const entry = files.get(key);
        if (!entry) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {
          ...(mode === 'noetag' || mode === 'nometadata' ? {} : { ETag: entry.etag }),
          ...(mode === 'nolastmodified' || mode === 'nometadata' ? {} : { 'Last-Modified': entry.lastModified })
        });
        res.end(req.method === 'GET' ? entry.body : undefined);
        return;
      }
      if (req.method === 'PUT') {
        const previous = files.get(key);
        const ifModifiedSince=req.headers['if-unmodified-since']?Date.parse(req.headers['if-unmodified-since']):null;
        if (mode === 'race' || mode==='reject-valid'&&req.headers['if-match']&&previous&&req.headers['if-match']===previous.etag || (req.headers['if-none-match'] === '*' && previous) || (mode!=='ignore-stale'&&req.headers['if-match']&&req.headers['if-match']!==previous?.etag) || Number.isFinite(ifModifiedSince)&&previous&&Date.parse(previous.lastModified)>ifModifiedSince) {
          res.writeHead(412); res.end(); return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        files.set(key, {
          body: Buffer.concat(chunks).toString(),
          etag: mode === 'stable-etag' && previous ? previous.etag : '"' + (previous ? Number(previous.etag.replaceAll('"', '')) + 1 : 1) + '"',
          lastModified: new Date().toUTCString()
        });
        res.writeHead(201); res.end(); return;
      }
      if(req.method==='DELETE'){if(!files.has(key)){res.writeHead(404);res.end();return;}files.delete(key);res.writeHead(204);res.end();return;}
      res.writeHead(405); res.end();
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server, files, directories, requests,
    settings: { webdavUrl: 'http://127.0.0.1:' + server.address().port + '/dav/', webdavRemotePath: '资料/Unified Manager' },
    setMode: value => { mode = value; },
    setDelay: value => { delayMs = Math.max(0, Number(value) || 0); },
    get aborted() { return aborted; },
    close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }
  };
};
