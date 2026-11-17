// HTTPS test: starts real servers and checks HTTPS, the http:// → https:// redirect on the same port,
// secure WebSockets and certificate handling.
//   node tools/tls-test.js                     TLS_MODE=files with a self-signed certificate (needs openssl)
//   PEBBLE_DIR=/path/to/pebble node tools/tls-test.js
//                                              also TLS_MODE=auto against Pebble (Let's Encrypt's test server)
//                                              with the Cloudflare DNS check (mocked API) and the http check.
//                                              PEBBLE_DIR = a pebble checkout with built pebble + pebble-challtestsrv in ./bin
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-tls-'));
const procs = [];
const cleanup = () => { for (const p of procs) try { p.kill('SIGKILL'); } catch { /* gone */ } fs.rmSync(tmp, { recursive: true, force: true }); };
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
const ok = m => { n++; console.log(`  ✔ ${m}`); };

function start(cmd, args, { env = {}, cwd = ROOT, name = cmd } = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  p.out = '';
  p.stdout.on('data', d => { p.out += d; });
  p.stderr.on('data', d => { p.out += d; });
  p.name = name;
  procs.push(p);
  return p;
}
async function waitFor(p, re, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (re.test(p.out)) return;
    if (p.exitCode != null) break;
    await sleep(100);
  }
  throw new Error(`${p.name}: timed out waiting for ${re}\n--- output ---\n${p.out.slice(-3000)}`);
}
function request(url, { ca, method = 'GET', body, headers = {} } = {}) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method, ca, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, servername: u.hostname === '127.0.0.1' ? undefined : u.hostname, lookup: (h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) }, res => {
      let data = ''; res.on('data', d => { data += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
let portBase = 18_400 + Math.floor(Math.random() * 500);
const nextPort = () => portBase++;

async function checkServer({ port, host, ca, label }) {
  const base = `https://${host}:${port}`;
  const h = await request(`${base}/api/health`, { ca });
  assert.equal(h.status, 200);
  ok(`${label}: HTTPS works (certificate trusted for ${host})`);
  const r = await request(`http://${host}:${port}/bestiary?x=1`);
  assert.equal(r.status, 308);
  assert.equal(r.headers.location, `https://${host}:${port}/bestiary?x=1`);
  ok(`${label}: http:// on the same port redirects to https://`);
  const reg = await request(`${base}/api/register`, { ca, method: 'POST', body: { username: `tls${port}`, password: 'secret123' } });
  const token = JSON.parse(reg.body).token;
  assert.ok(token, reg.body);
  const ws = new WebSocket(`wss://${host}:${port}/ws?token=${token}`, { ca, lookup: (h2, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) });
  const welcome = await new Promise((res, rej) => { ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'welcome') res(m); }); ws.on('error', rej); setTimeout(() => rej(new Error('no welcome')), 10_000); });
  assert.ok(welcome.playerId);
  ws.close();
  ok(`${label}: secure WebSocket (wss://) connects`);
}

// ---------------------------------------------------------------- 1. TLS_MODE=files
{
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { console.log('openssl not found — skipping the files test'); process.exit(0); }
  const dir = path.join(tmp, 'files');
  fs.mkdirSync(path.join(dir, 'tls'), { recursive: true });
  const cert = path.join(dir, 'tls/fullchain.pem'), key = path.join(dir, 'tls/privkey.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '30', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const port = nextPort(), httpPort = nextPort();
  const srv = start('node', ['server/index.js'], { name: 'server(files)', env: { DATA_DIR: dir, PORT: String(port), TLS_MODE: 'files', TLS_CERT: cert, TLS_KEY: key, HTTP_PORT: String(httpPort), DOMAIN: 'localhost', BACKUP_HOURS: '0' } });
  await waitFor(srv, /listening on https:\/\/localhost/);
  const ca = fs.readFileSync(cert);
  await checkServer({ port, host: 'localhost', ca, label: 'files' });
  const r = await request(`http://localhost:${httpPort}/`);
  assert.equal(r.status, 308); assert.equal(r.headers.location, `https://localhost:${port}/`);
  ok('files: HTTP_PORT redirects to the game port');
  // missing files: the server still starts (plain HTTP) and says what is wrong
  srv.kill('SIGTERM');
  const p2 = nextPort();
  const bad = start('node', ['server/index.js'], { name: 'server(bad files)', env: { DATA_DIR: dir, PORT: String(p2), TLS_MODE: 'files', TLS_CERT: path.join(dir, 'nope.pem'), BACKUP_HOURS: '0' } });
  await waitFor(bad, /listening on http:\/\//);
  assert.match(bad.out, /File not found: .*nope\.pem/);
  assert.match(bad.out, /HTTPS is NOT active/);
  ok('files: a missing certificate is reported and the game still starts on HTTP');
  bad.kill('SIGTERM');
  const p3 = nextPort();
  const off = start('node', ['server/index.js'], { name: 'server(off)', env: { DATA_DIR: dir, PORT: String(p3), BACKUP_HOURS: '0' } });
  await waitFor(off, /listening on http:\/\//);
  assert.equal((await request(`http://127.0.0.1:${p3}/api/health`)).status, 200);
  ok('TLS_MODE off (default): plain HTTP as before');
  off.kill('SIGTERM');
}

// ---------------------------------------------------------------- 2. TLS_MODE=auto against Pebble
const PEBBLE = process.env.PEBBLE_DIR;
if (!PEBBLE) {
  console.log('(set PEBBLE_DIR to also test Let\'s Encrypt certificates against Pebble)');
} else {
  const bin = f => path.join(PEBBLE, 'bin', f);
  const pebbleCa = path.join(PEBBLE, 'test/certs/pebble.minica.pem');
  const chall = start(bin('pebble-challtestsrv'), ['-defaultIPv4', '127.0.0.1', '-defaultIPv6', '', '-dns01', ':8053', '-http01', '', '-https01', '', '-tlsalpn01', '', '-doh', ''], { name: 'challtestsrv' });
  await sleep(500);
  const pebble = start(bin('pebble'), ['-config', 'test/config/pebble-config.json', '-dnsserver', '127.0.0.1:8053', '-strict'], { cwd: PEBBLE, name: 'pebble', env: { PEBBLE_VA_NOSLEEP: '1', PEBBLE_WFE_NONCEREJECT: '0', PEBBLE_VA_ALWAYS_VALID: '0' } });
  await waitFor(pebble, /ACME directory available/);
  // mock of the Cloudflare API: TXT records go into the test DNS server that Pebble asks
  const cfLog = [];
  const records = new Map();
  const zone = { id: 'zone123', name: 'ashen.test', name_servers: [] };
  const cfPort = nextPort();
  const cf = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== 'Bearer cf-test-token') return send(403, { success: false, errors: [{ code: 9109, message: 'Invalid access token' }] });
    const u = new URL(req.url, 'http://x');
    let body = ''; for await (const c of req) body += c;
    cfLog.push(`${req.method} ${u.pathname}`);
    if (req.method === 'GET' && u.pathname === '/zones') return send(200, { success: true, result: u.searchParams.get('name') === 'ashen.test' ? [zone] : [] });
    if (req.method === 'GET' && u.pathname === '/zones/zone123/dns_records') return send(200, { success: true, result: [...records.values()].filter(r => r.name === u.searchParams.get('name')) });
    if (req.method === 'POST' && u.pathname === '/zones/zone123/dns_records') {
      if (cf.failNext) { cf.failNext = false; return send(500, { success: false, errors: [{ code: 1000, message: 'temporary failure' }] }); }
      const rec = { ...JSON.parse(body), id: `r${records.size + 1}` };
      records.set(rec.id, rec);
      await fetch('http://127.0.0.1:8055/set-txt', { method: 'POST', body: JSON.stringify({ host: `${rec.name}.`, value: rec.content }) });
      return send(200, { success: true, result: rec });
    }
    const del = /^\/zones\/zone123\/dns_records\/(\w+)$/.exec(u.pathname);
    if (req.method === 'DELETE' && del) {
      const rec = records.get(del[1]); records.delete(del[1]);
      if (rec) await fetch('http://127.0.0.1:8055/clear-txt', { method: 'POST', body: JSON.stringify({ host: `${rec.name}.` }) });
      return send(200, { success: true, result: { id: del[1] } });
    }
    send(404, { success: false, errors: [{ code: 7003, message: 'no route' }] });
  }).listen(cfPort);

  const acmeEnv = { ACME_DIRECTORY: 'https://127.0.0.1:14000/dir', NODE_EXTRA_CA_CERTS: pebbleCa, BACKUP_HOURS: '0', ACME_EMAIL: 'admin@ashen.test' };
  // Pebble signs with a fresh random root: fetch it to trust the issued certificates
  const pebbleRoot = async () => (await request('https://127.0.0.1:15000/roots/0', { ca: fs.readFileSync(pebbleCa) })).body;

  // 2a. dns-cloudflare
  {
    const dir = path.join(tmp, 'auto-dns');
    const port = nextPort();
    const env = { ...acmeEnv, DATA_DIR: dir, PORT: String(port), TLS_MODE: 'auto', DOMAIN: 'game.ashen.test', ACME_CHALLENGE: 'dns-cloudflare', CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_API_URL: `http://127.0.0.1:${cfPort}`, ACME_DNS_RESOLVER: '127.0.0.1:8053' };
    const srv = start('node', ['server/index.js'], { name: 'server(dns)', env });
    await waitFor(srv, /listening on https:\/\/game\.ashen\.test/, 90_000);
    assert.match(srv.out, /got a certificate for game\.ashen\.test/);
    assert.ok(cfLog.includes('POST /zones/zone123/dns_records') && cfLog.some(l => l.startsWith('DELETE')), cfLog.join(', '));
    assert.equal(records.size, 0, 'the challenge record is removed again');
    ok('auto (dns-cloudflare): certificate issued, DNS record added and removed via the Cloudflare API');
    await checkServer({ port, host: 'game.ashen.test', ca: await pebbleRoot(), label: 'auto' });
    assert.ok(fs.existsSync(path.join(dir, 'tls/game.ashen.test.crt.pem')));
    srv.kill('SIGTERM');
    await sleep(500);
    // restart: the stored certificate is reused, no new request
    cfLog.length = 0;
    const port2 = nextPort();
    const again = start('node', ['server/index.js'], { name: 'server(dns restart)', env: { ...env, PORT: String(port2) } });
    await waitFor(again, /listening on https:\/\//);
    assert.ok(!/requesting a certificate/.test(again.out) && !cfLog.length, again.out + '\n' + cfLog.join(','));
    ok('auto: a stored certificate is reused after a restart');
    // console: tls / tls renew
    again.stdin.write('tls renew\n');
    await waitFor(again, /switched to the renewed certificate/, 60_000);
    ok('auto: "tls renew" gets a new certificate and swaps it in without a restart');
    again.kill('SIGTERM');
  }
  // 2b. wrong token: clear error, server still starts on HTTP
  {
    const dir = path.join(tmp, 'auto-badtoken');
    const port = nextPort();
    const srv = start('node', ['server/index.js'], { name: 'server(bad token)', env: { ...acmeEnv, DATA_DIR: dir, PORT: String(port), TLS_MODE: 'auto', DOMAIN: 'game.ashen.test', CLOUDFLARE_API_TOKEN: 'wrong', CLOUDFLARE_API_URL: `http://127.0.0.1:${cfPort}`, ACME_DNS_RESOLVER: '127.0.0.1:8053' } });
    await waitFor(srv, /listening on http:\/\//, 60_000);
    assert.match(srv.out, /Invalid access token.*check that the API token has Zone → DNS → Edit/s);
    ok('auto: a wrong Cloudflare token is reported clearly, the game still starts');
    srv.kill('SIGTERM');
  }
  // 2c. first attempt fails → starts on HTTP; a later success switches the port over to HTTPS
  {
    const dir = path.join(tmp, 'auto-switch');
    const port = nextPort();
    cf.failNext = true;
    const srv = start('node', ['server/index.js'], { name: 'server(switch)', env: { ...acmeEnv, DATA_DIR: dir, PORT: String(port), TLS_MODE: 'auto', DOMAIN: 'late.ashen.test', CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_API_URL: `http://127.0.0.1:${cfPort}`, ACME_DNS_RESOLVER: '127.0.0.1:8053' } });
    await waitFor(srv, /listening on http:\/\//, 60_000);
    assert.match(srv.out, /temporary failure/);
    const reg = await request(`http://127.0.0.1:${port}/api/register`, { method: 'POST', body: { username: 'early', password: 'secret123' } });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${JSON.parse(reg.body).token}`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d).t));
    await new Promise(r => ws.on('open', r));
    srv.stdin.write('tls renew\n');
    await waitFor(srv, /Now listening on https:\/\/late\.ashen\.test/, 60_000);
    await sleep(300);
    assert.ok(msgs.includes('client_update'), 'open pages are told to reload');
    await checkServer({ port, host: 'late.ashen.test', ca: await pebbleRoot(), label: 'switch' });
    ok('auto: started on HTTP after a failure, switched the port to HTTPS once the certificate arrived');
    srv.kill('SIGTERM');
  }
  // 2d. http challenge on HTTP_PORT (Pebble checks port 5002)
  {
    const dir = path.join(tmp, 'auto-http');
    const port = nextPort();
    const srv = start('node', ['server/index.js'], { name: 'server(http)', env: { ...acmeEnv, DATA_DIR: dir, PORT: String(port), TLS_MODE: 'auto', DOMAIN: 'web.ashen.test', ACME_CHALLENGE: 'http', HTTP_PORT: '5002' } });
    await waitFor(srv, /listening on https:\/\/web\.ashen\.test/, 90_000);
    ok('auto (http): certificate issued through the http check on HTTP_PORT');
    const r = await request('http://web.ashen.test:5002/x');
    assert.equal(r.status, 308); assert.equal(r.headers.location, `https://web.ashen.test:${port}/x`);
    ok('auto (http): HTTP_PORT redirects to https:// afterwards');
    srv.kill('SIGTERM');
  }
  cf.close();
}
console.log(`HTTPS: all ${n} checks passed.`);
process.exit(0);
