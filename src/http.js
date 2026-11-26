'use strict';
// Réponses HTTP et lecture d'un corps JSON borné.
const { API_KEY } = require('./config');

function send(res, status, body, headers = {}) {
  const isObj = body && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readJson(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('corps trop lourd')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { let v; try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return reject(new Error('json invalide')); }
      v && typeof v === 'object' && !Array.isArray(v) ? resolve(v) : reject(new Error('json invalide')); });
    req.on('error', reject);
  });
}
// Comparaison à durée constante : la clé ne se devine pas en mesurant le temps de réponse
const crypto = require('crypto');
function keyOk(req) {
  if (!API_KEY) return false;
  const given = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(given), b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const NEXT = Symbol('next');

module.exports = { send, readJson, keyOk, NEXT };
