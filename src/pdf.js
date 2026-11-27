'use strict';
// Lecture du texte d'un PDF, par pdftotext (paquet poppler-utils). Sans lui, un PDF est archivé mais pas lu :
// c'est une dépendance système facultative, jamais une dépendance du paquet.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Un pdftotext utilisable peut sortir en code non nul sur -v, donc une erreur d'exécution ne suffit pas à conclure.
// En revanche, absent (ENOENT) ou non exécutable (EACCES, EPERM), il ne servira jamais : le dire franchement,
// un « oui » faux ferait croire que les recueils sont lus alors qu'ils échouent un par un.
const INDISPONIBLE = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC']);
let OK = false;
execFile('pdftotext', ['-v'], { timeout: 5000 }, err => { OK = !err || !INDISPONIBLE.has(err.code); });
const pdfReady = () => OK;

// Texte d'un PDF tenu en mémoire. pages : nombre de pages lues au plus (un recueil en compte parfois des centaines).
function pdfTexte(buf, { pages = 40, timeout = 120_000 } = {}) {
  return new Promise(ok => {
    if (!OK) return ok('');
    const file = path.join(os.tmpdir(), 'nonobstant-' + crypto.randomBytes(8).toString('hex') + '.pdf');
    try { fs.writeFileSync(file, buf, { mode: 0o600 }); } catch { return ok(''); }
    execFile('pdftotext', ['-l', String(pages), '-enc', 'UTF-8', file, '-'],
      { timeout, maxBuffer: 60e6, env: { PATH: process.env.PATH || '/usr/bin:/bin' }, cwd: os.tmpdir() },
      (err, out) => { try { fs.unlinkSync(file); } catch { /* déjà parti */ } ok(err && !out ? '' : String(out || '')); });
  });
}
module.exports = { pdfReady, pdfTexte };
