'use strict';
// Base de données : SQLite intégré à Node, en mode WAL, et toutes les tables créées au démarrage.
const path = require('path');
const { DATA_DIR } = require('./config');

{
  const emit = process.emitWarning;
  process.emitWarning = function (w, ...rest) { if (/sqlite/i.test(String((w && w.message) || w))) return; return emit.call(process, w, ...rest); };
}
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch { console.error('Nonobstant a besoin de Node 22.13 ou plus récent (module node:sqlite).'); process.exit(1); }

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'nonobstant.db'));
db.exec('PRAGMA busy_timeout=8000');
try { db.exec('PRAGMA journal_mode=WAL'); } catch { /* base en lecture seule ou système sans WAL : on continue */ }
db.exec(`PRAGMA synchronous=NORMAL;
  -- Coffre des preuves : une ligne par source archivée. Le fichier complet est sur disque, jamais dans la base.
  CREATE TABLE IF NOT EXISTS preuve(id TEXT PRIMARY KEY, url TEXT NOT NULL, t INTEGER NOT NULL, status TEXT NOT NULL,
    mime TEXT, bytes INTEGER, sha256 TEXT, title TEXT, extrait TEXT, file TEXT, tag TEXT, err TEXT);
  CREATE INDEX IF NOT EXISTS preuve_t ON preuve(t);
  CREATE INDEX IF NOT EXISTS preuve_tag ON preuve(tag);
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`);

const q = sql => db.prepare(sql);
const getMeta = k => { const r = q('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : null; };
const setMeta = (k, v) => q('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run(k, String(v));
// Transaction : tout passe ou rien ne passe
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* déjà annulée */ } throw e; }
}

module.exports = { db, q, getMeta, setMeta, tx };
