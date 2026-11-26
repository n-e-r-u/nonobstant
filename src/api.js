'use strict';
// Routes de l'API. Lecture publique, écriture avec la clé.
const fs = require('fs');
const { send, readJson, keyOk, NEXT } = require('./http');
const { API_KEY } = require('./config');
const C = require('./coffre');
const V = require('./veille/arretes');

const num = (v, def, max) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def; };

async function apiRoutes(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/')) return NEXT;

  if (req.method === 'GET' && p === '/api/sante') return send(res, 200, { ok: true, ecriture: !!API_KEY, pdf: C.pdfReady() });

  // ---- Arrêtés : lecture publique. « complet » est publiable tel quel, « partiel » demande une main humaine. ----
  if (req.method === 'GET' && p === '/api/arretes') {
    const etat = url.searchParams.get('etat');
    if (etat && !['complet', 'partiel'].includes(etat)) return send(res, 400, { error: 'État inconnu (complet ou partiel).' });
    return send(res, 200, { arretes: V.arretes({ etat, depuis: url.searchParams.get('depuis'), limit: num(url.searchParams.get('limit'), 100, 500) }) });
  }

  // ---- Numéros de legal team : jamais publiés tout seuls, ils alimentent une file de validation ----
  if (req.method === 'GET' && p === '/api/legal') {
    if (!keyOk(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    const status = url.searchParams.get('status');
    if (status && !['neuf', 'propose', 'ignore', 'disparu'].includes(status)) return send(res, 400, { error: 'État inconnu.' });
    return send(res, 200, { ...V.legal.etatLegal(), candidats: V.legal.legalCandidats({ status, depuis: url.searchParams.get('depuis'), limit: num(url.searchParams.get('limit'), 100, 500) }) });
  }
  const ml = p.match(/^\/api\/legal\/([\w-]{6,24})$/);
  if (ml && req.method === 'POST') {
    if (!keyOk(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    let b; try { b = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, ...V.legal.marquer(ml[1], String(b.status || '')));
  }

  // ---- Veille : la configuration et les relances demandent la clé ----
  if (p.startsWith('/api/veille')) {
    if (!keyOk(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    if (req.method === 'GET' && p === '/api/veille') return send(res, 200, { ...V.etat(), sources: V.sources() });
    if (req.method === 'POST' && p === '/api/veille/tour') { await V.tick(); return send(res, 200, V.etat()); }
    if (req.method === 'POST' && p === '/api/veille/sources/prefectures') return send(res, ...V.srcAddAll());
    if (req.method === 'POST' && p === '/api/veille/sources') {
      let b; try { b = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, ...await V.srcAdd(b));
    }
    const m2 = p.match(/^\/api\/veille\/sources\/([\w-]{1,16})(\/test)?$/);
    if (m2 && req.method === 'POST' && m2[2]) return send(res, ...await V.srcTest(m2[1]));
    if (m2 && req.method === 'DELETE' && !m2[2]) return send(res, ...V.srcDel(m2[1]));
    return send(res, 404, { error: 'Route inconnue.' });
  }

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
