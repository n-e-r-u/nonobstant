'use strict';
// Lecture d'arrêtés réels : la zone, la période et les mesures doivent sortir justes, ou être marquées à compléter.
const { test } = require('node:test');
const assert = require('node:assert');
const { lireArretes } = require('../src/veille/extraction');
const { parisMs } = require('../src/time');

const NOW = parisMs('2026-11-10', '08:00');
const lire = (t, dep = '34') => lireArretes(t, { dep, src: 'https://exemple.gouv.fr/raa.pdf', now: NOW });
const hParis = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16);

test('interdiction de manifester, une commune, un jour avec horaires', () => {
  const r = lire(`ARRÊTÉ N° 2026-11-0345 portant interdiction de manifestation
  Article 1er : Toute manifestation revendicative est interdite sur le territoire de la commune de Montpellier,
  le samedi 14 novembre 2026 de 10 heures à 22 heures.`);
  assert.equal(r.length, 1);
  assert.equal(r[0].etat, 'complet');
  assert.equal(r[0].commune, 'Montpellier');
  assert.equal(r[0].dep, '34');
  assert.equal(hParis(r[0].start), '2026-11-14 10:00');
  assert.equal(hParis(r[0].end), '2026-11-14 22:00');
  assert.equal(r[0].items[0].k, 'manif');
  assert.match(r[0].items[0].text, /manifestation revendicative est interdite/);
});

test('périmètre de protection à cheval sur deux jours', () => {
  const r = lire(`Arrêté n° 2026-1122 : Il est institué un périmètre de protection sur le territoire de la commune de Nantes
  du vendredi 13 novembre 2026 à 6 heures au samedi 14 novembre 2026 à 2 heures.`, '44');
  assert.equal(r.length, 1);
  assert.equal(r[0].etat, 'complet');
  assert.equal(r[0].commune, 'Nantes');
  assert.equal(hParis(r[0].start), '2026-11-13 06:00');
  assert.equal(hParis(r[0].end), '2026-11-14 02:00');
  assert.equal(r[0].items[0].k, 'perimetre');
});

test('couvre-feu : les horaires écrits avant les dates sont retrouvés', () => {
  const r = lire(`Arrêté n° 2026-998 : La circulation des personnes est interdite de 22 heures à 6 heures sur le territoire
  de la commune de Sète du 12 novembre 2026 au 16 novembre 2026.`);
  assert.equal(r.length, 1);
  assert.equal(r[0].commune, 'Sète');
  assert.equal(r[0].items[0].k, 'couvre');
  assert.equal(hParis(r[0].start), '2026-11-12 22:00');
  assert.equal(hParis(r[0].end), '2026-11-17 06:00', 'la fin passe minuit');
});

test('plusieurs communes : un arrêté par commune, même source', () => {
  const r = lire(`Arrêté n° 2026-77 : Tout rassemblement est interdit sur le territoire des communes de Rennes,
  Cesson-Sévigné et Saint-Grégoire le 15 novembre 2026.`, '35');
  assert.deepEqual(r.map(x => x.commune), ['Rennes', 'Cesson-Sévigné', 'Saint-Grégoire']);
  assert.ok(r.every(x => x.etat === 'complet' && x.src === 'https://exemple.gouv.fr/raa.pdf'));
  assert.equal(hParis(r[0].start), '2026-11-15 00:00');
  assert.equal(hParis(r[0].end), '2026-11-15 23:59');
});

test('département entier : pas de commune, et ce n’est pas un manque', () => {
  const r = lire(`Arrêté n° 2026-12 : Les manifestations sur la voie publique sont interdites sur l'ensemble du département
  le 20 novembre 2026.`);
  assert.equal(r.length, 1);
  assert.equal(r[0].commune, '');
  assert.equal(r[0].etat, 'complet');
  assert.equal(r[0].manque, undefined);
});

test('objets et drones reconnus comme consignes', () => {
  const r = lire(`Arrêté n° 2026-55 : Toute manifestation est interdite à Grenoble le 18 novembre 2026.
  Article 2 : Le port et le transport, sans motif légitime, de tout objet susceptible de constituer une arme sont interdits.
  Article 3 : Le survol par aéronef avec captation d'images est interdit.`, '38');
  const ks = r[0].items.map(i => i.k);
  assert.ok(ks.includes('manif'));
  assert.ok(ks.includes('consigne'));
});

test('un acte qui ne concerne pas les manifestations est ignoré', () => {
  for (const t of [
    `Arrêté n° 2026-0999 portant interdiction de la pêche à la ligne sur le plan d'eau communal du 1er au 30 novembre 2026.`,
    `Arrêté n° 2026-0888 portant autorisation d'une manifestation sportive sur la commune de Lodève le 15 novembre 2026.`,
    `Arrêté n° 2026-0777 portant interdiction de circulation des poids lourds de plus de 7,5 tonnes.`,
  ]) assert.equal(lire(t).length, 0, t.slice(0, 50));
});

test('un arrêté déjà terminé n’est pas publié', () => {
  const r = lire(`Arrêté n° 2026-1 : Toute manifestation est interdite sur le territoire de la commune de Béziers
  le 2 novembre 2026 de 8 heures à 20 heures.`);
  assert.equal(r.length, 0);
});

test('période illisible : marqué à compléter, pas deviné', () => {
  const r = lire(`Arrêté n° 2026-2 : Toute manifestation est interdite sur le territoire de la commune de Nîmes
  jusqu'à nouvel ordre.`, '30');
  assert.equal(r.length, 1);
  assert.equal(r[0].etat, 'partiel');
  assert.equal(r[0].manque, 'période illisible');
  assert.equal(r[0].start, undefined);
});

test('recueil : plusieurs arrêtés à la suite, chacun lu séparément', () => {
  const r = lire(`RECUEIL DES ACTES ADMINISTRATIFS - Recueil spécial n° 331
  ARRÊTÉ N° 2026-301 portant interdiction de manifester : Toute manifestation est interdite sur le territoire de la commune
  de Montpellier le 14 novembre 2026 de 9 heures à 19 heures.
  ARRÊTÉ N° 2026-302 portant renouvellement d'agrément d'un organisme de formation. Article 1er : l'agrément est renouvelé.
  ARRÊTÉ N° 2026-303 : Il est institué un périmètre de protection sur le territoire de la commune de Lunel
  du 16 novembre 2026 à 7 heures au 16 novembre 2026 à 23 heures.`);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.commune), ['Montpellier', 'Lunel']);
  assert.deepEqual(r.map(x => x.items[0].k), ['manif', 'perimetre']);
});
