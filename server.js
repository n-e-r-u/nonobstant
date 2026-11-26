'use strict';
// Nonobstant : serveur du fonds documentaire. Sans dépendance, un seul processus, SQLite sur le disque.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { PORT, ROOT } = require('./src/config');
const { send, NEXT } = require('./src/http');
const { apiRoutes } = require('./src/api');

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// Fichier public : jamais de remontée hors du dossier, quelle que soit l'adresse demandée
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return NEXT;
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Interdit.');
  let st; try { st = fs.statSync(file); } catch { return NEXT; }
  if (!st.isFile()) return NEXT;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size, 'Cache-Control': 'public, max-age=300' });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'Requête invalide.'); }
  try {
    if (await apiRoutes(req, res, url) !== NEXT) return;
    if (serveStatic(req, res, url) !== NEXT) return;
    return send(res, 404, 'Page inconnue.');
  } catch (e) {
    console.error('requête', req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, 500, { error: 'Erreur du serveur.' });
  }
});
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;

if (require.main === module) {
  server.listen(PORT, () => console.log('Nonobstant écoute sur le port ' + PORT));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('arrêt'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
}
module.exports = { server };
