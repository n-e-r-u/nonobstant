'use strict';
// La garde réseau : aucune lecture ne doit pouvoir atteindre le serveur lui-même ou le réseau local.
const { test } = require('node:test');
const assert = require('node:assert');
delete process.env.FETCH_ALLOW_PRIVATE;
const { blockedIp, fetchPublicFull } = require('../src/net');

test('adresses internes refusées, adresses publiques acceptées', () => {
  for (const a of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', '100.64.0.1', '::1', 'fe80::1', 'fc00::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', 'pas-une-adresse']) assert.equal(blockedIp(a), true, a);
  for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) assert.equal(blockedIp(a), false, a);
});

test('une adresse interne écrite en clair est refusée avant toute connexion', async () => {
  await assert.rejects(fetchPublicFull('http://169.254.169.254/latest/meta-data/'), /interne/);
  await assert.rejects(fetchPublicFull('http://127.0.0.1:9/'), /interne|refusée/);
});

test('protocoles et identifiants dans l’adresse refusés', async () => {
  for (const u of ['file:///etc/passwd', 'ftp://exemple.org/x', 'http://user:mdp@exemple.org/']) await assert.rejects(fetchPublicFull(u), /refusée|invalide/);
});
