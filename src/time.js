'use strict';
// Dates et heures de Paris (heure d'été comprise).
const parisDay = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
// « 2026-10-17 » + « 14:00 », heure de Paris, vers un horodatage
function parisMs(date, hhmm) {
  const [y, m, d] = String(date).split('-').map(Number), [h, mi] = String(hhmm || '12:00').split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
    t += want - Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1, +p.slice(8, 10), +p.slice(11, 13), +p.slice(14, 16));
  }
  return t;
}
module.exports = { parisDay, parisMs };
