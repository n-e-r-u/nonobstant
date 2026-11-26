'use strict';
// ---- Veille des arrêtés préfectoraux ----
// Chaque site de préfecture est relu régulièrement. Les pages utiles (accueil, actualités, communiqués, recueil des actes
// administratifs de l'année et du mois) sont repérées seules, une fois par jour, parce que les 101 sites partagent le même
// moteur mais pas la même arborescence. Les documents qui apparaissent et dont le titre ou l'adresse parlent de manifestation,
// de périmètre, de couvre-feu, de drones sont téléchargés, confiés au coffre, lus, et transformés en arrêtés structurés.
// Les recueils ont des titres muets (« Recueil spécial n° 331 ») : ceux-là sont lus systématiquement, leur texte tranche.
//
// Ce que la veille ne fait pas : deviner. Un arrêté dont la zone ou la période ne se lisent pas part en file à compléter.
const crypto = require('crypto');
const { MIN } = require('../config');
const { q } = require('../db');
const { fetchPublicFull, textOf } = require('../net');
const { pdfReady, pdfTexte } = require('../pdf');
const { garder } = require('../coffre');
const { discoverPref } = require('./pages');
const { PREFECTURES } = require('./prefectures');
const { lireArretes } = require('./extraction');

q(`CREATE TABLE IF NOT EXISTS veille_src(id TEXT PRIMARY KEY, dep TEXT, url TEXT UNIQUE, label TEXT, kind TEXT DEFAULT 'page',
  t INTEGER, last INTEGER, ok INTEGER, err TEXT, n INTEGER, etag TEXT, lastmod TEXT, seen TEXT, pages TEXT)`).run();
q(`CREATE TABLE IF NOT EXISTS veille_doc(url TEXT PRIMARY KEY, src TEXT, dep TEXT, titre TEXT, t INTEGER,
  status TEXT, err TEXT, kw TEXT)`).run();
q(`CREATE TABLE IF NOT EXISTS arrete(id TEXT PRIMARY KEY, dep TEXT, commune TEXT, start INTEGER, fin INTEGER,
  items TEXT, src TEXT, doc TEXT, titre TEXT, extrait TEXT, etat TEXT, manque TEXT, preuve TEXT, t INTEGER)`).run();
q('CREATE INDEX IF NOT EXISTS arrete_t ON arrete(t)').run();
q('CREATE INDEX IF NOT EXISTS arrete_etat ON arrete(etat, fin)').run();
q("CREATE INDEX IF NOT EXISTS doc_todo ON veille_doc(status, t)").run();

const EVERY = +(process.env.VEILLE_EVERY_MS || 20 * MIN);
const PREF_EVERY = +(process.env.VEILLE_PREF_EVERY_MS || 30 * MIN);
const PAGE_GAP = +(process.env.VEILLE_PAGE_GAP_MS || 1500);
const SRC_GAP = +(process.env.VEILLE_GAP_MS || 3000);
const DOC_MAX = +(process.env.VEILLE_DOC_MAX || 25e6);
const SEEN_MAX = 3000;
const JOUR = 24 * 60 * MIN;
const UA = process.env.USER_AGENT_VEILLE || 'Nonobstant/1 (veille des actes administratifs ; relecture toutes les 20 minutes)';
const h12 = s => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Repérage des documents intéressants dans une liste de liens ----
const MOTS = [
  ['manifestation', /manifestation|manifester|cortege|defile/], ['rassemblement', /rassemblement|attroupement/],
  ['interdiction', /interdi(t|ction|sant)/], ['périmètre', /perimetre|zone de protection|zone protegee/],
  ['couvre-feu', /couvre[- ]?feu/], ['drones', /drone|aeronef|captation|camera(s)? aeroportee/],
  ['objets interdits', /artifice|objets? pouvant constituer une arme|port et (le )?transport|carburant|acide/],
  ['mesures de police', /mesures? de police|ordre public|maintien de l.ordre/],
  ['circulation', /circulation et (le )?stationnement|restriction(s)? de circulation/],
];
// « interdiction » et « circulation » sont trop larges seuls : sinon chaque interdiction de pêche remonte.
const LARGE = new Set(['interdiction', 'circulation']);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
function motsCles(titre, url) {
  let u = String(url); try { u = decodeURIComponent(u); } catch { /* adresse déjà lisible */ }
  const s = norm(titre + ' ' + u.replace(/[-_/.]+/g, ' '));
  const kw = MOTS.filter(([, re]) => re.test(s)).map(([k]) => k);
  return kw.some(k => !LARGE.has(k)) || kw.length >= 2 ? kw : [];
}
const decode = s => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;|&rsquo;/g, '’')
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ' '; } }).replace(/\s+/g, ' ').trim();
// Liens d'une page : flux RSS ou Atom (titre et lien de chaque article), sinon page HTML
function extractLinks(body, base) {
  const out = [], abs = u => { try { const x = new URL(decode(u).trim(), base); x.hash = ''; return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  if (/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000))) {
    for (const m of body.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
      const it = m[0], titre = decode((it.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const lien = (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || (it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || (it.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/i) || [])[1];
      const plus = decode((it.match(/<(description|summary)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || '').slice(0, 300);
      const u = lien && abs(lien); if (u && titre) out.push({ titre: titre.slice(0, 300), url: u, plus });
    }
    return out;
  }
  const html = body.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = abs(m[2] ?? m[3] ?? ''); if (!u) continue;
    const titre = decode(m[4]) || decode((m[0].match(/title\s*=\s*"([^"]+)"/i) || [])[1] || '');
    if (titre.length < 4) continue;
    out.push({ titre: titre.slice(0, 300), url: u });
  }
  return out;
}

// ---- Lecture des pages ----
const lourd = e => new Error(e.message === 'trop lourd' ? 'page trop lourde' : e.message);
async function lirePage(url, { etag = '', lastmod = '' } = {}) {
  const headers = { Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,*/*;q=0.5' };
  if (etag) headers['If-None-Match'] = etag;
  if (lastmod) headers['If-Modified-Since'] = lastmod;
  let r;
  try { r = await fetchPublicFull(url, { headers, ua: UA, max: 5e6, strict: true, timeout: 25_000, hops: 5 }); }
  catch (e) { throw lourd(e); }
  if (r.status === 304) return { same: true };
  return { texte: textOf(r.buf, r.headers['content-type']), etag: r.headers.etag || '', lastmod: r.headers['last-modified'] || '', url: r.url };
}
const getTexte = async url => (await lirePage(url)).texte || '';
const estPdf = u => /\/telechargement\/|\.pdf($|\?)/i.test(u);

// ---- Enregistrement des arrêtés lus ----
const idArrete = a => a.etat === 'complet'
  ? 'a' + h12([a.dep, a.commune, a.start, a.end, a.items[0].k].join('|'))
  : 'p' + h12([a.doc, a.items[0].text.slice(0, 80)].join('|'));
function noter(a, now) {
  const id = idArrete(a);
  return q(`INSERT OR IGNORE INTO arrete(id,dep,commune,start,fin,items,src,doc,titre,extrait,etat,manque,preuve,t)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, a.dep, a.commune || '', a.start ?? null, a.end ?? null,
    JSON.stringify(a.items), a.src, a.doc, a.titre || '', a.extrait || '', a.etat, a.manque || null, a.preuve || null, now).changes;
}
// Un document de la file : téléchargé une fois, confié au coffre, lu, puis transformé en arrêtés
async function lireDoc(d, now = Date.now()) {
  let r;
  try { r = await fetchPublicFull(d.url, { ua: UA, max: DOC_MAX, strict: true, timeout: 60_000, hops: 5 }); }
  catch (e) { q('UPDATE veille_doc SET status=?, err=? WHERE url=?').run('err', String(e.message || e).slice(0, 160), d.url); return { error: e.message }; }
  const ctype = r.headers['content-type'] || '';
  const pdf = /pdf/i.test(ctype) || estPdf(d.url);
  if (pdf && !pdfReady()) { q('UPDATE veille_doc SET status=?, err=? WHERE url=?').run('err', 'pdftotext absent', d.url); return { error: 'pdftotext absent' }; }
  const texte = pdf ? await pdfTexte(r.buf, { pages: 300, timeout: 180_000 }) : textOf(r.buf, ctype);
  let preuve = null;
  try { const [, p] = await garder(d.url, r.buf, ctype, { tag: 'arrete', title: d.titre, now }); preuve = p && p.id; }
  catch (e) { console.error('coffre', e.message); }
  const lus = lireArretes(texte, { dep: d.dep, src: d.url, now, titre: d.titre || '' });
  let neufs = 0;
  for (const a of lus) neufs += noter({ ...a, doc: d.url, preuve }, now);
  q('UPDATE veille_doc SET status=?, err=NULL WHERE url=?').run('lu', d.url);
  return { arretes: lus.length, neufs, preuve, pdf };
}
async function lireDocs(max = 4) {
  let n = 0;
  for (const d of q("SELECT * FROM veille_doc WHERE status='todo' ORDER BY t LIMIT ?").all(max)) { await lireDoc(d); n++; }
  return n;
}
const docQueue = () => q("SELECT COUNT(*) n FROM veille_doc WHERE status='todo'").get().n;
// Un document est mis en file soit parce que son titre parle de nos sujets, soit parce que c'est un recueil (titre muet)
function enFile(l, s, page, now) {
  const kw = motsCles(l.titre + ' ' + (l.plus || ''), l.url);
  const recueil = page.kind === 'raa' && estPdf(l.url);
  if (!kw.length && !recueil) return 0;
  return q('INSERT OR IGNORE INTO veille_doc(url,src,dep,titre,t,status,kw) VALUES(?,?,?,?,?,?,?)')
    .run(l.url, s.id, s.dep, String(l.titre || '').slice(0, 200), now, 'todo', kw.join(', ')).changes;
}

// ---- Un tour sur une source ----
// Première lecture d'une page : tout ce qui s'y trouve déjà sert de référence, sans rien mettre en file.
// Sinon le premier passage sur une préfecture téléchargerait des années de recueils.
async function verifierPref(s, now) {
  let pg = { t: 0, list: [], known: [] }; try { pg = { ...pg, ...JSON.parse(s.pages || '{}') }; } catch { /* état illisible : on repère à neuf */ }
  if (!pg.t || now - pg.t > JOUR || !pg.list.length) {
    try { pg.list = await discoverPref(getTexte, s.url, now); pg.t = now; }
    catch (e) { if (!pg.list.length) { q('UPDATE veille_src SET last=?, ok=0, err=? WHERE id=?').run(now, String(e.message || e).slice(0, 160), s.id); return { error: e.message }; } }
  }
  let vus = []; try { vus = JSON.parse(s.seen || '[]'); } catch { /* repart de zéro */ }
  const premiere = !s.seen, connues = new Set(pg.known), set = new Set(vus);
  let mis = 0, total = 0, okPages = 0, derniere = '';
  for (const page of pg.list) {
    let liens;
    try { liens = extractLinks(await getTexte(page.url), page.url); okPages++; }
    catch (e) { derniere = e.message; continue; }
    total += liens.length;
    const reference = premiere || !connues.has(page.url);
    for (const l of liens) {
      const k = h12(l.url); if (set.has(k)) continue; set.add(k); vus.push(k);
      if (!reference) mis += enFile(l, s, page, now);
    }
    connues.add(page.url);
    await sleep(PAGE_GAP);
  }
  q('UPDATE veille_src SET last=?, ok=?, err=?, n=?, seen=?, pages=? WHERE id=?').run(now, okPages ? 1 : 0,
    okPages ? null : (derniere || 'aucune page lue').slice(0, 160), total, JSON.stringify(vus.slice(-SEEN_MAX * 2)),
    JSON.stringify({ t: pg.t, list: pg.list, known: [...connues].slice(-60) }), s.id);
  return okPages ? { mis, liens: total, premiere, pages: pg.list.length } : { error: derniere || 'aucune page lue' };
}
async function verifierPage(s, now) {
  let res;
  try { res = await lirePage(s.url, { etag: s.etag, lastmod: s.lastmod }); }
  catch (e) { q('UPDATE veille_src SET last=?, ok=0, err=? WHERE id=?').run(now, String(e.message || e).slice(0, 160), s.id); return { error: e.message }; }
  if (res.same) { q('UPDATE veille_src SET last=?, ok=1, err=NULL WHERE id=?').run(now, s.id); return { mis: 0, inchangee: true }; }
  const liens = extractLinks(res.texte, res.url);
  let vus = []; try { vus = JSON.parse(s.seen || '[]'); } catch { /* repart de zéro */ }
  const premiere = !s.seen, connus = new Set(vus);
  let mis = 0;
  for (const l of liens) {
    const k = h12(l.url); if (connus.has(k)) continue; connus.add(k); vus.push(k);
    if (!premiere) mis += enFile(l, s, { kind: s.kind === 'raa' ? 'raa' : 'news' }, now);
  }
  q('UPDATE veille_src SET last=?, ok=1, err=NULL, n=?, etag=?, lastmod=?, seen=? WHERE id=?')
    .run(now, liens.length, res.etag, res.lastmod, JSON.stringify(vus.slice(-SEEN_MAX)), s.id);
  return { mis, liens: liens.length, premiere };
}
const verifier = (s, now = Date.now()) => s.kind === 'pref' ? verifierPref(s, now) : verifierPage(s, now);

let enCours = false;
async function tick() {
  if (enCours) return; enCours = true;
  try {
    const now = Date.now();
    const dues = q(`SELECT * FROM veille_src WHERE last IS NULL OR (kind='pref' AND last<?) OR (kind IS NOT 'pref' AND last<?)
      ORDER BY last LIMIT 30`).all(now - PREF_EVERY, now - EVERY);
    for (const s of dues) { await verifier(s, Date.now()); await lireDocs(2); await sleep(SRC_GAP); }
    await lireDocs(6);
    // Un arrêté terminé depuis plus d'un mois ne sert plus ; les documents lus non plus
    q('DELETE FROM arrete WHERE fin IS NOT NULL AND fin<?').run(now - 30 * JOUR);
    q("DELETE FROM veille_doc WHERE status!='todo' AND t<?").run(now - 14 * JOUR);
  } catch (e) { console.error('veille', e.message); }
  finally { enCours = false; }
}
if (process.env.VEILLE !== '0') setInterval(tick, +(process.env.VEILLE_TICK_MS || 60_000)).unref();

// ---- Sources ----
const srcRow = id => q('SELECT * FROM veille_src WHERE id=?').get(id);
const srcView = s => { let pages = 0; try { pages = (JSON.parse(s.pages || '{}').list || []).length; } catch { /* rien repéré */ }
  return { id: s.id, dep: s.dep, url: s.url, label: s.label || '', kind: s.kind || 'page', pages, last: s.last, ok: !!s.ok, err: s.err || '', n: s.n || 0 }; };
const sources = () => q('SELECT * FROM veille_src ORDER BY dep, url').all().map(srcView);
async function srcAdd(b) {
  const url = String(b.url || '').trim(), dep = String(b.dep || '').trim().toUpperCase();
  if (!/^https?:\/\/[^\s"<>]{4,400}$/.test(url)) return [400, { error: 'Adresse invalide.' }];
  if (dep && !/^(\d{2}|97\d|2A|2B)$/.test(dep)) return [400, { error: 'Département invalide.' }];
  if (q('SELECT 1 FROM veille_src WHERE url=?').get(url)) return [409, { error: 'Cette source est déjà surveillée.' }];
  if (q('SELECT COUNT(*) n FROM veille_src').get().n >= 400) return [400, { error: '400 sources au plus.' }];
  const id = crypto.randomBytes(6).toString('base64url');
  const kind = ['pref', 'raa', 'page'].includes(b.kind) ? b.kind : 'page';
  q('INSERT INTO veille_src(id,dep,url,label,t,kind) VALUES(?,?,?,?,?,?)').run(id, dep, url, String(b.label || '').trim().slice(0, 60), Date.now(), kind);
  const r = await verifier(srcRow(id));
  return [201, { ...srcView(srcRow(id)), ...(r.error ? { error: r.error } : {}) }];
}
// Les 101 préfectures d'un coup. Rien n'est lu tout de suite : le tour de veille s'en charge, étalé.
function srcAddAll() {
  let ajoutees = 0;
  for (const p of PREFECTURES) {
    if (q('SELECT 1 FROM veille_src WHERE url=?').get(p.url)) continue;
    q('INSERT INTO veille_src(id,dep,url,label,t,kind) VALUES(?,?,?,?,?,?)').run(crypto.randomBytes(6).toString('base64url'), p.dep, p.url, p.label, Date.now(), 'pref');
    ajoutees++;
  }
  return [200, { ajoutees, total: q('SELECT COUNT(*) n FROM veille_src').get().n }];
}
const srcDel = id => { const n = q('DELETE FROM veille_src WHERE id=?').run(id).changes; return n ? [200, { ok: true }] : [404, { error: 'Introuvable.' }]; };
async function srcTest(id) {
  const s = srcRow(id); if (!s) return [404, { error: 'Source introuvable.' }];
  const r = await verifier(s);
  await lireDocs(4);
  return [200, { ...srcView(srcRow(id)), ...r }];
}

// ---- Vue des arrêtés ----
const vue = a => ({ id: a.id, dep: a.dep, commune: a.commune || '', start: a.start, end: a.fin, items: JSON.parse(a.items),
  src: a.src, doc: a.doc, titre: a.titre || '', extrait: a.extrait || '', etat: a.etat, manque: a.manque || null, preuve: a.preuve || null, t: a.t });
function arretes({ etat = null, depuis = 0, limit = 100, now = Date.now() } = {}) {
  const cond = ['(fin IS NULL OR fin>?)', 't>?'], args = [now, +depuis || 0];
  if (etat) { cond.push('etat=?'); args.push(etat); }
  return q(`SELECT * FROM arrete WHERE ${cond.join(' AND ')} ORDER BY t DESC LIMIT ?`).all(...args, Math.min(+limit || 100, 500)).map(vue);
}
const etat = () => ({ sources: q('SELECT COUNT(*) n FROM veille_src').get().n, prefectures: PREFECTURES.length,
  file: docQueue(), pdf: pdfReady(), every: EVERY, prefEvery: PREF_EVERY,
  complets: q("SELECT COUNT(*) n FROM arrete WHERE etat='complet'").get().n,
  partiels: q("SELECT COUNT(*) n FROM arrete WHERE etat='partiel'").get().n });

module.exports = { tick, verifier, extractLinks, motsCles, lireDoc, lireDocs, docQueue, noter, idArrete,
  sources, srcAdd, srcAddAll, srcDel, srcTest, arretes, etat, vue };
