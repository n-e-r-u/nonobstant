'use strict';
// Routes de l'API. Lecture publique, écriture avec la clé.
const fs = require('fs');
const { send, readJson, keyOk, NEXT } = require('./http');
const { API_KEY } = require('./config');
const C = require('./coffre');

const num = (v, def, max) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def; };

async function apiRoutes(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/')) return NEXT;

  if (req.method === 'GET' && p === '/api/sante') return send(res, 200, { ok: true, ecriture: !!API_KEY, pdf: C.pdfReady() });

  // ---- Coffre des preuves ----
  if (p === '/api/coffre' && req.method === 'POST') {
    if (!keyOk(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    let b; try { b = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    const [st, out] = await C.archive(b.url, { tag: b.tag ? String(b.tag).slice(0, 40) : null, title: b.title, force: !!b.force });
    return send(res, st, out);
  }
  if (p === '/api/coffre' && req.method === 'GET') {
    const u = url.searchParams.get('url');
    if (!u) return send(res, 400, { error: 'Donne l’adresse (paramètre url).' });
    return send(res, 200, { url: u, copies: C.snapshots(u).map(C.view) });
  }
  if (p === '/api/coffre/recent' && req.method === 'GET')
    return send(res, 200, { copies: C.recent(num(url.searchParams.get('limit'), 50, 200), url.searchParams.get('tag')) });

  let m = p.match(/^\/api\/coffre\/([\w-]{6,24})$/);
  if (m && req.method === 'GET') { const r = C.view(C.rowOf(m[1])); return r ? send(res, 200, r) : send(res, 404, { error: 'Introuvable.' }); }

  // Copie complète : réservée à la clé. L'extrait et l'empreinte, eux, sont publics.
  m = p.match(/^\/api\/coffre\/([\w-]{6,24})\/copie$/);
  if (m && req.method === 'GET') {
    if (!keyOk(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    const f = C.filePath(m[1]);
    if (!f) return send(res, 404, { error: 'Copie introuvable.' });
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.bytes, 'Cache-Control': 'no-store',
      'X-Copie-Source': f.url, 'X-Copie-Date': new Date(f.t).toISOString() });
    return fs.createReadStream(f.path).pipe(res);
  }

  return send(res, 404, { error: 'Route inconnue.' });
}
module.exports = { apiRoutes };
