'use strict';
// L'API : lecture publique, écriture et copie complète réservées à la clé.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonobstant-api-'));
process.env.DATA_DIR = dir;
process.env.FETCH_ALLOW_PRIVATE = '1';
process.env.API_KEY = 'cle-de-test-suffisamment-longue';
const { server } = require('../server');

const site = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Source</title><p>Texte de la source.</p>'); });
let api = '', src = '';
const call = (p, { method = 'GET', key = null, body = null } = {}) => new Promise((ok, ko) => {
  const req = http.request(api + p, { method, headers: { ...(key ? { 'x-api-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
    const parts = []; res.on('data', c => parts.push(c));
    res.on('end', () => { const raw = Buffer.concat(parts); let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch { /* corps non JSON */ } ok({ status: res.statusCode, json, raw, headers: res.headers }); });
  });
  req.on('error', ko);
  if (body) req.end(JSON.stringify(body)); else req.end();
});

before(async () => {
  api = await new Promise(ok => server.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + server.address().port)));
  src = await new Promise(ok => site.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + site.address().port)));
});
after(() => { server.close(); site.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('état du serveur', async () => {
  const r = await call('/api/sante');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.ecriture, true);
});

test('archiver sans la clé est refusé', async () => {
  const r = await call('/api/coffre', { method: 'POST', body: { url: src + '/x' } });
  assert.equal(r.status, 403);
  const q = await call('/api/coffre/recent');
  assert.equal(q.json.copies.length, 0, 'rien n’a été écrit');
});

test('une mauvaise clé est refusée, y compris si elle a la bonne longueur', async () => {
  const r = await call('/api/coffre', { method: 'POST', key: 'cle-de-test-suffisamment-fausse', body: { url: src + '/x' } });
  assert.equal(r.status, 403);
});

test('archiver avec la clé, puis relire la fiche sans clé', async () => {
  const r = await call('/api/coffre', { method: 'POST', key: process.env.API_KEY, body: { url: src + '/y', tag: 'chronique' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.title, 'Source');
  const fiche = await call('/api/coffre/' + r.json.id);
  assert.equal(fiche.status, 200);
  assert.match(fiche.json.extrait, /Texte de la source\./);
  assert.equal(fiche.json.file, undefined, 'le chemin du fichier ne sort jamais');
  const parTag = await call('/api/coffre/recent?tag=chronique');
  assert.equal(parTag.json.copies.length, 1);
});

test('la copie complète demande la clé', async () => {
  const a = await call('/api/coffre', { method: 'POST', key: process.env.API_KEY, body: { url: src + '/z' } });
  const sans = await call('/api/coffre/' + a.json.id + '/copie');
  assert.equal(sans.status, 403);
  const avec = await call('/api/coffre/' + a.json.id + '/copie', { key: process.env.API_KEY });
  assert.equal(avec.status, 200);
  assert.match(avec.raw.toString('utf8'), /Texte de la source\./);
  assert.equal(avec.headers['x-copie-source'], src + '/z');
});

test('aucune remontée hors du dossier public', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json']) {
    const r = await call(p);
    assert.ok([403, 404].includes(r.status), p + ' : ' + r.status);
    assert.doesNotMatch(r.raw.toString('utf8'), /nonobstant/i, p);
  }
});
