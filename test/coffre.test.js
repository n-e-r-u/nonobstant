'use strict';
// Le coffre : une copie datée, empreintée, avec son extrait public et sa copie complète privée.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonobstant-test-'));
process.env.DATA_DIR = dir;
process.env.FETCH_ALLOW_PRIVATE = '1';
const C = require('../src/coffre');
const { COFFRE_DIR } = require('../src/config');

let page = '<html><head><title>Arrêté du 12 novembre</title></head><body><p>La manifestation est interdite.</p><script>var a=1</script></body></html>';
const site = http.createServer((req, res) => {
  if (req.url === '/mort') { res.writeHead(404); return res.end('non'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
});
let base = '';
before(async () => { base = await new Promise(ok => site.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + site.address().port))); });
after(() => { site.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('archive une page : titre, extrait sans le script, empreinte, copie sur le disque', async () => {
  const [st, r] = await C.archive(base + '/a');
  assert.equal(st, 201);
  assert.equal(r.status, 'ok');
  assert.equal(r.title, 'Arrêté du 12 novembre');
  assert.match(r.extrait, /La manifestation est interdite\./);
  assert.doesNotMatch(r.extrait, /var a=1/);
  assert.equal(r.sha256.length, 64);
  assert.equal(r.mime, 'text/html');
  const files = fs.readdirSync(COFFRE_DIR);
  assert.equal(files.length, 1);
  assert.equal(C.sha256(fs.readFileSync(path.join(COFFRE_DIR, files[0]))), r.sha256, 'la copie sur le disque a la même empreinte');
});

test('la même source le même jour n’est pas rearchivée', async () => {
  const [st1, a] = await C.archive(base + '/b');
  const [st2, b] = await C.archive(base + '/b');
  assert.equal(st1, 201);
  assert.equal(st2, 200);
  assert.equal(b.id, a.id);
});

test('contenu changé : nouvelle copie, et l’ancienne reste consultable', async () => {
  const [, a] = await C.archive(base + '/c');
  page = '<html><head><title>Arrêté abrogé</title></head><body><p>Abrogé.</p></body></html>';
  const [st, b] = await C.archive(base + '/c', { force: true });
  assert.equal(st, 201);
  assert.notEqual(b.id, a.id);
  assert.notEqual(b.sha256, a.sha256);
  const copies = C.snapshots(base + '/c');
  assert.equal(copies.length, 2);
  assert.equal(copies[0].title, 'Arrêté abrogé');
  assert.equal(copies[1].title, 'Arrêté du 12 novembre', 'la première copie garde ce que la page disait ce jour-là');
});

test('une source qui ne répond plus est datée au lieu d’être oubliée', async () => {
  const [st, r] = await C.archive(base + '/mort');
  assert.equal(st, 502);
  assert.equal(r.status, 'err');
  assert.match(r.err, /HTTP 404/);
  assert.ok(r.t > 0, 'le moment où la source a cessé de répondre est conservé');
});

test('adresse invalide refusée sans rien écrire', async () => {
  const avant = C.recent(999).length;
  const [st] = await C.archive('pas une adresse');
  assert.equal(st, 400);
  assert.equal(C.recent(999).length, avant);
});

test('la copie complète n’est jamais dans la vue publique', async () => {
  const [, r] = await C.archive(base + '/d');
  assert.equal(r.file, undefined);
  assert.ok(C.filePath(r.id), 'elle reste accessible côté serveur');
});
