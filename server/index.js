// Ashenvale Idle server: static files + JSON API + WebSocket game channel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { AssetIndex } from './assets.js';
import { assetReport } from './asset-report.js';
import { Game } from './game.js';
import { CONTENT, replaceContent } from '../shared/content.js';
import { validateContent } from './content-check.js';
import { ContentManager } from './content-admin.js';
import { LevelSimRunner } from './levelSim.js';
import { BotManager, ARCHETYPES } from './bots.js';
import { computeBuildId } from './version.js';
import { TlsManager } from './tls.js';
import { createListener } from './listener.js';
import { Settings } from './settings.js';
import { AdminManager, isBanned } from './admin.js';
import { execFile } from 'node:child_process';
import { createAccount, verifyLogin, issueToken, accountFromToken, revokeToken, RateLimiter } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 8080);
const APP_NAME = process.env.APP_NAME || 'Ashenvale Idle';
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || APP_NAME.split(' ')[0];
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const log = (...a) => console.log(new Date().toISOString(), ...a);
let store;
try { store = new Store(DATA_DIR, { log }); } catch (e) { log('Could not open the database:', e.message); process.exit(1); }
const assets = new AssetIndex(ASSETS_DIR);
const settings = new Settings(store, { registrationOpen: ALLOW_REGISTRATION });
const admins = new AdminManager(store, process.env.ADMIN_USERS || '');
// ---- game content: validate before anything uses it
{
  const { errors, warnings } = validateContent(CONTENT);
  for (const w of warnings) log(`Content warning: ${w}`);
  if (errors.length) {
    log(`Game content has ${errors.length} error(s) — fix them in content/*.json${CONTENT._meta.overrides.length ? ` or ${CONTENT._meta.overrideDir}` : ''}:`);
    for (const e of errors) log(`  ✘ ${e}`);
    process.exit(1);
  }
  if (CONTENT._meta.overrides.length) log(`Content overrides loaded from ${CONTENT._meta.overrideDir}: ${CONTENT._meta.overrides.join(', ')}`);
}
let contentJson = JSON.stringify(CONTENT);
const buildId = () => `${computeBuildId(ROOT).slice(0, 8)}${CONTENT._meta.hash.slice(0, 4)}`;
const game = new Game({ store, assets, log, settings, admins, buildId: buildId() });
const bots = new BotManager(game, { log });
game.bots = bots;
// ---- admin content editor: changes are saved as overrides and applied live
function applyContent(fresh) {
  replaceContent(fresh);
  contentJson = JSON.stringify(CONTENT);
  game.buildId = buildId();
  // open pages fetch the new content and redraw — no reload needed
  game.broadcast({ t: 'content_update', buildId: game.buildId, hash: CONTENT._meta.hash });
  log(`Content updated live (${CONTENT._meta.hash}).`);
}
game.content = new ContentManager({ apply: applyContent, usage: id => store.countPlayersMentioning(id) });
// XP curve test runs (bots on a fast-forwarded clock, in a separate low-priority process)
game.levelSim = new LevelSimRunner({ dataDir: DATA_DIR, settings: game.settings, log });
game.loadGroups();
const authLimiter = new RateLimiter(20, 60_000);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function sendText(res, type, body, headers = {}) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

// Web app manifest. Your own icons override the defaults: public/assets/ui/app-icon-192.png and app-icon-512.png
function appManifest() {
  const own = size => fs.existsSync(path.join(PUBLIC_DIR, 'assets', 'ui', `app-icon-${size}.png`));
  const icon = (size, purpose = 'any') => ({ src: own(size) ? `/assets/ui/app-icon-${size}.png` : `/icons/${purpose === 'maskable' ? 'maskable' : 'icon'}-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose });
  return {
    id: '/', name: APP_NAME, short_name: APP_SHORT_NAME, description: 'Multiplayer idle RPG — build your party, script their tactics, conquer together.',
    start_url: '/?source=app', scope: '/', display: 'standalone', orientation: 'any',
    background_color: '#120d0b', theme_color: '#120d0b', categories: ['games'],
    icons: [icon(192), icon(512), icon(512, 'maskable')],
  };
}

// Service worker: network-first (so updates arrive immediately), cached copy when offline.
// The cache name contains the build id, so every update replaces the old cache.
function serviceWorkerSource() {
  return `// Ashenvale Idle service worker — build ${game.buildId}
const CACHE = 'ashenvale-${game.buildId}';
const SHELL = ['/', '/css/style.css', '/js/main.js', '/favicon.svg', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ashenvale-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/sw.js') return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
`;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res, baseDir, relPath) {
  const decoded = decodeURIComponent(relPath);
  const file = path.normalize(path.join(baseDir, decoded));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const isAsset = file.startsWith(ASSETS_DIR);
    const etag = `"${st.size}-${st.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, ETag: etag,
      'Cache-Control': isAsset ? 'public, max-age=300' : 'no-cache', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, online: game.sessions.size });
    if (p === '/api/assets') return json(res, 200, { assets: assets.get() });
    // game content (content/*.json + overrides) — the browser loads the same data the server uses
    if (p === '/api/content') {
      const etag = `"${CONTENT._meta.hash}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: etag });
      return res.end(contentJson);
    }
    // installable app (PWA)
    if (p === '/manifest.webmanifest') return sendText(res, MIME['.webmanifest'], JSON.stringify(appManifest()));
    if (p === '/sw.js') return sendText(res, MIME['.js'], serviceWorkerSource(), { 'Service-Worker-Allowed': '/' });
    if (p === '/api/register' && req.method === 'POST') {
      if (!authLimiter.allow(clientIp(req))) return json(res, 429, { error: 'Too many attempts, try again in a minute' });
      if (!settings.get('registrationOpen')) return json(res, 403, { error: 'Registration is currently closed on this server' });
      const body = await readBody(req);
      try {
        const acc = createAccount(store, body.username, body.password);
        store.flush();
        log('New account', acc.username);
        return json(res, 200, { token: issueToken(store, acc), username: acc.username });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/login' && req.method === 'POST') {
      if (!authLimiter.allow(clientIp(req))) return json(res, 429, { error: 'Too many attempts, try again in a minute' });
      const body = await readBody(req);
      try {
        const acc = verifyLogin(store, body.username, body.password);
        if (isBanned(acc)) return json(res, 403, { error: `This account is banned${acc.banned.until ? ` until ${new Date(acc.banned.until).toUTCString()}` : ''}: ${acc.banned.reason}` });
        const token = issueToken(store, acc);
        store.flush();
        return json(res, 200, { token, username: acc.username });
      } catch (e) { return json(res, 401, { error: e.message }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const body = await readBody(req);
      revokeToken(store, body.token);
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p.startsWith('/shared/')) return serveStatic(req, res, SHARED_DIR, p.slice('/shared/'.length));
    return serveStatic(req, res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    log('HTTP error', e);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  const account = accountFromToken(store, url.searchParams.get('token'));
  if (!account || isBanned(account)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => {
    const session = game.connect(ws, account);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', data => game.handleMessage(session, ws, data.toString()));
    ws.on('close', () => game.disconnect(ws, account.id));
    ws.on('error', () => {});
  });
}

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

game.start();
bots.start();
if (bots.bots.size) log(`${bots.bots.size} bot player(s) loaded${bots.enabled ? '' : ' (paused)'} — type "bots" to list them.`);
// automatic daily database backup (data/backups, newest 7 kept)
const BACKUP_HOURS = Number(process.env.BACKUP_HOURS ?? 24);
if (BACKUP_HOURS > 0) setInterval(() => { try { log(`Automatic backup: ${path.basename(store.backup())}`); } catch (e) { log('Automatic backup failed:', e.message); } }, BACKUP_HOURS * 3600_000).unref();
// ---- HTTP / HTTPS (server/tls.js: TLS_MODE=auto gets Let's Encrypt certificates, TLS_MODE=files uses your own)
let listener = null;
function startListener(creds, first = false) {
  listener = createListener({ handler: handleRequest, onUpgrade: handleUpgrade, creds, tls, port: PORT, log });
  listener.listen(HOST, () => {
    const st = store.stats();
    const proto = creds ? 'https' : 'http';
    const where = creds && tls.config.domain ? `https://${tls.config.domain}${PORT === 443 ? '' : `:${PORT}`}` : `${proto}://${HOST}:${PORT}`;
    if (first) log(`Ashenvale Idle server listening on ${where} (database: ${store.file}, ${st.accounts} accounts, ${st.sizeMb} MB, ${st.driver}; build ${game.buildId})`);
    else log(`Now listening on ${where}.`);
    if (first) log('Type "help" for console commands (e.g. "update" to pull a new version).');
  });
}
const tls = new TlsManager({ dataDir: DATA_DIR, log, root: ROOT });
game.tls = tls;
const creds = await tls.init();
if (tls.enabled && !creds) log(`TLS: HTTPS is NOT active — the game runs on plain HTTP until a certificate is available${tls.config.mode === 'auto' && !tls.config.errors.length ? ' (retrying automatically)' : ''}. Fix the problem above${tls.config.mode === 'files' ? ' and restart' : ''}.`);
startListener(creds, true);
tls.onChange(next => {
  if (listener.secure) { listener.setCredentials(next); log('TLS: switched to the renewed certificate.'); return; }
  // first certificate after starting without one: move the port over to HTTPS
  log('TLS: certificate ready — switching to HTTPS (open pages reload and are redirected to https://).');
  game.broadcast({ t: 'client_update', buildId: game.buildId, force: true });
  setTimeout(() => {
    for (const ws of wss.clients) ws.close(1012, 'Switching to HTTPS');
    listener.close(() => startListener(next));
  }, 1500);
});
tls.startRenewal();

let stopping = false;
function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log(`${sig} received, saving and shutting down...`);
  try { game.broadcast({ t: 'server_restart' }); } catch { /* ignore */ }
  try { bots.stop(); bots.persist(); } catch (e) { log('Error while stopping bots', e); }
  try { game.stop(); } catch (e) { log('Error while saving', e); }
  try { store.close(); } catch (e) { log('Error while closing the database', e); }
  for (const ws of wss.clients) ws.close(1012, 'Server restarting');
  tls.stop();
  game.levelSim.stop();
  listener.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// ------------------------------------------------------------------ console commands (Pterodactyl console / terminal)
const git = args => new Promise((resolve, reject) => execFile('git', args, { cwd: ROOT, timeout: 120_000 }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim())) : resolve(out.trim()))));
let updating = false;

async function runUpdate() {
  if (updating) return log('Update already running');
  updating = true;
  try {
    const before = await git(['rev-parse', 'HEAD']);
    log('Pulling latest version from git...');
    // package-lock.json is rewritten by "npm install" on start (other npm version) — that is never a real
    // local change, so throw it away instead of letting it block the update
    await git(['checkout', '--', 'package-lock.json']).catch(() => {});
    try { await git(['pull', '--ff-only']); } catch (e) {
      const files = [...e.message.matchAll(/^\s+(\S+)$/gm)].map(m => m[1]).filter(f => !/^(error|Please|Aborting)/.test(f));
      if (/local changes/.test(e.message)) throw new Error(`these files were changed on the server and would be overwritten: ${files.join(', ') || '(see above)'}. Move your changes to data/ (overrides) or public/assets/, or use "Reinstall Server" in the panel (keeps data/ and uploaded images) — then run update again.\n${e.message}`);
      throw e;
    }
    const after = await git(['rev-parse', 'HEAD']);
    if (before === after) return log('Already up to date.');
    const changed = (await git(['diff', '--name-only', before, after])).split('\n').filter(Boolean);
    const serverSide = changed.filter(f => /^(server|shared|content)\//.test(f) || /^package(-lock)?\.json$/.test(f));
    log(`Updated ${before.slice(0, 7)} -> ${after.slice(0, 7)} (${changed.length} file(s) changed)`);
    if (serverSide.length) {
      log(`Server-side files changed (${serverSide.slice(0, 5).join(', ')}${serverSide.length > 5 ? ', ...' : ''}).`);
      log('>>> A RESTART is required to apply them. Players reconnect automatically after the restart.');
      game.broadcast({ t: 'toast', kind: 'info', text: 'A game update is ready — the server will restart briefly soon. You will reconnect automatically.' });
    } else {
      game.buildId = buildId();
      game.broadcast({ t: 'client_update', buildId: game.buildId });
      log('Client-only update applied live — no restart needed. Open game pages refresh themselves.');
    }
  } catch (e) {
    log('Update failed:', e.message);
  } finally {
    updating = false;
  }
}

const COMMANDS = {
  help: () => log('Commands: update | reload-clients | players | say <message> | assets [list|<section>] | admin add|remove|list <name> | bots [add <n> [type] | remove <name|all> | on | off] | content [reload] | tls [renew] | backup | db | stop'),
  content: async args => {
    // "content" checks the files on disk; "content reload" also switches the running server to them
    try {
      const { loadContentFromDisk } = await import('./content-loader.js');
      const fresh = loadContentFromDisk();
      const { errors, warnings } = validateContent(fresh);
      for (const w of warnings) log(`  ! ${w}`);
      for (const e of errors) log(`  ✘ ${e}`);
      const changed = fresh._meta.hash !== CONTENT._meta.hash;
      if (args.trim() === 'reload') {
        if (errors.length) return log(`Not reloaded — content has ${errors.length} error(s).`);
        if (!changed) return log('Content is unchanged.');
        game.content.refresh();
        return applyContent(fresh);
      }
      log(errors.length ? `Content has ${errors.length} error(s) — the server would refuse to start with it.` : `Content OK${changed ? ' — it differs from the running version: type "content reload" to apply it now.' : ' (same as the running version).'}`);
    } catch (e) { log(`Content could not be loaded: ${e.message}`); }
  },
  bots: args => {
    const [sub, a, b] = args.split(/\s+/).filter(Boolean);
    if (sub === 'add') { const made = bots.add(Number(a) || 1, b); return log(`Added ${made.length} bot(s): ${made.map(x => `${x.name} (${x.archetype})`).join(', ')}. Types: ${Object.keys(ARCHETYPES).join(', ')}`); }
    if (sub === 'remove') return log(a ? `Removed ${bots.remove(a)} bot(s).` : 'Usage: bots remove <name|all>');
    if (sub === 'on' || sub === 'off') { bots.setEnabled(sub === 'on'); return log(`Bots ${sub === 'on' ? 'running' : 'paused'}.`); }
    const list = bots.list();
    log(`${list.length} bot(s), ${list.filter(x => x.online).length} online${bots.enabled ? '' : ' — PAUSED (bots on)'}. Add: bots add <n> [${Object.keys(ARCHETYPES).join('|')}]`);
    for (const x of list) log(`  ${x.online ? '●' : '○'} ${x.name.padEnd(16)} ${String(x.label).padEnd(8)} ${x.hero ? `Lv ${String(x.hero.level).padStart(2)} ${x.hero.classId.padEnd(7)}` : 'no hero    '} ${x.doing}`);
  },
  // "assets" = missing images per section, "assets list" = every missing file, "assets <word>" = only matching sections
  assets: args => {
    const r = assetReport(assets.get());
    const arg = args.trim().toLowerCase();
    log(`Artwork: ${r.found} of ${r.total} images present, ${r.missing} missing (${r.missingRecommended} recommended, ${r.missing - r.missingRecommended} optional). Folder: public/assets/<folder>/<name>.png|webp|jpg…`);
    const secs = r.sections.map(x => ({ ...x, miss: x.entries.filter(e => !e.ok) })).filter(x => x.miss.length).sort((a, b) => a.optional - b.optional);
    if (!arg) {
      for (const x of secs) log(`  ${String(x.miss.length).padStart(3)} missing  ${x.title}`);
      return log('Type "assets list" for every missing file name, "assets <section>" (e.g. "assets enemies") for one section, or see Admin → 🖼 Assets.');
    }
    const pick = arg === 'list' || arg === 'all' ? secs : secs.filter(x => x.title.toLowerCase().includes(arg) || x.folder.includes(arg));
    if (!pick.length) return log(`No section with missing images matches "${arg}".`);
    for (const x of pick) { log(`${x.title} (${x.miss.length} missing):`); for (const e of x.miss) log(`  ${e.file.padEnd(40)} ${e.name}`); }
  },
  backup: () => { try { log(`Backup written: ${store.backup()}`); } catch (e) { log('Backup failed:', e.message); } },
  db: () => { const st = store.stats(); log(`Database ${store.file}: ${st.accounts} accounts, ${st.players} players, ${st.sizeMb} MB (driver: ${st.driver})`); },
  admin: args => {
    const [sub, name] = args.split(/\s+/);
    if (sub === 'list') return log('Admins:', admins.list().join(', ') || '(none)');
    if (!name || !['add', 'remove'].includes(sub)) return log('Usage: admin add <username> | admin remove <username> | admin list');
    if (!store.getAccount(name)) return log(`No account named "${name}"`);
    if (sub === 'add') { admins.add(name); log(`${name} is now an admin (they may need to refresh the page).`); }
    else log(admins.remove(name) ? `${name} is no longer an admin.` : `${name} is set via ADMIN_USERS — remove them there.`);
  },
  tls: async args => {
    const st = tls.status();
    if (st.mode === 'off') return log('HTTPS is off. Set TLS_MODE=auto (Let\'s Encrypt) or TLS_MODE=files in the server variables — see README → HTTPS.');
    log(`HTTPS: mode ${st.mode}${st.challenge ? ` (${st.challenge})` : ''}, ${st.active ? 'ACTIVE' : 'NOT active'}${st.domains.length ? `, domain ${st.domains.join(', ')}` : ''}`);
    if (st.expires) log(`  certificate for ${st.names.join(', ')} valid until ${new Date(st.expires).toISOString().slice(0, 10)} (${Math.floor((st.expires - Date.now()) / 86400000)} days)${st.staging ? ' — STAGING certificate' : ''}; issuer ${st.issuer}`);
    if (st.error) log(`  last problem: ${st.error}`);
    if (args.trim() === 'renew') {
      if (st.mode !== 'auto') return log('Only TLS_MODE=auto certificates can be renewed from here (for files: replace the files, they are picked up within 12 h, or restart).');
      try { await tls.obtain(); } catch (e) { log(`Renewal failed: ${e.message}`); }
    } else if (st.mode === 'auto') log('  "tls renew" gets a fresh certificate now (Let\'s Encrypt allows 5 per week for the same domain).');
  },
  stop: () => shutdown('stop'),
  update: () => runUpdate(),
  'reload-clients': () => { game.buildId = buildId(); game.broadcast({ t: 'client_update', buildId: game.buildId, force: true }); log('Told all open pages to refresh.'); },
  players: () => log(`${game.sessions.size} online: ${[...game.sessions.values()].map(s => s.player.name).join(', ') || '-'}`),
  say: text => { if (text) { game.announce(text, 'Server', 24); log('Announcement sent (stays visible for 24h for players who are offline).'); } },
};
let stdinBuf = '';
process.stdin.on('data', d => {
  stdinBuf += d.toString();
  let i;
  while ((i = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, i).trim();
    stdinBuf = stdinBuf.slice(i + 1);
    if (!line) continue;
    const [cmd, ...rest] = line.split(' ');
    const fn = COMMANDS[cmd.toLowerCase()];
    if (fn) fn(rest.join(' ').trim()); else log(`Unknown command "${cmd}". Type "help".`);
  }
});
process.stdin.on('error', () => {});
