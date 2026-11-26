'use strict';
// ---- Lecture d'une page publique, et rien d'autre ----
// Adresse publique seulement : jamais le serveur lui-même, le réseau local, ni les adresses internes des hébergeurs (métadonnées).
// L'adresse est vérifiée au moment même de la connexion, donc une redirection ou un nom de domaine qui change d'adresse
// ne peut pas mener au réseau interne. Les formes IPv6 qui enveloppent une IPv4 sont ramenées à l'IPv4 avant le test.
// Durée totale bornée (pas seulement l'inactivité) et taille bornée pendant le téléchargement.
const net = require('net');

const BLOCK = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) BLOCK.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['100::', 64], ['2001:db8::', 32]]) BLOCK.addSubnet(a, n, 'ipv6');

function v4Inside(a) {
  const m = a.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i); if (m) return m[1];
  const w = a.toLowerCase().split(':');
  const hex = (h, l) => [parseInt(h || '0', 16) >> 8, parseInt(h || '0', 16) & 255, parseInt(l || '0', 16) >> 8, parseInt(l || '0', 16) & 255].join('.');
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(a)) return hex(w[3], w[4]);
  if (/^64:ff9b::/i.test(a)) { const t = a.slice(9); if (net.isIPv4(t)) return t; const [h, l] = t.split(':'); return hex(h, l); }
  if (/^2002:/i.test(a)) return hex(w[1], w[2]);
  return null;
}
function blockedIp(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const fam = net.isIP(a); if (!fam) return true; // illisible : refusé
  if (fam === 4) return BLOCK.check(a, 'ipv4');
  const v4 = v4Inside(a); if (v4 && net.isIPv4(v4)) return BLOCK.check(v4, 'ipv4');
  return BLOCK.check(a, 'ipv6');
}
const UA = process.env.USER_AGENT || 'Nonobstant/1 (archivage de sources citees)';

function fetchPublicFull(url, { max = 3_000_000, timeout = 15_000, hops = 3, headers = {}, strict = false, ua = UA } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('adresse invalide')); }
    const open = process.env.FETCH_ALLOW_PRIVATE === '1';
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port) && !open) || u.username || u.password) return reject(new Error('adresse refusée'));
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) && blockedIp(bare) && !open) return reject(new Error('adresse interne refusée'));
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    // Respecte opts.all : toutes les adresses renvoyées par le DNS sont vérifiées, pas seulement la première
    const lookup = (host, o, cb) => require('dns').lookup(host, { ...o, all: true }, (err, list) => {
      if (err) return cb(err);
      if (!list.length) return cb(new Error('site injoignable'));
      if (!open && list.some(x => blockedIp(x.address))) return cb(new Error('adresse interne refusée'));
      if (o && o.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
    const kill = setTimeout(() => req.destroy(new Error('délai dépassé')), timeout * 4);
    const done = (fn, v) => { clearTimeout(kill); fn(v); };
    const req = lib.get(u, { lookup, timeout, headers: { 'user-agent': ua, ...headers } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops <= 0) return done(reject, new Error('trop de redirections'));
        clearTimeout(kill);
        return resolve(fetchPublicFull(new URL(res.headers.location, u).href, { max, timeout, hops: hops - 1, headers, strict, ua }));
      }
      if (res.statusCode === 304) { res.resume(); return done(resolve, { status: 304, headers: res.headers, buf: Buffer.alloc(0), url: u.href }); }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return done(reject, new Error('HTTP ' + res.statusCode)); }
      if (strict && +(res.headers['content-length'] || 0) > max) { res.destroy(); return done(reject, new Error('trop lourd')); }
      let size = 0; const parts = [];
      const out = () => ({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(parts), url: u.href });
      res.on('data', c => { size += c.length; if (size > max) { res.destroy(); strict ? done(reject, new Error('trop lourd')) : done(resolve, out()); } else parts.push(c); });
      res.on('end', () => done(resolve, out()));
      res.on('error', () => done(reject, new Error('lecture interrompue')));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e => done(reject, new Error(/interne|refusée|délai/.test(e.message) ? e.message : 'site injoignable')));
  });
}
const fetchPublic = (url, opts = {}) => fetchPublicFull(url, opts).then(r => r.buf.toString('utf8'));
// Texte d'une réponse, en tenant compte des vieux encodages encore servis par des sites officiels
function textOf(buf, ctype) {
  let text = buf.toString('utf8');
  if (/charset=(iso-8859-1|latin1|windows-1252)/i.test(ctype || '') || /<meta[^>]+charset=["']?(iso-8859-1|windows-1252)/i.test(text.slice(0, 3000))) text = buf.toString('latin1');
  return text;
}

module.exports = { fetchPublic, fetchPublicFull, blockedIp, textOf, UA };
