// HTTPS for the game server itself — no reverse proxy or panel/Wings changes needed.
// Configured with environment variables (egg variables on Pterodactyl):
//
//   TLS_MODE        off (default) | auto | files
//   DOMAIN          game.example.com (comma separated for more names; the first one is the main one)
//   ACME_EMAIL      e-mail for Let's Encrypt (expiry notices)                         [auto]
//   ACME_CHALLENGE  dns-cloudflare (default, works on any port) | http (needs port 80) [auto]
//   CLOUDFLARE_API_TOKEN   API token with "Zone → DNS → Edit" for the domain's zone    [dns-cloudflare]
//   CLOUDFLARE_ZONE_ID     optional, skips looking the zone up                          [dns-cloudflare]
//   ACME_STAGING    1 = Let's Encrypt staging (untrusted test certificates, for trying the setup)
//   TLS_CERT / TLS_KEY     certificate chain + private key (PEM)                        [files]
//   HTTP_PORT       optional second port serving http:// → https:// redirects and Let's Encrypt
//                   http challenges (must be reachable as port 80 for ACME_CHALLENGE=http)
//
// Certificates from Let's Encrypt are kept in <DATA_DIR>/tls/ and renewed automatically 30 days before
// they expire (or with a third of their lifetime left); the running server switches to the new certificate without a restart.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';

const LE_PRODUCTION = 'https://acme-v02.api.letsencrypt.org/directory';
const LE_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';
const DAY = 86400_000;
const RENEW_BEFORE = 30 * DAY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function tlsConfig(env = process.env, root = process.cwd()) {
  const mode = String(env.TLS_MODE || 'off').trim().toLowerCase();
  const domains = String(env.DOMAIN || '').split(',').map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[:/].*$/, '')).filter(Boolean);
  const c = {
    mode, domains, domain: domains[0] || null,
    email: String(env.ACME_EMAIL || '').trim(),
    challenge: String(env.ACME_CHALLENGE || 'dns-cloudflare').trim().toLowerCase(),
    cfToken: String(env.CLOUDFLARE_API_TOKEN || '').trim(),
    cfZoneId: String(env.CLOUDFLARE_ZONE_ID || '').trim(),
    cfApi: String(env.CLOUDFLARE_API_URL || 'https://api.cloudflare.com/client/v4').replace(/\/$/, ''),
    directoryUrl: env.ACME_DIRECTORY || (/^(1|true|yes)$/i.test(env.ACME_STAGING || '') ? LE_STAGING : LE_PRODUCTION),
    dnsResolver: String(env.ACME_DNS_RESOLVER || '').trim(), // testing: check TXT records on this server instead of the zone's nameservers
    certFile: path.resolve(root, env.TLS_CERT || 'data/tls/fullchain.pem'),
    keyFile: path.resolve(root, env.TLS_KEY || 'data/tls/privkey.pem'),
    httpPort: Number(env.HTTP_PORT) || null,
    errors: [],
  };
  if (!['off', 'auto', 'files'].includes(mode)) c.errors.push(`TLS_MODE must be off, auto or files (got "${mode}")`);
  if (mode === 'auto') {
    if (!c.domain) c.errors.push('TLS_MODE=auto needs DOMAIN (e.g. game.example.com) — a domain whose DNS points at this server');
    for (const d of domains) if (!/^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]+$/.test(d)) c.errors.push(`DOMAIN "${d}" is not a valid domain name`);
    if (!['dns-cloudflare', 'http'].includes(c.challenge)) c.errors.push(`ACME_CHALLENGE must be dns-cloudflare or http (got "${c.challenge}")`);
    if (c.challenge === 'dns-cloudflare' && !c.cfToken) c.errors.push('ACME_CHALLENGE=dns-cloudflare needs CLOUDFLARE_API_TOKEN (Cloudflare → My Profile → API Tokens → "Edit zone DNS")');
    if (c.challenge === 'http' && !c.httpPort) c.errors.push('ACME_CHALLENGE=http needs HTTP_PORT — a second allocation that is reachable as port 80 from the internet');
    if (c.challenge === 'http' && domains.some(d => d.startsWith('*.'))) c.errors.push('Wildcard domains need ACME_CHALLENGE=dns-cloudflare');
  }
  return c;
}

// ---------------------------------------------------------------- Cloudflare DNS (for dns-01 challenges)
export class CloudflareDns {
  constructor({ token, zoneId = '', api = 'https://api.cloudflare.com/client/v4' }) {
    this.token = token; this.zoneId = zoneId; this.api = api; this.zones = new Map();
  }
  async call(method, p, body) {
    const res = await fetch(this.api + p, {
      method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !data?.success) {
      const msg = data?.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
      throw new Error(`Cloudflare API ${method} ${p.split('?')[0]} failed — ${msg}${res.status === 403 || res.status === 401 ? ' (check that the API token has Zone → DNS → Edit for this domain)' : ''}`);
    }
    return data.result;
  }
  // the zone is the longest suffix of the name that Cloudflare knows (game.example.com → example.com)
  async zoneFor(name) {
    if (this.zoneId) {
      if (!this.zones.has(this.zoneId)) this.zones.set(this.zoneId, await this.call('GET', `/zones/${this.zoneId}`));
      return this.zones.get(this.zoneId);
    }
    const labels = name.replace(/^\*\./, '').split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      if (this.zones.has(candidate)) return this.zones.get(candidate);
      const list = await this.call('GET', `/zones?name=${encodeURIComponent(candidate)}`);
      if (list?.length) { this.zones.set(candidate, list[0]); return list[0]; }
    }
    throw new Error(`No Cloudflare zone found for ${name} — is the domain on this Cloudflare account, and may the token read it? (or set CLOUDFLARE_ZONE_ID)`);
  }
  async setTxt(name, value) {
    const zone = await this.zoneFor(name);
    // leftovers from an interrupted earlier attempt would only confuse the check
    const old = await this.call('GET', `/zones/${zone.id}/dns_records?type=TXT&name=${encodeURIComponent(name)}`);
    for (const r of old || []) await this.call('DELETE', `/zones/${zone.id}/dns_records/${r.id}`).catch(() => {});
    const rec = await this.call('POST', `/zones/${zone.id}/dns_records`, { type: 'TXT', name, content: value, ttl: 60, comment: 'ACME challenge (Ashenvale Idle) — removed automatically' });
    return { zone, id: rec.id };
  }
  async remove(zone, id) { await this.call('DELETE', `/zones/${zone.id}/dns_records/${id}`); }
}

// waits until the zone's own nameservers answer the TXT record (Let's Encrypt asks those, not a cache)
async function waitForTxt(name, value, { zone, resolverAddr, log, timeoutMs = 120_000 }) {
  const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 1 });
  if (resolverAddr) resolver.setServers([resolverAddr]);
  else {
    const ips = [];
    for (const ns of zone?.name_servers || []) { try { ips.push(...(await dns.promises.resolve4(ns))); } catch { /* skip */ } }
    if (ips.length) resolver.setServers(ips);
  }
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const recs = await resolver.resolveTxt(name);
      if (recs.some(parts => parts.join('') === value)) return true;
    } catch { /* not there yet */ }
    await sleep(3000);
  }
  log(`TLS: the DNS record ${name} is not visible yet after ${timeoutMs / 1000}s — asking Let's Encrypt to check anyway.`);
  return false;
}

// ---------------------------------------------------------------- certificates
function certInfo(pem) {
  try {
    const x = new crypto.X509Certificate(pem);
    const names = (x.subjectAltName || '').split(',').map(s => s.trim()).filter(s => s.startsWith('DNS:')).map(s => s.slice(4).toLowerCase());
    return { issued: Date.parse(x.validFrom), expires: Date.parse(x.validTo), names, issuer: x.issuer.replace(/\n/g, ', ') };
  } catch { return null; }
}

export class TlsManager {
  constructor({ dataDir, log = console.log, env = process.env, root = process.cwd() }) {
    this.config = tlsConfig(env, root);
    this.dir = path.join(dataDir, 'tls');
    this.log = log;
    this.creds = null;          // { key, cert }
    this.info = null;           // { expires, names, issuer }
    this.httpTokens = new Map(); // http-01 token → key authorization
    this.listeners = [];
    this.lastError = null;
    this.renewing = null;
  }
  get enabled() { return this.config.mode !== 'off'; }
  onChange(fn) { this.listeners.push(fn); }

  // → { key, cert } or null (TLS off, or no certificate could be loaded/obtained yet)
  async init() {
    const c = this.config;
    if (c.mode === 'off') return null;
    if (c.errors.length) { for (const e of c.errors) this.log(`TLS: ${e}`); this.lastError = c.errors.join('; '); return null; }
    if (c.mode === 'files') return this.loadFiles();
    // auto: reuse the stored certificate while it is good, otherwise get a new one
    const stored = this.loadStored();
    if (stored && !this.needsRenewal()) return stored;
    try { return await this.obtain(); } catch (e) {
      this.lastError = e.message;
      this.log(`TLS: could not get a certificate from Let's Encrypt: ${e.message}`);
      if (stored) { this.log('TLS: using the stored certificate for now; trying again later.'); return stored; }
      return null;
    }
  }

  loadFiles() {
    const c = this.config;
    try {
      const cert = fs.readFileSync(c.certFile, 'utf8'), key = fs.readFileSync(c.keyFile, 'utf8');
      crypto.createPrivateKey(key);
      const info = certInfo(cert);
      if (!info) throw new Error(`${c.certFile} is not a PEM certificate`);
      this.creds = { key, cert }; this.info = info; this.lastError = null;
      const days = Math.floor((info.expires - Date.now()) / DAY);
      this.log(`TLS: using certificate ${path.basename(c.certFile)} for ${info.names.join(', ') || '?'} (${days >= 0 ? `valid ${days} more days` : 'EXPIRED'}).`);
      if (c.domain && info.names.length && !info.names.some(n => n === c.domain || (n.startsWith('*.') && c.domain.endsWith(n.slice(1))))) this.log(`TLS: warning — the certificate does not cover DOMAIN ${c.domain}.`);
      return this.creds;
    } catch (e) {
      this.lastError = e.code === 'ENOENT' ? `File not found: ${e.path} (TLS_CERT / TLS_KEY)` : e.message;
      this.log(`TLS: ${this.lastError}`);
      return null;
    }
  }

  files() {
    const base = this.config.domain.replace(/^\*\./, '_wildcard.');
    return { account: path.join(this.dir, 'account-key.pem'), key: path.join(this.dir, `${base}.key.pem`), cert: path.join(this.dir, `${base}.crt.pem`), meta: path.join(this.dir, `${base}.json`) };
  }
  loadStored() {
    const f = this.files();
    try {
      const cert = fs.readFileSync(f.cert, 'utf8'), key = fs.readFileSync(f.key, 'utf8');
      const meta = JSON.parse(fs.readFileSync(f.meta, 'utf8'));
      const info = certInfo(cert);
      if (!info) return null;
      this.creds = { key, cert }; this.info = info; this.meta = meta;
      return this.creds;
    } catch { return null; }
  }
  needsRenewal() {
    const c = this.config;
    if (!this.info || !this.meta) return true;
    if (this.meta.directoryUrl !== c.directoryUrl) return true;                      // staging ↔ production
    if (c.domains.some(d => !this.info.names.includes(d))) return true;              // domains changed
    // 30 days before expiry, or with the last third of the lifetime left for short-lived certificates
    const lifetime = this.info.expires - this.info.issued;
    return this.info.expires - Date.now() < Math.min(RENEW_BEFORE, lifetime / 3);
  }

  async obtain() {
    if (this.renewing) return this.renewing;
    this.renewing = this.#obtain().finally(() => { this.renewing = null; });
    return this.renewing;
  }
  async #obtain() {
    const c = this.config;
    const acme = (await import('acme-client')).default;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const f = this.files();
    let accountKey;
    try { accountKey = fs.readFileSync(f.account); } catch {
      accountKey = await acme.crypto.createPrivateEcdsaKey();
      fs.writeFileSync(f.account, accountKey, { mode: 0o600 });
    }
    const staging = c.directoryUrl === LE_STAGING;
    this.log(`TLS: requesting a certificate for ${c.domains.join(', ')} from ${c.directoryUrl === LE_PRODUCTION ? "Let's Encrypt" : staging ? "Let's Encrypt STAGING (test certificates)" : c.directoryUrl} (${c.challenge} check)…`);
    const client = new acme.Client({ directoryUrl: c.directoryUrl, accountKey });
    const certKey = await acme.crypto.createPrivateEcdsaKey();
    const [, csr] = await acme.crypto.createCsr({ commonName: c.domains[0], altNames: c.domains }, certKey);
    const cf = c.challenge === 'dns-cloudflare' ? new CloudflareDns({ token: c.cfToken, zoneId: c.cfZoneId, api: c.cfApi }) : null;
    const records = new Map();
    // http check before the game is listening (first start): answer it from a short-lived server on HTTP_PORT.
    // Later (renewals) the port is already ours and the game's listener answers.
    const temp = cf ? null : await this.#tempChallengeServer();
    try {
    const cert = await client.auto({
      csr, email: c.email || undefined, termsOfServiceAgreed: true,
      challengePriority: [cf ? 'dns-01' : 'http-01'],
      skipChallengeVerification: true, // we check DNS ourselves (against the authoritative servers)
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type === 'http-01') { this.httpTokens.set(challenge.token, keyAuthorization); return; }
        const name = `_acme-challenge.${authz.identifier.value}`;
        const rec = await cf.setTxt(name, keyAuthorization);
        records.set(challenge.token, rec);
        this.log(`TLS: added DNS record ${name}, waiting until it is visible…`);
        await waitForTxt(name, keyAuthorization, { zone: rec.zone, resolverAddr: c.dnsResolver, log: this.log });
      },
      challengeRemoveFn: async (authz, challenge) => {
        if (challenge.type === 'http-01') { this.httpTokens.delete(challenge.token); return; }
        const rec = records.get(challenge.token);
        if (rec) await cf.remove(rec.zone, rec.id).catch(e => this.log(`TLS: could not remove the DNS record: ${e.message}`));
      },
    });
    return this.#store(cert, certKey, f, staging);
    } finally { temp?.close(); }
  }
  #tempChallengeServer() {
    return new Promise(resolve => {
      const srv = http.createServer((req, res) => {
        const answer = this.challengeAnswer(new URL(req.url, 'http://x').pathname);
        res.writeHead(answer == null ? 404 : 200, { 'Content-Type': 'text/plain' });
        res.end(answer ?? 'Not found');
      });
      srv.once('error', () => resolve(null)); // port taken — by our own listener, which answers too
      srv.listen(this.config.httpPort, process.env.HOST || '0.0.0.0', () => resolve(srv));
    });
  }
  #store(cert, certKey, f, staging) {
    const c = this.config;
    const keyPem = certKey.toString();
    const info = certInfo(cert);
    if (!info) throw new Error('Let\'s Encrypt returned something that is not a certificate');
    fs.writeFileSync(f.key, keyPem, { mode: 0o600 });
    fs.writeFileSync(f.cert, cert);
    fs.writeFileSync(f.meta, JSON.stringify({ directoryUrl: c.directoryUrl, domains: c.domains, obtainedAt: new Date().toISOString() }, null, 2));
    this.creds = { key: keyPem, cert }; this.info = info; this.meta = { directoryUrl: c.directoryUrl, domains: c.domains };
    this.lastError = null;
    this.log(`TLS: got a certificate for ${info.names.join(', ')}, valid until ${new Date(info.expires).toISOString().slice(0, 10)}${staging ? ' (STAGING — browsers will not trust it; set ACME_STAGING=0 when everything works)' : ''}.`);
    for (const fn of this.listeners) fn(this.creds);
    return this.creds;
  }

  // checks twice a day; renews 30 days before expiry. Without a certificate it retries sooner.
  startRenewal() {
    if (this.config.mode === 'off' || this.config.errors.length) return;
    let failures = 0;
    const tick = async () => {
      let next = 12 * 3600_000;
      try {
        if (this.config.mode === 'files') {
          // pick up replaced files (e.g. renewed by another tool)
          const cert = fs.readFileSync(this.config.certFile, 'utf8');
          if (cert !== this.creds?.cert && this.loadFiles()) { this.log('TLS: certificate files changed — switched to the new certificate.'); for (const fn of this.listeners) fn(this.creds); }
        } else if (this.needsRenewal()) { await this.obtain(); failures = 0; }
      } catch (e) {
        failures++;
        this.lastError = e.message;
        this.log(`TLS: renewal failed (${e.message}).`);
        // Let's Encrypt allows only a few failed checks per hour — back off
        if (!this.creds) next = Math.min(4, failures) * 15 * 60_000;
      }
      this.timer = setTimeout(tick, next);
      this.timer.unref?.();
    };
    this.timer = setTimeout(tick, this.creds ? 12 * 3600_000 : 15 * 60_000);
    this.timer.unref?.();
  }
  stop() { clearTimeout(this.timer); }

  // http-01 challenge answer for a request path, or null
  challengeAnswer(urlPath) {
    const m = /^\/\.well-known\/acme-challenge\/([\w-]+)$/.exec(urlPath || '');
    return m ? this.httpTokens.get(m[1]) ?? null : null;
  }

  status() {
    const c = this.config;
    return {
      mode: c.mode, domains: c.domains, challenge: c.mode === 'auto' ? c.challenge : null, httpPort: c.httpPort,
      active: !!this.creds, expires: this.info?.expires || null, names: this.info?.names || [], issuer: this.info?.issuer || null,
      staging: c.mode === 'auto' && c.directoryUrl === LE_STAGING, error: this.lastError,
    };
  }
}
