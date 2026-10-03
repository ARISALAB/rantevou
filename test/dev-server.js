// Τοπικός server για δοκιμές χωρίς Netlify/Firebase: node test/dev-server.js  ->  http://localhost:8899/arakron
// Χωρίς εγκατάσταση πακέτων: το firebase-admin αντικαθίσταται από την ψεύτικη βάση
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'firebase-admin' || req === 'resend') return require.resolve('./fake-db.js');
  return origResolve.call(this, req, ...rest);
};
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FakeDb } = require('./fake-db');
global.__APPT_TEST_DB__ = new FakeDb();
global.__APPT_SENT__ = [];
process.env.ADMIN_KEY_ARAKRON = process.env.ADMIN_KEY_ARAKRON || 'dev-admin-key-123456';

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/.netlify/functions/')) {
    const name = url.pathname.split('/').pop();
    let body = '';
    for await (const c of req) body += c;
    try {
      const fn = require(path.join(ROOT, 'netlify/functions', name)).handler;
      const r = await fn({ httpMethod: req.method, body, headers: { 'x-nf-client-connection-ip': req.socket.remoteAddress + Math.random() }, queryStringParameters: Object.fromEntries(url.searchParams) });
      res.writeHead(r.statusCode, r.headers || {}); res.end(r.body);
    } catch (e) { console.error(e); res.writeHead(500); res.end('{}'); }
    return;
  }
  if (url.pathname === '/__sent') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(global.__APPT_SENT__)); return; }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || (!fs.existsSync(p) && !path.extname(p))) p = path.join(ROOT, 'index.html');
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 8899, () => console.log('http://localhost:' + (process.env.PORT || 8899) + '/arakron'));
