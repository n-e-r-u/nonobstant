'use strict';
// ---- Le coffre des preuves ----
// Au moment où une source est citée, une copie est prise, horodatée et empreintée. Six mois plus tard, quand la page a été
// corrigée sans mention ou purement effacée, on peut encore dire ce qu'elle disait ce jour-là, et le prouver.
//
// Ce qui est public : l'adresse, la date de la copie, l'empreinte sha256, la taille, le titre, et un extrait du texte.
// Ce qui ne l'est pas : la copie complète, qui reste sur le disque du serveur et ne sort qu'avec la clé.
// La distinction est volontaire. Archiver pour pouvoir prouver est une chose, rediffuser l'oeuvre d'autrui en est une autre :
// l'extrait suffit à citer, l'empreinte suffit à démontrer que la copie n'a pas bougé, et le reste n'a pas à être republié.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { COFFRE_DIR, EXTRACT_MAX, FETCH_MAX } = require('./config');
const { q } = require('./db');
const { fetchPublicFull, textOf } = require('./net');

// pdftotext (paquet poppler-utils) : testé une fois au démarrage. Sans lui, un PDF est archivé mais pas lu.
let PDF_OK = false;
execFile('pdftotext', ['-v'], { timeout: 5000 }, err => { PDF_OK = !err || err.code !== 'ENOENT'; });
const pdfReady = () => PDF_OK;

const EXT = { 'text/html': 'html', 'application/xhtml+xml': 'html', 'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/json': 'json', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/xml': 'xml', 'application/xml': 'xml' };
const mimeOf = ctype => String(ctype || '').split(';')[0].trim().toLowerCase();
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const unent = s => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;|&rsquo;/g, '’').replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ' '; } });

// Titre d'une page : la balise title, sinon og:title
function htmlTitle(html) {
  const t = (html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i) || [])[1]
    || (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,300})["']/i) || [])[1] || '';
  return unent(t).replace(/\s+/g, ' ').trim().slice(0, 300);
}
// Texte lisible d'une page : on retire ce qui n'est pas du contenu avant de retirer les balises
function htmlText(html) {
  return unent(String(html)
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}
// Texte d'un PDF : les 40 premières pages suffisent pour un extrait
function pdfText(buf) {
  return new Promise(ok => {
    if (!PDF_OK) return ok('');
    const file = path.join(os.tmpdir(), 'nonobstant-' + crypto.randomBytes(6).toString('hex') + '.pdf');
    try { fs.writeFileSync(file, buf, { mode: 0o600 }); } catch { return ok(''); }
    execFile('pdftotext', ['-l', '40', '-enc', 'UTF-8', file, '-'],
      { timeout: 90_000, maxBuffer: 40e6, env: { PATH: process.env.PATH || '/usr/bin:/bin' }, cwd: os.tmpdir() },
      (err, out) => { try { fs.unlinkSync(file); } catch { /* déjà parti */ } ok(err ? '' : String(out)); });
  });
}
async function readable(buf, mime, ctype) {
  if (mime === 'application/pdf') return { title: '', text: await pdfText(buf) };
  if (mime === 'text/html' || mime === 'application/xhtml+xml') { const h = textOf(buf, ctype); return { title: htmlTitle(h), text: htmlText(h) }; }
  if (mime.startsWith('text/') || mime === 'application/json') return { title: '', text: textOf(buf, ctype) };
  return { title: '', text: '' };
}

const newId = () => crypto.randomBytes(9).toString('base64url');
const rowOf = id => q('SELECT * FROM preuve WHERE id=?').get(id) || null;
const snapshots = url => q('SELECT * FROM preuve WHERE url=? ORDER BY t DESC').all(String(url));
// Vue publique : tout sauf le chemin du fichier sur le disque
const view = r => r && ({ id: r.id, url: r.url, t: r.t, status: r.status, mime: r.mime || null, bytes: r.bytes || null,
  sha256: r.sha256 || null, title: r.title || '', extrait: r.extrait || '', tag: r.tag || null, err: r.err || null });
const recent = (limit = 50, tag = null) => (tag
  ? q('SELECT * FROM preuve WHERE tag=? ORDER BY t DESC LIMIT ?').all(String(tag), limit)
  : q('SELECT * FROM preuve ORDER BY t DESC LIMIT ?').all(limit)).map(view);
// Chemin du fichier complet, pour la restitution avec la clé
function filePath(id) {
  const r = rowOf(id);
  if (!r || !r.file) return null;
  const p = path.join(COFFRE_DIR, path.basename(r.file));
  return fs.existsSync(p) ? { path: p, mime: r.mime || 'application/octet-stream', bytes: r.bytes || 0, url: r.url, t: r.t } : null;
}
const DAY = 24 * 60 * 60_000;

// Archive une source. Une copie identique prise le même jour n'est pas refaite : on renvoie celle qui existe.
async function archive(url, { tag = null, title = '', force = false, now = Date.now() } = {}) {
  let u; try { u = new URL(String(url)); } catch { return [400, { error: 'Adresse invalide.' }]; }
  if (!/^https?:$/.test(u.protocol)) return [400, { error: 'Seules les adresses http et https sont archivées.' }];
  u.hash = '';
  const same = snapshots(u.href).find(r => r.status === 'ok' && now - r.t < DAY);
  if (same && !force) return [200, view(same)];

  let r;
  try { r = await fetchPublicFull(u.href, { max: FETCH_MAX, timeout: 30_000, hops: 5, strict: false }); }
  catch (e) {
    // Un échec est une information : il date le moment où la source a cessé de répondre.
    const row = { id: newId(), url: u.href, t: now, status: 'err', err: String(e.message || e).slice(0, 200), tag };
    q('INSERT INTO preuve(id,url,t,status,err,tag) VALUES(?,?,?,?,?,?)').run(row.id, row.url, row.t, row.status, row.err, row.tag);
    return [502, view(rowOf(row.id))];
  }
  const mime = mimeOf(r.headers['content-type']) || 'application/octet-stream';
  const hash = sha256(r.buf);
  // Contenu inchangé depuis la dernière copie : on garde une seule copie sur le disque, pas une par passage
  const twin = snapshots(u.href).find(x => x.sha256 === hash && x.file);
  const id = newId();
  const file = twin ? twin.file : id + '.' + (EXT[mime] || 'bin');
  if (!twin) fs.writeFileSync(path.join(COFFRE_DIR, file), r.buf, { mode: 0o600 });
  const read = await readable(r.buf, mime, r.headers['content-type']);
  const extrait = read.text.replace(/\s+\n/g, '\n').trim().slice(0, EXTRACT_MAX);
  const t2 = String(title || read.title || '').slice(0, 300);
  q('INSERT INTO preuve(id,url,t,status,mime,bytes,sha256,title,extrait,file,tag) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, u.href, now, 'ok', mime, r.buf.length, hash, t2, extrait, file, tag);
  return [201, view(rowOf(id))];
}

module.exports = { archive, snapshots, recent, rowOf, view, filePath, htmlText, htmlTitle, sha256, pdfReady };
