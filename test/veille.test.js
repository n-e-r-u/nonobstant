'use strict';
// La veille, de bout en bout, sur un faux site de préfecture : repérage des pages, mise en file, lecture, arrêtés structurés.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonobstant-veille-'));
process.env.DATA_DIR = dir;
process.env.FETCH_ALLOW_PRIVATE = '1';
process.env.VEILLE = '0';          // pas de tour automatique pendant les tests
process.env.VEILLE_PAGE_GAP_MS = '1';
const V = require('../src/veille/arretes');
const C = require('../src/coffre');

const AN = new Date().getFullYear();
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][new Date().getMonth()];
// L'arrêté porte sur demain, sinon il serait déjà terminé et jamais publié
const demain = new Date(Date.now() + 36e5 * 30);
const jourDemain = demain.getDate(), moisDemain = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][demain.getMonth()], anDemain = demain.getFullYear();
const ARRETE = `ARRÊTÉ N° ${AN}-4242 portant interdiction de manifester
  Article 1er : Toute manifestation revendicative est interdite sur le territoire de la commune de Montpellier
  le ${jourDemain} ${moisDemain} ${anDemain} de 10 heures à 22 heures.`;

// La veille ne remonte que ce qui apparaît : le site publie son arrêté entre le premier et le deuxième tour.
let base = '', publie = false;
const site = http.createServer((req, res) => {
  const html = b => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b); };
  if (req.url === '/') return html(`<a href="/actualites/">Actualités</a><a href="/recueil-des-actes-administratifs/">Recueil des actes administratifs</a>`);
  if (req.url === '/recueil-des-actes-administratifs/') return html(`<a href="/recueil-des-actes-administratifs/${AN}/">Recueils ${AN}</a>`);
  if (req.url === `/recueil-des-actes-administratifs/${AN}/`) return html(`<a href="/recueil-des-actes-administratifs/${AN}/${MOIS}/">${MOIS} ${AN}</a>`);
  if (req.url === `/recueil-des-actes-administratifs/${AN}/${MOIS}/`) return html(`<a href="/doc/agrement.pdf">Recueil n° 332</a>${publie ? '<a href="/doc/recueil-special-331.pdf">Recueil spécial n° 331</a>' : ''}`);
  if (req.url === '/actualites/') return html(publie ? '<a href="/actu/interdiction-de-manifester-centre-ville">Interdiction de manifester en centre-ville</a>' : '<a href="/actu/remise-des-medailles">Remise des médailles du travail</a>');
  if (req.url === '/actu/remise-des-medailles') return html('<p>La cérémonie a eu lieu en préfecture.</p>');
  if (req.url === '/actu/interdiction-de-manifester-centre-ville') return html(`<p>${ARRETE}</p>`);
  if (req.url === '/doc/recueil-special-331.pdf') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(ARRETE); }
  if (req.url === '/doc/agrement.pdf') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`ARRÊTÉ N° ${AN}-332 portant renouvellement d'agrément. Article 1er : l'agrément est renouvelé pour cinq ans.`); }
  res.writeHead(404); res.end('non');
});
before(async () => { base = await new Promise(ok => site.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + site.address().port))); });
after(() => { site.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('mots-clés : les thèmes larges seuls ne déclenchent rien', () => {
  assert.deepEqual(V.motsCles('Interdiction de manifester en centre-ville', '/x'), ['manifestation', 'interdiction']);
  assert.deepEqual(V.motsCles('Interdiction de pêche sur le lac', '/x'), []);
  assert.deepEqual(V.motsCles('Recueil spécial n° 331', '/raa/2026/331.pdf'), []);
  assert.ok(V.motsCles('Instauration d’un périmètre de protection', '/x').includes('périmètre'));
});

test('liens : flux RSS et page HTML', () => {
  const rss = V.extractLinks('<rss><channel><item><title>Arrêté du jour</title><link>https://a.fr/1</link></item></channel></rss>', 'https://a.fr/');
  assert.deepEqual(rss, [{ titre: 'Arrêté du jour', url: 'https://a.fr/1', plus: '' }]);
  const html = V.extractLinks('<a href="/b">Un titre assez long</a><a href="/c">x</a>', 'https://a.fr/');
  assert.equal(html.length, 1, 'un libellé de moins de 4 caractères est ignoré');
});

test('premier passage : rien n’est mis en file, tout sert de référence', async () => {
  const [st, s] = await V.srcAdd({ url: base + '/', dep: '34', label: 'Préfecture de test', kind: 'pref' });
  assert.equal(st, 201);
  assert.equal(s.ok, true);
  assert.ok(s.pages >= 4, 'les pages du recueil ont été repérées : ' + s.pages);
  assert.equal(V.docQueue(), 0, 'aucun document en file au premier passage');
  assert.equal(V.arretes().length, 0);
});

test('deuxième passage : les documents sont lus et les arrêtés sortis structurés', async () => {
  publie = true;
  const s = V.sources()[0];
  const r = await V.srcTest(s.id);
  assert.equal(r[0], 200);
  const liste = V.arretes();
  const complets = liste.filter(a => a.etat === 'complet');
  assert.ok(complets.length >= 1, 'au moins un arrêté complet : ' + JSON.stringify(liste.map(a => [a.etat, a.manque])));
  const a = complets[0];
  assert.equal(a.dep, '34');
  assert.equal(a.commune, 'Montpellier');
  assert.equal(a.items[0].k, 'manif');
  assert.equal(new Date(a.start).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(11, 16), '10:00');
  assert.equal(new Date(a.end).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(11, 16), '22:00');
  assert.ok(a.preuve, 'une copie a été versée au coffre');
  assert.equal(C.rowOf(a.preuve).tag, 'arrete');
});

test('le recueil d’agrément est lu mais ne produit aucun arrêté', () => {
  const liste = V.arretes({ limit: 500 });
  assert.ok(!liste.some(a => /agr[eé]ment/i.test(a.titre + a.extrait)), 'rien ne vient du recueil 332');
});

test('même arrêté trouvé deux fois : un seul enregistrement', async () => {
  const avant = V.arretes({ etat: 'complet' }).length;
  const s = V.sources()[0];
  await V.srcTest(s.id);
  assert.equal(V.arretes({ etat: 'complet' }).length, avant, 'la page et le recueil décrivent le même arrêté');
});

test('état de la veille', () => {
  const e = V.etat();
  assert.equal(e.sources, 1);
  assert.equal(e.prefectures, 102);
  assert.ok(e.complets >= 1);
});
