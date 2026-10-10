'use strict';
// Static server for the Pacing Frontier AI microsite in ./site.
// Zero dependencies: Node 20+ built-ins only (http, fs, path, zlib, crypto).
//
//   node server.js
//
// Environment (see README.md):
//   PORT           port to listen on; Railway sets it. Default 8080.
//   SITE_PASSWORD  when set, every path except /healthz requires HTTP Basic Auth.
//   SITE_USER      the Basic Auth user name. Default "guest".
//   SITE_NOINDEX   "1" sends X-Robots-Tag: noindex, nofollow and makes robots.txt disallow all.
//   SITE_URL       public base URL, such as https://example.org. robots.txt then points to /sitemap.xml.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, 'site');
const HOST = '0.0.0.0';
const PORT = toPort(process.env.PORT);
const PASSWORD = process.env.SITE_PASSWORD || '';
const USER = process.env.SITE_USER || 'guest';
const NOINDEX = /^(1|true|yes|on)$/i.test((process.env.SITE_NOINDEX || '').trim());
const SITE_URL = toSiteUrl(process.env.SITE_URL);
const REALM = 'Pacing Frontier AI';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|manifest\+json)|image\/svg\+xml)/;

// ------------------------------------------------------------------ load and precompress the site
const t0 = Date.now();
const FILES = new Map(); // URL path ("/stop.html") -> entry
if (!fs.existsSync(ROOT)) {
  console.error(`No site folder at ${ROOT}. Build the site first (scripts/refresh.sh).`);
  process.exit(1);
}
for (const [urlPath, file] of walk(ROOT, '')) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  FILES.set(urlPath, makeEntry(fs.readFileSync(file), type));
}
if (!FILES.has('/index.html')) {
  console.error(`No index.html in ${ROOT}. Build the site first (scripts/refresh.sh).`);
  process.exit(1);
}
// 404.html answers unknown paths, always with status 404, so it is not routable itself.
const NOT_FOUND = FILES.get('/404.html') || makeEntry(Buffer.from('Not found\n'), TYPES['.txt']);
FILES.delete('/404.html');
const PAGES = [...FILES.keys()].filter(k => k.endsWith('.html')).sort((a, b) => (a === '/index.html' ? -1 : b === '/index.html' ? 1 : a.localeCompare(b)));

const PAGE_CSP = buildCsp([...FILES.values(), NOT_FOUND].filter(e => e.html));
// Everything that is not a page (CSS, JS, JSON, SVG, robots.txt, sitemap.xml, plain-text replies)
// may still be opened directly. Scripts stay blocked; Chrome's built-in text and XML viewers add
// inline styles and data: icons of their own, so those are allowed.
const OTHER_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'";
const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

const ROBOTS = makeEntry(Buffer.from(NOINDEX
  ? 'User-agent: *\nDisallow: /\n'
  : `User-agent: *\nAllow: /\n${SITE_URL ? `\nSitemap: ${SITE_URL}/sitemap.xml\n` : ''}`), TYPES['.txt']);
const SITEMAP = SITE_URL && !NOINDEX ? makeEntry(Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + PAGES.map(p => `  <url><loc>${xmlEscape(SITE_URL + (p === '/index.html' ? '/' : p))}</loc></url>\n`).join('')
  + '</urlset>\n'), TYPES['.xml']) : null;

const AUTH = PASSWORD ? { user: digest(USER), pass: digest(PASSWORD) } : null;

const all = [...FILES.values(), NOT_FOUND, ROBOTS, SITEMAP].filter(Boolean);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
console.log(`site: ${FILES.size} files, ${mb(sum(all, e => e.body.length))} from ${ROOT}; gzip ${mb(sum(all, e => (e.gzip || e).body.length))} in ${Date.now() - t0} ms`);
console.log(AUTH ? `access: Basic Auth required for every path except /healthz (user "${USER}")` : 'access: public');
console.log(NOINDEX ? 'indexing: blocked (X-Robots-Tag and robots.txt)'
  : SITE_URL ? `indexing: allowed, sitemap at ${SITE_URL}/sitemap.xml` : 'indexing: allowed (set SITE_URL to publish a sitemap)');
if (process.env.SITE_URL && !SITE_URL) console.warn(`warning: SITE_URL "${process.env.SITE_URL}" is not an http(s) URL; ignored`);

// ------------------------------------------------------------------ server
const server = http.createServer((req, res) => {
  const started = process.hrtime.bigint();
  res.on('close', () => logLine(req, res, started));
  try {
    route(req, res);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    if (!res.headersSent) sendText(req, res, 500, 'Internal server error\n');
    else res.destroy();
  }
});
server.keepAliveTimeout = 65000; // longer than the 60 s idle timeout of Railway's edge proxy
server.headersTimeout = 66000;
server.on('error', err => { console.error(`server error: ${err.message}`); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log(`listening on http://${HOST}:${PORT}`);
  // Brotli at quality 11 takes a few seconds for the whole site, so it runs on zlib's thread pool
  // after the server is up. Until an entry's brotli copy is ready, clients get gzip.
  const b0 = Date.now();
  Promise.all(all.filter(e => e.compressible).map(addBrotli)).then(() => {
    console.log(`brotli: ready in ${Date.now() - b0} ms, ${mb(sum(all, e => (e.br || e.gzip || e).body.length))} total`);
  });
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

function route(req, res) {
  const p = requestPath(req.url);
  if (p === null) return sendText(req, res, 400, 'Bad request\n');
  const getOrHead = req.method === 'GET' || req.method === 'HEAD';
  if (p === '/healthz') return getOrHead ? sendText(req, res, 200, 'ok') : notAllowed(req, res);
  if (AUTH && !authorized(req)) {
    return sendText(req, res, 401, 'Authentication required\n', { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` });
  }
  if (!getOrHead) return notAllowed(req, res);
  if (p === '/robots.txt') return sendEntry(req, res, 200, ROBOTS);
  if (p === '/sitemap.xml' && SITEMAP) return sendEntry(req, res, 200, SITEMAP);
  const entry = lookup(p);
  return entry ? sendEntry(req, res, 200, entry) : sendEntry(req, res, 404, NOT_FOUND);
}

// "/" is index.html; a path with no extension tries the same path plus ".html".
function lookup(p) {
  if (p === '/') return FILES.get('/index.html');
  if (FILES.has(p)) return FILES.get(p);
  if (!p.endsWith('/') && !path.posix.extname(p)) return FILES.get(p + '.html');
  return undefined;
}

// Decoded URL path, or null for a malformed or traversing one. Files are served only from the
// in-memory map built at startup, so no request can reach a file outside ./site in any case.
function requestPath(url) {
  let target = url || '/';
  if (target[0] !== '/') { // absolute-form request target
    const m = /^https?:\/\/[^/?#]*([^?#]*)/i.exec(target);
    if (!m) return null;
    target = m[1] || '/';
  }
  const cut = target.search(/[?#]/);
  let p = cut >= 0 ? target.slice(0, cut) : target;
  try { p = decodeURIComponent(p); } catch { return null; }
  if (p.includes('\0') || p.includes('\\') || p.split('/').includes('..')) return null;
  return path.posix.normalize(p);
}

function authorized(req) {
  const m = /^Basic\s+(\S+)\s*$/i.exec(req.headers.authorization || '');
  const decoded = m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
  const i = decoded.indexOf(':');
  const user = i >= 0 ? decoded.slice(0, i) : '';
  const pass = i >= 0 ? decoded.slice(i + 1) : '';
  // Compare fixed-length digests in constant time, and always compare both fields.
  const okUser = crypto.timingSafeEqual(digest(user), AUTH.user);
  const okPass = crypto.timingSafeEqual(digest(pass), AUTH.pass);
  return (Number(okUser) & Number(okPass)) === 1;
}

// ------------------------------------------------------------------ responses
function securityHeaders(req, isPage) {
  const h = {
    'Content-Security-Policy': isPage ? PAGE_CSP : OTHER_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS,
  };
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  if (NOINDEX) h['X-Robots-Tag'] = 'noindex, nofollow';
  return h;
}

function sendEntry(req, res, status, entry) {
  const enc = negotiate(req.headers['accept-encoding'], entry);
  const variant = enc === 'br' ? entry.br : enc === 'gzip' ? entry.gzip : entry;
  const headers = securityHeaders(req, entry.html);
  // Behind a password, keep responses out of shared caches.
  headers['Cache-Control'] = (AUTH ? 'private, ' : '') + (entry.html ? 'no-cache' : 'max-age=3600');
  if (entry.compressible) headers['Vary'] = 'Accept-Encoding';
  if (status === 200) {
    headers['ETag'] = variant.etag;
    if (etagMatches(req.headers['if-none-match'], variant.etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
  }
  headers['Content-Type'] = entry.type;
  headers['Content-Length'] = variant.body.length;
  if (enc) headers['Content-Encoding'] = enc;
  res.writeHead(status, headers);
  res.sentEncoding = enc;
  res.sentBytes = req.method === 'HEAD' ? 0 : variant.body.length;
  res.end(req.method === 'HEAD' ? undefined : variant.body);
}

function sendText(req, res, status, text, extra) {
  const body = Buffer.from(text);
  res.writeHead(status, {
    ...securityHeaders(req, false),
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.sentBytes = req.method === 'HEAD' ? 0 : body.length;
  res.end(req.method === 'HEAD' ? undefined : body);
}

function notAllowed(req, res) {
  return sendText(req, res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
}

// Pick br or gzip by the client's Accept-Encoding q-values; br wins a tie.
function negotiate(header, entry) {
  if (!header || !(entry.gzip || entry.br)) return null;
  const q = {};
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map(s => s.trim());
    if (!name) continue;
    const qp = params.find(s => s.startsWith('q='));
    const w = qp ? Number(qp.slice(2)) : 1;
    q[name] = Number.isFinite(w) ? w : 0;
  }
  const weight = n => (n in q ? q[n] : '*' in q ? q['*'] : 0);
  const br = entry.br ? weight('br') : 0;
  const gz = entry.gzip ? Math.max(weight('gzip'), weight('x-gzip')) : 0;
  if (br > 0 && br >= gz) return 'br';
  return gz > 0 ? 'gzip' : null;
}

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(t => t.trim().replace(/^W\//, '') === etag);
}

// ------------------------------------------------------------------ helpers
function makeEntry(body, type) {
  const hash = crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27);
  const entry = { type, body, etag: `"${hash}"`, html: type.startsWith('text/html'), compressible: COMPRESSIBLE.test(type), gzip: null, br: null };
  if (entry.compressible) {
    const gz = zlib.gzipSync(body, { level: 9 });
    if (gz.length < body.length) entry.gzip = { body: gz, etag: `"${hash}-gz"` };
  }
  return entry;
}

function addBrotli(entry) {
  const params = {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.body.length,
  };
  return new Promise(resolve => {
    zlib.brotliCompress(entry.body, { params }, (err, out) => {
      if (err) console.error(`brotli failed: ${err.message}`);
      else if (out.length < entry.body.length) entry.br = { body: out, etag: entry.etag.slice(0, -1) + '-br"' };
      resolve();
    });
  });
}

// The pages load scripts and styles only from this origin, the Google Fonts stylesheet from
// fonts.googleapis.com, font files from fonts.gstatic.com, data: images (CSS masks), and the
// search index by fetch(). The current build has no inline scripts or styles. If a later build
// adds inline <script> or <style> blocks, their hashes are allowed here at startup.
function buildCsp(htmlEntries) {
  const scripts = new Set();
  const styles = new Set();
  let attrs = 0;
  for (const e of htmlEntries) {
    const html = e.body.toString('utf8').replace(/\r\n?/g, '\n');
    for (const [, a, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (code && !/\bsrc\s*=/i.test(a) && !/\btype\s*=\s*["']?application\/(ld\+)?json/i.test(a)) scripts.add(sha256(code));
    }
    for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) styles.add(sha256(css));
    attrs += (html.match(/<[a-z][^>]*?\s(?:style|on[a-z]+)\s*=/gi) || []).length;
  }
  if (attrs) console.warn(`warning: ${attrs} style attributes or inline event handlers found; the CSP blocks them`);
  const extra = set => [...set].map(h => ` 'sha256-${h}'`).join('');
  return [
    "default-src 'none'",
    `script-src 'self'${extra(scripts)}`,
    `style-src 'self' https://fonts.googleapis.com${extra(styles)}`,
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function walk(dir, base) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(abs, `${base}/${d.name}`));
    else if (d.isFile()) out.push([`${base}/${d.name}`, abs]);
  }
  return out;
}

function logLine(req, res, started) {
  const ms = (Number(process.hrtime.bigint() - started) / 1e6).toFixed(1);
  const ip = String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '-')
    .trim().replace(/[^\w.:%-]/g, '').slice(0, 64) || '-';
  const url = String(req.url).replace(/[\x00-\x20\x7f]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).slice(0, 300);
  let line = `${new Date().toISOString()} ${ip} ${req.method} ${url} ${res.statusCode} ${res.sentBytes || 0}B ${ms}ms`;
  if (res.sentEncoding) line += ` ${res.sentEncoding}`;
  if (!res.writableFinished) line += ' aborted';
  console.log(line);
}

function toPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8080;
}

function toSiteUrl(v) {
  const s = (v || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(s) ? s : '';
}

function digest(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest(); }
function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('base64'); }
function sum(list, f) { return list.reduce((n, x) => n + f(x), 0); }
function xmlEscape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
