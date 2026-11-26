'use strict';
// Configuration : variables d'environnement et constantes partagées.
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8090;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const COFFRE_DIR = path.join(DATA_DIR, 'coffre');
for (const d of [DATA_DIR, COFFRE_DIR]) fs.mkdirSync(d, { recursive: true });

// Clé d'écriture : vide = écriture désactivée (le serveur ne sert plus qu'à lire).
// Une clé trop courte est refusée, elle se devinerait.
const API_KEY = (k => {
  if (k && k.length < 24) { console.error('API_KEY trop courte (24 caractères minimum) : écriture désactivée.'); return ''; }
  return k;
})(process.env.API_KEY || '');

const MIN = 60_000;
// Taille maximale d'une source archivée, et de l'extrait public qui en est tiré
const FETCH_MAX = Number(process.env.FETCH_MAX) || 25_000_000;
const EXTRACT_MAX = Number(process.env.EXTRACT_MAX) || 5000;

module.exports = { PORT, ROOT, DATA_DIR, COFFRE_DIR, API_KEY, MIN, FETCH_MAX, EXTRACT_MAX };
