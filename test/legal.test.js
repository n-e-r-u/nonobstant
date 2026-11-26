'use strict';
// Numéros de legal team : seuls les numéros entourés d'un propos antirépression sont retenus, et rien n'est publié tout seul.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonobstant-legal-'));
process.env.DATA_DIR = dir;
process.env.VEILLE = '0';
const L = require('../src/veille/legal');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('un numéro de legal team est retenu avec sa phrase', () => {
  const c = L.candidats(`Manifestation du 14 novembre. En cas d'interpellation, appelez la legal team au 06 12 34 56 78.
    Ne parlez pas sans avocat.`, { titre: 'Infos antirep', url: 'https://exemple.org/a' });
  assert.equal(c.length, 1);
  assert.equal(c[0].tel, '0612345678');
  assert.match(c[0].contexte, /appelez la legal team/);
});

test('les écritures du numéro sont ramenées à la même forme', () => {
  for (const e of ['06.12.34.56.78', '06-12-34-56-78', '0612345678', '+33 6 12 34 56 78', '+33612345678']) {
    const c = L.candidats(`Legal team, garde à vue : ${e}.`, { url: 'https://exemple.org/b' });
    assert.equal(c.length, 1, e);
    assert.equal(c[0].tel, '0612345678', e);
  }
});

test('un numéro sans propos antirépression autour n’est pas retenu', () => {
  for (const t of [
    'Réservations au 04 67 00 00 00. Le concert commence à 20 heures.',
    'Permanence du secrétariat : 01 44 00 00 00, du lundi au vendredi.',
    'Pour toute question sur la billetterie, écrivez-nous ou appelez le 05 61 00 00 00.',
  ]) assert.deepEqual(L.candidats(t, { url: 'https://exemple.org/c' }), [], t.slice(0, 40));
});

test('indice de rattachement quand la page le donne', () => {
  const a = L.candidats('La Legal Team Toulouse est joignable au 05 61 11 22 33 en cas d’arrestation.', { url: 'https://exemple.org/d' });
  assert.equal(a[0].indice, 'toulouse');
  const b = L.candidats('Legal team 71 : 03 85 11 22 33, à appeler en cas de garde à vue.', { url: 'https://exemple.org/e' });
  assert.equal(b[0].indice, 'département 71');
});

test('le contexte garde ce qui introduit le numéro, même avant un deux-points', () => {
  const c = L.candidats('Legal team 71 : 03 85 11 22 33, à appeler en cas de garde à vue.', { url: 'https://exemple.org/i' });
  assert.match(c[0].contexte, /Legal team 71/);
});

test('un même numéro vu deux fois sur la même page ne fait qu’un candidat', () => {
  const liste = L.candidats('Legal team : 06 99 88 77 66. En garde à vue, appelez le 06 99 88 77 66.', { url: 'https://exemple.org/f' });
  assert.equal(liste.length, 1);
  assert.equal(L.noter(liste, { src: 's1' }), 1);
  assert.equal(L.noter(liste, { src: 's1' }), 0, 'le second passage ne crée rien');
  assert.equal(L.legalCandidats({ status: 'neuf' }).filter(c => c.tel === '0699887766').length, 1);
});

test('un numéro disparu de sa page est signalé, pas supprimé', () => {
  const url = 'https://exemple.org/g';
  L.noter(L.candidats('Legal team : 06 11 11 11 11, en cas d’interpellation.', { url }), { src: 's1', now: 1000 });
  assert.equal(L.disparus(url, 1000 + 60_000), 0, 'rien n’est signalé tout de suite');
  const n = L.disparus(url, 1000 + 3 * 24 * 3600_000);
  assert.equal(n, 1);
  const c = L.legalCandidats({ status: 'disparu' }).find(x => x.tel === '0611111111');
  assert.ok(c, 'le candidat existe toujours, avec son état');
});

test('un candidat se marque proposé ou ignoré', () => {
  const liste = L.candidats('Legal team : 07 22 22 22 22, garde à vue.', { url: 'https://exemple.org/h' });
  L.noter(liste, { src: 's1' });
  const c = L.legalCandidats({ status: 'neuf' }).find(x => x.tel === '0722222222');
  assert.equal(L.marquer(c.id, 'propose')[0], 200);
  assert.equal(L.marquer(c.id, 'nimporte')[0], 400);
  assert.equal(L.marquer('inexistant', 'propose')[0], 404);
});
