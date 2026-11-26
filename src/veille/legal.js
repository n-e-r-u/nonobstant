'use strict';
// ---- Veille des numéros de legal team ----
// Il n'existe aucun registre. Un numéro de legal team est annoncé mobilisation par mobilisation, sur le site d'un collectif
// antirépression, d'un média local indépendant ou d'un syndicat, et il change d'une manifestation à l'autre. La veille lit
// les pages qu'on lui donne et en tire des candidats, avec leur phrase et leur source. Elle ne publie rien : un numéro faux
// envoie quelqu'un en garde à vue appeler le vide, donc la validation reste humaine, côté administration.
//
// Deux garde-fous sur ce qui est retenu. Un numéro n'est gardé que si son entourage parle d'antirépression (legal team,
// garde à vue, interpellation, avocat·e) : sans ça, la veille ramasserait le numéro du secrétariat, celui d'un commerce,
// ou celui d'une personne privée dans un article voisin. Et la liste des pages surveillées n'est pas dans ce dépôt :
// elle vit dans la configuration du serveur, pour ne pas publier un annuaire des collectifs à surveiller.
const crypto = require('crypto');
const { MIN } = require('../config');
const { q } = require('../db');
const { garder } = require('../coffre');
const { aplat, plier } = require('./texte');

q(`CREATE TABLE IF NOT EXISTS legal_cand(id TEXT PRIMARY KEY, tel TEXT, indice TEXT, contexte TEXT, titre TEXT, url TEXT,
  src TEXT, t INTEGER, vu INTEGER, status TEXT, preuve TEXT)`).run();
q('CREATE INDEX IF NOT EXISTS legal_cand_t ON legal_cand(t)').run();
q('CREATE INDEX IF NOT EXISTS legal_cand_status ON legal_cand(status)').run();

const JOUR = 24 * 60 * MIN;
// Numéros français, toutes écritures confondues, ramenés à 0XXXXXXXXX
const TEL = /(?:\+33[\s.\-]?|0)[1-9](?:[\s.\-]?\d{2}){4}/g;
const chiffres = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2); return d; };
// L'entourage doit parler d'antirépression. Sans ça, le numéro n'est pas retenu.
const ANTIREP = /legal ?team|antirep|anti[- ]?repression|garde a vue|gav\b|interpellation|interpelle|arrestation|avocat|permanence juridique|defense collective|caisse de solidarite/;
// Indice de rattachement : le nom d'une legal team ou un numéro de département, pour aider la validation
function indiceDe(contexte, titre) {
  const f = plier(contexte + ' ' + titre);
  const nom = /(?:legal ?team|collectif|defense collective|permanence)\s+(?:de\s+|d'|du\s+)?([a-z][\w'-]{2,24})/.exec(f);
  const dep = /(?:legal ?team|collectif|antirep)\s*(\d{2,3})\b/.exec(f);
  if (dep) return 'département ' + dep[1];
  if (nom && !['qui', 'est', 'sera', 'de', 'la', 'le', 'les', 'des', 'nous', 'vous'].includes(nom[1])) return nom[1];
  return '';
}
// Fenêtre autour du numéro, bornée aux mots entiers. Pas la phrase seule : « Legal Team 71 : 06 … » met ce qui identifie
// le collectif avant le deux-points, et la personne qui valide a besoin de le voir.
function autourDe(flat, at, avant = 150, apres = 170) {
  const d = Math.max(0, at - avant), f = Math.min(flat.length, at + apres);
  let bout = flat.slice(d, f);
  if (d > 0) bout = bout.replace(/^\S*\s/, '…');
  if (f < flat.length) bout = bout.replace(/\s\S*$/, '…');
  return bout.trim();
}
const idDe = (tel, url) => 'l' + crypto.createHash('sha256').update(tel + '|' + url).digest('base64url').slice(0, 12);

// Candidats trouvés dans un texte. Fonction pure : testable sans réseau.
function candidats(texte, { titre = '', url = '' } = {}) {
  const flat = aplat(texte), fold = plier(flat), out = [], vus = new Set();
  for (const m of flat.matchAll(TEL)) {
    const tel = chiffres(m[0]);
    if (tel.length !== 10 || vus.has(tel)) continue;
    const autour = fold.slice(Math.max(0, m.index - 220), m.index + 220);
    if (!ANTIREP.test(autour)) continue;
    const contexte = autourDe(flat, m.index);
    vus.add(tel);
    out.push({ tel, contexte, indice: indiceDe(autour, titre), titre: String(titre).slice(0, 200), url });
  }
  return out;
}
// Enregistre les candidats d'une page. Un numéro déjà connu pour cette page voit seulement sa date de dernière vue avancer.
function noter(liste, { src = '', preuve = null, now = Date.now() } = {}) {
  let neufs = 0;
  for (const c of liste) {
    const id = idDe(c.tel, c.url);
    const n = q(`INSERT OR IGNORE INTO legal_cand(id,tel,indice,contexte,titre,url,src,t,vu,status,preuve)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, c.tel, c.indice || '', c.contexte, c.titre, c.url, src, now, now, 'neuf', preuve).changes;
    if (n) neufs++; else q('UPDATE legal_cand SET vu=? WHERE id=?').run(now, id);
  }
  return neufs;
}
// Un numéro qui a disparu de sa page est une information : il a sans doute cessé d'être valable.
// On ne le supprime pas, on le signale, et c'est l'administration qui décide.
function disparus(url, now = Date.now(), tolerance = 2 * JOUR) {
  const r = q("UPDATE legal_cand SET status='disparu' WHERE url=? AND status='neuf' AND vu<?").run(String(url), now - tolerance);
  return r.changes;
}

// Lecture d'une page de collectif : les candidats, et une copie au coffre pour pouvoir montrer d'où venait le numéro.
async function lireSource(s, lirePage, now = Date.now()) {
  let res;
  try { res = await lirePage(s.url); }
  catch (e) { q('UPDATE veille_src SET last=?, ok=0, err=? WHERE id=?').run(now, String(e.message || e).slice(0, 160), s.id); return { error: e.message }; }
  const texte = res.texte || '';
  const titre = (texte.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i) || [])[1] || s.label || '';
  const sansBalise = aplat(texte.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
  let preuve = null;
  try { const [, p] = await garder(s.url, Buffer.from(texte, 'utf8'), 'text/html', { tag: 'legal', title: aplat(titre), now }); preuve = p && p.id; }
  catch (e) { console.error('coffre', e.message); }
  const liste = candidats(sansBalise, { titre: aplat(titre), url: s.url });
  const neufs = noter(liste, { src: s.id, preuve, now });
  const partis = disparus(s.url, now);
  q('UPDATE veille_src SET last=?, ok=1, err=NULL, n=? WHERE id=?').run(now, liste.length, s.id);
  return { candidats: liste.length, neufs, partis };
}

const vue = c => ({ id: c.id, tel: c.tel, indice: c.indice || '', contexte: c.contexte, titre: c.titre || '', url: c.url,
  status: c.status, preuve: c.preuve || null, t: c.t, vu: c.vu });
function legalCandidats({ status = null, depuis = 0, limit = 100 } = {}) {
  const cond = ['t>?'], args = [+depuis || 0];
  if (status) { cond.push('status=?'); args.push(status); }
  return q(`SELECT * FROM legal_cand WHERE ${cond.join(' AND ')} ORDER BY t DESC LIMIT ?`).all(...args, Math.min(+limit || 100, 500)).map(vue);
}
function marquer(id, status) {
  if (!['neuf', 'propose', 'ignore', 'disparu'].includes(status)) return [400, { error: 'État inconnu.' }];
  const r = q('UPDATE legal_cand SET status=? WHERE id=?').run(status, id);
  return r.changes ? [200, { ok: true }] : [404, { error: 'Introuvable.' }];
}
const etatLegal = () => ({ neufs: q("SELECT COUNT(*) n FROM legal_cand WHERE status='neuf'").get().n,
  disparus: q("SELECT COUNT(*) n FROM legal_cand WHERE status='disparu'").get().n,
  total: q('SELECT COUNT(*) n FROM legal_cand').get().n });

module.exports = { candidats, autourDe, noter, disparus, lireSource, legalCandidats, marquer, etatLegal, chiffres, indiceDe, ANTIREP };
