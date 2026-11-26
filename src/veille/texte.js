'use strict';
// Mise à plat d'un texte officiel, en gardant la correspondance des positions.
// Les expressions sont cherchées sur une version sans accent et en minuscules de la même longueur que l'affichage,
// pour qu'un extrait retrouvé dans la version pliée se découpe correctement dans la version lisible.
const PLI = { à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', å: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', î: 'i', ï: 'i', í: 'i', ì: 'i',
  ô: 'o', ö: 'o', ó: 'o', õ: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u', ç: 'c', ñ: 'n', ÿ: 'y', œ: 'o', æ: 'a', ø: 'o', '’': '\'', '‘': '\'',
  ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-', '–': '-', '—': '-', '«': '"', '»': '"', '“': '"', '”': '"' };
// Une ligne par phrase perdue : les retours à la ligne des PDF coupent les phrases au milieu
const aplat = s => String(s || '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
const plier = s => String(s).toLowerCase().replace(/[^\x00-\x7f’‘]/g, c => PLI[c] ?? (PLI[c.toLowerCase()] ?? c)).replace(/[’‘]/g, '\'');
// Phrase qui contient la position donnée, bornée aux ponctuations fortes
function phrase(flat, at, max = 220) {
  const avant = Math.max(flat.lastIndexOf('. ', at), flat.lastIndexOf(' : ', at), flat.lastIndexOf('; ', at), -1);
  let d = avant < 0 ? 0 : avant + 2;
  let f = flat.length;
  for (const sep of ['. ', ' ; ']) { const i = flat.indexOf(sep, at); if (i >= 0 && i < f) f = i + 1; }
  const out = flat.slice(d, f).trim();
  return out.length > max ? out.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : out;
}
module.exports = { aplat, plier, phrase };
