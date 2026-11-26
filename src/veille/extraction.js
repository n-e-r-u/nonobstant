'use strict';
// ---- Du texte d'un arrêté à un arrêté structuré ----
// C'est la pièce qui manquait à la veille précédente : elle repérait les recueils intéressants, mais il fallait ensuite
// ouvrir le PDF et tout retaper. Ici le texte est découpé en arrêtés, et chacun rend sa zone, ses dates et ses mesures.
//
// Règle de prudence : on ne devine rien. Un arrêté dont la période ou la zone ne se lisent pas clairement n'est pas complété
// au jugé, il est marqué « partiel » et part dans la file à compléter à la main. Mieux vaut un arrêté manquant sur la carte
// qu'un arrêté inventé : dans la rue, une date fausse se paie.
const { parisMs } = require('../time');
const { aplat, plier, phrase } = require('./texte');

const MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const NOMS_MOIS = Object.keys(MOIS).join('|');
const DATE = new RegExp(`(?:(?:lun|mar|mer|jeu|ven|sam|dim)\\w*\\s+)?(\\d{1,2})\\s*(?:er|re)?\\s+(${NOMS_MOIS})\\.?(?:\\s+(\\d{4}))?|(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4})`, 'g');
const HEURE = '(?:(\\d{1,2})\\s*(?:h(?:eures?)?|:)\\s*(\\d{2})?|(minuit)|(midi))';

// Mesures reconnues, et la catégorie de Cortège correspondante.
// Une formulation précise seulement : « manifestation sportive » ou « interdiction de pêche » ne doivent rien déclencher.
const MESURES = [
  ['manif', /interdi\w*[^.;]{0,90}(manifestation|rassemblement|cortege|defile|attroupement)|(manifestation|rassemblement|cortege|defile)s?[^.;]{0,60}(est|sont) interdit/],
  ['perimetre', /perimetre de protection|perimetre d'interdiction|zone de protection|perimetre interdit|zone interdite a toute/],
  ['couvre', /couvre[- ]?feu|circulation des personnes (est|sera) interdite/],
  ['consigne', /port et (le )?transport[^.;]{0,70}(arme|objet|engin)|artifices? de divertissement|aeronef[^.;]{0,70}(camera|captation|image|survol)|captation[^.;]{0,90}image|interdiction de survol|distribution[^.;]{0,50}carburant|vente[^.;]{0,60}(carburant|alcool)[^.;]{0,40}interdit/],
  ['transport', /circulation et (le )?stationnement[^.;]{0,60}interdit|restriction[^.;]{0,50}circulation|interdiction de stationner|arret des (transports|lignes)/],
];
// Un arrêté utile aux manifestant·es : au moins une de ces mesures. Les autres actes du recueil sont ignorés.
const interessant = fold => MESURES.some(([, re]) => re.test(fold));

// Année sous-entendue : celle qui place la date au plus près du moment de la lecture
function anneeProche(jour, mois, now) {
  const base = new Date(now).getUTCFullYear();
  let best = base, ecart = Infinity;
  for (const y of [base - 1, base, base + 1]) {
    const d = Math.abs(Date.UTC(y, mois - 1, jour) - now);
    if (d < ecart) { ecart = d; best = y; }
  }
  return best;
}
// Dates trouvées dans un texte, avec leur position
function dates(fold, now) {
  const out = [];
  for (const m of fold.matchAll(DATE)) {
    let j, mo, an;
    if (m[2]) { j = +m[1]; mo = MOIS[m[2]]; an = m[3] ? +m[3] : anneeProche(j, mo, now); }
    else { j = +m[4]; mo = +m[5]; an = +m[6]; }
    if (!(j >= 1 && j <= 31 && mo >= 1 && mo <= 12 && an >= 2000 && an <= 2100)) continue;
    out.push({ at: m.index, fin: m.index + m[0].length, jour: `${an}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}` });
  }
  return out;
}
const hhmm = (h, mi, minuit, midi) => minuit ? '00:00' : midi ? '12:00' : `${String(Math.min(+h, 23)).padStart(2, '0')}:${String(mi ? Math.min(+mi, 59) : 0).padStart(2, '0')}`;
// Première heure écrite après une position, si elle est assez proche pour appartenir à la même expression
function heureApres(fold, at, portee = 40) {
  const m = new RegExp(HEURE).exec(fold.slice(at, at + portee));
  return m ? hhmm(m[1], m[2], m[3], m[4]) : null;
}
const JOUR_MS = 24 * 60 * 60_000;

// Période de l'arrêté : « du … au … », « le … de … à … », « à compter du … jusqu'au … ».
// Distinction qui compte : des horaires collés aux dates (« du 13 à 6 heures au 14 à 2 heures ») décrivent une période
// continue. Des horaires énoncés à part (« de 22 heures à 6 heures ») sur plusieurs jours décrivent un couvre-feu, qui
// revient chaque nuit. Le modèle de Cortège n'a qu'un début et une fin : on couvre alors toute la plage, jusqu'au matin
// suivant le dernier jour, et la phrase de l'arrêté, citée telle quelle, dit les vrais horaires. Avertir un peu trop
// largement est le bon sens du risque pour quelqu'un qui est dans la rue.
function periode(fold, now) {
  const ds = dates(fold, now);
  if (!ds.length) return null;
  const plageRe = () => new RegExp(`(?:de|entre|a partir de)\\s*${HEURE}\\s*(?:a|et|jusqu'a)\\s*${HEURE}`);
  // Deux dates reliées par « du … au … » ou « à compter du … jusqu'au … »
  for (let i = 0; i + 1 < ds.length; i++) {
    const a = ds[i], b = ds[i + 1];
    const avant = fold.slice(Math.max(0, a.at - 24), a.at), entre = fold.slice(a.fin, b.at);
    if (!/\b(du|des le|a compter du|a partir du)\s*$/.test(avant) || entre.length > 60) continue;
    if (!/\b(au|jusqu'au|jusqu'a)\b/.test(entre)) continue;
    let h1 = heureApres(fold, a.fin, entre.length + 4), h2 = heureApres(fold, b.fin), nuits = false;
    if (!h1 && !h2) {
      const pl = plageRe().exec(fold);
      if (pl) { h1 = hhmm(pl[1], pl[2], pl[3], pl[4]); h2 = hhmm(pl[5], pl[6], pl[7], pl[8]); nuits = h2 <= h1 && b.jour !== a.jour; }
    }
    h1 = h1 || '00:00'; h2 = h2 || '23:59';
    let debut = parisMs(a.jour, h1), fin = parisMs(b.jour, h2);
    if (nuits) fin += JOUR_MS;
    if (fin <= debut) fin += JOUR_MS;
    return { debut, fin, h1, h2, nuits, jours: [a.jour, b.jour] };
  }
  // Une seule date : « le … de … à … », ou la journée entière
  const a = ds[0];
  const plage = plageRe().exec(fold.slice(a.fin, a.fin + 80)) || plageRe().exec(fold.slice(Math.max(0, a.at - 70), a.at));
  if (plage) {
    const h1 = hhmm(plage[1], plage[2], plage[3], plage[4]), h2 = hhmm(plage[5], plage[6], plage[7], plage[8]);
    let debut = parisMs(a.jour, h1), fin = parisMs(a.jour, h2);
    if (fin <= debut) fin += JOUR_MS;
    return { debut, fin, h1, h2, nuits: false, jours: [a.jour, a.jour] };
  }
  return { debut: parisMs(a.jour, '00:00'), fin: parisMs(a.jour, '23:59'), h1: '00:00', h2: '23:59', journee: true, nuits: false, jours: [a.jour, a.jour] };
}

const COUPE = /\s(?:du|des|le|la|les|a compter|a partir|pour|durant|pendant|entre|afin|aux fins|dans|sur|et sur|jusqu|ainsi)\s/;
const propre = n => n.replace(/\s+/g, ' ').replace(/[\s,;:.'-]+$/, '').trim();
// Communes visées. « sur l'ensemble du département » rend une liste vide : la zone est alors le département entier.
function communes(fold, flat) {
  if (/ensemble du departement|tout le departement|l'ensemble du territoire du departement/.test(fold)) return { dep: true, liste: [] };
  const vus = new Set(), liste = [];
  for (const m of fold.matchAll(/(?:communes?|villes?) (?:de |d'|du |des |de la )?/g)) {
    let bout = flat.slice(m.index + m[0].length, m.index + m[0].length + 140);
    const c = COUPE.exec(bout); if (c) bout = bout.slice(0, c.index);
    const fin = bout.search(/[.;:)\d]/); if (fin > 0) bout = bout.slice(0, fin);
    for (const part of bout.split(/,| et /)) {
      const n = propre(part);
      if (n.length < 2 || n.length > 60 || /\d/.test(n)) continue;
      if (!/^[A-ZÀ-Ý]/.test(n)) continue; // un nom de commune commence par une majuscule
      const k = plier(n); if (vus.has(k)) continue;
      vus.add(k); liste.push(n);
      if (liste.length >= 8) break;
    }
    if (liste.length >= 8) break;
  }
  return { dep: false, liste };
}
// Mesures de l'arrêté, chacune citée par sa propre phrase
function mesures(fold, flat) {
  const out = [], vus = new Set();
  for (const [k, re] of MESURES) {
    const m = re.exec(fold); if (!m) continue;
    const texte = phrase(flat, m.index);
    if (texte.length < 10 || vus.has(texte)) continue;
    vus.add(texte); out.push({ k, text: texte });
    if (out.length >= 8) break;
  }
  return out;
}
// Découpage d'un recueil en arrêtés. Un recueil des actes administratifs en contient des dizaines à la suite, et les mélanger
// produirait un arrêté chimère : la commune d'un acte, les dates d'un autre. Les repères sont cherchés sans accent, parce que
// les recueils écrivent aussi bien « ARRÊTÉ N° » que « ARRETE No ». Si rien ne se découpe dans un texte long, on le dit.
const REPERE = /arrete\s*(?:prefectoral\s*)?(?:n\s*[°o]|du\s+\d)|decision\s*n\s*[°o]/g;
const LONG = 8000;
function decouper(flat, fold) {
  const marques = [...fold.matchAll(REPERE)].map(m => m.index);
  if (marques.length < 2) return { bouts: [flat], sur: flat.length <= LONG };
  const bouts = [];
  for (let i = 0; i < marques.length && i < 400; i++) bouts.push(flat.slice(marques[i], marques[i + 1] ?? flat.length));
  return { bouts, sur: true };
}

// Lit un texte et rend les arrêtés publiables, plus ceux qu'il faut compléter à la main.
// Un arrêté visant plusieurs communes donne un arrêté par commune : la zone de Cortège est une commune ou un département.
function lireArretes(texte, { dep, src = '', now = Date.now(), titre = '' } = {}) {
  const flat = aplat(texte);
  const sorties = [];
  const { bouts, sur } = decouper(flat, plier(flat));
  for (const bout of bouts) {
    const fold = plier(bout);
    if (!interessant(fold)) continue;
    const items = mesures(fold, bout);
    if (!items.length) continue;
    const p = periode(fold, now);
    const z = communes(fold, bout);
    const base = { dep, src, items, extrait: phrase(bout, 0, 300), titre: titre.slice(0, 200) };
    if (!sur) { sorties.push({ ...base, etat: 'partiel', manque: 'recueil non découpé' }); continue; }
    if (!p) { sorties.push({ ...base, etat: 'partiel', manque: 'période illisible' }); continue; }
    if (p.fin <= now) continue; // déjà terminé : rien à afficher
    if (p.debut > now + 60 * JOUR_MS || p.fin - p.debut > 62 * JOUR_MS) { sorties.push({ ...base, etat: 'partiel', manque: 'période hors limites' }); continue; }
    const commun = { ...base, start: p.debut, end: p.fin, journee: !!p.journee, nuits: !!p.nuits };
    if (z.dep || !z.liste.length) sorties.push({ ...commun, commune: '', etat: z.dep ? 'complet' : 'partiel', ...(z.dep ? {} : { manque: 'commune non trouvée' }) });
    else for (const c of z.liste) sorties.push({ ...commun, commune: c, etat: 'complet' });
  }
  return sorties;
}

module.exports = { lireArretes, periode, communes, mesures, dates, decouper, interessant, MESURES };
